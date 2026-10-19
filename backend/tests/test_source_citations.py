"""Source-copy contracts, atomic section citations and safe version/publication behavior."""
import copy
import io
import json
import zipfile

import pytest
import pytest_asyncio
from fastapi import HTTPException
from pydantic import ValidationError

from content_metadata import ContentReference, public_content_metadata, validate_section_references
from publications import snapshot_project
from routers.nodes import SceneDocument
from utils import gen_id
from version_history import content_snapshot, merge_restore


def reference(identity="source_water", **changes):
    return {"id": identity, "title": "Water cycle source", "url": "https://en.wikipedia.org/w/index.php?oldid=123",
            "excerpt": "Water changes phase and moves between reservoirs.", "locator": "Overview",
            "source_provider": "wikipedia", "source_language": "en", "source_revision": "123",
            "retrieved_at": "2026-10-19T03:04:05Z", "license_title": "CC BY-SA 4.0",
            "license_url": "https://creativecommons.org/licenses/by-sa/4.0/", **changes}


def metadata(*references, review_status="unreviewed"):
    return {"version": 1, "references": list(references), "review_status": review_status}


def scene(*sections):
    return {"version": 1, "layout": "atlas", "sections": list(sections)}


def section(identity="cycle", **changes):
    return {"id": identity, "title": "Water cycle", "body": "A complete explanation of reservoirs and phase changes.", **changes}


def canonical_reference(**changes):
    return ContentReference.model_validate(reference(**changes)).model_dump(exclude_none=True)


def test_legacy_reference_keeps_its_exact_public_shape_and_never_keeps_a_spurious_hash():
    original = {"id": "book", "title": "Author reading", "note": "A printed book"}
    assert ContentReference.model_validate(original).model_dump(exclude_none=True) == original
    assert ContentReference.model_validate({**original, "snapshot_sha256": "a" * 64}).model_dump(exclude_none=True) == original
    assert public_content_metadata(metadata(original)) == metadata(original)


def test_source_digest_is_canonical_and_recomputed_for_stale_client_values():
    saved = canonical_reference()
    assert len(saved["snapshot_sha256"]) == 64
    reordered = dict(reversed(list(reference().items())))
    assert ContentReference.model_validate(reordered).snapshot_sha256 == saved["snapshot_sha256"]
    assert canonical_reference(id="a_new_stable_identity")["snapshot_sha256"] == saved["snapshot_sha256"]
    edited = canonical_reference(excerpt="A corrected author-saved excerpt.", snapshot_sha256=saved["snapshot_sha256"])
    assert edited["snapshot_sha256"] != saved["snapshot_sha256"]
    assert ContentReference.model_validate(edited).model_dump(exclude_none=True) == edited
    assert canonical_reference(excerpt="")["snapshot_sha256"] != saved["snapshot_sha256"]


@pytest.mark.parametrize("changes", [
    {"title": "A changed source title"}, {"url": "https://example.org/new"}, {"note": "Author qualification"},
    {"locator": "A different section"}, {"source_revision": "124"}, {"retrieved_at": "2026-10-19T03:04:06Z"},
    {"source_language": "zh"}, {"license_title": "A different license title"},
    {"license_url": "https://example.org/license"},
])
def test_every_public_copy_change_replaces_its_version_digest(changes):
    assert canonical_reference(**changes)["snapshot_sha256"] != canonical_reference()["snapshot_sha256"]


@pytest.mark.parametrize("changes", [
    {"excerpt": "x" * 3001}, {"locator": "x" * 201}, {"source_revision": "x" * 101},
    {"source_revision": 123}, {"retrieved_at": "2026-10-19"}, {"retrieved_at": "2026-10-19T01:02:03"},
    {"retrieved_at": "not-a-time"}, {"retrieved_at": "2026-10-19T01:02:03+99:00"},
    {"source_provider": "untrusted-provider"}, {"source_language": "fr"},
    {"license_title": "x" * 201}, {"license_url": "javascript:alert(1)"},
    {"license_url": "https://user:password@example.org/"}, {"snapshot_sha256": "stale"},
    {"api_key": "never-public"},
])
def test_source_copy_fields_are_strict_and_bounded(changes):
    with pytest.raises(ValidationError):
        ContentReference.model_validate(reference(**changes))


