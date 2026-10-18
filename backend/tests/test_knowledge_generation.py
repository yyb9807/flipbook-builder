"""Knowledge generation contract and replay boundaries, using only controlled data."""
import json
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from agents.base import LLMConfig
from agents.input_analysis import InputAnalysisAgent
from agents.knowledge import KnowledgeFormatError, generation_metadata, normalize_knowledge
from agents.page_generation import PageGenerationAgent
from jobs import page_workflows, providers
from jobs.store import fingerprint, validate_content_model
from tests.knowledge_fixtures import knowledge_result
from tests.test_durable_jobs import HEADERS, wait_job
from tests.test_durable_pages import NO_KEYS, analyze


def test_knowledge_ignores_model_identity_sources_and_verification():
    raw = knowledge_result(
        content_metadata={"review_status": "reviewed", "provenance": {"model": "forged"}},
        references=[{"title": "Fake authority", "url": "https://forged.invalid"}],
    )
    raw["sections"][0].update(id="forged", hotspot_id="foreign", target_node_id="other-project", sources=["forged"])
    normalized = normalize_knowledge(raw)
    assert normalized["sections"][0] == {
        "id": "section_1", "title": "Evaporation",
        "body": "Energy from sunlight lets liquid water become vapor and enter the atmosphere.",
    }
    assert "content_metadata" not in normalized and "references" not in normalized
    assert generation_metadata({"content_format": "knowledge-v1", "kind": "analyze"}, {"llm_model": "actual-model"}) == {
        "version": 1, "provenance": {"kind": "ai", "input_kind": "text", "model": "actual-model"},
        "references": [], "review_status": "unreviewed",
    }
    assert generation_metadata({}, {"llm_model": "actual-model"}) is None


def test_regeneration_keeps_author_references_but_resets_review_and_real_input_kind():
    reference = {"id": "book", "title": "An author-supplied reference", "url": "https://example.org/book"}
    metadata = generation_metadata({"content_format": "knowledge-v1", "kind": "regenerate",
                                    "old_content_metadata": {"version": 1, "references": [reference], "review_status": "reviewed"}},
                                   {"llm_model": "actual-model"})
    assert metadata["provenance"]["input_kind"] == "page"
    assert metadata["references"] == [reference] and metadata["review_status"] == "unreviewed"


@pytest.mark.parametrize("patch", [
    {"title": " "}, {"description": None}, {"layout": []}, {"layout": "canvas"},
    {"sections": []}, {"sections": [None]}, {"sections": [{"title": "A", "body": "Just a label"}]},
    {"sections": [{"title": "A", "body": "X" * 5001}]},
    {"sections": [{"title": "A", "body": "Long enough explanatory body."}] * 7},
])
def test_knowledge_rejects_invalid_content_without_default_prose(patch):
    with pytest.raises(KnowledgeFormatError) as caught:
        normalize_knowledge(knowledge_result(**patch))
    failure = providers.public_failure(caught.value)
    assert failure.code == "invalid_knowledge_page" and not failure.unknown


@pytest.mark.parametrize("agent_kind", ["root", "child"])
async def test_same_single_model_call_produces_knowledge_and_optional_illustration(monkeypatch, agent_kind):
    agent = InputAnalysisAgent(LLMConfig("https://provider.invalid/v1", "fake-key", "fake-model")) if agent_kind == "root" else PageGenerationAgent(LLMConfig("https://provider.invalid/v1", "fake-key", "fake-model"))
    call = AsyncMock(return_value=json.dumps(knowledge_result()))
    monkeypatch.setattr(agent, "call", call)
    if agent_kind == "root":
        result = await agent.analyze_text("Water cycle", content_format="knowledge-v1")
    else:
        result = await agent.generate("Evaporation", "Water cycle", "Water changes state", content_format="knowledge-v1")
    assert result["sections"][0]["body"].startswith("Energy") and result["image_prompt"]
    call.assert_awaited_once()
    assert "可独立阅读" in call.call_args.kwargs["system"]


