"""Atomic editing, scene contracts, and generation lifecycle regressions."""
import json
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException


async def test_hotspot_batch_rejects_other_node_before_any_write(isolated_api):
    client, pool = isolated_api
    pool.conn.fetchrow.return_value = {"id": "node_a", "status": "draft"}
    pool.conn.fetch.return_value = [{"id": "hs_a", "pos_x": 0.1, "pos_y": 0.1, "width": 0.2, "height": 0.2}]
    response = await client.patch("/api/projects/proj_safe/nodes/node_a/hotspots", json={"hotspots": [
        {"id": "hs_a", "label": "valid change"}, {"id": "hs_other", "label": "wrong node"},
    ]})
    assert response.status_code == 404
    pool.conn.execute.assert_not_called()
    assert pool.transaction_exits == [HTTPException]


async def test_hotspot_update_is_scoped_to_node_and_transaction(isolated_api):
    client, pool = isolated_api
    pool.conn.fetchrow.return_value = {"id": "node_a", "status": "draft"}
    pool.conn.fetch.return_value = [{"id": "hs_a", "pos_x": 0.1, "pos_y": 0.1, "width": 0.2, "height": 0.2}]
    response = await client.patch("/api/projects/proj_safe/nodes/node_a/hotspots", json={"hotspots": [
        {"id": "hs_a", "pos_x": 0.5},
    ]})
    assert response.status_code == 200
    statement, *values = pool.conn.execute.call_args_list[0].args
    assert "AND node_id =" in statement
    assert values[-2:] == ["hs_a", "node_a"]
    assert pool.transaction_exits == [None]


@pytest.mark.parametrize("patch,expected", [
    ({"pos_x": -0.1}, 422), ({"width": 0}, 422), ({"height": 1.1}, 422), ({"pos_x": 0.9}, 400),
])
async def test_hotspot_geometry_validation(isolated_api, patch, expected):
    client, pool = isolated_api
    pool.conn.fetchrow.return_value = {"id": "node_a", "status": "draft"}
    pool.conn.fetch.return_value = [{"id": "hs_a", "pos_x": 0.1, "pos_y": 0.1, "width": 0.2, "height": 0.2}]
    response = await client.patch("/api/projects/proj_safe/nodes/node_a/hotspots", json={
        "hotspots": [{"id": "hs_a", **patch}],
    })
    assert response.status_code == expected
    pool.conn.execute.assert_not_called()


def scene_document(**changes):
    return {"version": 1, "layout": "atlas", "sections": [{"id": "intro", "title": "Introduction", "body": "Editable text"}], **changes}


async def test_edit_node_scene_validates_links_and_returns_document(isolated_api):
    client, pool = isolated_api
    scene = scene_document(sections=[{"id": "intro", "title": "One", "body": "Text", "hotspot_id": "hs_a", "target_node_id": "node_b"}])
    pool.conn.fetchrow.side_effect = [
        {"id": "node_a", "status": "draft"},
        {"id": "node_a", "title": "Edited", "description": "New description", "scene_document": json.dumps(scene)},
    ]
    pool.conn.fetch.side_effect = [[{"id": "hs_a", "kind": "image", "label": "One", "pos_x": 0.1, "pos_y": 0.1,
                                     "width": 0.2, "height": 0.2, "selected": False, "target_node_id": "node_b"}], [{"id": "node_b"}]]
    response = await client.patch("/api/projects/proj_safe/nodes/node_a", json={
        "title": "Edited", "description": "New description", "scene_document": scene,
    })
    assert response.status_code == 200
    assert response.json()["scene_document"] == scene
    update_call = pool.conn.fetchrow.call_args_list[1].args
    assert "scene_document = $3::jsonb" in update_call[0]
    assert json.loads(update_call[3]) == scene
    assert pool.transaction_exits == [None]


async def test_edit_node_can_clear_scene_without_changing_title(isolated_api):
    client, pool = isolated_api
    pool.conn.fetchrow.side_effect = [
        {"id": "node_a", "status": "draft"},
        {"id": "node_a", "title": "Preserved", "description": "Text", "scene_document": None},
    ]
    response = await client.patch("/api/projects/proj_safe/nodes/node_a", json={"scene_document": None})
    assert response.status_code == 200
    assert response.json()["scene_document"] is None
    update_sql, *params = pool.conn.fetchrow.call_args_list[1].args
    assert "title =" not in update_sql and "scene_document = $1::jsonb" in update_sql
    assert params[0] is None


@pytest.mark.parametrize("bad_scene", [
    scene_document(version=2), scene_document(version=True), scene_document(layout="canvas"),
    scene_document(sections=[{"id": "a", "title": "T", "body": "B"}] * 2),
    scene_document(sections=[{"id": str(i), "title": "T", "body": "B"} for i in range(13)]),
    scene_document(sections=[{"id": "a", "title": "T", "body": "X" * 5001}]),
    scene_document(sections=[{"id": "a", "title": 123, "body": "B"}]),
    scene_document(extra="not allowed"),
])
async def test_scene_schema_is_strict_and_bounded(isolated_api, bad_scene):
    client, pool = isolated_api
    response = await client.patch("/api/projects/proj_safe/nodes/node_a", json={"scene_document": bad_scene})
    assert response.status_code == 422
    pool.conn.fetchrow.assert_not_called()


