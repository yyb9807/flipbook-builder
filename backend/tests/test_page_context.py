"""Source preservation and frozen revision compatibility, without model calls."""
import json
from unittest.mock import AsyncMock

import pytest

from agents.base import LLMConfig
from agents.page_context import (
    FOCUSED_GENERATION_REVISION,
    GENERATION_REVISION,
    build_page_context,
    configured_generation_revision,
)
from jobs import page_workflows, providers
from jobs.providers import ProviderFailure
from tests.knowledge_fixtures import knowledge_result
from tests.test_durable_jobs import HEADERS, wait_job
from tests.test_durable_pages import IMAGE_KEYS, NO_KEYS, analyze, regenerate
from utils import gen_id


def context(**overrides):
    values = dict(source_text="Original user material.", source_kind="original_text_unavailable",
                  root_title="Root", root_description="Generated overview.", ancestor_titles=["Root", "Parent"],
                  parent_title="Parent", parent_description="Parent overview.", selected_label="Mechanism",
                  selected_body="An explanation already shown.", covered_topics=["Other topic"])
    return build_page_context(**{**values, **overrides})


def test_context_is_bounded_and_preserves_both_ends_of_long_source():
    original = "Initial condition." + "X" * 20000 + "Final limitation."
    encoded = context(source_text=original, selected_body="B" * 20000, ancestor_titles=["A" * 500] * 100,
                      covered_topics=["T" * 500] * 100)
    value = json.loads(encoded)
    assert value["source"]["text"].startswith("Initial condition.")
    assert value["source"]["text"].endswith("Final limitation.")
    assert value["source"]["truncated"] is True
    assert len(value["source"]["text"]) == 8000
    assert len(value["selected_section"]["body"]) == 5000
    assert len(value["ancestor_titles"]) == 12 and len(value["other_covered_topics"]) == 6
    assert len(encoded.encode()) < 100000


def test_image_overview_is_not_promoted_to_original_user_material():
    value = json.loads(context(source_text=None, source_kind="image_without_original_text"))
    assert value["source"] == {"kind": "image_without_original_text", "text": "", "truncated": False}
    assert value["root_page"]["overview"] == "Generated overview."
    assert value["root_page"]["is_original_source"] is False


@pytest.mark.parametrize("generation_revision", [GENERATION_REVISION, FOCUSED_GENERATION_REVISION])
async def test_partial_root_keeps_original_source_and_children_use_admission_snapshot(client, project, monkeypatch, generation_revision):
    from main import app

    monkeypatch.setenv("KNOWLEDGE_GENERATION_REVISION", generation_revision)
    original = "This fictional museum has no supplied opening hours or booking policy."

    async def root(stage, *args):
        if stage == "image":
            raise ProviderFailure("provider_http_400", "Synthetic illustration failure", False)
        return knowledge_result()

    monkeypatch.setattr(page_workflows, "perform_page", root)
    response = await analyze(client, project, headers=IMAGE_KEYS, data={"text": original, "generate_images": "true"})
    root_job = await wait_job(client, response.json()["job_id"])
    assert root_job["status"] == "partial", root_job
    root_input = await app.state.jobs.store.input(response.json()["job_id"])
    assert root_input["generation_revision"] == generation_revision
    node_id = root_job["node_id"]
    node = (await client.get(f"/api/projects/{project}")).json()["nodes"][node_id]
    hotspot = node["hotspots"][0]
    selected = await client.patch(f"/api/projects/{project}/nodes/{node_id}/hotspots",
        json={"hotspots": [{"id": hotspot["id"], "selected": True}]})
    assert selected.status_code == 200
    created = await client.post(f"/api/projects/{project}/nodes/{node_id}/generation-jobs", headers=NO_KEYS,
                               json={"operation_id": "freeze-source", "generate_images": False})
    job_id = created.json()["job_id"]
    await wait_job(client, job_id, lambda row: row["status"] == "waiting_credentials")
    frozen = await app.state.jobs.store.input(job_id)
    saved = frozen["children"][0]["context"]
    value = json.loads(saved)
    assert frozen["generation_revision"] == generation_revision
    assert value["context_version"] == generation_revision
    assert value["source"]["text"] == original and value["source"]["kind"] == "user_text"
    assert value["selected_section"]["body"] == node["scene_document"]["sections"][0]["body"]
    # An external change cannot replace admission-time inputs when credentials arrive.
    monkeypatch.setenv("KNOWLEDGE_GENERATION_REVISION", "unrecognized-after-admission")
    async with app.state.pool.acquire() as conn:
        await conn.execute("UPDATE nodes SET title='Changed later',description='Changed later' WHERE id=$1", node_id)

    seen = []
    async def child(stage, config, frozen, subject, *args):
        assert stage == "plan"
        seen.append(subject["context"])
        return knowledge_result("Child", "A new explanation of the selected mechanism.")

    monkeypatch.setattr(providers, "perform", child)
    await client.post(f"/api/jobs/{job_id}/credentials", headers=HEADERS)
    done = await wait_job(client, job_id)
    assert done["status"] == "succeeded", done
    assert seen == [saved]
    assert (await app.state.jobs.store.input(job_id))["children"][0]["context"] == saved


