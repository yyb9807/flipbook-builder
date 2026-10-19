"""Real Postgres publication admission and independent filesystem reader boundaries."""
import asyncio
import io
import json
import subprocess
import sys
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from PIL import Image

import publications
import storage
from content_metadata import ai_content_metadata
from reader import app as reader_app
from utils import gen_id


@pytest_asyncio.fixture
async def published_work(client, project, tmp_path, monkeypatch):
    from main import app

    directory, runtime, uploads = tmp_path / "publications", tmp_path / "runtime", tmp_path / "uploads"
    runtime.mkdir()
    (runtime / "player.js").write_text("window.FROZEN_READER='first';")
    (runtime / "player.css").write_text("body{margin:0}")
    monkeypatch.setenv("PUBLICATION_DIR", str(directory))
    monkeypatch.setenv("PUBLICATION_RUNTIME_DIR", str(runtime))
    monkeypatch.setenv("PUBLICATION_BASE_URL", "https://reader.example.org")
    monkeypatch.setattr(storage, "UPLOAD_DIR", uploads)
    image = io.BytesIO()
    Image.new("RGB", (8, 8), (10, 20, 30)).save(image, format="PNG")
    image_url = await storage.save_upload(project, "root.png", image.getvalue())
    identities = [gen_id("node_") for _ in range(3)]
    metadata = ai_content_metadata("text", "public-model")
    metadata.update(private_key="DO_NOT_PUBLISH_METADATA", references=[{
        "id": "ref", "title": "Author reference", "url": "https://example.org/source", "secret": "DO_NOT_PUBLISH_REFERENCE",
    }])
    async with app.state.pool.acquire() as conn:
        await conn.execute("UPDATE projects SET name=$1,root_node_id=$2,settings=$3::jsonb WHERE id=$4",
                           '</script><script>window.BAD=1</script>', identities[0],
                           json.dumps({"language": "zh", "api_key": "DO_NOT_PUBLISH_SETTING"}), project)
        for depth, identity in enumerate(identities):
            hotspot = gen_id("hs_") if depth < 2 else None
            section = {"id": "intro", "title": "Explore", "body": f"Frozen page {depth}"}
            if hotspot:
                section.update(hotspot_id=hotspot, target_node_id=identities[depth + 1])
            await conn.execute("INSERT INTO nodes(id,project_id,parent_id,depth,title,description,source_type,image_url,scene_document,content_metadata) "
                               "VALUES($1,$2,$3,$4,$5,'Saved content','text',$6,$7::jsonb,$8::jsonb)",
                               identity, project, identities[depth - 1] if depth else None, depth, f"Frozen title {depth}",
                               image_url if depth == 0 else None,
                               json.dumps({"version": 1, "layout": "atlas", "sections": [section], "secret": "DO_NOT_PUBLISH_SCENE"}),
                               json.dumps(metadata))
        for depth in range(2):
            scene = json.loads(await conn.fetchval("SELECT scene_document FROM nodes WHERE id=$1", identities[depth]))
            await conn.execute("INSERT INTO hotspots(id,node_id,label,target_node_id,kind) VALUES($1,$2,'Explore',$3,'section')",
                               scene["sections"][0]["hotspot_id"], identities[depth], identities[depth + 1])
    async with AsyncClient(transport=ASGITransport(app=reader_app), base_url="http://reader") as reader:
        yield {"client": client, "reader": reader, "project": project, "nodes": identities,
               "directory": directory, "runtime": runtime, "image": storage.url_to_disk_path(image_url)}


async def publish(work, operation="publish_first", revision=0):
    return await work["client"].post(f"/api/projects/{work['project']}/publications", json={
        "operation_id": operation, "expected_revision": revision,
    })


