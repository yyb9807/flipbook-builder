"""Real Postgres/DBOS page workflows; no paid network calls."""
import asyncio
import hashlib
import io
import json
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from PIL import Image

import storage
from jobs import page_workflows
from jobs.providers import ProviderFailure
from tests.knowledge_fixtures import knowledge_result
from tests.test_durable_jobs import HEADERS, wait_job
from utils import gen_id

NO_KEYS = {**HEADERS, "x-llm-api-key": ""}
IMAGE_KEYS = {**HEADERS, "x-imggen-api-key": "synthetic-image-secret"}


def png():
    out = io.BytesIO()
    Image.new("RGB", (30, 20), "green").save(out, "PNG")
    return out.getvalue()


async def analyze(client, project, operation="root-operation", headers=None, data=None, files=None):
    return await client.post(f"/api/projects/{project}/analysis-jobs", headers=HEADERS if headers is None else headers,
                             data={"operation_id": operation, "text": "Water cycle", "generate_images": "false", **(data or {})}, files=files)


async def regenerate(client, project, node, operation="regenerate-operation", headers=None, images=False):
    return await client.post(f"/api/projects/{project}/nodes/{node}/regeneration-jobs", headers=HEADERS if headers is None else headers,
                             json={"operation_id": operation, "generate_images": images})


@pytest_asyncio.fixture
async def blank_node(client, project):
    from main import app
    node = gen_id("node_")
    async with app.state.pool.acquire() as conn:
        await conn.execute("INSERT INTO nodes(id,project_id,title,description,status) VALUES($1,$2,'Original title','Original body','draft')", node, project)
        await conn.execute("UPDATE projects SET root_node_id=$1 WHERE id=$2", node, project)
    yield node
    for job in (await client.get(f"/api/projects/{project}/jobs")).json()["jobs"]:
        await client.post(f"/api/jobs/{job['job_id']}/cancel")


@pytest.fixture
async def fake_page_provider(monkeypatch, tmp_path):
    monkeypatch.setattr(storage, "UPLOAD_DIR", tmp_path)
    calls = []
    async def invoke(stage, config, frozen, page=None, image=None):
        calls.append(stage)
        if stage in {"plan", "analyze"}:
            return knowledge_result("New title", "New body", summary="Cycle", main_objects=["Cloud"],
                                    keywords=[{"label": "Cloud", "description": "Water"}], image_prompt="Cloud")
        if stage == "image":
            data = png()
            url = await storage.save_upload(frozen["project_id"], "generated.png", data)
            return {"url": url, "sha256": hashlib.sha256(data).hexdigest()}
        return [{"label": "Cloud", "x": .1, "y": .2, "width": .2, "height": .2, "score": None}]
    monkeypatch.setattr(page_workflows, "perform_page", invoke)
    return calls


async def test_empty_root_job_wait_cancel_and_operation_replay(client, project):
    from main import app
    created = await analyze(client, project, headers=NO_KEYS)
    assert created.status_code == 202, created.text
    job = created.json()
    assert job["kind"] == "analyze" and job["node_id"] is None and job["target_node_id"].startswith("node_")
    waiting = await wait_job(client, job["job_id"], lambda row: row["status"] == "waiting_credentials")
    assert waiting["phase"] == "analyze" and waiting["target_node_id"] == job["target_node_id"]
    assert (await client.delete(f"/api/projects/{project}")).status_code == 409
    assert (await analyze(client, project, operation="another-operation", headers=NO_KEYS)).status_code == 409
    cancelled = (await client.post(f"/api/jobs/{job['job_id']}/cancel")).json()
    assert cancelled["status"] == "cancelled"
    empty = (await client.get(f"/api/projects/{project}")).json()
    assert empty["root_node_id"] is None and empty["nodes"] == {}
    replay = await analyze(client, project, headers=NO_KEYS)
    assert replay.json()["job_id"] == job["job_id"]
    assert app.state.jobs.vault.get(job["job_id"], "llm") is None