async def test_markerless_provider_uses_legacy_selected_body_without_revision(monkeypatch):
    from agents.page_generation import PageGenerationAgent

    call = AsyncMock(return_value=knowledge_result())
    monkeypatch.setattr(PageGenerationAgent, "generate", call)
    frozen = {"settings": {}, "title": "Parent", "description": "Overview", "selected_keywords": [],
              "content_format": "knowledge-v1"}
    config = LLMConfig("https://synthetic.invalid/v1", "synthetic-context-key", "synthetic-model")
    await providers.perform("plan", config, frozen, {"label": "Topic", "context": "Legacy body"}, None, None, "synthetic")
    assert call.call_args.kwargs["parent_description"] == "Legacy body"
    assert "generation_revision" not in call.call_args.kwargs
    for revision in (GENERATION_REVISION, FOCUSED_GENERATION_REVISION):
        call.reset_mock()
        frozen["generation_revision"] = revision
        saved_context = context(generation_revision=revision)
        await providers.perform("plan", config, frozen, {"label": "Topic", "context": saved_context}, None, None, "synthetic")
        assert call.call_args.kwargs["generation_revision"] == revision
        assert call.call_args.kwargs["parent_description"] == saved_context


async def test_markerless_root_and_regeneration_keep_original_arguments(monkeypatch):
    from agents.input_analysis import InputAnalysisAgent
    from agents.page_generation import PageGenerationAgent

    analysis, generation = AsyncMock(return_value=knowledge_result()), AsyncMock(return_value=knowledge_result())
    monkeypatch.setattr(InputAnalysisAgent, "analyze_text", analysis)
    monkeypatch.setattr(PageGenerationAgent, "generate", generation)
    frozen = {"settings": {}, "source_type": "text", "text": "Original input", "content_format": "knowledge-v1",
              "title": "Legacy page", "description": "Legacy page description", "subject": {"label": "Topic"}}
    await page_workflows.perform_page("analyze", object(), frozen)
    assert "generation_revision" not in analysis.call_args.kwargs
    await page_workflows.perform_page("plan", object(), frozen)
    assert generation.call_args.kwargs["parent_description"] == "Legacy page description"
    assert "generation_revision" not in generation.call_args.kwargs
    for revision in (GENERATION_REVISION, FOCUSED_GENERATION_REVISION):
        frozen.update(generation_revision=revision, generation_context=context(generation_revision=revision))
        await page_workflows.perform_page("plan", object(), frozen)
        assert generation.call_args.kwargs["parent_description"] == frozen["generation_context"]
        assert generation.call_args.kwargs["generation_revision"] == revision
        await page_workflows.perform_page("analyze", object(), frozen)
        assert analysis.call_args.kwargs["generation_revision"] == revision


