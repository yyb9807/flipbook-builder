import asyncio
import base64
import io
import json
import time
import zipfile
from pathlib import Path

import asyncpg
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

from agents.base import _log, get_imggen_config, get_llm_config
from agents.hotspot_localization import HotspotLocalizationAgent
from agents.image_generation import ImageGenerationAgent
from agents.input_analysis import InputAnalysisAgent
from database import get_pool
from sse import _sse, sse_stream
from storage import UPLOAD_DIR, save_upload, url_to_disk_path
from utils import gen_id

_BackendDir = Path(__file__).parent.parent

router = APIRouter()


class CreateProjectBody(BaseModel):
    name: str
    settings: dict = {}


@router.get("/projects")
async def list_projects(pool: asyncpg.Pool = Depends(get_pool)):
    """返回所有项目列表，每个项目附带其根页面的缩略图。"""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                p.id, p.name, p.created_at, p.updated_at, p.root_node_id,
                n.image_url AS thumbnail, n.title AS root_title,
                (SELECT COUNT(*) FROM nodes WHERE project_id = p.id) AS node_count
            FROM projects p
            LEFT JOIN nodes n ON n.id = p.root_node_id
            ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC
            LIMIT 100
            """
        )
    return {
        "projects": [
            {
                "project_id": r["id"],
                "name": r["name"],
                "thumbnail": r["thumbnail"],
                "root_title": r["root_title"],
                "node_count": r["node_count"],
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
            }
            for r in rows
        ]
    }


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str, pool: asyncpg.Pool = Depends(get_pool)):
    """删除项目（级联删除节点和热点）。"""
    async with pool.acquire() as conn:
        # 先获取所有节点的图片路径，待会儿删文件
        nodes = await conn.fetch(
            "SELECT image_url FROM nodes WHERE project_id = $1", project_id
        )
        # 删数据库记录（hotspots / nodes 应有 ON DELETE CASCADE）
        result = await conn.execute("DELETE FROM projects WHERE id = $1", project_id)
        if result.endswith("0"):
            raise HTTPException(404, "项目不存在")

    # 删图片文件
    project_dir = UPLOAD_DIR / project_id
    if project_dir.exists():
        try:
            import shutil
            shutil.rmtree(project_dir)
        except Exception as e:
            print(f"删除项目文件失败: {e}")

    _ = nodes  # silence unused
    return {"status": "deleted"}


@router.post("/projects")
async def create_project(body: CreateProjectBody, pool: asyncpg.Pool = Depends(get_pool)):
    project_id = gen_id("proj_")
    settings = {
        "max_depth": body.settings.get("max_depth", 4),
        "max_hotspots_per_page": body.settings.get("max_hotspots_per_page", 3),
        "visual_style": body.settings.get("visual_style", "encyclopedia"),
        "language": body.settings.get("language", "zh"),
    }
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO projects (id, name, settings) VALUES ($1, $2, $3)",
            project_id, body.name, json.dumps(settings),
        )
    return {"project_id": project_id, "name": body.name, "settings": settings}


@router.get("/projects/{project_id}")
async def get_project(project_id: str, pool: asyncpg.Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        project = await conn.fetchrow("SELECT * FROM projects WHERE id = $1", project_id)
        if not project:
            raise HTTPException(404, "项目不存在")

        nodes_rows = await conn.fetch(
            "SELECT * FROM nodes WHERE project_id = $1 ORDER BY created_at", project_id
        )
        hotspot_rows = await conn.fetch(
            """SELECT h.* FROM hotspots h
               JOIN nodes n ON h.node_id = n.id
               WHERE n.project_id = $1
               ORDER BY h.sort_order""",
            project_id,
        )

    # 组装 hotspot 映射
    hotspots_by_node: dict[str, list] = {}
    for h in hotspot_rows:
        node_id = h["node_id"]
        hotspots_by_node.setdefault(node_id, []).append({
            "id": h["id"],
            "label": h["label"],
            "position": {"x": h["pos_x"], "y": h["pos_y"]},
            "size": {"width": h["width"], "height": h["height"]},
            "selected": h["selected"],
            "target_node_id": h["target_node_id"],
            "score": h["score"],
        })

    # 组装节点映射
    nodes: dict[str, dict] = {}
    children_map: dict[str, list] = {}
    for n in nodes_rows:
        nodes[n["id"]] = {
            "id": n["id"],
            "parent_id": n["parent_id"],
            "depth": n["depth"],
            "title": n["title"],
            "description": n["description"],
            "source_type": n["source_type"],
            "image_url": n["image_url"],
            "status": n["status"],
            "hotspots": hotspots_by_node.get(n["id"], []),
            "children": [],
        }
        if n["parent_id"]:
            children_map.setdefault(n["parent_id"], []).append(n["id"])

    for parent_id, child_ids in children_map.items():
        if parent_id in nodes:
            nodes[parent_id]["children"] = child_ids

    return {
        "project_id": project["id"],
        "name": project["name"],
        "root_node_id": project["root_node_id"],
        "settings": json.loads(project["settings"]) if isinstance(project["settings"], str) else project["settings"],
        "nodes": nodes,
    }


@router.post("/projects/{project_id}/analyze")
async def analyze_upload(
    request: Request,
    project_id: str,
    file: UploadFile | None = File(None),
    text: str | None = Form(None),
    keywords: str | None = Form(None),
    pool: asyncpg.Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        project = await conn.fetchrow("SELECT * FROM projects WHERE id = $1", project_id)
        if not project:
            raise HTTPException(404, "项目不存在")

    settings = json.loads(project["settings"]) if isinstance(project["settings"], str) else project["settings"]
    language = settings.get("language", "zh")
    visual_style = settings.get("visual_style", "encyclopedia")
    llm_config = get_llm_config(request)
    imggen_config = get_imggen_config(request)

    # 引入 page_generation 的 STYLE_PROMPTS 复用（避免重复定义风格描述）
    from agents.page_generation import STYLE_PROMPTS
    style_desc = STYLE_PROMPTS.get(visual_style, STYLE_PROMPTS["encyclopedia"])

    # 预读文件（必须在 generator 外完成，因为 UploadFile 只能读一次）
    file_contents: bytes | None = None
    file_name: str | None = None
    if file and file.filename:
        file_contents = await file.read()
        file_name = file.filename
        # 大小校验（前端已校验，后端兜底防绕过）
        MAX_BYTES = 20 * 1024 * 1024
        if len(file_contents) > MAX_BYTES:
            raise HTTPException(
                400,
                f"文件 {len(file_contents) / 1024 / 1024:.1f} MB 超过 20 MB 上限",
            )
        # 类型校验
        ALLOWED = {"image/jpeg", "image/png", "image/webp"}
        ct = (file.content_type or "").lower()
        if ct and ct not in ALLOWED:
            raise HTTPException(400, f"仅支持 JPG / PNG / WEBP（收到 {ct}）")

    @sse_stream("ANALYZE")
    async def stream(bg_tasks: list[asyncio.Task]):
        flow_t0 = time.time()
        _log(f"════ ANALYZE start project={project_id} type={'image' if file_contents else 'text'}")
        analysis_agent = InputAnalysisAgent(llm_config)
        localization_agent = HotspotLocalizationAgent(llm_config)
        image_agent = ImageGenerationAgent(imggen_config)

        image_url: str | None = None
        image_b64: str | None = None
        source_type = "text"

        if file_contents and file_name:
            image_url = await save_upload(project_id, f"root_{file_name}", file_contents)
            image_b64 = base64.b64encode(file_contents).decode()
            source_type = "image"

        # Step 0: 分析内容
        yield _sse({"step": 0, "pct": 8, "message": "分析内容中"})
        if source_type == "image" and image_b64:
            analysis = await analysis_agent.analyze_image(image_b64, language)
        else:
            analysis = await analysis_agent.analyze_text(text or "", language, style_desc=style_desc)

        summary = analysis.get("summary", "")
        main_objects = analysis.get("main_objects", [])
        main_objects_zh = _merge_extra_keywords(
            keywords,
            analysis.get("main_objects_zh") or main_objects,
        )

        # Step 1: 生成封面图（仅文字输入）
        _reuse_node_id: str | None = None
        if source_type == "text" and imggen_config.api_key:
            root_node_id_temp = gen_id("node_")
            _reuse_node_id = root_node_id_temp
            try:
                async for ev, new_url in _gen_root_cover(
                    image_agent, analysis, summary, project_id, root_node_id_temp, bg_tasks
                ):
                    if ev:
                        yield ev
                    if new_url:
                        image_url = new_url
                        img_path = UPLOAD_DIR / project_id / f"{root_node_id_temp}.png"
                        if img_path.exists():
                            image_b64 = base64.b64encode(img_path.read_bytes()).decode()
            except (asyncio.CancelledError, GeneratorExit):
                raise
            except Exception as e:
                print(f"封面图生成失败: {e}")
        else:
            yield _sse({"step": 1, "pct": 28, "message": "识别热点区域"})

        # Step 2: 定位热点
        yield _sse({"step": 2, "pct": 58, "message": "识别热点区域"})
        raw_hotspots = await _resolve_hotspots(
            source_type, image_b64, analysis, main_objects, main_objects_zh, language, localization_agent
        )

        # Step 3: 写入数据库
        yield _sse({"step": 3, "pct": 88, "message": "搭建页面结构"})
        node_id = _reuse_node_id or gen_id("node_")
        hotspots_out = await _persist_root_node(
            pool, project_id, node_id, source_type, image_url, analysis, raw_hotspots
        )

        _log(f"════ ANALYZE done total={time.time() - flow_t0:.1f}s")
        yield _sse({
            "done": True,
            "node_id": node_id,
            "summary": summary,
            "main_objects": main_objects,
            "scene_type": analysis.get("scene_type", "other"),
            "image_url": image_url,
            "source_type": source_type,
            "hotspots": hotspots_out,
            "keywords": analysis.get("keywords", []),
        })

    return StreamingResponse(stream(), media_type="text/event-stream")


# ─────────── analyze_upload helpers ───────────

def _merge_extra_keywords(raw_keywords: str | None, base: list[str]) -> list[str]:
    """合并用户在 form 里输入的 extra keywords 到 main_objects 前面，去重。"""
    extra = [k.strip() for k in raw_keywords.split(",") if k.strip()] if raw_keywords else []
    if not extra:
        return base
    return list(dict.fromkeys(extra + base))


async def _gen_root_cover(
    image_agent: ImageGenerationAgent,
    analysis: dict,
    summary: str,
    project_id: str,
    node_id: str,
    bg_tasks: list[asyncio.Task],
):
    """生成根节点封面图，每 5s yield 一次心跳。完成后最后 yield (None, image_url)。
    返回值是 async generator of (event_str | None, url | None)。"""
    yield _sse({"step": 1, "pct": 28, "message": "生成封面图"}), None
    image_prompt = analysis.get("image_prompt") or (
        f"illustrated knowledge guide about {summary}, "
        "editorial illustration with multiple annotated zones, rich details, 16:9"
    )
    img_task = asyncio.ensure_future(
        image_agent.generate(prompt=image_prompt, project_id=project_id, node_id=node_id)
    )
    bg_tasks.append(img_task)
    elapsed = 0
    while not img_task.done():
        await asyncio.sleep(5)
        elapsed += 5
        pct = min(28 + elapsed, 54)
        yield _sse({"step": 1, "pct": pct, "message": f"生成封面图（{elapsed}s…）"}), None
    url = await img_task
    yield None, url


async def _resolve_hotspots(
    source_type: str,
    image_b64: str | None,
    analysis: dict,
    main_objects: list[str],
    main_objects_zh: list[str],
    language: str,
    localization_agent: HotspotLocalizationAgent,
) -> list[dict]:
    """决定根节点的热点：
    - 用户上传图片 + analyze_image 已返回 hotspots → 直接复用
    - 用户上传图片但无 inline hotspots → 单独跑视觉定位
    - 文字输入 → 规则法生成（中文标签）
    """
    if source_type == "image" and image_b64:
        inline = analysis.get("hotspots") or []
        if inline:
            for i, hs in enumerate(inline):
                hs.setdefault("id", f"hs_{i + 1}")
            return inline
        loc = await localization_agent.localize(image_b64, main_objects, language)
        return loc.get("hotspots", [])
    loc = await localization_agent.generate_text_hotspots(main_objects_zh, language)
    return loc.get("hotspots", [])


async def _persist_root_node(
    pool: asyncpg.Pool,
    project_id: str,
    node_id: str,
    source_type: str,
    image_url: str | None,
    analysis: dict,
    raw_hotspots: list[dict],
) -> list[dict]:
    """写入根节点 + 热点 + 更新 projects.root_node_id。返回供 SSE 输出的 hotspots_out。"""
    DEFAULT_SCORE = 0.8  # 跳过 ExpansionSuggestionAgent 后所有热点用此分（>= 0.7 → 自动勾选）
    hotspots_out: list[dict] = []
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO nodes (id, project_id, parent_id, depth, title, description,
               source_type, image_url, status)
               VALUES ($1, $2, NULL, 0, $3, $4, $5, $6, 'draft')""",
            node_id, project_id,
            analysis.get("summary", "根页面")[:50],
            analysis.get("summary", ""),
            source_type, image_url,
        )
        for i, hs in enumerate(raw_hotspots):
            hs_id = gen_id("hs_")
            await conn.execute(
                """INSERT INTO hotspots (id, node_id, label, pos_x, pos_y,
                   width, height, selected, sort_order, score)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)""",
                hs_id, node_id, hs["label"],
                hs["x"], hs["y"], hs["width"], hs["height"],
                True, i, DEFAULT_SCORE,
            )
            hotspots_out.append({
                "id": hs_id,
                "label": hs["label"],
                "position": {"x": hs["x"], "y": hs["y"]},
                "size": {"width": hs["width"], "height": hs["height"]},
                "selected": True,
                "target_node_id": None,
                "score": DEFAULT_SCORE,
            })
        await conn.execute(
            "UPDATE projects SET root_node_id = $1, updated_at = NOW() WHERE id = $2",
            node_id, project_id,
        )
    return hotspots_out


