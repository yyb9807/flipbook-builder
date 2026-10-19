"""Atomic page-content history, independent of execution checkpoints and credentials."""
from __future__ import annotations

import copy
import hashlib
import json

from fastapi import HTTPException

from content_metadata import public_content_metadata, validate_section_references
from hotspots import public_hotspot
from storage import url_to_disk_path
from utils import gen_id


def decoded(value):
    return json.loads(value) if isinstance(value, str) else value


def content_snapshot(node, hotspots) -> dict:
    """Never copy opaque node/job/provider data into the history journal."""
    scene = decoded(node.get("scene_document"))
    if scene is not None:
        scene = {"version": 1, "layout": scene["layout"], "sections": [
            {key: section[key] for key in ("id", "title", "body", "hotspot_id", "target_node_id", "reference_ids") if key in section}
            for section in scene.get("sections", [])
        ]}
    image = node.get("image_url")
    if image and (not image.startswith(f"/uploads/{node['project_id']}/") or url_to_disk_path(image) is None):
        image = None
    return {
        "title": node["title"], "description": node["description"], "source_type": node["source_type"],
        "image_url": image, "scene_document": scene,
        "content_metadata": public_content_metadata(node.get("content_metadata")),
        "hotspots": [public_hotspot(hotspot) for hotspot in hotspots],
    }