async def test_text_root_generates_real_stages_and_replays_stable_id(client, project, fake_page_provider):
    from main import app
    created = await analyze(client, project, headers=IMAGE_KEYS, data={"generate_images": "true"})
    assert created.status_code == 202, created.text
    job_id = created.json()["job_id"]
    done = await wait_job(client, job_id)
    assert done["status"] == "succeeded", done
    assert fake_page_provider == ["analyze", "image"]
    assert done["node_id"] == created.json()["target_node_id"] == done["result"]["node_id"]
    assert done["result"]["scene_document"]["sections"][0]["title"] == "Evaporation"
    assert done["result"]["hotspots"][0]["kind"] == "section"
    assert done["result"]["hotspots"][0]["position"] is None
    assert done["result"]["content_metadata"]["provenance"]["input_kind"] == "text"
    restored = (await client.get(f"/api/projects/{project}")).json()
    assert restored["root_node_id"] == done["node_id"] and len(restored["nodes"]) == 1
    replay = await analyze(client, project, headers=IMAGE_KEYS, data={"generate_images": "true"})
    assert replay.json()["job_id"] == job_id and fake_page_provider == ["analyze", "image"]
    assert app.state.jobs.vault.get(job_id, "llm") is None
    async with app.state.pool.acquire() as conn:
        outputs = await conn.fetch("SELECT function_name FROM dbos.operation_outputs WHERE workflow_uuid=$1", job_id)
    assert any("page_compose" in row["function_name"] for row in outputs)


async def test_uploaded_root_freezes_valid_asset_and_reuses_inline_hotspots(client, project, monkeypatch, tmp_path):
    monkeypatch.setattr(storage, "UPLOAD_DIR", tmp_path)
    data = png()
    async def provider(stage, config, frozen, page=None, image=None):
        assert stage == "analyze"
        assert storage.url_to_disk_path(frozen["asset_url"]).read_bytes() == storage.normalize_image(data)
        return {"summary": "Uploaded", "hotspots": [{"label": "Leaf", "x": .1, "y": .1, "width": .2, "height": .2}]}
    call = AsyncMock(side_effect=provider)
    monkeypatch.setattr(page_workflows, "perform_page", call)
    created = await analyze(client, project, files={"file": ("source.png", data, "image/png")},
                            data={"file_sha256": hashlib.sha256(data).hexdigest()})
    assert created.status_code == 202, created.text
    done = await wait_job(client, created.json()["job_id"])
    assert done["status"] == "succeeded" and done["result"]["source_type"] == "image"
    assert done["result"]["scene_document"] is None
    assert done["result"]["content_metadata"]["provenance"]["input_kind"] == "image"
    assert len(done["result"]["hotspots"]) == 1 and call.await_count == 1
    assert done["input_summary"]["file_sha256"] == hashlib.sha256(data).hexdigest()
    assert len(list(tmp_path.rglob("*.png"))) == 1
    replay = await analyze(client, project, files={"file": ("source.png", data, "image/png")},
                           data={"file_sha256": hashlib.sha256(data).hexdigest()})
    assert replay.json()["job_id"] == done["job_id"] and len(list(tmp_path.rglob("*.png"))) == 1
    bad = await analyze(client, project, files={"file": ("source.png", data, "image/png")}, data={"file_sha256": "0" * 64})
    assert bad.status_code == 409


async def test_root_unknown_image_can_keep_text_without_reissue(client, project, monkeypatch):
    calls = []
    async def provider(stage, config, frozen, page=None, image=None):
        calls.append(stage)
        if stage == "image":
            raise ProviderFailure("unknown", "unknown", True)
        return knowledge_result("Saved text", "Saved text")
    monkeypatch.setattr(page_workflows, "perform_page", provider)
    created = await analyze(client, project, headers=IMAGE_KEYS, data={"generate_images": "true"})
    job_id = created.json()["job_id"]
    waiting = await wait_job(client, job_id, lambda row: row["status"] == "waiting_confirmation")
    assert waiting["confirmation"]["can_accept"] and waiting["phase"] == "image"
    assert (await client.post(f"/api/jobs/{job_id}/accept", json={"confirmation_id": waiting["confirmation"]["id"]})).status_code == 200
    done = await wait_job(client, job_id)
    assert done["status"] == "partial" and done["result"]["image_url"] is None and calls == ["analyze", "image"]


