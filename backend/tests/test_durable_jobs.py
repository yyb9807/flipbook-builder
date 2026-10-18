"""Job API + real Postgres/DBOS tests; provider execution is controlled in memory.

The separate scripts/verify_durable_jobs.py suite exercises real HTTP providers
and SIGKILL. These focused cases cover transactional public API invariants.
"""
import asyncio
import json
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from fastapi import HTTPException

from agents.base import ImgGenConfig, LLMConfig
from jobs.credentials import CredentialVault
from jobs.models import TERMINAL
from jobs.providers import ProviderFailure, public_failure, redact
from tests.knowledge_fixtures import knowledge_result
from utils import gen_id

HEADERS = {
    "x-llm-base-url": "http://127.0.0.1:19991/v1", "x-llm-model": "test-llm", "x-llm-api-key": "synthetic-llm-secret",
    "x-imggen-base-url": "http://127.0.0.1:19991/v1", "x-imggen-model": "test-image", "x-imggen-api-key": "",
}


@pytest_asyncio.fixture
async def job_graph(client, project):
    from main import app

    node = gen_id("node_")
    hotspots = [gen_id("hs_"), gen_id("hs_")]
    async with app.state.pool.acquire() as conn:
        await conn.execute("INSERT INTO nodes(id,project_id,title,status) VALUES($1,$2,'Water cycle','generated')", node, project)
        for index, hotspot in enumerate(hotspots):
            await conn.execute(
                "INSERT INTO hotspots(id,node_id,label,pos_x,pos_y,width,height,selected,sort_order) VALUES($1,$2,$3,0.1,0.1,0.2,0.2,true,$4)",
                hotspot, node, f"Topic {index}", index,
            )
    try:
        yield node, hotspots
    finally:
        jobs = (await client.get(f"/api/projects/{project}/jobs")).json()["jobs"]
        for job in jobs:
            await client.post(f"/api/jobs/{job['job_id']}/cancel")


async def wait_job(client, job_id, predicate=None):
    for _ in range(200):
        result = (await client.get(f"/api/jobs/{job_id}")).json()
        if (predicate(result) if predicate else result["status"] in TERMINAL):
            return result
        await asyncio.sleep(0.02)
    raise AssertionError(f"job did not reach expected state: {result}")


async def create_job(client, project, node, operation="test-operation", headers=None):
    return await client.post(f"/api/projects/{project}/nodes/{node}/generation-jobs",
                             headers=HEADERS if headers is None else headers,
                             json={"operation_id": operation, "selected_keywords": []})


async def test_job_success_partial_checkpoints_and_events(client, project, job_graph, monkeypatch):
    from jobs import providers
    from main import app

    async def provider(stage, config, frozen, child, page, image_url, project_id):
        assert stage == "plan"
        return knowledge_result(child["label"], "Saved content")

    fake = AsyncMock(side_effect=provider)
    monkeypatch.setattr(providers, "perform", fake)
    response = await create_job(client, project, job_graph[0])
    assert response.status_code == 202, response.text
    job_id = response.json()["job_id"]
    done = await wait_job(client, job_id)
    assert done["status"] == "succeeded", done
    assert len(done["result"]["nodes"]) == 2
    assert fake.await_count == 2
    assert app.state.jobs.vault.get(job_id, "llm") is None
    restored = (await client.get(f"/api/projects/{project}")).json()["nodes"]
    assert all(node["id"] in restored for node in done["result"]["nodes"])
    assert restored[job_graph[0]]["status"] == "completed"
    replay = await create_job(client, project, job_graph[0])
    assert replay.status_code == 202 and replay.json()["job_id"] == job_id
    assert fake.await_count == 2
    conflict = await client.post(f"/api/projects/{project}/nodes/{job_graph[0]}/generation-jobs", headers=HEADERS,
                                 json={"operation_id": "test-operation", "selected_keywords": ["different"]})
    assert conflict.status_code == 409
    stream = await client.get(f"/api/jobs/{job_id}/events")
    events = [json.loads(line[6:]) for line in stream.text.splitlines() if line.startswith("data: ")]
    assert events[-1] == done
    ids = [event["last_event_id"] for event in events]
    assert ids == sorted(set(ids))
    empty = await client.get(f"/api/jobs/{job_id}/events", headers={"Last-Event-ID": str(done["last_event_id"])})
    assert empty.text == ""
    assert (await client.get(f"/api/jobs/{job_id}/events?after=-1")).status_code == 422
    assert (await client.get(f"/api/jobs/{job_id}/events", headers={"Last-Event-ID": "bad"})).status_code == 400
    assert (await client.get(f"/api/projects/{project}/jobs")).json() == {"jobs": []}
    assert (await client.get(f"/api/projects/{project}/jobs?active=false")).json()["jobs"][0]["job_id"] == job_id


