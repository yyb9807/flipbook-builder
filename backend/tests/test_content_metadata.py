"""Metadata trust boundaries and transactional knowledge-page connections."""
import io
import json
import zipfile

import asyncpg
import pytest
import pytest_asyncio
from pydantic import ValidationError

from content_metadata import ContentMetadata, ai_content_metadata, public_content_metadata, safe_reference_url
from database import apply_schema
from hotspots import insert_hotspots
from utils import gen_id


def metadata(**changes):
    return {"version": 1, "references": [{"id": "reference_1", "title": "Water cycle", "url": "https://example.org/water",
                                          "note": "Author-supplied reading."}], "review_status": "unreviewed", **changes}


@pytest.mark.parametrize("url", [
    "javascript:alert(1)", "data:text/html,hello", "//example.org", "/relative", "https://",
    "https://user:password@example.org", "https://@example.org", "https://example.org\\@evil.org",
    " https://example.org", "https://example.org/hello world", "https://example.org/\nnext",
    "https://example.org/\x00", "https://example.org/\u202e", "https://example.org:0", "https://example.org:99999",
    "https://example.org%40evil.org", "https://-bad.example", "https://example..org",
])
def test_reference_url_rejects_unsafe_or_ambiguous_values(url):
    with pytest.raises(ValueError):
        safe_reference_url(url)


@pytest.mark.parametrize("url", ["https://example.org/path?q=a%20b#notes", "http://localhost:8080/read", "https://例子.测试/水", "https://[::1]:8443/read"])
def test_reference_url_accepts_public_http_links(url):
    assert safe_reference_url(url) == url


@pytest.mark.parametrize("change", [
    {"version": True}, {"version": 2}, {"review_status": "verified"}, {"api_key": "never-public"},
    {"references": [{"id": "same", "title": "A"}, {"id": "same", "title": "B"}]},
    {"references": [{"id": "a", "title": " "}]}, {"references": [{"id": "a", "title": "A", "note": "x" * 1001}]},
    {"references": [{"id": str(i), "title": "A"} for i in range(13)]},
    {"provenance": {"kind": "ai", "input_kind": "web_search", "model": "m"}},
])
def test_metadata_contract_is_strict_and_bounded(change):
    with pytest.raises(ValidationError):
        ContentMetadata.model_validate(metadata(**change))


def test_public_metadata_allowlist_drops_opaque_request_fields():
    value = metadata(provenance={"kind": "ai", "input_kind": "text", "model": "demo", "endpoint": "private"},
                     api_key="private", raw_request={"secret": "private"})
    value["references"][0]["api_key"] = "private"
    public = public_content_metadata(json.dumps(value))
    assert public == metadata(provenance={"kind": "ai", "input_kind": "text", "model": "demo"})
    assert "private" not in json.dumps(public)
    assert public_content_metadata({"version": 1, "references": [{"id": "a", "title": "A", "url": "javascript:x"}]}) is None
    assert public_content_metadata("bad-json") is None


@pytest_asyncio.fixture
async def content_page(client, project):
    from main import app
    node = gen_id("node_")
    original = ai_content_metadata("text", "content-contract-test")
    original["review_status"] = "reviewed"
    async with app.state.pool.acquire() as conn:
        await conn.execute("INSERT INTO nodes(id,project_id,title,description,source_type,content_metadata) "
                           "VALUES($1,$2,'Water','Original explanation','text',$3::jsonb)", node, project, json.dumps(original))
        await conn.execute("UPDATE projects SET root_node_id=$1 WHERE id=$2", node, project)
    return node, original


