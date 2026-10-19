"""Real Postgres regressions for reversible content and protected branch identities."""
import asyncio
import json

import pytest
import pytest_asyncio

from content_metadata import ai_content_metadata
from utils import gen_id
from version_history import merge_restore


def scene(*sections):
    return {"version": 1, "layout": "atlas", "sections": list(sections)}


def section(identity="intro", title="Original section", body="Original section body"):
    return {"id": identity, "title": title, "body": body}


def node_url(project, node):
    return f"/api/projects/{project}/nodes/{node}"


def test_restore_resolves_even_deliberate_section_identity_collisions():
    def hotspot(identity, target=None):
        return {"id": identity, "kind": "section", "label": "Section", "position": None,
                "size": None, "score": None, "selected": False, "target_node_id": target}

    historical = {"title": "Old", "content_metadata": None, "scene_document": scene(
        {**section("intro"), "hotspot_id": "hs_old"},
        {**section("restored_hs_new"), "hotspot_id": "hs_other"}),
        "hotspots": [hotspot("hs_old"), hotspot("hs_other")]}
    current = {"title": "New", "content_metadata": None, "scene_document": scene(
        {**section("intro"), "hotspot_id": "hs_new", "target_node_id": "child"}),
        "hotspots": [hotspot("hs_new", "child")]}
    merged, preserved = merge_restore(historical, current)
    identities = [item["id"] for item in merged["scene_document"]["sections"]]
    assert identities == ["intro", "restored_hs_new", "restored_hs_new_1"]
    assert preserved == 1 and merged["scene_document"]["sections"][-1]["target_node_id"] == "child"


async def graph(client, project):
    return (await client.get(f"/api/projects/{project}")).json()


async def versions(client, project, node):
    result = await client.get(node_url(project, node) + "/versions")
    assert result.status_code == 200, result.text
    return result.json()


async def patch(client, project, node, **changes):
    revision = (await graph(client, project))["revision"]
    result = await client.patch(node_url(project, node), json={**changes, "expected_revision": revision})
    assert result.status_code == 200, result.text
    return result.json()


async def restore(client, project, node, version, *, operation=None, revision=None):
    if revision is None:
        revision = (await graph(client, project))["revision"]
    return await client.post(node_url(project, node) + f"/versions/{version}/restore", json={
        "operation_id": operation or gen_id("restore_"), "expected_revision": revision,
    })


@pytest_asyncio.fixture
async def page(client, project):
    from main import app

    node = gen_id("node_")
    metadata = ai_content_metadata("text", "trusted-model")
    metadata["review_status"] = "reviewed"
    async with app.state.pool.acquire() as conn:
        await conn.execute("INSERT INTO nodes(id,project_id,title,description,source_type,content_metadata) "
                           "VALUES($1,$2,'Original title','Original description','text',$3::jsonb)",
                           node, project, json.dumps(metadata))
        await conn.execute("UPDATE projects SET root_node_id=$1 WHERE id=$2", node, project)
    return node


async def test_legacy_baseline_is_stable_and_public_snapshot_is_allowlisted(client, project, page):
    from main import app

    first = await versions(client, project, page)
    second = await versions(client, project, page)
    assert first == second and first["project_revision"] == 0
    assert len(first["versions"]) == 1 and first["versions"][0]["reason"] == "initial"
    async with app.state.pool.acquire() as conn:
        content = json.loads(await conn.fetchval("SELECT snapshot FROM node_versions WHERE node_id=$1", page))
    assert set(content) == {"title", "description", "source_type", "image_url", "scene_document", "content_metadata", "hotspots"}
    assert content["content_metadata"]["provenance"]["model"] == "trusted-model"
    exported = (await client.get(f"/api/projects/{project}/export.json")).json()
    assert "node_versions" not in json.dumps(exported) and "snapshot" not in json.dumps(exported)