async def test_wait_credentials_idempotency_cancel_edit_and_delete(client, project, job_graph):
    from main import app

    no_keys = {**HEADERS, "x-llm-api-key": ""}
    created = await create_job(client, project, job_graph[0], headers=no_keys)
    assert created.status_code == 202, created.text
    job_id = created.json()["job_id"]
    waiting = await wait_job(client, job_id, lambda job: job["status"] == "waiting_credentials")
    assert waiting["required_credentials"] == ["llm"]
    duplicate = await create_job(client, project, job_graph[0], headers=no_keys)
    assert duplicate.status_code == 202 and duplicate.json()["job_id"] == job_id
    conflict = await create_job(client, project, job_graph[0], operation="another-operation", headers=no_keys)
    assert conflict.status_code == 409
    assert (await client.patch(f"/api/projects/{project}/nodes/{job_graph[0]}", json={"title": "blocked"})).status_code == 409
    assert (await client.delete(f"/api/projects/{project}")).status_code == 409
    assert (await client.post(f"/api/jobs/{job_id}/credentials")).status_code == 400
    mismatch = {**HEADERS, "x-llm-base-url": "http://127.0.0.1:19992/v1"}
    assert (await client.post(f"/api/jobs/{job_id}/credentials", headers=mismatch)).status_code == 409
    cancelled = await client.post(f"/api/jobs/{job_id}/cancel")
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    assert app.state.jobs.vault.get(job_id, "llm") is None
    assert (await client.post(f"/api/jobs/{job_id}/cancel")).json()["status"] == "cancelled"
    assert (await client.patch(f"/api/projects/{project}/nodes/{job_graph[0]}", json={"title": "allowed"})).status_code == 200


async def test_unknown_retry_confirmation_is_consumed_once(client, project, job_graph, monkeypatch):
    from jobs import providers

    calls = []

    async def provider(stage, config, frozen, child, page, image_url, project_id):
        calls.append(child["hotspot_id"])
        if len(calls) == 1:
            raise ProviderFailure("unknown", "uncertain", True)
        return knowledge_result(child["label"], "Recovered")

    monkeypatch.setattr(providers, "perform", provider)
    created = await create_job(client, project, job_graph[0])
    job_id = created.json()["job_id"]
    waiting = await wait_job(client, job_id, lambda job: job["status"] == "waiting_confirmation")
    assert calls == [job_graph[1][0]]
    confirmation = waiting["confirmation"]
    assert not confirmation["can_accept"]
    assert (await client.post(f"/api/jobs/{job_id}/accept", json={"confirmation_id": confirmation["id"]})).status_code == 409
    assert (await client.post(f"/api/jobs/{job_id}/retry", json={"confirmation_id": "stale"})).status_code == 409
    responses = await asyncio.gather(*[client.post(f"/api/jobs/{job_id}/retry", json={"confirmation_id": confirmation["id"]}) for _ in range(3)])
    assert all(response.status_code in {200, 409} for response in responses)
    done = await wait_job(client, job_id)
    assert done["status"] == "succeeded"
    assert calls.count(job_graph[1][0]) == 2 and calls.count(job_graph[1][1]) == 1


async def test_accept_unknown_image_keeps_text_and_skips_remote_retry(client, project, job_graph, monkeypatch):
    from jobs import providers

    calls = []

    async def provider(stage, config, frozen, child, page, image_url, project_id):
        calls.append((stage, child["hotspot_id"]))
        if stage == "image":
            raise ProviderFailure("unknown", "uncertain", True)
        return knowledge_result(child["label"], "Text survives")

    monkeypatch.setattr(providers, "perform", provider)
    created = await create_job(client, project, job_graph[0], headers={**HEADERS, "x-imggen-api-key": "synthetic-image-secret"})
    job_id = created.json()["job_id"]
    for _ in range(2):
        waiting = await wait_job(client, job_id, lambda job: job["status"] == "waiting_confirmation")
        assert waiting["confirmation"]["can_accept"]
        accepted = await client.post(f"/api/jobs/{job_id}/accept", json={"confirmation_id": waiting["confirmation"]["id"]})
        assert accepted.status_code == 200
        await asyncio.sleep(0.05)
    done = await wait_job(client, job_id)
    assert done["status"] == "succeeded"
    assert len(done["result"]["nodes"]) == 2
    assert all(node["image_url"] is None for node in done["result"]["nodes"])
    assert [stage for stage, _ in calls] == ["plan", "image", "plan", "image"]