async def test_regenerate_success_updates_same_node_and_bypasses_content_conflicts(client, project, blank_node, fake_page_provider):
    created = await regenerate(client, project, blank_node, headers=IMAGE_KEYS, images=True)
    assert created.status_code == 202, created.text
    done = await wait_job(client, created.json()["job_id"])
    assert done["status"] == "succeeded" and done["node_id"] == blank_node and done["kind"] == "regenerate"
    assert fake_page_provider == ["plan", "image"]
    restored = (await client.get(f"/api/projects/{project}")).json()["nodes"][blank_node]
    assert restored["title"] == "New title" and len(restored["hotspots"]) == 1
    assert restored["content_metadata"]["provenance"]["input_kind"] == "page"
    assert (await regenerate(client, project, blank_node)).status_code == 409  # same op changed image intent
    replay = await regenerate(client, project, blank_node, headers=IMAGE_KEYS, images=True)
    assert replay.json()["job_id"] == done["job_id"]


@pytest.mark.parametrize("unknown", [False, True])
async def test_regenerate_image_failure_or_cancel_preserves_all_original_content(client, project, blank_node, monkeypatch, unknown):
    async def provider(stage, config, frozen, page=None, image=None):
        if stage == "image":
            raise ProviderFailure("provider_outcome_unknown" if unknown else "provider_http_401", "Failure", unknown)
        return knowledge_result("Must not publish", "Must not publish", image_prompt="New")
    monkeypatch.setattr(page_workflows, "perform_page", provider)
    created = await regenerate(client, project, blank_node, headers=IMAGE_KEYS, images=True)
    assert created.status_code == 202, created.text
    job_id = created.json()["job_id"]
    if unknown:
        waiting = await wait_job(client, job_id, lambda row: row["status"] == "waiting_confirmation")
        assert not waiting["confirmation"]["can_accept"]
        assert (await client.post(f"/api/jobs/{job_id}/accept", json={"confirmation_id": waiting["confirmation"]["id"]})).status_code == 409
        await client.post(f"/api/jobs/{job_id}/cancel")
    done = await wait_job(client, job_id)
    assert done["status"] == ("cancelled" if unknown else "failed")
    restored = (await client.get(f"/api/projects/{project}")).json()["nodes"][blank_node]
    assert restored["title"] == "Original title" and restored["description"] == "Original body"
    assert restored["status"] == "draft" and restored["image_url"] is None and restored["hotspots"] == []


@pytest.mark.parametrize("protection", ["hotspots", "scene"])
async def test_regenerate_protects_hotspots_and_structured_body(client, project, blank_node, protection):
    from main import app
    async with app.state.pool.acquire() as conn:
        if protection == "hotspots":
            await conn.execute("INSERT INTO hotspots(id,node_id,label,pos_x,pos_y,width,height) VALUES($1,$2,'Existing',0.1,0.1,0.2,0.2)", gen_id("hs_"), blank_node)
        else:
            await conn.execute("UPDATE nodes SET scene_document=$1::jsonb WHERE id=$2", json.dumps({"version": 1, "layout": "atlas", "sections": []}), blank_node)
    response = await regenerate(client, project, blank_node)
    assert response.status_code == 409
    assert (await client.get(f"/api/projects/{project}/jobs?active=false")).json()["jobs"] == []