async def test_metadata_read_patch_export_preserve_server_provenance(client, project, content_page):
    node, original = content_page
    update = metadata(review_status="reviewed")
    response = await client.patch(f"/api/projects/{project}/nodes/{node}", json={"description": "Edited and checked", "content_metadata": update})
    assert response.status_code == 200
    expected = {**update, "provenance": original["provenance"]}
    assert response.json()["content_metadata"] == expected
    read = (await client.get(f"/api/projects/{project}")).json()["nodes"][node]
    assert read["scene_document"] is None and read["content_metadata"] == expected
    exported = (await client.get(f"/api/projects/{project}/export.json")).json()
    assert next(item for item in exported["nodes"] if item["id"] == node)["content_metadata"] == expected
    zipped = await client.get(f"/api/projects/{project}/export.zip")
    with zipfile.ZipFile(io.BytesIO(zipped.content)) as archive:
        html = archive.read("index.html").decode()
    payload = json.loads(html.split("const DATA = ", 1)[1].split(";\n", 1)[0])
    assert next(item for item in payload["nodes"] if item["id"] == node)["content_metadata"] == expected
    assert "reference.title" in html and "title.textContent" in html
    assert "系统未抓取或核验" in html


async def test_metadata_export_is_html_safe_and_never_publishes_opaque_fields(client, project, content_page):
    from html.parser import HTMLParser

    from main import app
    node, original = content_page
    attack = '</script><script>window.bad=1</script>&\u2028'
    stored = metadata(provenance={**original["provenance"], "endpoint": "private-endpoint"}, api_key="private-key")
    stored["references"][0]["title"] = attack
    stored["references"][0]["note"] = attack
    async with app.state.pool.acquire() as conn:
        await conn.execute("UPDATE nodes SET content_metadata=$1::jsonb WHERE id=$2", json.dumps(stored), node)
    response = await client.get(f"/api/projects/{project}/export.zip")
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        html = archive.read("index.html").decode()
    class ScriptCount(HTMLParser):
        count = 0
        def handle_starttag(self, tag, attrs):
            if tag == "script":
                self.count += 1
    parser = ScriptCount()
    parser.feed(html)
    assert parser.count == 1
    payload = json.loads(html.split("const DATA = ", 1)[1].split(";\n", 1)[0])
    public = payload["nodes"][0]["content_metadata"]
    assert public["references"][0]["title"] == attack
    assert "private-key" not in html and "private-endpoint" not in html
    assert "api_key" not in json.dumps(public) and "endpoint" not in json.dumps(public)


async def test_provenance_failure_rolls_back_created_section_connections(client, project, content_page):
    node, original = content_page
    result = await client.patch(f"/api/projects/{project}/nodes/{node}", json={
        "scene_document": scene(section()),
        "content_metadata": metadata(provenance={"kind": "ai", "input_kind": "text", "model": "forged"}),
    })
    assert result.status_code == 400
    restored = (await client.get(f"/api/projects/{project}")).json()["nodes"][node]
    assert restored["scene_document"] is None and restored["hotspots"] == []
    assert restored["content_metadata"] == original


async def test_content_change_without_declaration_clears_review_but_noop_preserves(client, project, content_page):
    node, original = content_page
    unchanged = await client.patch(f"/api/projects/{project}/nodes/{node}", json={"title": "Water"})
    assert unchanged.json()["content_metadata"]["review_status"] == "reviewed"
    changed = await client.patch(f"/api/projects/{project}/nodes/{node}", json={"description": "New explanation"})
    assert changed.json()["content_metadata"] == {**original, "review_status": "unreviewed"}


@pytest.mark.parametrize("provenance", [None, {"kind": "ai", "input_kind": "image", "model": "forged"}])
async def test_metadata_cannot_remove_or_forge_provenance(client, project, content_page, provenance):
    node, original = content_page
    result = await client.patch(f"/api/projects/{project}/nodes/{node}", json={"title": "Must roll back", "content_metadata": metadata(provenance=provenance)})
    assert result.status_code == 400
    restored = (await client.get(f"/api/projects/{project}")).json()["nodes"][node]
    assert restored["title"] == "Water" and restored["content_metadata"] == original