def test_public_copy_preserves_allowed_fields_and_drops_opaque_retrieval_data():
    saved = public_content_metadata(metadata({**reference(), "raw_html": "<script>bad</script>",
                                               "api_key": "PRIVATE", "request": {"headers": "PRIVATE"}}))
    assert saved["references"] == [canonical_reference()]
    assert "PRIVATE" not in json.dumps(saved) and "raw_html" not in json.dumps(saved)


def test_old_scene_has_no_new_default_fields_but_explicit_citations_roundtrip():
    original = scene(section())
    assert SceneDocument.model_validate(original).model_dump(exclude_none=True, exclude_unset=True) == original
    cited = scene(section(reference_ids=["source_water"]))
    assert SceneDocument.model_validate(cited).model_dump(exclude_none=True, exclude_unset=True) == cited
    validate_section_references(cited, metadata(reference()))


@pytest.mark.parametrize("identities", [None, "source_water", ["a", "a"], [str(i) for i in range(7)], [""], [True]])
def test_invalid_section_reference_contract_is_rejected(identities):
    with pytest.raises((ValidationError, ValueError)):
        parsed = SceneDocument.model_validate(scene(section(reference_ids=identities)))
        validate_section_references(parsed.model_dump(exclude_none=True, exclude_unset=True), metadata(reference()))


def test_section_cannot_reference_another_page_or_missing_source():
    with pytest.raises(ValueError, match="删除资料前"):
        validate_section_references(scene(section(reference_ids=["foreign_source"])), metadata(reference()))


@pytest.mark.parametrize("document", [[], {"sections": None}, {"sections": [None]}])
def test_invalid_imported_scene_shape_has_a_recoverable_validation_error(document):
    with pytest.raises(ValueError):
        validate_section_references(document, metadata(reference()))


@pytest.mark.parametrize("kind", ["analyze", "children"])
@pytest.mark.parametrize("content_format", ["knowledge-v1", "image-v1"])
def test_new_generated_pages_never_inherit_or_claim_a_parent_source(kind, content_format):
    from agents.knowledge import generation_metadata

    generated = generation_metadata({"kind": kind, "content_format": content_format,
                                     "old_content_metadata": metadata(reference())}, {"llm_model": "controlled-only"})
    assert generated["references"] == [] and generated["review_status"] == "unreviewed"


def hotspot(identity, target=None):
    return {"id": identity, "kind": "section", "label": identity, "position": None, "size": None,
            "selected": False, "target_node_id": target, "score": None}


def historical_pair(*, historical_references=(), current_references=()):
    historical = {"title": "Historical title", "content_metadata": metadata(*historical_references),
                  "scene_document": scene(section(hotspot_id="hs_old")), "hotspots": [hotspot("hs_old")]}
    current = {"title": "Current title", "content_metadata": metadata(*current_references),
               "scene_document": scene(section(hotspot_id="hs_old"), section("new", hotspot_id="hs_new",
                                          reference_ids=["source_water"], target_node_id="child")),
               "hotspots": [hotspot("hs_old"), hotspot("hs_new", "child")]}
    return historical, current


def test_history_snapshot_preserves_source_copies_and_section_associations():
    node = {"project_id": "proj_sources", "title": "Water", "description": "Explanation", "source_type": "text",
            "image_url": None, "scene_document": scene(section(reference_ids=["source_water"])),
            "content_metadata": metadata(reference())}
    snapshot = content_snapshot(node, [])
    assert snapshot["scene_document"] == node["scene_document"]
    assert snapshot["content_metadata"]["references"] == [canonical_reference()]