def content_hash(content: dict) -> str:
    # Selection is an editor preference. Its changes still advance concurrency
    # revision, but do not create a content version for each checkbox click.
    comparable = copy.deepcopy(content)
    for hotspot in comparable["hotspots"]:
        hotspot.pop("selected", None)
    return hashlib.sha256(json.dumps(comparable, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


async def capture_content(conn, project_id: str, node_id: str) -> dict | None:
    node = await conn.fetchrow("SELECT * FROM nodes WHERE id=$1 AND project_id=$2", node_id, project_id)
    if not node:
        return None
    hotspots = await conn.fetch("SELECT * FROM hotspots WHERE node_id=$1 ORDER BY sort_order,id", node_id)
    return content_snapshot(node, hotspots)


async def append_version(conn, project_id: str, node_id: str, content: dict, reason: str, revision: int) -> str:
    latest = await conn.fetchrow("SELECT * FROM node_versions WHERE node_id=$1 ORDER BY sequence DESC LIMIT 1", node_id)
    digest = content_hash(content)
    if latest and latest["content_hash"] == digest:
        return latest["id"]
    version_id = gen_id("ver_")
    await conn.execute(
        "INSERT INTO node_versions(id,project_id,node_id,sequence,project_revision,reason,content_hash,snapshot) "
        "VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)", version_id, project_id, node_id,
        (latest["sequence"] + 1) if latest else 1, revision, reason, digest, json.dumps(content, ensure_ascii=False),
    )
    return version_id


async def capture_before(conn, project_id: str, node_id: str) -> dict | None:
    """Call inside the project's write transaction, before changing content."""
    content = await capture_content(conn, project_id, node_id)
    if content is not None:
        revision = await conn.fetchval("SELECT revision FROM projects WHERE id=$1", project_id)
        await append_version(conn, project_id, node_id, content, "initial", revision)
    return content


async def record_changes(conn, project_id: str, changes: list[tuple[str, dict | None]], reason: str) -> int:
    captured = [(node_id, before, await capture_content(conn, project_id, node_id)) for node_id, before in changes]
    changed = any(before != after for _, before, after in captured)
    if changed:
        revision = await conn.fetchval(
            "UPDATE projects SET revision=revision+1,updated_at=NOW() WHERE id=$1 RETURNING revision", project_id,
        )
        for node_id, before, after in captured:
            if after is not None and (before is None or content_hash(before) != content_hash(after)):
                await append_version(conn, project_id, node_id, after, reason, revision)
    else:
        revision = await conn.fetchval("SELECT revision FROM projects WHERE id=$1", project_id)
    return revision


async def public_node(conn, project_id: str, node_id: str, *, content: dict | None = None) -> dict:
    node = await conn.fetchrow("SELECT * FROM nodes WHERE id=$1 AND project_id=$2", node_id, project_id)
    if not node:
        raise HTTPException(404, "页面不存在")
    if content is None:
        content = await capture_content(conn, project_id, node_id)
    children = await conn.fetch("SELECT id FROM nodes WHERE parent_id=$1 AND project_id=$2 ORDER BY created_at,id", node_id, project_id)
    return {"id": node_id, "parent_id": node["parent_id"], "depth": node["depth"], "status": node["status"],
            **content, "children": [child["id"] for child in children]}


def version_summary(row) -> dict:
    content = decoded(row["snapshot"])
    return {"id": row["id"], "sequence": row["sequence"], "reason": row["reason"],
            "created_at": row["created_at"].isoformat(),
            "summary": {"title": content["title"], "description": content["description"][:240],
                        "section_count": len((content.get("scene_document") or {}).get("sections", [])),
                        "hotspot_count": len(content["hotspots"])}}


def merge_restore(historical: dict, current: dict) -> tuple[dict, int]:
    """Restore content while treating current child connections as authoritative.

    Versions can resurrect deleted unlinked connectors, but never resurrect old
    targets, reassign a current target, or delete a connector with a live child.
    """
    restored = copy.deepcopy(historical)
    # Historical JSON may predate the derived digest, or contain a formerly
    # supplied stale value. Preview and persistence use the same public copy.
    if restored.get("content_metadata") is not None:
        restored["content_metadata"] = public_content_metadata(restored["content_metadata"])
    current_hotspots = {hotspot["id"]: hotspot for hotspot in current["hotspots"]}
    historical_hotspots = {hotspot["id"]: hotspot for hotspot in restored["hotspots"]}
    preserved = 0
    for hotspot in restored["hotspots"]:
        current_hotspot = current_hotspots.get(hotspot["id"])
        target = current_hotspot.get("target_node_id") if current_hotspot else None
        if target and target != hotspot.get("target_node_id"):
            preserved += 1
        hotspot["target_node_id"] = target
    for hotspot in current["hotspots"]:
        if hotspot.get("target_node_id") and hotspot["id"] not in historical_hotspots:
            restored["hotspots"].append(copy.deepcopy(hotspot))
            preserved += 1
    by_id = {hotspot["id"]: hotspot for hotspot in restored["hotspots"]}
    current_scene = current.get("scene_document")
    current_sections = {section.get("hotspot_id"): section for section in (current_scene or {}).get("sections", [])}
    scene = restored.get("scene_document")
    sections = [] if scene is None else scene["sections"]
    retained = set()
    retained_sections = []
    for section in sections:
        hotspot = by_id.get(section.get("hotspot_id"))
        section.pop("target_node_id", None)
        if hotspot:
            hotspot["label"] = section["title"]
            retained.add(hotspot["id"])
            if hotspot.get("target_node_id"):
                section["target_node_id"] = hotspot["target_node_id"]
    for hotspot in restored["hotspots"]:
        if hotspot["kind"] == "section" and hotspot.get("target_node_id") and hotspot["id"] not in retained:
            section = copy.deepcopy(current_sections.get(hotspot["id"]))
            if not section:
                raise HTTPException(409, "现有分支缺少对应的正文区块，无法安全恢复")
            # A section id may have been reused after deletion. Preserve its
            # linked identity without colliding with historical content ids.
            if any(existing["id"] == section["id"] for existing in sections):
                base = "restored_" + hotspot["id"][-70:]
                candidate, suffix = base, 1
                identities = {existing["id"] for existing in sections}
                while candidate in identities:
                    candidate = f"{base}_{suffix}"
                    suffix += 1
                section["id"] = candidate
            section["target_node_id"] = hotspot["target_node_id"]
            sections.append(section)
            retained_sections.append(section)
    if len(sections) > 12:
        raise HTTPException(409, "恢复内容与现有分支合并后超过 12 个区块；请先整理正文，本次没有修改内容")
    if len(restored["hotspots"]) > 12:
        raise HTTPException(409, "恢复热点与现有分支合并后超过 12 个热点；请先整理页面，本次没有修改内容")
    if sections and scene is None:
        restored["scene_document"] = {"version": 1, "layout": (current_scene or {}).get("layout", "atlas"), "sections": sections}
    # A newer connected section survives restoration with its own source copy.
    # The same id can mean different public content across versions. Reject
    # that conflict rather than silently citing the historical source version.
    current_metadata = public_content_metadata(current.get("content_metadata"))
    current_references = {reference["id"]: reference for reference in (current_metadata or {}).get("references", [])}
    metadata = restored.get("content_metadata")
    references = (metadata or {}).get("references", [])
    references_by_id = {reference["id"]: reference for reference in references}
    for section in retained_sections:
        for identity in section.get("reference_ids", []):
            reference = current_references.get(identity)
            if reference is None:
                raise HTTPException(409, "现有分支的来源资料缺失，无法安全恢复；本次没有修改内容")
            existing = references_by_id.get(identity)
            if existing is not None and (
                {key: value for key, value in existing.items() if key != "snapshot_sha256"}
                != {key: value for key, value in reference.items() if key != "snapshot_sha256"}
            ):
                raise HTTPException(409, "来源版本冲突，请先整理当前分支与历史资料后再恢复；本次没有修改内容")
            if existing is None:
                saved = copy.deepcopy(reference)
                references.append(saved)
                references_by_id[identity] = saved
    if len(references) > 12:
        raise HTTPException(409, "恢复内容与现有分支合并后超过 12 条资料；请先整理来源，本次没有修改内容")
    if metadata is None and references:
        metadata = {"version": 1, "references": references, "review_status": "unreviewed"}
        restored["content_metadata"] = metadata
    try:
        validate_section_references(restored.get("scene_document"), metadata)
    except ValueError as exc:
        raise HTTPException(409, "该版本的引用关联不完整，无法安全恢复；本次没有修改内容") from exc
    if metadata:
        metadata["review_status"] = "unreviewed"
    return restored, preserved


def validate_restored_asset(content: dict, project_id: str):
    image = content.get("image_url")
    if image:
        path = url_to_disk_path(image)
        if not image.startswith(f"/uploads/{project_id}/") or path is None or not path.is_file():
            raise HTTPException(409, "该版本引用的图片文件已缺失，无法完整恢复；本次没有修改内容")


async def persist_restored_content(conn, node_id: str, content: dict):
    # Parentage, status, depth and child nodes are intentionally absent.
    await conn.execute(
        "UPDATE nodes SET title=$1,description=$2,source_type=$3,image_url=$4,scene_document=$5::jsonb,"
        "content_metadata=$6::jsonb,updated_at=NOW() WHERE id=$7", content["title"], content["description"],
        content["source_type"], content["image_url"],
        json.dumps(content["scene_document"], ensure_ascii=False) if content["scene_document"] is not None else None,
        json.dumps(content["content_metadata"], ensure_ascii=False) if content["content_metadata"] is not None else None, node_id,
    )
    ids = [hotspot["id"] for hotspot in content["hotspots"]]
    await conn.execute("DELETE FROM hotspots WHERE node_id=$1 AND NOT (id=ANY($2::text[]))", node_id, ids)
    for index, hotspot in enumerate(content["hotspots"]):
        position, size = hotspot.get("position") or {}, hotspot.get("size") or {}
        await conn.execute(
            "INSERT INTO hotspots(id,node_id,label,pos_x,pos_y,width,height,selected,target_node_id,sort_order,score,kind) "
            "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(id) DO UPDATE SET "
            "label=EXCLUDED.label,pos_x=EXCLUDED.pos_x,pos_y=EXCLUDED.pos_y,width=EXCLUDED.width,height=EXCLUDED.height,"
            "selected=EXCLUDED.selected,target_node_id=EXCLUDED.target_node_id,sort_order=EXCLUDED.sort_order,"
            "score=EXCLUDED.score,kind=EXCLUDED.kind WHERE hotspots.node_id=EXCLUDED.node_id",
            hotspot["id"], node_id, hotspot["label"], position.get("x"), position.get("y"), size.get("width"),
            size.get("height"), hotspot["selected"], hotspot.get("target_node_id"), index, hotspot.get("score"), hotspot["kind"],
        )
