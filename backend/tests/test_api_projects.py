"""项目 CRUD 端点的端到端集成测试。需要 Postgres 跑着。"""
import pytest
from httpx import AsyncClient


class TestCreateProject:
    async def test_create_with_default_settings(self, client: AsyncClient):
        r = await client.post("/api/projects", json={"name": "测试项目"})
        assert r.status_code == 200
        body = r.json()
        assert body["name"] == "测试项目"
        assert body["project_id"].startswith("proj_")
        # 默认 settings
        assert body["settings"]["max_depth"] == 4
        assert body["settings"]["language"] == "zh"
        assert body["settings"]["visual_style"] == "encyclopedia"
        # 清理
        await client.delete(f"/api/projects/{body['project_id']}")

    async def test_create_with_custom_settings(self, client: AsyncClient):
        r = await client.post(
            "/api/projects",
            json={
                "name": "x",
                "settings": {"max_depth": 2, "visual_style": "watercolor"},
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["settings"]["max_depth"] == 2
        assert body["settings"]["visual_style"] == "watercolor"
        await client.delete(f"/api/projects/{body['project_id']}")


class TestListProjects:
    async def test_list_includes_created_project(self, client: AsyncClient, project: str):
        r = await client.get("/api/projects")
        assert r.status_code == 200
        ids = [p["project_id"] for p in r.json()["projects"]]
        assert project in ids

    async def test_list_response_shape(self, client: AsyncClient, project: str):
        r = await client.get("/api/projects")
        item = next(p for p in r.json()["projects"] if p["project_id"] == project)
        # 全字段都存在
        for k in ("project_id", "name", "thumbnail", "root_title", "node_count", "created_at", "updated_at"):
            assert k in item


class TestGetProject:
    async def test_existing(self, client: AsyncClient, project: str):
        r = await client.get(f"/api/projects/{project}")
        assert r.status_code == 200
        assert r.json()["project_id"] == project

    async def test_not_found(self, client: AsyncClient):
        r = await client.get("/api/projects/proj_does_not_exist")
        assert r.status_code == 404


class TestDeleteProject:
    async def test_delete_existing(self, client: AsyncClient):
        # 单独创建（不用 fixture）这样测删除的副作用
        r = await client.post("/api/projects", json={"name": "to_delete"})
        pid = r.json()["project_id"]

        r = await client.delete(f"/api/projects/{pid}")
        assert r.status_code == 200

        # 再 get 应该 404
        r = await client.get(f"/api/projects/{pid}")
        assert r.status_code == 404

    async def test_delete_nonexistent_returns_404(self, client: AsyncClient):
        r = await client.delete("/api/projects/proj_does_not_exist")
        assert r.status_code == 404


class TestUploadValidation:
    async def test_oversized_file_rejected(self, client: AsyncClient, project: str):
        big = b"\x00" * (21 * 1024 * 1024)  # 21 MB
        r = await client.post(
            f"/api/projects/{project}/analyze",
            files={"file": ("big.png", big, "image/png")},
        )
        assert r.status_code == 413
        assert "20 MB" in r.json()["detail"]

    async def test_wrong_mime_rejected(self, client: AsyncClient, project: str):
        r = await client.post(
            f"/api/projects/{project}/analyze",
            files={"file": ("note.txt", b"hello", "text/plain")},
        )
        assert r.status_code == 400
        assert "JPG / PNG / WEBP" in r.json()["detail"]

    async def test_analyze_nonexistent_project(self, client: AsyncClient):
        r = await client.post(
            "/api/projects/proj_nope/analyze",
            files={"file": ("x.png", b"\x89PNG", "image/png")},
        )
        assert r.status_code == 404


class TestExport:
    async def test_export_json_empty_project(self, client: AsyncClient, project: str):
        r = await client.get(f"/api/projects/{project}/export.json")
        assert r.status_code == 200
        body = r.json()
        assert body["project_id"] == project
        assert body["nodes"] == []
        assert body["hotspots"] == []
        assert body["_export"]["kind"] == "flipbook-builder-json"

    async def test_export_zip_empty_project(self, client: AsyncClient, project: str):
        r = await client.get(f"/api/projects/{project}/export.zip")
        assert r.status_code == 200
        assert r.headers["content-type"] == "application/zip"
        # ZIP magic header
        assert r.content[:4] == b"PK\x03\x04"


class TestHealth:
    async def test_health_endpoint(self, client: AsyncClient):
        r = await client.get("/api/health")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}


class TestTestConfig:
    async def test_empty_keys_returns_errors(self, client: AsyncClient):
        # 不带 key header 应该报 "API Key 为空"
        r = await client.post("/api/test-config")
        assert r.status_code == 200
        body = r.json()
        assert body["llm"]["ok"] is False
        assert "为空" in body["llm"]["error"]
        assert body["imggen"]["ok"] is False


@pytest.mark.parametrize("path", ["/api/projects/proj_x/analyze", "/api/projects/proj_x/export.zip"])
async def test_404_on_nonexistent_project(client: AsyncClient, path: str):
    if "analyze" in path:
        r = await client.post(path, data={"text": "hello"})
    else:
        r = await client.get(path)
    assert r.status_code == 404