def test_restore_retains_new_connected_section_and_its_current_source_without_mutating_inputs():
    historical, current = historical_pair(current_references=(canonical_reference(),))
    inputs = copy.deepcopy((historical, current))
    restored, count = merge_restore(historical, current)
    assert count == 1 and restored["scene_document"]["sections"][1]["reference_ids"] == ["source_water"]
    assert restored["content_metadata"] == metadata(canonical_reference())
    assert (historical, current) == inputs


def test_restore_can_add_sources_to_an_old_page_without_metadata():
    historical, current = historical_pair(current_references=(canonical_reference(),))
    historical["content_metadata"] = None
    restored, _ = merge_restore(historical, current)
    assert restored["content_metadata"] == metadata(canonical_reference())


def test_restore_rejects_conflicting_source_versions_instead_of_retargeting_a_retained_citation():
    historical, current = historical_pair(historical_references=(canonical_reference(excerpt="Historical source copy"),),
                                          current_references=(canonical_reference(excerpt="Current source copy"),))
    inputs = copy.deepcopy((historical, current))
    with pytest.raises(HTTPException, match="来源版本冲突") as error:
        merge_restore(historical, current)
    assert error.value.status_code == 409 and (historical, current) == inputs


def test_restore_ignores_a_derived_hash_difference_when_source_copies_match():
    saved = canonical_reference()
    without_digest = {key: value for key, value in saved.items() if key != "snapshot_sha256"}
    historical, current = historical_pair(historical_references=(without_digest,), current_references=(saved,))
    restored, _ = merge_restore(historical, current)
    assert len(restored["content_metadata"]["references"]) == 1


def test_existing_historical_section_keeps_its_historical_citation_even_with_a_new_live_connection():
    historical, current = historical_pair(historical_references=(canonical_reference(excerpt="Historical copy"),),
                                          current_references=(canonical_reference(excerpt="Current copy"),))
    historical["scene_document"]["sections"][0]["reference_ids"] = ["source_water"]
    current["hotspots"] = [hotspot("hs_old", "child")]
    current["scene_document"]["sections"] = [section(hotspot_id="hs_old", reference_ids=["source_water"], target_node_id="child")]
    restored, _ = merge_restore(historical, current)
    assert restored["content_metadata"]["references"][0]["excerpt"] == "Historical copy"
    assert restored["scene_document"]["sections"][0]["reference_ids"] == ["source_water"]
    assert restored["scene_document"]["sections"][0]["target_node_id"] == "child"


@pytest.mark.parametrize("damage", ["missing_current_source", "source_limit", "missing_historical_source"])
def test_restore_rejects_missing_or_over_limit_citations_without_changing_inputs(damage):
    historical, current = historical_pair(current_references=(canonical_reference(),))
    if damage == "missing_current_source":
        current["content_metadata"]["references"] = []
    elif damage == "source_limit":
        historical["content_metadata"]["references"] = [canonical_reference(id=f"other_{i}") for i in range(12)]
    else:
        historical["scene_document"]["sections"][0]["reference_ids"] = ["missing"]
    inputs = copy.deepcopy((historical, current))
    with pytest.raises(HTTPException) as error:
        merge_restore(historical, current)
    assert error.value.status_code == 409 and (historical, current) == inputs


def publication_rows():
    project = {"id": "proj_sources", "name": "Sources", "root_node_id": "root", "settings": {}}
    row = {"id": "root", "parent_id": None, "depth": 0, "status": "draft", "title": "Water cycle",
           "description": "An explanatory project", "source_type": "text", "image_url": None,
           "scene_document": scene(section(reference_ids=["source_water"])), "content_metadata": metadata(reference())}
    return project, [row], []