async def test_edit_versions_and_noop_do_not_duplicate_or_advance_revision(client, project, page):
    baseline = (await versions(client, project, page))["current_version_id"]
    updated = await patch(client, project, page, title="Changed")
    assert updated["project_revision"] == 1
    first = await versions(client, project, page)
    assert first["current_version_id"] != baseline and len(first["versions"]) == 2
    assert first["versions"][0]["reason"] == "edit"
    unchanged = await patch(client, project, page, title="Changed")
    assert unchanged["project_revision"] == 1
    assert await versions(client, project, page) == first


async def test_restore_content_adds_version_and_recovery_requires_review(client, project, page):
    baseline = (await versions(client, project, page))["current_version_id"]
    metadata = {"version": 1, "references": [{"id": "book", "title": "Author book"}], "review_status": "reviewed"}
    await patch(client, project, page, title="Reviewed edited title", content_metadata=metadata)
    edited = (await versions(client, project, page))["current_version_id"]
    response = await restore(client, project, page, baseline)
    assert response.status_code == 200, response.text
    restored = response.json()
    assert restored["node"]["title"] == "Original title"
    assert restored["node"]["content_metadata"]["review_status"] == "unreviewed"
    assert restored["node"]["content_metadata"]["provenance"]["model"] == "trusted-model"
    assert restored["restored_version_id"] not in {baseline, edited}
    redo = await restore(client, project, page, edited)
    assert redo.status_code == 200 and redo.json()["node"]["title"] == "Reviewed edited title"
    assert redo.json()["node"]["content_metadata"]["references"] == metadata["references"]
    assert redo.json()["node"]["content_metadata"]["review_status"] == "unreviewed"


async def attach_child(project, parent, hotspot):
    from main import app

    child = gen_id("node_")
    async with app.state.pool.acquire() as conn:
        await conn.execute("INSERT INTO nodes(id,project_id,parent_id,depth,title) VALUES($1,$2,$3,1,'Protected child')", child, project, parent)
        await conn.execute("UPDATE hotspots SET target_node_id=$1 WHERE id=$2", child, hotspot)
        raw = await conn.fetchval("SELECT scene_document FROM nodes WHERE id=$1", parent)
        document = json.loads(raw) if raw else None
        if document:
            for item in document["sections"]:
                if item.get("hotspot_id") == hotspot:
                    item["target_node_id"] = child
            await conn.execute("UPDATE nodes SET scene_document=$1::jsonb WHERE id=$2", json.dumps(document), parent)
    return child


async def test_restore_preserves_later_connected_sections_children_and_parentage(client, project, page):
    first = await patch(client, project, page, scene_document=scene(section()))
    baseline = (await versions(client, project, page))["current_version_id"]
    original_hotspot = first["hotspots"][0]["id"]
    child_a = await attach_child(project, page, original_hotspot)
    current = (await graph(client, project))["nodes"][page]
    added = await patch(client, project, page, title="Later", scene_document=scene(*current["scene_document"]["sections"], section("later", "Later section")))
    child_b = await attach_child(project, page, added["hotspots"][1]["id"])
    detail = await client.get(node_url(project, page) + f"/versions/{baseline}")
    assert detail.status_code == 200
    assert detail.json()["preserved_branch_count"] == 2
    preview = detail.json()["preview"]
    assert len(preview["scene_document"]["sections"]) == 2
    assert {h["target_node_id"] for h in preview["hotspots"]} == {child_a, child_b}
    assert (await graph(client, project))["nodes"][page]["title"] == "Later"
    response = await restore(client, project, page, baseline)
    assert response.status_code == 200, response.text
    current = await graph(client, project)
    assert set(current["nodes"][page]["children"]) == {child_a, child_b}
    assert current["nodes"][child_a]["parent_id"] == page and current["nodes"][child_b]["parent_id"] == page
    assert current["nodes"][page]["status"] == "draft"
    assert response.json()["node"] == preview