async def test_partial_plan_failure_keeps_other_child(client, project, job_graph, monkeypatch):
    from jobs import providers

    async def provider(stage, config, frozen, child, page, image_url, project_id):
        if child["hotspot_id"] == job_graph[1][0]:
            raise ProviderFailure("provider_http_401", "Check credentials", False)
        return knowledge_result(child["label"], "Good")

    monkeypatch.setattr(providers, "perform", provider)
    created = await create_job(client, project, job_graph[0])
    done = await wait_job(client, created.json()["job_id"])
    assert done["status"] == "partial"
    assert done["result"]["failed_hotspot_ids"] == [job_graph[1][0]]
    assert len(done["result"]["nodes"]) == 1


async def test_atomic_admission_rollback_leaves_no_job_or_stuck_parent(client, project, job_graph, monkeypatch):
    from main import app

    def fail_enqueue(*args, **kwargs):
        raise RuntimeError("test_admission_rollback")

    monkeypatch.setattr(app.state.jobs.client, "enqueue_in_transaction", fail_enqueue)
    with pytest.raises(RuntimeError, match="test_admission_rollback"):
        await create_job(client, project, job_graph[0])
    async with app.state.pool.acquire() as conn:
        assert await conn.fetchval("SELECT COUNT(*) FROM generation_jobs WHERE project_id=$1", project) == 0
        assert await conn.fetchval("SELECT status FROM nodes WHERE id=$1", job_graph[0]) == "generated"


async def test_cancel_wins_late_provider_result_and_commit_replay_is_idempotent(client, project, job_graph, monkeypatch):
    from jobs import providers
    from main import app

    started, release = asyncio.Event(), asyncio.Event()

    async def provider(*args):
        started.set()
        await release.wait()
        return knowledge_result("Late", "Do not publish")

    monkeypatch.setattr(providers, "perform", provider)
    created = await create_job(client, project, job_graph[0])
    job_id = created.json()["job_id"]
    await asyncio.wait_for(started.wait(), timeout=5)
    await client.post(f"/api/jobs/{job_id}/cancel")
    release.set()
    await asyncio.sleep(0.1)
    async with app.state.pool.acquire() as conn:
        assert await conn.fetchval("SELECT COUNT(*) FROM nodes WHERE parent_id=$1", job_graph[0]) == 0
    frozen = await app.state.jobs.store.input(job_id)
    result = await app.state.jobs.store.commit_child(job_id, frozen["children"][0], frozen, {"title": "Late"}, None, [], [], 90)
    assert result == {"cancelled": True}


def test_vault_ttl_binding_capacity_and_redaction(monkeypatch):
    from jobs import credentials

    now = [10.0]
    monkeypatch.setattr(credentials.time, "monotonic", lambda: now[0])
    vault = CredentialVault(ttl_seconds=5, capacity=1)
    llm = LLMConfig("http://localhost/v1", "secret-llm", "model")
    image = ImgGenConfig("http://localhost/v1", "secret-image", "model")
    vault.provide("one", llm, image)
    assert vault.get("one", "llm") is llm
    vault.provide("two", llm, image)
    assert vault.get("one", "llm") is None
    assert redact({"nested": ["secret-llm", {"secret-image": "prefixsecret-image"}]}, vault.secrets("two")) == {
        "nested": ["[redacted]", {"[redacted]": "prefix[redacted]"}],
    }
    now[0] = 16
    assert vault.get("two", "llm") is None
    assert public_failure(HTTPException(401, "secret-llm")).unknown is False
    assert public_failure(TimeoutError("secret-image")).unknown is True