async def test_manual_page_cannot_acquire_fake_ai_provenance(client, project):
    from main import app
    node = gen_id("node_")
    async with app.state.pool.acquire() as conn:
        await conn.execute("INSERT INTO nodes(id,project_id,title) VALUES($1,$2,'Manual')", node, project)
    result = await client.patch(f"/api/projects/{project}/nodes/{node}", json={"content_metadata": ai_content_metadata("text", "pretend")})
    assert result.status_code == 400
    saved = await client.patch(f"/api/projects/{project}/nodes/{node}", json={"content_metadata": metadata()})
    assert saved.status_code == 200 and "provenance" not in saved.json()["content_metadata"]


def scene(*sections):
    return {"version": 1, "layout": "atlas", "sections": list(sections)}


def section(id="water", **changes):
    return {"id": id, "title": "Water", "body": "Water moves between reservoirs in the environment.", **changes}


async def test_scene_save_creates_persistent_section_connections_and_migrates_twice(client, project, content_page):
    from main import app
    node, _ = content_page
    saved = await client.patch(f"/api/projects/{project}/nodes/{node}", json={"scene_document": scene(section(), section("air", title="Air"))})
    assert saved.status_code == 200
    body = saved.json()
    assert body["content_metadata"]["review_status"] == "unreviewed"
    hotspot_ids = [part["hotspot_id"] for part in body["scene_document"]["sections"]]
    assert len(set(hotspot_ids)) == 2
    assert all(h["kind"] == "section" and h["position"] is None and h["size"] is None and h["score"] is None for h in body["hotspots"])
    await apply_schema(app.state.pool)
    await apply_schema(app.state.pool)
    repeated = await client.patch(f"/api/projects/{project}/nodes/{node}", json={"scene_document": scene(section(), section("air", title="Air"))})
    assert repeated.status_code == 200
    assert [part["hotspot_id"] for part in repeated.json()["scene_document"]["sections"]] == hotspot_ids
    assert len(repeated.json()["hotspots"]) == 2


async def test_scene_rename_keeps_linked_child_and_rejects_removal_or_retarget(client, project, content_page):
    from main import app
    node, _ = content_page
    saved = (await client.patch(f"/api/projects/{project}/nodes/{node}", json={"scene_document": scene(section())})).json()
    hotspot = saved["hotspots"][0]["id"]
    child, other = gen_id("node_"), gen_id("node_")
    async with app.state.pool.acquire() as conn:
        await conn.execute("INSERT INTO nodes(id,project_id,parent_id,depth) VALUES($1,$2,$3,1),($4,$2,$3,1)", child, project, node, other)
        await conn.execute("UPDATE hotspots SET target_node_id=$1 WHERE id=$2", child, hotspot)
    renamed = await client.patch(f"/api/projects/{project}/nodes/{node}", json={"scene_document": scene(section(title="Renamed"))})
    assert renamed.status_code == 200
    part = renamed.json()["scene_document"]["sections"][0]
    assert part["hotspot_id"] == hotspot and part["target_node_id"] == child
    assert renamed.json()["hotspots"][0]["label"] == "Renamed"
    for document in (None, scene(), scene(section(hotspot_id=hotspot, target_node_id=other))):
        result = await client.patch(f"/api/projects/{project}/nodes/{node}", json={"scene_document": document})
        assert result.status_code in {400, 409}
    restored = (await client.get(f"/api/projects/{project}")).json()["nodes"][node]
    assert restored["scene_document"]["sections"][0] == part
    assert restored["hotspots"][0]["target_node_id"] == child


async def test_scene_deletes_unlinked_connection_but_not_page_content(client, project, content_page):
    node, _ = content_page
    original = (await client.patch(f"/api/projects/{project}/nodes/{node}", json={"scene_document": scene(section(), section("air", title="Air"))})).json()
    kept = original["scene_document"]["sections"][1]
    result = await client.patch(f"/api/projects/{project}/nodes/{node}", json={"scene_document": scene(kept)})
    assert result.status_code == 200
    assert len(result.json()["hotspots"]) == 1 and result.json()["hotspots"][0]["id"] == kept["hotspot_id"]
    assert result.json()["description"] == "Original explanation"


