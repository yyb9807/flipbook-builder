"""集成测试共享 fixtures。

策略：用 ASGITransport + httpx.AsyncClient 调用 FastAPI 应用，不起真实 server。
DB 用真实 Postgres（要求 .env 里 DATABASE_URL 已配好），每个测试在 schema 上操作，
通过创建临时项目并在 finalizer 里清理来保证隔离。
"""
import os

import pytest_asyncio
from dotenv import load_dotenv
from httpx import ASGITransport, AsyncClient

# 启动测试前确保 .env 已加载（main 里也会 load 但 conftest 早执行）
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))


@pytest_asyncio.fixture
async def client() -> AsyncClient:
    """返回一个 httpx.AsyncClient，绑定到 FastAPI app。
    自动跑 lifespan（连接 DB pool）。"""
    # 延迟 import，确保 .env 已加载
    from main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 显式触发 lifespan（连 DB）
        async with app.router.lifespan_context(app):
            yield ac


@pytest_asyncio.fixture
async def project(client: AsyncClient):
    """创建一个临时项目，测试结束后删除。"""
    r = await client.post("/api/projects", json={"name": "test_project"})
    assert r.status_code == 200
    pid = r.json()["project_id"]
    try:
        yield pid
    finally:
        await client.delete(f"/api/projects/{pid}")