async def test_old_plain_page_restore_keeps_new_connected_structured_body(client, project, page):
    baseline = (await versions(client, project, page))["current_version_id"]
    current = await patch(client, project, page, scene_document=scene(section()), title="New structured page")
    child = await attach_child(project, page, current["hotspots"][0]["id"])
    response = await restore(client, project, page, baseline)
    assert response.status_code == 200, response.text
    node = response.json()["node"]
    assert node["title"] == "Original title" and node["scene_document"]["sections"][0]["target_node_id"] == child
    assert node["children"] == [child] and response.json()["preserved_branch_count"] == 1


async def test_restore_can_resurrect_unlinked_section_with_original_identity(client, project, page):
    original = await patch(client, project, page, scene_document=scene(section()))
    baseline = (await versions(client, project, page))["current_version_id"]
    await patch(client, project, page, scene_document=scene())
    response = await restore(client, project, page, baseline)
    assert response.status_code == 200
    assert response.json()["node"]["hotspots"][0]["id"] == original["hotspots"][0]["id"]
    assert response.json()["node"]["hotspots"][0]["target_node_id"] is None


async def test_restore_does_not_resurrect_historical_targets(client, project, page):
    from main import app

    current = await patch(client, project, page, scene_document=scene(section()))
    hotspot = current["hotspots"][0]["id"]
    await attach_child(project, page, hotspot)
    linked_version = (await versions(client, project, page))["current_version_id"]
    async with app.state.pool.acquire() as conn:
        await conn.execute("UPDATE hotspots SET target_node_id=NULL WHERE id=$1", hotspot)
    response = await restore(client, project, page, linked_version)
    assert response.status_code == 200
    node = response.json()["node"]
    assert node["hotspots"][0]["target_node_id"] is None
    assert "target_node_id" not in node["scene_document"]["sections"][0]


async def test_restore_idempotency_survives_later_edit_and_rejects_parameter_conflicts(client, project, page):
    baseline = (await versions(client, project, page))["current_version_id"]
    await patch(client, project, page, title="Before undo")
    previous_revision = (await graph(client, project))["revision"]
    first = await restore(client, project, page, baseline, operation="stable", revision=previous_revision)
    assert first.status_code == 200
    await patch(client, project, page, title="New edit after undo")
    replay = await restore(client, project, page, baseline, operation="stable", revision=previous_revision)
    assert replay.json() == first.json()
    assert (await graph(client, project))["nodes"][page]["title"] == "New edit after undo"
    conflict = await restore(client, project, page, baseline, operation="stable", revision=previous_revision + 1)
    assert conflict.status_code == 409


async def test_stale_restore_node_hotspot_patch_and_creation_cannot_overwrite(client, project, page):
    baseline = (await versions(client, project, page))["current_version_id"]
    await patch(client, project, page, title="Concurrent edit")
    for method, suffix, body in [
        ("PATCH", "", {"title": "Late overwrite"}),
        ("PATCH", "/hotspots", {"hotspots": []}),
        ("POST", "/hotspots", {"label": "Late", "pos_x": .1, "pos_y": .1, "width": .1, "height": .1}),
    ]:
        result = await client.request(method, node_url(project, page) + suffix, json={**body, "expected_revision": 0})
        assert result.status_code == 409
    result = await restore(client, project, page, baseline, revision=0)
    assert result.status_code == 409
    assert (await graph(client, project))["nodes"][page]["title"] == "Concurrent edit"


async def test_concurrent_restores_with_same_revision_serialize_without_overwrite(client, project, page):
    baseline = (await versions(client, project, page))["current_version_id"]
    await patch(client, project, page, title="New title")
    revision = (await graph(client, project))["revision"]
    responses = await asyncio.gather(
        restore(client, project, page, baseline, revision=revision),
        restore(client, project, page, baseline, revision=revision),
    )
    assert sorted(response.status_code for response in responses) == [200, 409]