async def test_transient_local_writes_retry_without_new_provider_call(client, project, job_graph, monkeypatch):
    import asyncpg

    from jobs import providers
    from main import app

    fake = AsyncMock(return_value=knowledge_result("Recovered", "Local retry"))
    monkeypatch.setattr(providers, "perform", fake)
    original_complete = app.state.jobs.store.complete_attempt
    original_commit = app.state.jobs.store.commit_child
    failures = {"complete": 0, "commit": 0}

    async def complete(*args, **kwargs):
        if not failures["complete"]:
            failures["complete"] += 1
            raise asyncpg.ConnectionDoesNotExistError("synthetic disconnect")
        return await original_complete(*args, **kwargs)

    async def commit(*args, **kwargs):
        result = await original_commit(*args, **kwargs)
        if not failures["commit"]:
            failures["commit"] += 1
            # Simulate committed business transaction with lost acknowledgement.
            raise asyncpg.ConnectionDoesNotExistError("synthetic lost commit ack")
        return result

    monkeypatch.setattr(app.state.jobs.store, "complete_attempt", complete)
    monkeypatch.setattr(app.state.jobs.store, "commit_child", commit)
    created = await create_job(client, project, job_graph[0])
    done = await wait_job(client, created.json()["job_id"])
    assert done["status"] == "succeeded"
    assert len(done["result"]["nodes"]) == 2
    assert len({node["id"] for node in done["result"]["nodes"]}) == 2
    assert fake.await_count == 2  # No remote retry for either local I/O failure.
    assert failures == {"complete": 1, "commit": 1}


async def test_failed_executor_with_unresolved_intent_stays_locked_until_cancel(client, project, job_graph):
    from main import app

    created = await create_job(client, project, job_graph[0], headers={**HEADERS, "x-llm-api-key": ""})
    job_id = created.json()["job_id"]
    await wait_job(client, job_id, lambda job: job["status"] == "waiting_credentials")
    frozen = await app.state.jobs.store.input(job_id)
    await app.state.jobs.store.begin_attempt(job_id, frozen["children"][0], "plan", 0, True)
    guarded = await app.state.jobs.store.fail(job_id)
    assert guarded["status"] == "waiting_confirmation"
    assert guarded["confirmation"]["can_retry"] is False
    assert guarded["error"]["code"] == "execution_recovery_required"
    assert (await create_job(client, project, job_graph[0], operation="must-not-charge-again")).status_code == 409
    assert (await client.delete(f"/api/projects/{project}")).status_code == 409
    assert (await client.post(f"/api/jobs/{job_id}/retry", json={"confirmation_id": guarded["confirmation"]["id"]})).status_code == 409
    assert (await client.post(f"/api/jobs/{job_id}/cancel")).json()["status"] == "cancelled"


async def test_completed_attempt_guard_reuses_result_without_credentials_or_call(client, project, job_graph, monkeypatch):
    from jobs import providers
    from main import app

    created = await create_job(client, project, job_graph[0], headers={**HEADERS, "x-llm-api-key": ""})
    job_id = created.json()["job_id"]
    await wait_job(client, job_id, lambda job: job["status"] == "waiting_credentials")
    frozen = await app.state.jobs.store.input(job_id)
    child = frozen["children"][0]
    first = await app.state.jobs.store.begin_attempt(job_id, child, "plan", 0, True)
    assert first["state"] == "invoke"
    value = {"title": "Already returned", "description": "Business result saved before DBOS checkpoint"}
    await app.state.jobs.store.complete_attempt(job_id, child, "plan", 0, value=value)
    replay = await app.state.jobs.store.begin_attempt(job_id, child, "plan", 0, False)
    assert replay == {"state": "completed", "value": value}
    assert replay["state"] != "unknown"
    monkeypatch.setattr(providers, "perform", AsyncMock())


async def test_project_scoped_operation_race_on_different_nodes_is_409(client, project, job_graph):
    from main import app

    other_node, other_hotspot = gen_id("node_"), gen_id("hs_")
    async with app.state.pool.acquire() as conn:
        await conn.execute("INSERT INTO nodes(id,project_id,title) VALUES($1,$2,'Other page')", other_node, project)
        await conn.execute(
            "INSERT INTO hotspots(id,node_id,label,pos_x,pos_y,width,height,selected) VALUES($1,$2,'Other topic',0.1,0.1,0.2,0.2,true)",
            other_hotspot, other_node,
        )
    no_keys = {**HEADERS, "x-llm-api-key": ""}
    responses = await asyncio.gather(*[create_job(client, project, node, operation="same-project-operation", headers=no_keys)
                                       for node in [job_graph[0], other_node]])
    assert sorted(response.status_code for response in responses) == [202, 409]
    async with app.state.pool.acquire() as conn:
        assert await conn.fetchval("SELECT COUNT(*) FROM generation_jobs WHERE project_id=$1", project) == 1
    exact = await client.get(f"/api/projects/{project}/jobs?active=false&operation_id=same-project-operation")
    assert len(exact.json()["jobs"]) == 1
    absent = await client.get(f"/api/projects/{project}/jobs?active=false&operation_id=not-present")
    assert absent.json() == {"jobs": []}