async def test_publication_copies_allowlisted_complete_tree_images_and_runtime(published_work):
    work = published_work
    result = await publish(work)
    assert result.status_code == 201, result.text
    receipt = result.json()["publication"]
    identity = receipt["id"]
    assert receipt["source_revision"] == 0 and receipt["page_count"] == 3 and len(receipt["content_hash"]) == 64
    assert receipt["url"] == f"https://reader.example.org/p/{identity}/"
    directory = work["directory"] / identity
    payload = json.loads((directory / "project.json").read_text())
    text = (directory / "project.json").read_text()
    assert "DO_NOT_PUBLISH" not in text and "operation_id" not in text and "provider" not in text
    assert payload["settings"] == {"language": "zh", "max_depth": 4, "max_hotspots_per_page": 3, "visual_style": "encyclopedia"}
    root, child, leaf = work["nodes"]
    assert payload["nodes"][root]["children"] == [child] and payload["nodes"][child]["children"] == [leaf]
    assert payload["nodes"][root]["scene_document"]["sections"][0]["target_node_id"] == child
    assert payload["nodes"][root]["content_metadata"]["references"][0]["url"] == "https://example.org/source"
    image = payload["nodes"][root]["image_url"]
    assert image.startswith("assets/") and (directory / image).read_bytes() == work["image"].read_bytes()
    assert "/uploads/" not in text
    assert (directory / "index.html").read_text().count("<script") == 2
    assert "\\u003c/script\\u003e" in (directory / "index.html").read_text()
    response = await work["reader"].get(f"/p/{identity}/")
    assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    assert "connect-src 'none'" in response.headers["content-security-policy"]
    assert (await work["reader"].get(f"/p/{identity}/{image}")).content == work["image"].read_bytes()


async def test_frozen_versions_survive_edits_runtime_changes_and_source_deletion(published_work):
    work = published_work
    first = (await publish(work)).json()["publication"]
    path = f"/p/{first['id']}/project.json"
    before = (await work["reader"].get(path)).content
    old_runtime = (await work["reader"].get(f"/p/{first['id']}/player.js")).content
    (work["runtime"] / "player.js").write_text("window.FROZEN_READER='second';")
    changed = await work["client"].patch(f"/api/projects/{work['project']}/nodes/{work['nodes'][0]}", json={
        "title": "Later edited title", "expected_revision": 0,
    })
    assert changed.status_code == 200
    second = await publish(work, "publish_second", changed.json()["project_revision"])
    assert second.status_code == 201 and second.json()["publication"]["id"] != first["id"]
    assert (await work["reader"].get(path)).content == before
    assert (await work["reader"].get(f"/p/{first['id']}/player.js")).content == old_runtime
    assert b"Later edited title" in (await work["reader"].get(f"/p/{second.json()['publication']['id']}/project.json")).content
    work["image"].unlink()
    deleted = await work["client"].delete(f"/api/projects/{work['project']}")
    assert deleted.status_code == 200
    assert (await work["reader"].get(path)).content == before
    replay = await publish(work)
    assert replay.status_code == 200 and replay.json()["publication"] == first
    listed = await work["client"].get(f"/api/projects/{work['project']}/publications")
    assert len(listed.json()["publications"]) == 2
    global_list = await work["client"].get("/api/publications")
    assert global_list.json() == listed.json()
    assert (await work["client"].get("/api/projects/other/publications")).json() == {"publications": []}


async def test_idempotent_publication_and_withdrawal_never_resurrect_saved_operation(published_work):
    work = published_work
    first = await publish(work)
    receipt = first.json()["publication"]
    assert (await publish(work)).status_code == 200
    conflict = await publish(work, revision=1)
    assert conflict.status_code == 409
    endpoint = f"/api/projects/{work['project']}/publications/{receipt['id']}"
    withdrawn = await work["client"].delete(endpoint)
    assert withdrawn.status_code == 200 and withdrawn.json()["publication"]["state"] == "withdrawn"
    assert (await work["client"].delete(endpoint)).json() == withdrawn.json()
    replay = await publish(work)
    assert replay.status_code == 200 and replay.json() == withdrawn.json()
    assert (await work["reader"].get(f"/p/{receipt['id']}/")).status_code == 404
    tombstone = work["directory"] / ".withdrawn" / receipt["id"]
    assert [file.name for file in tombstone.iterdir()] == ["manifest.json"]
    assert (await work["client"].delete(f"/api/projects/other/publications/{receipt['id']}")).status_code == 404