async def test_selection_changes_revision_without_content_versions_and_geometry_is_versioned(client, project, page):
    first = await client.post(node_url(project, page) + "/hotspots", json={
        "label": "Image region", "pos_x": .1, "pos_y": .1, "width": .2, "height": .2, "expected_revision": 0,
    })
    assert first.status_code == 201 and first.json()["project_revision"] == 1
    hotspot = first.json()["id"]
    before = await versions(client, project, page)
    selected = await client.patch(node_url(project, page) + "/hotspots", json={
        "hotspots": [{"id": hotspot, "selected": False}], "expected_revision": 1,
    })
    assert selected.status_code == 200 and selected.json()["project_revision"] == 2
    after = await versions(client, project, page)
    assert after["versions"] == before["versions"]
    geometry = await client.patch(node_url(project, page) + "/hotspots", json={
        "hotspots": [{"id": hotspot, "pos_x": .3}], "expected_revision": 2,
    })
    assert geometry.status_code == 200 and geometry.json()["project_revision"] == 3
    assert len((await versions(client, project, page))["versions"]) == len(before["versions"]) + 1


async def test_connected_section_overflow_is_rejected_atomically(client, project, page):
    await patch(client, project, page, scene_document=scene(*(section(str(i)) for i in range(12))))
    baseline = (await versions(client, project, page))["current_version_id"]
    await patch(client, project, page, scene_document=scene(section("later")))
    node = (await graph(client, project))["nodes"][page]
    await attach_child(project, page, node["hotspots"][0]["id"])
    before = await graph(client, project)
    result = await restore(client, project, page, baseline)
    assert result.status_code == 409 and "12" in result.json()["detail"]
    assert await graph(client, project) == before


async def test_image_history_roundtrip_preserves_branch_when_hotspot_merge_exceeds_quota(client, project, page):
    first = await client.post(node_url(project, page) + "/hotspots", json={
        "label": "Original image region", "pos_x": .1, "pos_y": .1, "width": .1, "height": .1,
    })
    assert first.status_code == 201
    one_hotspot_version = (await versions(client, project, page))["current_version_id"]
    for index in range(11):
        added = await client.post(node_url(project, page) + "/hotspots", json={
            "label": f"Historical region {index}", "pos_x": .2, "pos_y": .2, "width": .1, "height": .1,
        })
        assert added.status_code == 201
    twelve_hotspot_version = (await versions(client, project, page))["current_version_id"]
    assert (await restore(client, project, page, one_hotspot_version)).status_code == 200
    later = await client.post(node_url(project, page) + "/hotspots", json={
        "label": "New connected image region", "pos_x": .3, "pos_y": .3, "width": .1, "height": .1,
    })
    assert later.status_code == 201
    child = await attach_child(project, page, later.json()["id"])
    before = await graph(client, project)
    history_before = await versions(client, project, page)
    preview = await client.get(node_url(project, page) + f"/versions/{twelve_hotspot_version}")
    assert preview.status_code == 409 and "12 个热点" in preview.json()["detail"]
    result = await restore(client, project, page, twelve_hotspot_version)
    assert result.status_code == 409 and "12 个热点" in result.json()["detail"]
    after = await graph(client, project)
    assert after == before
    assert after["nodes"][page]["children"] == [child]
    assert any(h["id"] == later.json()["id"] and h["target_node_id"] == child for h in after["nodes"][page]["hotspots"])
    assert await versions(client, project, page) == history_before


async def test_missing_historical_image_aborts_without_changing_content(client, project, page, tmp_path, monkeypatch):
    import storage
    from main import app
    monkeypatch.setattr(storage, "UPLOAD_DIR", tmp_path)
    directory = tmp_path / project
    directory.mkdir()
    image = directory / "immutable.png"
    image.write_bytes(b"unchanged image bytes")
    async with app.state.pool.acquire() as conn:
        await conn.execute("UPDATE nodes SET image_url=$1 WHERE id=$2", f"/uploads/{project}/immutable.png", page)
    baseline = (await versions(client, project, page))["current_version_id"]
    await patch(client, project, page, title="Later image title")
    image.unlink()
    before = await graph(client, project)
    result = await restore(client, project, page, baseline)
    assert result.status_code == 409 and "图片" in result.json()["detail"]
    assert await graph(client, project) == before