async def _load_full_project(project_id: str, pool: asyncpg.Pool) -> dict:
    """加载完整的项目数据（节点 + 热点）。供 export 端点和 get_project 共用。"""
    async with pool.acquire() as conn:
        project = await conn.fetchrow("SELECT * FROM projects WHERE id = $1", project_id)
        if not project:
            raise HTTPException(404, "项目不存在")
        nodes_rows = await conn.fetch(
            "SELECT * FROM nodes WHERE project_id = $1 ORDER BY created_at", project_id
        )
        hotspot_rows = await conn.fetch(
            """SELECT h.* FROM hotspots h
               JOIN nodes n ON h.node_id = n.id
               WHERE n.project_id = $1
               ORDER BY h.sort_order""",
            project_id,
        )
    settings = project["settings"]
    if isinstance(settings, str):
        settings = json.loads(settings)
    return {
        "project_id": project["id"],
        "name": project["name"],
        "root_node_id": project["root_node_id"],
        "settings": settings,
        "created_at": project["created_at"].isoformat() if project["created_at"] else None,
        "updated_at": project["updated_at"].isoformat() if project["updated_at"] else None,
        "nodes": [dict(n) for n in nodes_rows],
        "hotspots": [dict(h) for h in hotspot_rows],
    }


@router.get("/projects/{project_id}/export.json")
async def export_project_json(project_id: str, pool: asyncpg.Pool = Depends(get_pool)):
    """导出项目结构 + 节点 + 热点的完整 JSON（不含图片二进制）。
    图片仍以 image_url 引用 UPLOAD_URL_PREFIX 路径，便于在线 viewer 复用。"""
    data = await _load_full_project(project_id, pool)
    # datetime 字段需要在内层节点也处理
    for n in data["nodes"]:
        for k in ("created_at", "updated_at"):
            if k in n and n[k]:
                n[k] = n[k].isoformat()
    # 加导出标记
    data["_export"] = {
        "version": 1,
        "exported_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "kind": "flipbook-builder-json",
    }
    return JSONResponse(data)