async def test_stale_revision_active_tasks_and_injected_payload_do_not_publish(published_work):
    from main import app

    work = published_work
    assert (await publish(work, revision=1)).status_code == 409
    invalid = await work["client"].post(f"/api/projects/{work['project']}/publications", json={
        "operation_id": "inject", "expected_revision": 0, "html": "<script>evil()</script>",
    })
    assert invalid.status_code == 422
    job = gen_id("job_")
    async with app.state.pool.acquire() as conn:
        await conn.execute("INSERT INTO generation_jobs(id,operation_id,fingerprint,project_id,node_id,input,provider_config,previous_status,status) "
                           "VALUES($1,$1,'digest',$2,$3,'{}','{}','draft','waiting_credentials')", job, work["project"], work["nodes"][0])
    try:
        assert (await publish(work)).status_code == 409
    finally:
        async with app.state.pool.acquire() as conn:
            await conn.execute("DELETE FROM generation_jobs WHERE id=$1", job)
    assert not list(work["directory"].glob("pub_*")) and not list(work["directory"].glob(".staging-*"))


@pytest.mark.parametrize("damage", ["missing_root", "wrong_depth", "orphan", "unlinked_child", "scene_target", "hidden_image_branch", "external_image", "missing_image", "symlink_image", "traversal_image"])
async def test_incomplete_tree_or_asset_fails_without_visible_partial_version(published_work, damage):
    from main import app

    work = published_work
    root, child, leaf = work["nodes"]
    async with app.state.pool.acquire() as conn:
        if damage == "missing_root":
            await conn.execute("UPDATE projects SET root_node_id=NULL WHERE id=$1", work["project"])
        elif damage == "wrong_depth":
            await conn.execute("UPDATE nodes SET depth=9 WHERE id=$1", child)
        elif damage == "orphan":
            await conn.execute("UPDATE nodes SET parent_id=NULL WHERE id=$1", leaf)
        elif damage == "unlinked_child":
            await conn.execute("UPDATE hotspots SET target_node_id=NULL WHERE node_id=$1", child)
        elif damage == "scene_target":
            await conn.execute("UPDATE nodes SET scene_document=jsonb_set(scene_document,'{sections,0,target_node_id}',$1::jsonb) WHERE id=$2",
                               json.dumps(leaf), root)
        elif damage == "hidden_image_branch":
            await conn.execute("UPDATE hotspots SET kind='image',pos_x=.1,pos_y=.1,width=.2,height=.2 WHERE node_id=$1", root)
            await conn.execute("UPDATE nodes SET scene_document=$1::jsonb WHERE id=$2", json.dumps({
                "version": 1, "layout": "atlas", "sections": [{"id": "hidden", "title": "No connection", "body": "This omits the live child"}],
            }), root)
        elif damage == "external_image":
            await conn.execute("UPDATE nodes SET image_url='https://provider.invalid/private.png' WHERE id=$1", root)
        elif damage == "missing_image":
            work["image"].unlink()
        elif damage == "symlink_image":
            outside = work["image"].parent / "copy.png"
            work["image"].rename(outside)
            work["image"].symlink_to(outside)
        elif damage == "traversal_image":
            await conn.execute("UPDATE nodes SET image_url=$1 WHERE id=$2",
                               f"/uploads/{work['project']}/../{work['project']}/{work['image'].name}", root)
    response = await publish(work)
    assert response.status_code == 409, response.text
    assert not list(work["directory"].glob("pub_*")) and not list(work["directory"].glob(".staging-*"))


async def test_failed_copy_is_atomic_and_previous_publication_remains_readable(published_work, monkeypatch):
    work = published_work
    first = (await publish(work)).json()["publication"]

    def failed_copy(*args):
        raise OSError("disk failure")

    monkeypatch.setattr(publications.shutil, "copyfile", failed_copy)
    with pytest.raises(OSError, match="disk failure"):
        await publish(work, "failed_copy")
    assert len(list(work["directory"].glob("pub_*"))) == 1
    assert not list(work["directory"].glob(".staging-*"))
    assert (await work["reader"].get(f"/p/{first['id']}/")).status_code == 200


async def test_missing_trusted_runtime_fails_closed(published_work):
    work = published_work
    (work["runtime"] / "player.js").unlink()
    assert (await publish(work)).status_code == 503
    assert not list(work["directory"].glob("pub_*"))


async def test_concurrent_identical_operations_create_exactly_one_fixed_version(published_work):
    work = published_work
    responses = await asyncio.gather(publish(work), publish(work))
    assert sorted(response.status_code for response in responses) in ([201, 503], [200, 201])
    replay = await publish(work)
    assert replay.status_code == 200
    assert len(list(work["directory"].glob("pub_*"))) == 1


