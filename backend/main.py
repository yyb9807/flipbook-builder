import os
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from agents.base import BaseLLMAgent, get_imggen_config, get_llm_config
from database import create_pool
from request_limits import RequestBodyLimitMiddleware
from routers import jobs, nodes, projects, publications, sources, versions

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    dsn = os.environ["DATABASE_URL"]
    app.state.pool = await create_pool(dsn)
    from jobs.service import JobService

    service = JobService(app.state.pool, dsn)
    app.state.jobs = service
    try:
        # Acquire executor ownership before schema migration or DBOS recovery.
        # The application schema is additive and must exist before workflows start.
        await service.start()
        yield
    finally:
        try:
            await service.stop()
        finally:
            await app.state.pool.close()
            app.state.jobs = None


app = FastAPI(title="Flipbook Builder API", lifespan=lifespan)
app.add_middleware(RequestBodyLimitMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv(
        "CORS_ORIGIN", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",") if origin.strip()],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 静态文件服务（上传的图片）
uploads_dir = Path(__file__).parent.parent / "data" / "uploads"
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    if request.url.path.startswith("/uploads/"):
        response.headers["Content-Security-Policy"] = "default-src 'none'; sandbox"
    return response

app.include_router(projects.router, prefix="/api")
app.include_router(nodes.router, prefix="/api")
app.include_router(jobs.router, prefix="/api")
app.include_router(versions.router, prefix="/api")
app.include_router(publications.router, prefix="/api")
app.include_router(sources.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/test-config")
async def test_config(request: Request):
    """测试用户在设置页填的 LLM / 图片生成配置是否有效。
    只做最小代价探活：LLM 发 1 条 'ping'，图片生成调用 /models 列表（不实际生成）。"""
    llm_cfg = get_llm_config(request)
    img_cfg = get_imggen_config(request)

    result = {
        "llm": {"ok": False, "key_length": len(llm_cfg.api_key or ""), "model": llm_cfg.model, "base_url": llm_cfg.base_url, "error": None, "latency_ms": None},
        "imggen": {"ok": False, "key_length": len(img_cfg.api_key or ""), "model": img_cfg.model, "base_url": img_cfg.base_url, "error": None, "latency_ms": None},
    }

    # ── LLM 探活 ──
    if not llm_cfg.api_key:
        result["llm"]["error"] = "API Key 为空"
    else:
        import time
        try:
            t0 = time.time()
            agent = BaseLLMAgent(llm_cfg)
            text = await agent.call(
                [{"role": "user", "content": "ping"}],
                max_tokens=10,
            )
            result["llm"]["ok"] = True
            result["llm"]["latency_ms"] = int((time.time() - t0) * 1000)
            result["llm"]["sample"] = (text or "")[:30]
        except httpx.HTTPStatusError as e:
            result["llm"]["error"] = f"HTTP {e.response.status_code}: {e.response.text[:200]}"
        except Exception as e:
            result["llm"]["error"] = str(e)[:200]

    # ── 图片生成探活（GET /models，不实际生成）──
    if not img_cfg.api_key:
        result["imggen"]["error"] = "API Key 为空"
    else:
        import time
        try:
            t0 = time.time()
            url = img_cfg.base_url.rstrip("/") + "/models"
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.get(url, headers={"Authorization": f"Bearer {img_cfg.api_key}"})
            result["imggen"]["latency_ms"] = int((time.time() - t0) * 1000)
            if r.status_code == 200:
                result["imggen"]["ok"] = True
            elif r.status_code == 404:
                result["imggen"]["error"] = "服务未提供 /models，无法验证此配置；没有执行图片生成"
            else:
                result["imggen"]["error"] = f"HTTP {r.status_code}: {r.text[:200]}"
        except Exception as e:
            result["imggen"]["error"] = str(e)[:200]

    return result