async def test_cross_kind_admission_excludes_and_edits_other_nodes_locked(client, project, blank_node):
    from main import app
    other = gen_id("node_")
    async with app.state.pool.acquire() as conn:
        await conn.execute("INSERT INTO nodes(id,project_id,title) VALUES($1,$2,'Other')", other, project)
    created = await regenerate(client, project, blank_node, headers=NO_KEYS)
    job_id = created.json()["job_id"]
    await wait_job(client, job_id, lambda row: row["status"] == "waiting_credentials")
    assert (await regenerate(client, project, other, operation="other", headers=NO_KEYS)).status_code == 409
    assert (await client.patch(f"/api/projects/{project}/nodes/{other}", json={"title": "Blocked"})).status_code == 409
    assert (await client.post(f"/api/projects/{project}/nodes/{other}/hotspots", json={"label": "New", "pos_x": .1, "pos_y": .1, "width": .2, "height": .2})).status_code == 409
    assert (await analyze(client, project, operation="root", headers=NO_KEYS)).status_code == 409
    await client.post(f"/api/jobs/{job_id}/cancel")
    assert (await client.patch(f"/api/projects/{project}/nodes/{other}", json={"title": "Allowed"})).status_code == 200


async def test_root_enqueue_rollback_does_not_leave_job_or_node(client, project, monkeypatch):
    from main import app
    monkeypatch.setattr(app.state.jobs.client, "enqueue_in_transaction", lambda *args: (_ for _ in ()).throw(RuntimeError("Controlled rollback")))
    with pytest.raises(RuntimeError, match="Controlled rollback"):
        await analyze(client, project)
    async with app.state.pool.acquire() as conn:
        assert await conn.fetchval("SELECT COUNT(*) FROM generation_jobs WHERE project_id=$1", project) == 0
        assert await conn.fetchval("SELECT COUNT(*) FROM nodes WHERE project_id=$1", project) == 0
    assert app.state.jobs.vault._entries == {}


async def test_legacy_paths_are_async_and_do_not_depend_on_http_lifetime(client, project, monkeypatch):
    from main import app
    response = await client.post(f"/api/projects/{project}/analyze", data={"text": "Legacy", "generate_images": "false"}, headers={**NO_KEYS, "x-operation-id": "legacy-root"})
    assert response.status_code == 202 and response.json()["kind"] == "analyze"
    job_id = response.json()["job_id"]
    await wait_job(client, job_id, lambda row: row["status"] == "waiting_credentials")
    monkeypatch.setattr(page_workflows, "perform_page", AsyncMock(return_value=knowledge_result("Legacy page", "Legacy page")))
    await client.post(f"/api/jobs/{job_id}/credentials", headers=HEADERS)
    done = await wait_job(client, job_id)
    # New structured roots are protected from replacement. Exercise the legacy
    # regeneration URL on an actual unstructured child instead.
    node = gen_id("node_")
    async with app.state.pool.acquire() as conn:
        await conn.execute("INSERT INTO nodes(id,project_id,parent_id,depth,title) VALUES($1,$2,$3,1,'Legacy blank')", node, project, done["node_id"])
    response = await client.post(f"/api/projects/{project}/nodes/{node}/regenerate", json={"generate_images": False}, headers={**NO_KEYS, "x-operation-id": "legacy-regenerate"})
    assert response.status_code == 202 and response.json()["kind"] == "regenerate"
    await client.post(f"/api/jobs/{response.json()['job_id']}/cancel")
    assert app.state.jobs.vault._entries == {}


async def test_changed_asset_is_known_failure_and_vault_discarded(client, project, monkeypatch, tmp_path):
    from main import app
    monkeypatch.setattr(storage, "UPLOAD_DIR", tmp_path)
    async def provider(stage, config, frozen, page=None, image=None):
        path = storage.url_to_disk_path(frozen["asset_url"])
        path.write_bytes(b"changed")
        return {"summary": "Analysis done", "hotspots": []}
    monkeypatch.setattr(page_workflows, "perform_page", provider)
    created = await analyze(client, project, files={"file": ("source.png", png(), "image/png")})
    job_id = created.json()["job_id"]
    done = await wait_job(client, job_id)
    assert done["status"] == "failed" and done["error"]["code"] == "local_asset_unavailable"
    assert app.state.jobs.vault.get(job_id, "llm") is None
    assert (await client.get(f"/api/projects/{project}")).json()["root_node_id"] is None