def test_publication_keeps_citations_and_only_the_public_source_copy():
    project, rows, hotspots = publication_rows()
    rows[0]["content_metadata"]["references"][0]["raw_html"] = "PRIVATE"
    saved = snapshot_project(project, rows, hotspots)
    assert saved["nodes"]["root"]["scene_document"]["sections"][0]["reference_ids"] == ["source_water"]
    assert saved["nodes"]["root"]["content_metadata"]["references"] == [canonical_reference()]
    assert "PRIVATE" not in json.dumps(saved)


@pytest.mark.parametrize("identities", [["foreign"], ["source_water", "source_water"], None, "source_water"])
def test_publication_refuses_imported_dangling_or_invalid_citations(identities):
    project, rows, hotspots = publication_rows()
    rows[0]["scene_document"]["sections"][0]["reference_ids"] = identities
    with pytest.raises(HTTPException) as error:
        snapshot_project(project, rows, hotspots)
    assert error.value.status_code == 409


@pytest_asyncio.fixture
async def citation_page(client, project):
    from main import app
    identity = gen_id("node_")
    async with app.state.pool.acquire() as conn:
        await conn.execute("INSERT INTO nodes(id,project_id,title,description,source_type,content_metadata) "
                           "VALUES($1,$2,'Water cycle','An original explanation','text',$3::jsonb)",
                           identity, project, json.dumps(metadata(reference(), review_status="reviewed")))
        await conn.execute("UPDATE projects SET root_node_id=$1 WHERE id=$2", identity, project)
    return identity


async def saved_graph(client, project):
    return (await client.get(f"/api/projects/{project}")).json()


async def save_page(client, project, node, **changes):
    graph = await saved_graph(client, project)
    return await client.patch(f"/api/projects/{project}/nodes/{node}", json={"expected_revision": graph["revision"], **changes})


async def test_atomic_save_citations_review_reset_and_remove_requires_unlink(client, project, citation_page):
    node = citation_page
    first = await save_page(client, project, node, scene_document=scene(section(reference_ids=["source_water"])))
    assert first.status_code == 200, first.text
    assert first.json()["content_metadata"]["review_status"] == "unreviewed"
    prior = await saved_graph(client, project)
    bad = await save_page(client, project, node, title="Must roll back", content_metadata=metadata())
    assert bad.status_code == 400 and "解除" in bad.json()["detail"]
    assert await saved_graph(client, project) == prior
    saved = await save_page(client, project, node, scene_document=scene(section(reference_ids=[])), content_metadata=metadata())
    assert saved.status_code == 200 and saved.json()["content_metadata"]["references"] == []


async def test_same_batch_declaration_is_allowed_but_citation_and_source_edits_reset_old_review(client, project, citation_page):
    node = citation_page
    checked = await save_page(client, project, node, scene_document=scene(section(reference_ids=["source_water"])),
                              content_metadata=metadata(reference(), review_status="reviewed"))
    assert checked.status_code == 200 and checked.json()["content_metadata"]["review_status"] == "reviewed"
    saved = await save_page(client, project, node, scene_document=scene(section(reference_ids=[])))
    assert saved.status_code == 200 and saved.json()["content_metadata"]["review_status"] == "unreviewed"
    checked = await save_page(client, project, node, content_metadata=metadata(reference(), review_status="reviewed"))
    old_hash = checked.json()["content_metadata"]["references"][0]["snapshot_sha256"]
    updated = await save_page(client, project, node, content_metadata=metadata(reference(excerpt="An author correction", snapshot_sha256=old_hash)))
    assert updated.status_code == 200 and updated.json()["content_metadata"]["review_status"] == "unreviewed"
    assert updated.json()["content_metadata"]["references"][0]["snapshot_sha256"] != old_hash


async def test_cross_page_reference_rejected_and_whole_content_transaction_is_rolled_back(client, project, citation_page):
    prior = await saved_graph(client, project)
    response = await save_page(client, project, citation_page, scene_document=scene(section(reference_ids=["not_in_this_page"])))
    assert response.status_code == 400 and await saved_graph(client, project) == prior