def test_explicit_child_illustration_intent_is_part_of_identity_but_omission_stays_compatible():
    base = fingerprint("node", [], {"llm_model": "model"})
    assert fingerprint("node", [], {"llm_model": "model"}, None) == base
    assert len({base, fingerprint("node", [], {"llm_model": "model"}, True),
                fingerprint("node", [], {"llm_model": "model"}, False)}) == 3


@pytest.mark.parametrize("model", ["", " ", "X" * 201, None])
def test_invalid_source_model_name_is_rejected_at_admission(model):
    with pytest.raises(HTTPException) as caught:
        validate_content_model({"llm_model": model})
    assert caught.value.status_code == 400


async def test_malformed_response_is_one_known_failed_attempt_without_unknown_gate(client, project, monkeypatch):
    from main import app
    invoke = AsyncMock(return_value={"summary": "Only a summary, not usable knowledge"})
    monkeypatch.setattr(page_workflows, "perform_page", invoke)
    created = await analyze(client, project)
    job_id = created.json()["job_id"]
    done = await wait_job(client, job_id)
    assert done["status"] == "failed" and done["error"]["code"] == "invalid_knowledge_page"
    assert done["confirmation"] is None and invoke.await_count == 1
    assert (await client.get(f"/api/projects/{project}")).json()["root_node_id"] is None
    async with app.state.pool.acquire() as conn:
        attempt = await conn.fetchrow("SELECT state,error FROM generation_attempts WHERE job_id=$1", job_id)
    assert attempt["state"] == "failed"


async def test_new_text_root_and_multiple_depths_have_atomic_section_connections(client, project, monkeypatch):
    calls = []
    async def root(stage, *args):
        calls.append(stage)
        return knowledge_result()
    async def child(stage, config, frozen, subject, *args):
        calls.append(stage)
        assert frozen["content_format"] == "knowledge-v1"
        assert subject["context"].startswith("Energy")
        return knowledge_result(subject["label"], "A more detailed explanation.", references=[{"url": "https://forged.invalid"}])
    monkeypatch.setattr(page_workflows, "perform_page", root)
    monkeypatch.setattr(providers, "perform", child)
    created = await analyze(client, project)
    done = await wait_job(client, created.json()["job_id"])
    node_id = done["node_id"]
    for depth in (1, 2):
        current = (await client.get(f"/api/projects/{project}")).json()["nodes"][node_id]
        section = current["scene_document"]["sections"][0]
        hotspot = current["hotspots"][0]
        assert hotspot["kind"] == "section" and hotspot["position"] is None and hotspot["size"] is None and hotspot["score"] is None
        assert section["hotspot_id"] == hotspot["id"]
        selected = await client.patch(f"/api/projects/{project}/nodes/{node_id}/hotspots", json={"hotspots": [{"id": hotspot["id"], "selected": True}]})
        assert selected.status_code == 200, selected.text
        response = await client.post(f"/api/projects/{project}/nodes/{node_id}/generation-jobs", headers=HEADERS,
                                     json={"operation_id": f"knowledge-depth-{depth}", "generate_images": False})
        assert response.status_code == 202, response.text
        branch = await wait_job(client, response.json()["job_id"])
        assert branch["status"] == "succeeded", branch
        next_node = branch["result"]["nodes"][0]
        assert next_node["depth"] == depth and next_node["source_type"] == "text"
        assert next_node["content_metadata"]["provenance"]["input_kind"] == "parent_page"
        assert next_node["content_metadata"]["references"] == []
        restored = (await client.get(f"/api/projects/{project}")).json()["nodes"]
        assert restored[node_id]["scene_document"]["sections"][0]["target_node_id"] == next_node["id"]
        assert restored[node_id]["hotspots"][0]["target_node_id"] == next_node["id"]
        assert restored[next_node["id"]]["parent_id"] == node_id
        node_id = next_node["id"]
    assert calls == ["analyze", "plan", "plan"]


