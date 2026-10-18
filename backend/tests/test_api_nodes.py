"""Postgres integration tests for scene persistence and atomic hotspot updates."""
import pytest_asyncio

from database import apply_schema
from utils import gen_id


@pytest_asyncio.fixture
async def graph(client, project):
    from main import app

    node_id, child_id, hotspot_id, child_hotspot_id = [gen_id(prefix) for prefix in ("node_", "node_", "hs_", "hs_")]
    async with app.state.pool.acquire() as conn, conn.transaction():
        await conn.execute(
            "INSERT INTO nodes (id, project_id, title) VALUES ($1, $2, 'Original')", node_id, project
        )
        await conn.execute(
            "INSERT INTO nodes (id, project_id, parent_id, depth, title) VALUES ($1, $2, $3, 1, 'Child')",
            child_id, project, node_id,
        )
        await conn.execute(
            "INSERT INTO hotspots (id, node_id, label, pos_x, pos_y, width, height, target_node_id, selected) "
            "VALUES ($1, $2, 'Original hotspot', 0.1, 0.1, 0.2, 0.2, $3, true)", hotspot_id, node_id, child_id,
        )
        await conn.execute(
            "INSERT INTO hotspots (id, node_id, label, pos_x, pos_y, width, height) "
            "VALUES ($1, $2, 'Child hotspot', 0.1, 0.1, 0.2, 0.2)", child_hotspot_id, child_id,
        )
        await conn.execute("UPDATE projects SET root_node_id = $1 WHERE id = $2", node_id, project)
    return {"node": node_id, "child": child_id, "hotspot": hotspot_id, "child_hotspot": child_hotspot_id}


async def test_scene_patch_roundtrip_and_idempotent_schema(client, project, graph):
    from main import app

    scene = {"version": 1, "layout": "sequence", "sections": [{
        "id": "overview", "title": "Editable heading", "body": "Text survives migration.\nSecond line.",
        "hotspot_id": graph["hotspot"], "target_node_id": graph["child"],
    }]}
    response = await client.patch(f"/api/projects/{project}/nodes/{graph['node']}", json={
        "title": "Edited title", "description": "Edited description", "scene_document": scene,
    })
    assert response.status_code == 200
    assert response.json()["scene_document"] == scene
    await apply_schema(app.state.pool)
    await apply_schema(app.state.pool)
    restored = (await client.get(f"/api/projects/{project}")).json()["nodes"][graph["node"]]
    assert restored["title"] == "Edited title"
    assert restored["scene_document"] == scene
    exported = (await client.get(f"/api/projects/{project}/export.json")).json()
    assert next(node for node in exported["nodes"] if node["id"] == graph["node"])["scene_document"] == scene
    cleared = await client.patch(f"/api/projects/{project}/nodes/{graph['node']}", json={"scene_document": None})
    assert cleared.status_code == 200 and cleared.json()["scene_document"] is None


async def test_cross_node_hotspot_batch_is_atomic_in_postgres(client, project, graph):
    response = await client.patch(f"/api/projects/{project}/nodes/{graph['node']}/hotspots", json={"hotspots": [
        {"id": graph["hotspot"], "label": "Must roll back"},
        {"id": graph["child_hotspot"], "label": "Wrong page"},
    ]})
    assert response.status_code == 404
    restored = (await client.get(f"/api/projects/{project}")).json()
    assert restored["nodes"][graph["node"]]["hotspots"][0]["label"] == "Original hotspot"
    assert restored["nodes"][graph["child"]]["hotspots"][0]["label"] == "Child hotspot"


async def test_existing_children_generation_does_not_change_status(client, project, graph):
    response = await client.post(f"/api/projects/{project}/nodes/{graph['node']}/generate-children", json={})
    assert response.status_code == 200 and '"done": true' in response.text
    restored = (await client.get(f"/api/projects/{project}")).json()["nodes"][graph["node"]]
    assert restored["status"] == "draft"
    assert restored["children"] == [graph["child"]]