async def test_page_admission_race_uses_one_project_lock(client, project):
    responses = await asyncio.gather(*[analyze(client, project, operation=f"race-{index}", headers=NO_KEYS) for index in range(3)])
    assert sorted(response.status_code for response in responses) == [202, 409, 409]
    job = next(response.json() for response in responses if response.status_code == 202)
    await client.post(f"/api/jobs/{job['job_id']}/cancel")


async def test_new_migration_can_repeat_with_legacy_active_children(client, project):
    from database import apply_schema
    from main import app
    async with app.state.pool.acquire() as conn:
        for index in range(2):
            node, job = gen_id("node_"), gen_id("job_")
            await conn.execute("INSERT INTO nodes(id,project_id,title) VALUES($1,$2,'Legacy')", node, project)
            await conn.execute("INSERT INTO generation_jobs(id,operation_id,fingerprint,project_id,node_id,input,provider_config,previous_status) VALUES($1,$2,'legacy',$3,$4,'{}','{}','draft')", job, f"legacy-{index}", project, node)
    await apply_schema(app.state.pool)
    await apply_schema(app.state.pool)
    async with app.state.pool.acquire() as conn:
        assert await conn.fetchval("SELECT COUNT(*) FROM generation_jobs WHERE project_id=$1 AND kind='children'", project) == 2
        await conn.execute("UPDATE generation_jobs SET status='cancelled' WHERE project_id=$1", project)


@pytest.mark.parametrize("terminal", [False, True])
async def test_upload_operation_replay_without_file_checks_full_identity(client, project, fake_page_provider, terminal):
    from main import app
    data = png()
    file_hash = hashlib.sha256(data).hexdigest()
    headers = HEADERS if terminal else NO_KEYS
    created = await analyze(client, project, headers=headers, files={"file": ("original.png", data, "image/png")}, data={"file_sha256": file_hash})
    job_id = created.json()["job_id"]
    if terminal:
        await wait_job(client, job_id)
    else:
        await wait_job(client, job_id, lambda row: row["status"] == "waiting_credentials")
    replay = await analyze(client, project, headers=headers, data={"file_sha256": file_hash})
    assert replay.status_code == 202 and replay.json()["job_id"] == job_id
    assert replay.json()["input_summary"]["filename"] == "original.png"
    for override in [{"file_sha256": "0" * 64}, {"text": "Changed"}, {"keywords": "Changed"}, {"generate_images": "true"}]:
        mismatch = await analyze(client, project, headers=headers, data={"file_sha256": file_hash, **override})
        assert mismatch.status_code == 409
    wrong_provider = await analyze(client, project, headers={**headers, "x-llm-model": "different-model"}, data={"file_sha256": file_hash})
    assert wrong_provider.status_code == 409
    if not terminal:
        await client.post(f"/api/jobs/{job_id}/cancel")
    assert app.state.jobs.vault.get(job_id, "llm") is None


