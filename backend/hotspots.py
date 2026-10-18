"""Transactional hotspot persistence shared by creation and generation routes."""
import json

import asyncpg
from fastapi import HTTPException

from utils import gen_id


def public_hotspot(hotspot) -> dict:
    kind = hotspot.get("kind", "image")
    return {
        "id": hotspot["id"], "kind": kind, "label": hotspot["label"],
        "position": None if kind == "section" else {"x": hotspot["pos_x"], "y": hotspot["pos_y"]},
        "size": None if kind == "section" else {"width": hotspot["width"], "height": hotspot["height"]},
        "score": None if kind == "section" else hotspot.get("score"),
        "selected": hotspot["selected"], "target_node_id": hotspot.get("target_node_id"),
    }


async def insert_hotspots(
    conn: asyncpg.Connection, node_id: str, hotspots: list[dict], *, selected: bool = False, sort_offset: int = 0,
) -> list[dict]:
    result = []
    for index, hotspot in enumerate(hotspots):
        hotspot_id = gen_id("hs_")
        kind = hotspot.get("kind", "image")
        if kind not in {"image", "section"}:
            raise ValueError("Unknown hotspot kind")
        x, y, width, height, score = (None, None, None, None, None) if kind == "section" else (
            hotspot["x"], hotspot["y"], hotspot["width"], hotspot["height"], hotspot.get("score"),
        )
        await conn.execute(
            """INSERT INTO hotspots (id, node_id, label, pos_x, pos_y, width, height,
               score, selected, sort_order, kind) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)""",
            hotspot_id, node_id, hotspot["label"], x, y, width, height, score, selected, index + sort_offset, kind,
        )
        result.append(public_hotspot({
            "id": hotspot_id, "kind": kind, "label": hotspot["label"], "pos_x": x, "pos_y": y,
            "width": width, "height": height, "score": score, "selected": selected, "target_node_id": None,
        }))
    return result


async def synchronize_scene_sections(
    conn: asyncpg.Connection, node_id: str, scene: dict | None, previous_scene: dict | str | None = None,
) -> tuple[dict | None, list[dict]]:
    """Keep a scene and its branch connections atomic; callers hold the node lock.

    Existing image references retain their geometry for legacy scenes. New sections
    get server-created identities and no image geometry. A linked section cannot be
    removed or reassigned through a content edit; child creation owns the target.
    """
    existing = await conn.fetch("SELECT * FROM hotspots WHERE node_id = $1 ORDER BY sort_order FOR UPDATE", node_id)
    by_id = {hotspot["id"]: dict(hotspot) for hotspot in existing}
    if isinstance(previous_scene, str):
        previous_scene = json.loads(previous_scene)
    previous_sections = {section["id"]: section for section in (previous_scene or {}).get("sections", [])}
    sections = [] if scene is None else scene["sections"]
    resolved: list[tuple[dict, str | None]] = []
    retained = set()
    for section in sections:
        section = dict(section)
        old = previous_sections.get(section["id"], {})
        hotspot_id = section.get("hotspot_id") or old.get("hotspot_id")
        if old.get("hotspot_id") and hotspot_id != old["hotspot_id"]:
            raise HTTPException(400, "页面分区不能重新指定已有连接")
        if hotspot_id:
            hotspot = by_id.get(hotspot_id)
            if not hotspot:
                raise HTTPException(400, "页面分区引用了其他页面的热点")
            if hotspot_id in retained:
                raise HTTPException(400, "多个页面分区不能共用同一个连接")
            target = hotspot.get("target_node_id")
            if section.get("target_node_id") and section["target_node_id"] != target:
                raise HTTPException(400, "页面分区不能更改分支目标")
            # The target is always derived from the persisted parent connection.
            section.pop("target_node_id", None)
            if target:
                section["target_node_id"] = target
            section["hotspot_id"] = hotspot_id
            retained.add(hotspot_id)
        elif section.get("target_node_id"):
            raise HTTPException(400, "新分区不能直接指定分支目标")
        resolved.append((section, hotspot_id))
    targets = list({section["target_node_id"] for section, _ in resolved if section.get("target_node_id")})
    if targets:
        valid_targets = await conn.fetch(
            "SELECT id FROM nodes WHERE id = ANY($1::text[]) AND project_id = (SELECT project_id FROM nodes WHERE id = $2)",
            targets, node_id,
        )
        if len(valid_targets) != len(targets):
            raise HTTPException(400, "页面分区只能链接本作品中的页面")
    removed = [hotspot for hotspot in by_id.values() if hotspot.get("kind", "image") == "section"
               and hotspot["id"] not in retained]
    if any(hotspot.get("target_node_id") for hotspot in removed):
        raise HTTPException(409, "已有子页的区块不能直接删除，请保留该区块及其连接")
    # Validate all references before mutating any row, even though the transaction
    # also guarantees rollback if a later persistence step fails.
    if removed:
        await conn.execute("DELETE FROM hotspots WHERE node_id = $1 AND id = ANY($2::text[])",
                           node_id, [hotspot["id"] for hotspot in removed])
        for hotspot in removed:
            by_id.pop(hotspot["id"])
    output_sections = []
    for index, (section, hotspot_id) in enumerate(resolved):
        if hotspot_id is None:
            created = (await insert_hotspots(conn, node_id, [{"kind": "section", "label": section["title"]}],
                                             sort_offset=index))[0]
            hotspot_id = created["id"]
            section["hotspot_id"] = hotspot_id
            by_id[hotspot_id] = {**created, "sort_order": index, "pos_x": None, "pos_y": None,
                                 "width": None, "height": None}
        else:
            await conn.execute("UPDATE hotspots SET label = $1, sort_order = $2 WHERE id = $3 AND node_id = $4",
                               section["title"], index, hotspot_id, node_id)
            by_id[hotspot_id]["label"] = section["title"]
            by_id[hotspot_id]["sort_order"] = index
        output_sections.append(section)
    normalized_scene = None if scene is None else {**scene, "sections": output_sections}
    return normalized_scene, [public_hotspot(hotspot) for hotspot in sorted(by_id.values(), key=lambda h: h.get("sort_order", 0))]