async def test_json_and_legacy_zip_export_keep_source_copies_citations_and_escape_html(client, project, citation_page):
    attack = '</script><script>window.bad=1</script>&\u2028'
    saved = await save_page(client, project, citation_page, scene_document=scene(section(reference_ids=["source_water"])),
                            content_metadata=metadata(reference(excerpt=attack)))
    assert saved.status_code == 200, saved.text
    expected = saved.json()["content_metadata"]
    exported = await client.get(f"/api/projects/{project}/export.json")
    node = next(item for item in exported.json()["nodes"] if item["id"] == citation_page)
    assert node["content_metadata"] == expected
    assert node["scene_document"]["sections"][0]["reference_ids"] == ["source_water"]
    zipped = await client.get(f"/api/projects/{project}/export.zip")
    with zipfile.ZipFile(io.BytesIO(zipped.content)) as archive:
        html = archive.read("index.html").decode()
    payload = json.loads(html.split("const DATA = ", 1)[1].split(";\n", 1)[0])
    assert payload["nodes"][0]["content_metadata"] == expected
    assert payload["nodes"][0]["scene_document"]["sections"][0]["reference_ids"] == ["source_water"]
    assert html.count("<script>") == 1 and "excerpt.textContent" in html
    assert "readerJumpLink" in html and "返回区块：" in html


async def test_imported_dangling_citation_cannot_be_silently_exported(client, project, citation_page):
    from main import app
    async with app.state.pool.acquire() as conn:
        await conn.execute("UPDATE nodes SET scene_document=$1::jsonb WHERE id=$2",
                           json.dumps(scene(section(reference_ids=["missing"]))), citation_page)
    for suffix in ("export.json", "export.zip"):
        response = await client.get(f"/api/projects/{project}/{suffix}")
        assert response.status_code == 409 and "引用" in response.json()["detail"]


async def test_stale_page_revision_cannot_replace_source_copies_or_citations(client, project, citation_page):
    graph = await saved_graph(client, project)
    saved = await save_page(client, project, citation_page, scene_document=scene(section(reference_ids=["source_water"])))
    assert saved.status_code == 200
    prior = await saved_graph(client, project)
    stale = await client.patch(f"/api/projects/{project}/nodes/{citation_page}", json={
        "expected_revision": graph["revision"], "content_metadata": metadata(reference(excerpt="Stale draft")),
    })
    assert stale.status_code == 409 and await saved_graph(client, project) == prior


async def connect_new_cited_section(client, project, node):
    from main import app
    graph = await saved_graph(client, project)
    page = graph["nodes"][node]
    saved = await save_page(client, project, node, scene_document=scene(
        *page["scene_document"]["sections"], section("new", title="Newer connected material", reference_ids=["source_water"]),
    ))
    assert saved.status_code == 200, saved.text
    child = gen_id("node_")
    document = saved.json()["scene_document"]
    document["sections"][-1]["target_node_id"] = child
    async with app.state.pool.acquire() as conn:
        await conn.execute("INSERT INTO nodes(id,project_id,parent_id,depth,title,source_type) "
                           "VALUES($1,$2,$3,1,'Protected child','text')", child, project, node)
        await conn.execute("UPDATE hotspots SET target_node_id=$1 WHERE id=$2", child, document["sections"][-1]["hotspot_id"])
        await conn.execute("UPDATE nodes SET scene_document=$1::jsonb WHERE id=$2", json.dumps(document), node)
    return child