@pytest.mark.parametrize("raise_echo", [False, True])
async def test_new_analysis_workflow_never_checkpoints_echoed_credentials(client, project, monkeypatch, raise_echo):
    import base64
    import binascii

    from main import app
    llm_secret, image_secret = IMAGE_KEYS["x-llm-api-key"], IMAGE_KEYS["x-imggen-api-key"]
    async def provider(stage, config, frozen, page=None, image=None):
        if raise_echo:
            raise RuntimeError(f"Provider echoed {llm_secret} {image_secret}")
        return knowledge_result("Credential boundary", llm_secret + image_secret)
    monkeypatch.setattr(page_workflows, "perform_page", provider)
    created = await analyze(client, project, headers=IMAGE_KEYS)
    job_id = created.json()["job_id"]
    if raise_echo:
        waiting = await wait_job(client, job_id, lambda row: row["status"] == "waiting_confirmation")
        assert waiting["phase"] == "analyze" and not waiting["confirmation"]["can_accept"]
        await client.post(f"/api/jobs/{job_id}/cancel")
    else:
        done = await wait_job(client, job_id)
        assert done["result"]["summary"] == "[redacted][redacted]"
    async with app.state.pool.acquire() as conn:
        cells = []
        for query in ["SELECT inputs AS payload FROM dbos.workflow_status WHERE workflow_uuid=$1",
                      "SELECT output AS payload FROM dbos.operation_outputs WHERE workflow_uuid=$1",
                      "SELECT error AS payload FROM dbos.operation_outputs WHERE workflow_uuid=$1"]:
            cells.extend(row["payload"] for row in await conn.fetch(query, job_id) if row["payload"])
        cells.extend(str(row) for row in await conn.fetch("SELECT * FROM generation_attempts WHERE job_id=$1", job_id))
    assert cells
    for cell in cells:
        raw = cell.encode() if isinstance(cell, str) else bytes(cell)
        candidates = [raw]
        try:
            candidates.append(base64.b64decode(raw, validate=True))
        except (ValueError, binascii.Error):
            pass
        assert all(secret.encode() not in value for value in candidates for secret in [llm_secret, image_secret])


@pytest.mark.parametrize("attempt_state", [None, "started", "completed"])
async def test_asset_loss_preserves_unknown_intent_guard_but_reuses_known_work(client, project, monkeypatch, tmp_path, attempt_state):
    from main import app
    monkeypatch.setattr(storage, "UPLOAD_DIR", tmp_path)
    provider = AsyncMock()
    monkeypatch.setattr(page_workflows, "perform_page", provider)
    created = await analyze(client, project, headers=NO_KEYS, files={"file": ("source.png", png(), "image/png")})
    assert created.status_code == 202
    job_id = created.json()["job_id"]
    await wait_job(client, job_id, lambda row: row["status"] == "waiting_credentials")
    frozen = await app.state.jobs.store.input(job_id)
    if attempt_state:
        assert (await app.state.jobs.store.begin_attempt(job_id, frozen["subject"], "analyze", 0, True))["state"] == "invoke"
        if attempt_state == "completed":
            await app.state.jobs.store.complete_attempt(job_id, frozen["subject"], "analyze", 0,
                                                       value={"summary": "Known remote result", "hotspots": []})
    storage.url_to_disk_path(frozen["asset_url"]).unlink()
    await client.post(f"/api/jobs/{job_id}/credentials", headers=HEADERS)
    if attempt_state == "started":
        guarded = await wait_job(client, job_id, lambda row: row["phase"] == "recovery")
        assert guarded["status"] == "waiting_confirmation"
        assert guarded["error"]["code"] == "asset_recovery_required"
        assert not guarded["confirmation"]["can_retry"] and not guarded["confirmation"]["can_accept"]
        assert "可能已计费" in guarded["message"] and "本地图片" in guarded["message"]
        assert (await client.delete(f"/api/projects/{project}")).status_code == 409
        for action in ["retry", "accept"]:
            response = await client.post(f"/api/jobs/{job_id}/{action}", json={"confirmation_id": guarded["confirmation"]["id"]})
            assert response.status_code == 409
        await client.post(f"/api/jobs/{job_id}/cancel")
    else:
        done = await wait_job(client, job_id)
        assert done["status"] == "failed" and done["error"]["code"] == "local_asset_unavailable"
        if attempt_state == "completed":
            async with app.state.pool.acquire() as conn:
                assert await conn.fetchval("SELECT 1 FROM dbos.operation_outputs WHERE workflow_uuid=$1 AND function_name LIKE '%page_compose%'", job_id)
    provider.assert_not_awaited()
    empty = (await client.get(f"/api/projects/{project}")).json()
    assert empty["root_node_id"] is None and empty["nodes"] == {}
    assert app.state.jobs.vault.get(job_id, "llm") is None