async def test_duplicate_connection_and_other_page_reference_are_rejected(client, project, content_page):
    from main import app
    node, _ = content_page
    saved = (await client.patch(f"/api/projects/{project}/nodes/{node}", json={"scene_document": scene(section())})).json()
    hotspot = saved["hotspots"][0]["id"]
    duplicate = await client.patch(f"/api/projects/{project}/nodes/{node}", json={"scene_document": scene(section(hotspot_id=hotspot), section("air", hotspot_id=hotspot))})
    assert duplicate.status_code == 422
    foreign = gen_id("node_")
    async with app.state.pool.acquire() as conn:
        await conn.execute("INSERT INTO nodes(id,project_id) VALUES($1,$2)", foreign, project)
        foreign_hs = (await insert_hotspots(conn, foreign, [{"kind": "section", "label": "Foreign"}]))[0]["id"]
    attack = await client.patch(f"/api/projects/{project}/nodes/{node}", json={"scene_document": scene(section("new", hotspot_id=foreign_hs))})
    assert attack.status_code == 400
    restored = (await client.get(f"/api/projects/{project}")).json()["nodes"][node]
    assert restored["scene_document"] == saved["scene_document"] and len(restored["hotspots"]) == 1


async def test_section_hotspot_rejects_geometry_and_label_syncs_scene(client, project, content_page):
    node, _ = content_page
    saved = (await client.patch(f"/api/projects/{project}/nodes/{node}", json={"scene_document": scene(section())})).json()
    hotspot = saved["hotspots"][0]["id"]
    rejected = await client.patch(f"/api/projects/{project}/nodes/{node}/hotspots", json={"hotspots": [{"id": hotspot, "pos_x": 0.2}]})
    assert rejected.status_code == 400
    updated = await client.patch(f"/api/projects/{project}/nodes/{node}/hotspots", json={"hotspots": [{"id": hotspot, "selected": True, "label": "Renamed via connection"}]})
    assert updated.status_code == 200
    restored = (await client.get(f"/api/projects/{project}")).json()["nodes"][node]
    assert restored["hotspots"][0]["position"] is None and restored["hotspots"][0]["selected"] is True
    assert restored["scene_document"]["sections"][0]["title"] == "Renamed via connection"


async def test_database_section_geometry_constraint_rejects_fabricated_boxes(client, project, content_page):
    from main import app
    node, _ = content_page
    async with app.state.pool.acquire() as conn:
        with pytest.raises(asyncpg.CheckViolationError):
            await conn.execute("INSERT INTO hotspots(id,node_id,label,kind,pos_x,pos_y,width,height) VALUES($1,$2,'Fake','section',0,0,1,1)", gen_id("hs_"), node)
        with pytest.raises(asyncpg.CheckViolationError):
            await conn.execute("INSERT INTO hotspots(id,node_id,label,kind) VALUES($1,$2,'Missing','image')", gen_id("hs_"), node)


@pytest.mark.parametrize("document", [scene(), scene(section())])
async def test_structured_page_rejects_manual_image_hotspot(isolated_api, document):
    client, pool = isolated_api
    pool.conn.fetchrow.return_value = {"id": "node_knowledge", "status": "draft", "scene_document": json.dumps(document)}
    response = await client.post("/api/projects/proj_safe/nodes/node_knowledge/hotspots", json={
        "label": "Cannot position on structured page", "pos_x": 0.1, "pos_y": 0.1, "width": 0.2, "height": 0.2,
    })
    assert response.status_code == 409
    assert "内容区块" in response.json()["detail"]
    pool.conn.execute.assert_not_called()


async def test_explicit_metadata_without_review_resets_declaration_and_preserves_provenance(isolated_api):
    client, pool = isolated_api
    original = ai_content_metadata("text", "actual-server-model")
    original["review_status"] = "reviewed"
    refs = [{"id": "author_ref", "title": "Author reading", "note": "Author supplied; no system verification."}]
    expected = {"version": 1, "provenance": original["provenance"], "references": refs, "review_status": "unreviewed"}
    pool.conn.fetchrow.side_effect = [
        {"id": "node_a", "status": "draft", "title": "Water", "description": "Original", "scene_document": None,
         "content_metadata": json.dumps(original)},
        {"id": "node_a", "title": "Water", "description": "Original", "scene_document": None,
         "content_metadata": json.dumps(expected)},
    ]
    response = await client.patch("/api/projects/proj_safe/nodes/node_a", json={
        "content_metadata": {"version": 1, "references": refs},
    })
    assert response.status_code == 200 and response.json()["content_metadata"] == expected
    persisted = json.loads(pool.conn.fetchrow.call_args_list[1].args[1])
    assert persisted == expected