async def test_busy_publication_is_retryable_and_same_operation_keeps_exactly_one_receipt(published_work):
    work = published_work
    with publications._project_lock(work["project"]):
        busy = await publish(work, "unknown_pending")
    assert busy.status_code == 503 and busy.headers["retry-after"] == "1"
    assert not list(work["directory"].glob("pub_*")) and not list(work["directory"].glob(".staging-*"))
    first = await publish(work, "unknown_pending")
    assert first.status_code == 201
    replay = await publish(work, "unknown_pending")
    assert replay.status_code == 200 and replay.json() == first.json()
    assert len(list(work["directory"].glob("pub_*"))) == 1


async def test_reader_only_exposes_exact_public_files_and_get_head(published_work):
    work = published_work
    receipt = (await publish(work)).json()["publication"]
    prefix = f"/p/{receipt['id']}"
    for path in ("manifest.json", "assets/", "assets/%2e%2e/manifest.json", "%2e%2e/.locks/test.lock", "unknown.svg"):
        assert (await work["reader"].get(f"{prefix}/{path}")).status_code == 404
    for path in ("/api/projects", "/api/test-config", "/docs", "/openapi.json", "/uploads/a.png", "/"):
        assert (await work["reader"].get(path)).status_code == 404
    for method in ("POST", "PATCH", "PUT", "DELETE"):
        assert (await work["reader"].request(method, f"{prefix}/")).status_code == 405
    response = await work["reader"].head(f"{prefix}/project.json")
    assert response.status_code == 200 and not response.content and response.headers["content-type"] == "application/json"
    assert (await work["reader"].get("/healthz")).json() == {"status": "ok"}
    directory = work["directory"] / receipt["id"]
    (directory / "player.js").unlink()
    (directory / "player.js").symlink_to(directory / "manifest.json")
    assert (await work["reader"].get(f"{prefix}/player.js")).status_code == 404


def test_reader_import_does_not_load_database_editor_or_ai_modules():
    command = "import reader,sys; assert not ({'main','database','asyncpg','dbos','agents.base','publications'} & set(sys.modules))"
    result = subprocess.run([sys.executable, "-c", command], cwd=Path(__file__).parents[1], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


async def test_corrupt_settings_values_cannot_export_nested_configuration(published_work):
    from main import app

    work = published_work
    async with app.state.pool.acquire() as conn:
        await conn.execute("UPDATE projects SET settings=$1::jsonb WHERE id=$2", json.dumps({
            key: {"api_key": "DO_NOT_PUBLISH_NESTED_SETTINGS"}
            for key in ("max_depth", "max_hotspots_per_page", "visual_style", "language")
        }), work["project"])
    receipt = (await publish(work)).json()["publication"]
    payload = (await work["reader"].get(f"/p/{receipt['id']}/project.json")).json()
    assert "DO_NOT_PUBLISH" not in json.dumps(payload)
    assert payload["settings"] == {"max_depth": 4, "max_hotspots_per_page": 3, "visual_style": "encyclopedia", "language": "zh"}


async def test_browser_unavailable_publication_is_bilingual_safe_html_and_resources_keep_json(published_work):
    work = published_work
    receipt = (await publish(work)).json()["publication"]
    await work["client"].delete(f"/api/projects/{work['project']}/publications/{receipt['id']}")
    url = f"/p/{receipt['id']}/"
    browser = await work["reader"].get(url, headers={"Accept": "text/html,application/xhtml+xml,*/*;q=0.8"})
    assert browser.status_code == 404 and browser.headers["content-type"].startswith("text/html")
    assert "作品不可用" in browser.text and "Publication unavailable" in browser.text
    assert "请联系分享者确认地址" in browser.text and "contact the person who shared it" in browser.text
    assert not any(value in browser.text for value in ("<script", "<a ", "<link", "<img", "https://", "/api/", "/edit", "返回编辑"))
    assert browser.headers["cache-control"] == "no-store" and "connect-src 'none'" in browser.headers["content-security-policy"]
    for accept in ("*/*", "application/json"):
        response = await work["reader"].get(url + "project.json", headers={"Accept": accept})
        assert response.status_code == 404 and response.headers["content-type"] == "application/json"
        assert response.json() == {"detail": "作品不存在或已撤下"}