async def test_real_history_preview_restore_retains_new_branch_source_and_original_citations(client, project, citation_page):
    node = citation_page
    original = await save_page(client, project, node, scene_document=scene(section(reference_ids=["source_water"])))
    assert original.status_code == 200
    versions = (await client.get(f"/api/projects/{project}/nodes/{node}/versions")).json()
    baseline = versions["current_version_id"]
    child = await connect_new_cited_section(client, project, node)
    current = await saved_graph(client, project)
    preview = await client.get(f"/api/projects/{project}/nodes/{node}/versions/{baseline}")
    assert preview.status_code == 200, preview.text
    assert preview.json()["preserved_branch_count"] == 1
    restored = await client.post(f"/api/projects/{project}/nodes/{node}/versions/{baseline}/restore", json={
        "operation_id": gen_id("restore_"), "expected_revision": current["revision"],
    })
    assert restored.status_code == 200, restored.text
    assert restored.json()["node"] == preview.json()["preview"]
    assert restored.json()["node"]["children"] == [child]
    assert restored.json()["node"]["content_metadata"]["references"][0]["excerpt"] == reference()["excerpt"]
    assert all(part["reference_ids"] == ["source_water"] for part in restored.json()["node"]["scene_document"]["sections"])


async def test_real_history_conflict_is_atomic_for_preview_and_restore(client, project, citation_page):
    node = citation_page
    await save_page(client, project, node, scene_document=scene(section(reference_ids=["source_water"])))
    versions = (await client.get(f"/api/projects/{project}/nodes/{node}/versions")).json()
    baseline = versions["current_version_id"]
    await connect_new_cited_section(client, project, node)
    changed = await save_page(client, project, node, content_metadata=metadata(reference(excerpt="A newer source version")))
    assert changed.status_code == 200
    prior = await saved_graph(client, project)
    prior_versions = (await client.get(f"/api/projects/{project}/nodes/{node}/versions")).json()
    preview = await client.get(f"/api/projects/{project}/nodes/{node}/versions/{baseline}")
    assert preview.status_code == 409 and "来源版本冲突" in preview.json()["detail"]
    restore = await client.post(f"/api/projects/{project}/nodes/{node}/versions/{baseline}/restore", json={
        "operation_id": gen_id("restore_"), "expected_revision": prior["revision"],
    })
    assert restore.status_code == 409 and "来源版本冲突" in restore.json()["detail"]
    assert await saved_graph(client, project) == prior
    assert (await client.get(f"/api/projects/{project}/nodes/{node}/versions")).json() == prior_versions


async def test_fixed_publication_source_copy_survives_original_edit_and_project_deletion(client, project, citation_page, tmp_path, monkeypatch):
    from httpx import ASGITransport, AsyncClient

    from reader import app as reader_app

    runtime = tmp_path / "runtime"
    runtime.mkdir()
    (runtime / "player.js").write_text("window.CONTROLLED_STATIC_READER=true;")
    (runtime / "player.css").write_text("body{margin:0}")
    monkeypatch.setenv("PUBLICATION_DIR", str(tmp_path / "publications"))
    monkeypatch.setenv("PUBLICATION_RUNTIME_DIR", str(runtime))
    saved = await save_page(client, project, citation_page, scene_document=scene(section(reference_ids=["source_water"])))
    assert saved.status_code == 200
    receipt = await client.post(f"/api/projects/{project}/publications", json={
        "operation_id": gen_id("publish_"), "expected_revision": saved.json()["project_revision"],
    })
    assert receipt.status_code == 201, receipt.text
    identity = receipt.json()["publication"]["id"]
    async with AsyncClient(transport=ASGITransport(app=reader_app), base_url="http://reader") as reader:
        before = await reader.get(f"/p/{identity}/project.json")
        assert before.status_code == 200
        payload = before.json()["nodes"][citation_page]
        assert payload["content_metadata"]["references"] == [canonical_reference()]
        assert payload["scene_document"]["sections"][0]["reference_ids"] == ["source_water"]
        edited = await save_page(client, project, citation_page, content_metadata=metadata(reference(excerpt="A later author correction")))
        assert edited.status_code == 200
        assert (await reader.get(f"/p/{identity}/project.json")).content == before.content
        assert (await client.delete(f"/api/projects/{project}")).status_code == 200
        assert (await reader.get(f"/p/{identity}/project.json")).content == before.content