async def test_markerless_pending_root_replays_the_old_contract(client, project, monkeypatch):
    from main import app
    invoke = AsyncMock(return_value={"summary": "Legacy summary", "main_objects": []})
    monkeypatch.setattr(page_workflows, "perform_page", invoke)
    original_emit = app.state.jobs.store.sync_emit
    def admit_old_job(conn, job_id):
        conn.execute(text("UPDATE generation_jobs SET input=input-'content_format' WHERE id=:jid"), {"jid": job_id})
        return original_emit(conn, job_id)
    monkeypatch.setattr(app.state.jobs.store, "sync_emit", admit_old_job)
    created = await analyze(client, project, headers=NO_KEYS)
    job_id = created.json()["job_id"]
    await wait_job(client, job_id, lambda row: row["status"] == "waiting_credentials")
    await client.post(f"/api/jobs/{job_id}/credentials", headers=HEADERS)
    done = await wait_job(client, job_id)
    assert done["status"] == "succeeded" and done["result"]["title"] == "Legacy summary"
    assert done["result"]["scene_document"] is None and done["result"].get("content_metadata") is None
    invoke.assert_awaited_once()


async def test_completed_knowledge_checkpoint_is_reused_without_another_call(client, project, monkeypatch):
    from main import app
    invoke = AsyncMock()
    monkeypatch.setattr(page_workflows, "perform_page", invoke)
    created = await analyze(client, project, headers=NO_KEYS)
    job_id = created.json()["job_id"]
    await wait_job(client, job_id, lambda row: row["status"] == "waiting_credentials")
    frozen = await app.state.jobs.store.input(job_id)
    subject = frozen["subject"]
    assert (await app.state.jobs.store.begin_attempt(job_id, subject, "analyze", 0, True))["state"] == "invoke"
    await app.state.jobs.store.complete_attempt(job_id, subject, "analyze", 0, value=normalize_knowledge(knowledge_result()))
    await client.post(f"/api/jobs/{job_id}/credentials", headers=HEADERS)
    done = await wait_job(client, job_id)
    assert done["status"] == "succeeded" and done["result"]["scene_document"]["sections"][0]["hotspot_id"]
    invoke.assert_not_awaited()


async def test_markerless_children_keep_image_contract(client, project, monkeypatch):
    from main import app
    from utils import gen_id
    node_id, hotspot_id = gen_id("node_"), gen_id("hs_")
    async with app.state.pool.acquire() as conn:
        await conn.execute("INSERT INTO nodes(id,project_id,title,status) VALUES($1,$2,'Old root','generated')", node_id, project)
        await conn.execute("UPDATE projects SET root_node_id=$1 WHERE id=$2", node_id, project)
        await conn.execute("INSERT INTO hotspots(id,node_id,label,pos_x,pos_y,width,height,selected) VALUES($1,$2,'Old topic',0,0,0.2,0.2,true)", hotspot_id, node_id)
    invoke = AsyncMock(return_value={"title": "Old child", "description": "Only the legacy summary"})
    monkeypatch.setattr(providers, "perform", invoke)
    original_emit = app.state.jobs.store.sync_emit
    def admit_old_job(conn, job_id):
        conn.execute(text("UPDATE generation_jobs SET input=input-'content_format' WHERE id=:jid"), {"jid": job_id})
        return original_emit(conn, job_id)
    monkeypatch.setattr(app.state.jobs.store, "sync_emit", admit_old_job)
    response = await client.post(f"/api/projects/{project}/nodes/{node_id}/generation-jobs", headers=HEADERS,
                                 json={"operation_id": "markerless-children", "generate_images": False})
    assert response.status_code == 202, response.text
    done = await wait_job(client, response.json()["job_id"])
    child = done["result"]["nodes"][0]
    assert done["status"] == "succeeded" and child["source_type"] == "image"
    assert child["scene_document"] is None and child.get("content_metadata") is None
    invoke.assert_awaited_once()