@pytest.mark.parametrize("section", [
    {"id": "a", "title": "T", "body": "B", "hotspot_id": "other_hotspot"},
    {"id": "a", "title": "T", "body": "B", "target_node_id": "other_project_node"},
])
async def test_scene_rejects_foreign_relationships(isolated_api, section):
    client, pool = isolated_api
    pool.conn.fetchrow.return_value = {"id": "node_a", "status": "draft"}
    pool.conn.fetch.return_value = []
    response = await client.patch("/api/projects/proj_safe/nodes/node_a", json={"scene_document": scene_document(sections=[section])})
    assert response.status_code == 400
    assert pool.conn.fetchrow.call_count == 1
    pool.conn.execute.assert_not_called()


async def test_content_edit_rejects_active_generation(isolated_api):
    client, pool = isolated_api
    pool.conn.fetchrow.return_value = {"id": "node_a", "status": "generating"}
    response = await client.patch("/api/projects/proj_safe/nodes/node_a", json={"title": "Too late"})
    assert response.status_code == 409
    pool.conn.execute.assert_not_called()


async def test_durable_regeneration_explicitly_bypasses_cache_and_sdk_retry(monkeypatch, tmp_path):
    import hashlib
    import io

    from PIL import Image

    import storage
    from jobs.page_workflows import perform_page
    monkeypatch.setattr(storage, "UPLOAD_DIR", tmp_path)
    out = io.BytesIO()
    Image.new("RGB", (8, 8), "green").save(out, "PNG")
    url = await storage.save_upload("proj_safe", "new.png", out.getvalue())
    image_call = AsyncMock(return_value=url)
    monkeypatch.setattr("jobs.page_workflows.ImageGenerationAgent.generate", image_call)
    result = await perform_page("image", object(), {"settings": {}, "project_id": "proj_safe", "kind": "regenerate",
                                "subject": {"node_id": "node_a"}}, {"image_prompt": "new prompt"})
    assert result == {"url": url, "sha256": hashlib.sha256(out.getvalue()).hexdigest()}
    assert image_call.call_args.kwargs["use_cache"] is False
    assert image_call.call_args.kwargs["single_attempt"] is True


async def test_image_agent_regenerate_skips_cache_lookup(monkeypatch):
    from agents.base import ImgGenConfig
    from agents.image_generation import ImageGenerationAgent

    cache_lookup = AsyncMock(return_value="/uploads/old.png")
    monkeypatch.setattr("agents.image_generation.serve_from_cache", cache_lookup)
    monkeypatch.setattr("agents.image_generation.cache_image", AsyncMock())
    agent = ImageGenerationAgent(ImgGenConfig("https://provider.invalid/v1", "fake-key", "image-model"))
    new_generation = AsyncMock(return_value="/uploads/new.png")
    monkeypatch.setattr(agent, "_generate_openai", new_generation)
    result = await agent.generate("prompt", "proj_safe", "node_a", use_cache=False)
    assert result == "/uploads/new.png"
    cache_lookup.assert_not_called()
    new_generation.assert_awaited_once()


@pytest.mark.parametrize("scene", [None, scene_document()])
async def test_project_read_supports_old_pages_and_scene_json(isolated_api, scene):
    client, pool = isolated_api
    pool.conn.fetchrow.return_value = {"id": "proj_safe", "name": "Book", "root_node_id": "node_a", "settings": {}}
    node = {"id": "node_a", "parent_id": None, "depth": 0, "title": "Page", "description": "Text",
            "source_type": "image", "image_url": None, "status": "draft"}
    if scene is not None:
        node["scene_document"] = json.dumps(scene)
    pool.conn.fetch.side_effect = [[node], []]
    response = await client.get("/api/projects/proj_safe")
    assert response.status_code == 200
    assert response.json()["nodes"]["node_a"]["scene_document"] == scene


async def test_manual_hotspot_creation_returns_safe_frontend_shape(isolated_api):
    client, pool = isolated_api
    pool.conn.fetchrow.return_value = {"id": "node_a", "status": "draft"}
    response = await client.post("/api/projects/proj_safe/nodes/node_a/hotspots", json={
        "label": "Manual region", "pos_x": 0.3, "pos_y": 0.2, "width": 0.2, "height": 0.1,
    })
    assert response.status_code == 201
    hotspot = response.json()
    assert hotspot["id"].startswith("hs_")
    assert hotspot["position"] == {"x": 0.3, "y": 0.2}
    assert hotspot["size"] == {"width": 0.2, "height": 0.1}
    assert hotspot["selected"] is True
    assert hotspot["target_node_id"] is None and hotspot["score"] is None
    assert pool.transaction_exits == [None]


@pytest.mark.parametrize("status,count,expected", [("draft", 12, 400), ("generating", 0, 409)])
async def test_manual_hotspot_respects_quota_and_generation_lock(isolated_api, status, count, expected):
    client, pool = isolated_api
    pool.conn.fetchrow.return_value = {"id": "node_a", "status": status}
    pool.conn.fetchval.side_effect = lambda query, *args: count if "COUNT(*) FROM hotspots" in query else 0
    response = await client.post("/api/projects/proj_safe/nodes/node_a/hotspots", json={
        "label": "Manual region", "pos_x": 0.3, "pos_y": 0.2, "width": 0.2, "height": 0.1,
    })
    assert response.status_code == expected
    pool.conn.execute.assert_not_called()