@pytest_asyncio.fixture
async def reviewed_image_page(client, project):
    from main import app
    node = gen_id("node_")
    original = metadata(provenance={"kind": "ai", "input_kind": "image", "model": "image-review-test"},
                        review_status="reviewed")
    async with app.state.pool.acquire() as conn:
        await conn.execute("INSERT INTO nodes(id,project_id,title,content_metadata) VALUES($1,$2,'Uploaded image',$3::jsonb)",
                           node, project, json.dumps(original))
        hotspot = (await insert_hotspots(conn, node, [{"label": "Leaf", "x": 0.1, "y": 0.1,
                                                      "width": 0.2, "height": 0.2}]))[0]["id"]
    return node, hotspot, original


async def test_image_hotspot_actual_rename_resets_review_and_retains_provenance_and_references(client, project, reviewed_image_page):
    node, hotspot, original = reviewed_image_page
    result = await client.patch(f"/api/projects/{project}/nodes/{node}/hotspots", json={
        "hotspots": [{"id": hotspot, "label": "A different leaf"}],
    })
    expected = {**original, "review_status": "unreviewed"}
    assert result.status_code == 200
    assert result.json() == {"status": "ok", "content_metadata": expected}
    restored = (await client.get(f"/api/projects/{project}")).json()["nodes"][node]
    assert restored["content_metadata"] == expected and restored["hotspots"][0]["label"] == "A different leaf"
    assert restored["scene_document"] is None


@pytest.mark.parametrize("patch", [
    {"label": "Leaf"}, {"selected": True}, {"pos_x": 0.2},
    {"label": "Leaf", "selected": True, "width": 0.3},
])
async def test_image_hotspot_same_label_selection_and_geometry_preserve_review(client, project, reviewed_image_page, patch):
    node, hotspot, original = reviewed_image_page
    result = await client.patch(f"/api/projects/{project}/nodes/{node}/hotspots", json={
        "hotspots": [{"id": hotspot, **patch}],
    })
    assert result.status_code == 200
    assert result.json() == {"status": "ok", "content_metadata": original}
    restored = (await client.get(f"/api/projects/{project}")).json()["nodes"][node]
    assert restored["content_metadata"] == original


async def test_section_hotspot_same_label_preserves_review_but_actual_rename_syncs_and_resets(client, project, content_page):
    node, original = content_page
    saved = (await client.patch(f"/api/projects/{project}/nodes/{node}", json={
        "scene_document": scene(section()), "content_metadata": metadata(review_status="reviewed"),
    })).json()
    expected = saved["content_metadata"]
    assert expected["provenance"] == original["provenance"]
    hotspot = saved["hotspots"][0]["id"]
    same = await client.patch(f"/api/projects/{project}/nodes/{node}/hotspots", json={
        "hotspots": [{"id": hotspot, "label": "Water", "selected": True}],
    })
    assert same.status_code == 200 and same.json()["content_metadata"] == expected
    renamed = await client.patch(f"/api/projects/{project}/nodes/{node}/hotspots", json={
        "hotspots": [{"id": hotspot, "label": "Water storage"}],
    })
    assert renamed.status_code == 200
    assert renamed.json()["content_metadata"] == {**expected, "review_status": "unreviewed"}
    restored = (await client.get(f"/api/projects/{project}")).json()["nodes"][node]
    assert restored["scene_document"]["sections"][0]["title"] == "Water storage"
    assert restored["content_metadata"] == renamed.json()["content_metadata"]