async def test_active_job_blocks_restore_but_history_can_be_inspected(client, project, page):
    from main import app

    baseline = (await versions(client, project, page))["current_version_id"]
    job = gen_id("job_")
    async with app.state.pool.acquire() as conn:
        await conn.execute("INSERT INTO generation_jobs(id,operation_id,fingerprint,project_id,node_id,input,provider_config,previous_status,status) "
                           "VALUES($1,$1,'digest',$2,$3,'{}','{}','draft','waiting_credentials')", job, project, page)
    try:
        assert (await versions(client, project, page))["current_version_id"] == baseline
        result = await restore(client, project, page, baseline)
        assert result.status_code == 409
    finally:
        async with app.state.pool.acquire() as conn:
            await conn.execute("DELETE FROM generation_jobs WHERE id=$1", job)


async def test_versions_are_page_scoped_and_restore_body_cannot_inject_snapshot(client, project, page):
    baseline = (await versions(client, project, page))["current_version_id"]
    missing = await client.get(node_url(project, "other-page") + f"/versions/{baseline}")
    assert missing.status_code == 404
    missing_project = await client.get(node_url("missing-project", page) + "/versions")
    assert missing_project.status_code == 404
    wrong = await restore(client, project, "other-page", baseline)
    assert wrong.status_code == 404
    invalid = await client.post(node_url(project, page) + f"/versions/{baseline}/restore", json={
        "operation_id": "inject", "expected_revision": 0, "snapshot": {"title": "Forged"},
    })
    assert invalid.status_code == 422


async def test_cross_project_nodes_never_create_or_disclose_history(client, project, page):
    from main import app

    other_project = (await client.post("/api/projects", json={"name": "Other private work"})).json()["project_id"]
    other_node = gen_id("node_")
    try:
        async with app.state.pool.acquire() as conn:
            await conn.execute("INSERT INTO nodes(id,project_id,title) VALUES($1,$2,'Other private title')", other_node, other_project)
        original_version = (await versions(client, project, page))["current_version_id"]
        requests = [
            ("GET", node_url(project, other_node) + "/versions", None),
            ("GET", node_url(project, other_node) + f"/versions/{original_version}", None),
            ("POST", node_url(project, other_node) + f"/versions/{original_version}/restore", {"operation_id": "foreign-node", "expected_revision": 0}),
            ("GET", node_url(other_project, other_node) + f"/versions/{original_version}", None),
            ("POST", node_url(other_project, other_node) + f"/versions/{original_version}/restore", {"operation_id": "foreign-version", "expected_revision": 0}),
        ]
        for method, path, body in requests:
            result = await client.request(method, path, **({"json": body} if body else {}))
            assert result.status_code == 404
            assert "Other private title" not in result.text
        async with app.state.pool.acquire() as conn:
            assert not await conn.fetchval("SELECT 1 FROM node_versions WHERE node_id=$1", other_node)
            assert not await conn.fetchval("SELECT 1 FROM node_versions WHERE node_id=$1 AND project_id<>$2", page, project)
    finally:
        await client.delete(f"/api/projects/{other_project}")


async def test_journal_failure_rolls_back_content_revision_and_restore_operation(client, project, page, monkeypatch):
    from main import app
    from routers import versions as router

    baseline = (await versions(client, project, page))["current_version_id"]
    await patch(client, project, page, title="Must remain")
    before = await graph(client, project)
    history = await versions(client, project, page)

    async def fail_record(*args):
        raise RuntimeError("journal persistence failed")

    monkeypatch.setattr(router, "record_changes", fail_record)
    with pytest.raises(RuntimeError, match="journal persistence"):
        await restore(client, project, page, baseline, operation="rollback")
    assert await graph(client, project) == before
    assert await versions(client, project, page) == history
    async with app.state.pool.acquire() as conn:
        assert not await conn.fetchval("SELECT 1 FROM version_restore_operations WHERE project_id=$1", project)