@router.get("/projects/{project_id}/export.zip")
async def export_project_zip(project_id: str, pool: asyncpg.Pool = Depends(get_pool)):
    """导出离线 ZIP 包：
       index.html  — 含 JSON 数据的 viewer
       images/*.png — 实际图片文件（不再 base64 内嵌）
       README.txt  — 简短使用说明

    相比 base64 内嵌的单 HTML，ZIP 体积更小（base64 比原文件大 33%），
    并且打开速度更快（不需要 parse 巨型字符串）。
    """
    data = await _load_full_project(project_id, pool)
    nodes = data["nodes"]
    hotspots = data["hotspots"]

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        # ── 1. 图片：复制到 images/ 目录 + 重写 image_url 为相对路径 ──
        for n in nodes:
            url = n.get("image_url")
            src = url_to_disk_path(url) if isinstance(url, str) else None
            if src and src.exists():
                ext = src.suffix or ".png"
                dest = f"images/{n['id']}{ext}"
                try:
                    zf.write(src, dest)
                    n["image_url"] = f"./{dest}"
                except Exception as e:
                    _log(f"export.zip: skip {url} ({e})")
            # datetime → str
            for k in ("created_at", "updated_at"):
                if k in n and n[k] and not isinstance(n[k], str):
                    n[k] = n[k].isoformat()

        # ── 2. index.html（含数据）──
        payload = {
            "name": data["name"],
            "root_node_id": data["root_node_id"],
            "nodes": nodes,
            "hotspots": hotspots,
        }
        payload_json = json.dumps(payload, ensure_ascii=False, default=str)
        title = (data["name"] or "翻翻书").replace("<", "&lt;")
        html = _STATIC_VIEWER_HTML.replace("__TITLE__", title).replace("__PAYLOAD__", payload_json)
        zf.writestr("index.html", html)

        # ── 3. README ──
        readme = (
            f"翻翻书 · {data['name']}\n"
            f"{'=' * 40}\n\n"
            f"使用方法：\n"
            f"  1. 解压本压缩包\n"
            f"  2. 双击 index.html 在浏览器中打开\n"
            f"  3. 不需要联网，所有内容已离线打包\n\n"
            f"包含：\n"
            f"  - index.html       离线浏览器（HTML + JS 一体）\n"
            f"  - images/          所有页面的图片\n"
            f"  - README.txt       本文件\n"
        )
        zf.writestr("README.txt", readme)

    buf.seek(0)
    # 中文文件名走 RFC 5987 编码（filename*）；basic filename 用 ASCII 兜底
    from urllib.parse import quote
    raw_name = (data["name"] or "flipbook").replace("/", "_").replace("\\", "_")[:60]
    encoded_name = quote(f"{raw_name}.zip")
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename=flipbook.zip; filename*=UTF-8''{encoded_name}",
        },
    )


# ── 离线 HTML viewer 模板 ──
# 模板放在 backend/templates/viewer.html，启动时一次读入并 cache。
# 修改模板时直接编辑 .html 文件（IDE 支持 HTML 高亮 / 格式化），无需碰这个 router。
_TEMPLATE_PATH = _BackendDir / "templates" / "viewer.html"
_STATIC_VIEWER_HTML = _TEMPLATE_PATH.read_text(encoding="utf-8")