async def test_echoed_success_and_unexpected_exception_never_checkpoint_keys(client, project, job_graph, monkeypatch, capsys):
    import base64
    import binascii

    from jobs import providers
    from main import app

    llm_secret, image_secret = "synthetic-llm-secret", "synthetic-image-secret"

    async def echo_provider(stage, config, frozen, child, page, image_url, project_id):
        if stage == "image":
            raise RuntimeError(f"provider echoed Authorization {llm_secret} {image_secret}")
        return knowledge_result(llm_secret, image_secret, image_prompt="Safe illustration")

    monkeypatch.setattr(providers, "perform", echo_provider)
    created = await create_job(client, project, job_graph[0], headers={**HEADERS, "x-imggen-api-key": image_secret})
    job_id = created.json()["job_id"]
    for _ in range(2):
        waiting = await wait_job(client, job_id, lambda job: job["status"] == "waiting_confirmation")
        assert waiting["phase"] == "image"
        await client.post(f"/api/jobs/{job_id}/accept", json={"confirmation_id": waiting["confirmation"]["id"]})
        await asyncio.sleep(0.05)
    done = await wait_job(client, job_id)
    assert done["status"] == "succeeded"
    assert all(node["title"] == "[redacted]" and node["description"] == "[redacted]" for node in done["result"]["nodes"])
    async with app.state.pool.acquire() as conn:
        cells = []
        for query in [
            "SELECT inputs AS payload FROM dbos.workflow_status WHERE workflow_uuid=$1",
            "SELECT output AS payload FROM dbos.operation_outputs WHERE workflow_uuid=$1",
            "SELECT error AS payload FROM dbos.operation_outputs WHERE workflow_uuid=$1",
        ]:
            cells.extend(row["payload"] for row in await conn.fetch(query, job_id) if row["payload"])
        cells.extend(str(row) for row in await conn.fetch("SELECT * FROM generation_attempts WHERE job_id=$1", job_id))
    assert cells
    for cell in cells:
        data = cell.encode() if isinstance(cell, str) else bytes(cell)
        candidates = [data]
        try:
            candidates.append(base64.b64decode(data, validate=True))
        except (ValueError, binascii.Error):
            pass
        assert all(secret.encode() not in candidate for candidate in candidates for secret in [llm_secret, image_secret])
    assert all(secret not in capsys.readouterr().err for secret in [llm_secret, image_secret])


async def test_legacy_stable_operation_replays_active_and_terminal_before_prechecks(client, project, job_graph):
    no_keys = {**HEADERS, "x-llm-api-key": ""}
    created = await create_job(client, project, job_graph[0], operation="legacy-replay", headers=no_keys)
    job_id = created.json()["job_id"]
    await wait_job(client, job_id, lambda job: job["status"] == "waiting_credentials")
    replay = asyncio.create_task(client.post(
        f"/api/projects/{project}/nodes/{job_graph[0]}/generate-children",
        headers={**no_keys, "x-operation-id": "legacy-replay"}, json={"selected_keywords": []},
    ))
    await asyncio.sleep(0.1)
    assert not replay.done()  # An active replay subscribes; it must not immediately return409.
    await client.post(f"/api/jobs/{job_id}/cancel")
    response = await asyncio.wait_for(replay, timeout=2)
    assert response.status_code == 200 and job_id in response.text and '"done": true' in response.text
    await client.patch(f"/api/projects/{project}/nodes/{job_graph[0]}/hotspots", json={"hotspots": [
        {"id": hotspot, "selected": False} for hotspot in job_graph[1]
    ]})
    restored = await client.post(
        f"/api/projects/{project}/nodes/{job_graph[0]}/generate-children",
        headers={**no_keys, "x-operation-id": "legacy-replay"}, json={"selected_keywords": []},
    )
    assert restored.status_code == 200 and job_id in restored.text