@pytest.mark.parametrize("revision", [GENERATION_REVISION, FOCUSED_GENERATION_REVISION])
async def test_image_analysis_uses_frozen_revision_without_current_host_setting(monkeypatch, revision):
    from agents.input_analysis import InputAnalysisAgent

    call = AsyncMock(return_value={"summary": "Visible image", "hotspots": []})
    monkeypatch.setattr(InputAnalysisAgent, "analyze_image", call)
    monkeypatch.setattr(page_workflows, "asset_bytes", lambda *_args: b"synthetic-image")
    monkeypatch.setenv("KNOWLEDGE_GENERATION_REVISION", "unrecognized-after-admission")
    await page_workflows.perform_page("analyze", object(), {
        "settings": {"language": "en"}, "source_type": "image", "content_format": "image-v1",
        "generation_revision": revision, "asset_url": "/synthetic.png", "asset_sha256": "unused",
    })
    call.assert_awaited_once()
    assert call.call_args.kwargs["generation_revision"] == revision
    assert call.call_args.args[1] == "en"


@pytest.mark.parametrize("revision", [GENERATION_REVISION, FOCUSED_GENERATION_REVISION])
async def test_regeneration_freezes_context_and_revision_before_credentials(client, project, monkeypatch, revision):
    from agents.page_generation import PageGenerationAgent
    from main import app

    node_id = gen_id("node_")
    async with app.state.pool.acquire() as conn:
        await conn.execute("INSERT INTO nodes(id,project_id,title,description,status) VALUES($1,$2,'Saved title','Saved source boundary','draft')",
                           node_id, project)
        await conn.execute("UPDATE projects SET root_node_id=$1 WHERE id=$2", node_id, project)
    monkeypatch.setenv("KNOWLEDGE_GENERATION_REVISION", revision)
    created = await regenerate(client, project, node_id, headers=NO_KEYS)
    assert created.status_code == 202, created.text
    job_id = created.json()["job_id"]
    await wait_job(client, job_id, lambda row: row["status"] == "waiting_credentials")
    frozen = await app.state.jobs.store.input(job_id)
    context_value = json.loads(frozen["generation_context"])
    assert frozen["generation_revision"] == context_value["context_version"] == revision
    assert context_value["selected_section"]["body"] == "Saved source boundary"
    generation = AsyncMock(return_value=knowledge_result())
    monkeypatch.setattr(PageGenerationAgent, "generate", generation)
    monkeypatch.setenv("KNOWLEDGE_GENERATION_REVISION", "unrecognized-after-admission")
    resumed = await client.post(f"/api/jobs/{job_id}/credentials", headers=HEADERS)
    assert resumed.status_code == 200
    assert (await wait_job(client, job_id))["status"] == "succeeded"
    generation.assert_awaited_once()
    assert generation.call_args.kwargs["generation_revision"] == revision
    assert generation.call_args.kwargs["parent_description"] == frozen["generation_context"]
    assert (await app.state.jobs.store.input(job_id))["generation_context"] == frozen["generation_context"]


@pytest.mark.parametrize("value", [None, "", "  ", GENERATION_REVISION, FOCUSED_GENERATION_REVISION, "unrecognized"])
def test_experimental_generation_requires_explicit_supported_configuration(monkeypatch, value):
    if value is None:
        monkeypatch.delenv("KNOWLEDGE_GENERATION_REVISION", raising=False)
    else:
        monkeypatch.setenv("KNOWLEDGE_GENERATION_REVISION", value)
    if value == "unrecognized":
        with pytest.raises(ValueError, match="KNOWLEDGE_GENERATION_REVISION"):
            configured_generation_revision()
    else:
        assert configured_generation_revision() == (value if value in {GENERATION_REVISION, FOCUSED_GENERATION_REVISION} else None)


async def test_invalid_experiment_configuration_rejects_new_admission_before_provider(client, project, monkeypatch):
    invoke = AsyncMock()
    monkeypatch.setattr(page_workflows, "perform_page", invoke)
    monkeypatch.setenv("KNOWLEDGE_GENERATION_REVISION", "unrecognized")
    response = await analyze(client, project)
    assert response.status_code == 503 and "KNOWLEDGE_GENERATION_REVISION" in response.json()["detail"]
    invoke.assert_not_awaited()
    assert (await client.get(f"/api/projects/{project}/jobs")).json()["jobs"] == []
