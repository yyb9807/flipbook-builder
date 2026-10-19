"""Postgres projection. DBOS owns execution, this module owns business invariants."""
from __future__ import annotations

import hashlib
import json
from contextlib import asynccontextmanager
from datetime import datetime

import asyncpg
from fastapi import HTTPException
from sqlalchemy import text

from agents.knowledge import generation_metadata, normalize_knowledge
from hotspots import insert_hotspots
from jobs.models import ACTIVE_SQL, TERMINAL
from storage import url_to_disk_path
from utils import gen_id
from version_history import capture_before, record_changes

JSON_FIELDS = {"input", "provider_config", "result", "error", "required_credentials", "confirmation", "input_summary"}
PUBLIC_FIELDS = (
    "operation_id", "project_id", "node_id", "status", "phase", "message", "pct", "last_event_id",
    "result", "error", "provider_config", "required_credentials", "confirmation", "created_at", "updated_at",
    "kind", "target_node_id", "input_summary",
)


def decoded(value):
    return json.loads(value) if isinstance(value, str) else value


def snapshot(row) -> dict:
    result = {"job_id": row["id"]}
    for key in PUBLIC_FIELDS:
        value = row.get(key, "children" if key == "kind" else ({} if key == "input_summary" else None))
        if key in JSON_FIELDS:
            value = decoded(value)
        if isinstance(value, datetime):
            value = value.isoformat()
        if key == "target_node_id" and value is None:
            value = row["node_id"]
        result[key] = value
    return result


def fingerprint(node_id: str, keywords: list[str], provider_config: dict, image_intent: bool | None = None) -> str:
    identity = [node_id, keywords, provider_config]
    if image_intent is not None:
        identity.append({"generate_images": image_intent})
    return hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()


def validate_content_model(provider_config: dict) -> None:
    model = provider_config.get("llm_model")
    if not isinstance(model, str) or not model.strip() or len(model) > 200:
        raise HTTPException(400, "内容模型名称应为 1 至 200 个字符，请检查模型配置")


class JobStore:
    def __init__(self, pool: asyncpg.Pool, engine, dbos_client):
        self.pool, self.engine, self.client = pool, engine, dbos_client

    @asynccontextmanager
    async def locked(self, job_id: str):
        async with self.pool.acquire() as conn, conn.transaction():
            initial = await conn.fetchrow("SELECT project_id,node_id FROM generation_jobs WHERE id=$1", job_id)
            if not initial:
                raise HTTPException(404, "生成任务不存在")
            # All mutations share project -> node -> job, including empty roots.
            await conn.fetchrow("SELECT id FROM projects WHERE id=$1 FOR UPDATE", initial["project_id"])
            await conn.fetchrow("SELECT id FROM nodes WHERE id=$1 FOR UPDATE", initial["node_id"])
            row = await conn.fetchrow("SELECT * FROM generation_jobs WHERE id=$1 FOR UPDATE", job_id)
            if not row:
                raise HTTPException(404, "生成任务不存在")
            yield conn, row

    async def get(self, job_id: str) -> dict:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM generation_jobs WHERE id=$1", job_id)
        if not row:
            raise HTTPException(404, "生成任务不存在")
        return snapshot(row)

    async def existing_operation(self, project_id: str, operation_id: str, digest: str) -> dict:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM generation_jobs WHERE project_id=$1 AND operation_id=$2", project_id, operation_id)
        if not row or row["fingerprint"] != digest:
            raise HTTPException(409, "操作 ID 输入冲突，或此页面已有活动任务")
        return snapshot(row)

    async def input(self, job_id: str) -> dict:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("SELECT input FROM generation_jobs WHERE id=$1", job_id)
        if not row:
            raise HTTPException(404, "生成任务不存在")
        return decoded(row["input"])

    async def list(self, project_id: str, active: bool, operation_id: str | None = None) -> list[dict]:
        async with self.pool.acquire() as conn:
            if not await conn.fetchval("SELECT 1 FROM projects WHERE id=$1", project_id):
                raise HTTPException(404, "项目不存在")
            condition = f" AND status IN {ACTIVE_SQL}" if active else ""
            operation_clause = " AND operation_id=$2" if operation_id else ""
            args = [project_id, operation_id] if operation_id else [project_id]
            rows = await conn.fetch(
                f"SELECT * FROM generation_jobs WHERE project_id=$1{condition}{operation_clause} ORDER BY created_at DESC LIMIT 100", *args,
            )
        return [snapshot(row) for row in rows]

    async def events(self, job_id: str, after: int) -> list[dict]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT id,snapshot FROM generation_events WHERE job_id=$1 AND id>$2 ORDER BY id LIMIT 100", job_id, after,
            )
        return [{"id": row["id"], "snapshot": decoded(row["snapshot"])} for row in rows]

    async def emit(self, conn, job_id: str, **changes) -> dict:
        if changes:
            args = []
            clauses = []
            for field, value in changes.items():
                assert field in {*PUBLIC_FIELDS, "cancel_requested"} and field not in {"created_at", "updated_at"}
                args.append(json.dumps(value) if field in JSON_FIELDS and value is not None else value)
                clauses.append(f"{field}=${len(args)}" + ("::jsonb" if field in JSON_FIELDS else ""))
            args.append(job_id)
            await conn.execute(
                f"UPDATE generation_jobs SET {','.join(clauses)},updated_at=NOW() WHERE id=${len(args)}", *args,
            )
        event_id = await conn.fetchval(
            "INSERT INTO generation_events(job_id,event_key,snapshot) VALUES($1,$2,'{}') RETURNING id", job_id, gen_id("evt_"),
        )
        row = await conn.fetchrow(
            "UPDATE generation_jobs SET last_event_id=$1 WHERE id=$2 RETURNING *", event_id, job_id,
        )
        public = snapshot(row)
        await conn.execute("UPDATE generation_events SET snapshot=$1::jsonb WHERE id=$2", json.dumps(public), event_id)
        return public

    @staticmethod
    def sync_emit(conn, job_id: str) -> dict:
        event_id = conn.execute(text(
            "INSERT INTO generation_events(job_id,event_key,snapshot) VALUES(:jid,:key,'{}') RETURNING id"
        ), {"jid": job_id, "key": gen_id("evt_")}).scalar_one()
        row = conn.execute(text(
            "UPDATE generation_jobs SET last_event_id=:eid,updated_at=NOW() WHERE id=:jid RETURNING *"
        ), {"eid": event_id, "jid": job_id}).mappings().one()
        public = snapshot(row)
        conn.execute(text("UPDATE generation_events SET snapshot=CAST(:data AS jsonb) WHERE id=:eid"),
                     {"data": json.dumps(public), "eid": event_id})
        return public

    def create(self, job_id: str, project_id: str, node_id: str, operation_id: str,
               keywords: list[str], providers: dict, image_requested: bool, image_intent: bool | None = None) -> dict:
        validate_content_model(providers)
        digest = fingerprint(node_id, keywords, providers, image_intent)
        with self.engine.begin() as conn:
            project = conn.execute(text("SELECT * FROM projects WHERE id=:pid FOR UPDATE"), {"pid": project_id}).mappings().first()
            if not project:
                raise HTTPException(404, "项目不存在")
            existing = conn.execute(text("SELECT * FROM generation_jobs WHERE project_id=:pid AND operation_id=:op"),
                                    {"pid": project_id, "op": operation_id}).mappings().first()
            if existing:
                if existing["fingerprint"] != digest:
                    raise HTTPException(409, "同一操作 ID 的生成输入不同，请发起新的操作")
                return snapshot(existing)
            node = conn.execute(text("SELECT * FROM nodes WHERE id=:nid AND project_id=:pid FOR UPDATE"),
                                {"nid": node_id, "pid": project_id}).mappings().first()
            if not node:
                raise HTTPException(404, "页面不存在")
            # A concurrent identical submit may have waited for the node lock.
            existing = conn.execute(text("SELECT * FROM generation_jobs WHERE project_id=:pid AND operation_id=:op"),
                                    {"pid": project_id, "op": operation_id}).mappings().first()
            if existing:
                if existing["fingerprint"] != digest:
                    raise HTTPException(409, "同一操作 ID 的生成输入不同，请发起新的操作")
                return snapshot(existing)
            if self.active_project(conn, project_id) or node["status"] == "generating":
                raise HTTPException(409, "这个页面已有生成任务，请先恢复或取消它")
            settings = decoded(project["settings"])
            if node["depth"] >= settings.get("max_depth", 4):
                raise HTTPException(400, "已达到最大页面深度")
            hotspots = conn.execute(text(
                "SELECT h.* FROM hotspots h WHERE h.node_id=:nid AND h.selected=true "
                "AND h.target_node_id IS NULL ORDER BY h.sort_order,h.id"
            ), {"nid": node_id}).mappings().all()
            if not hotspots:
                raise HTTPException(400, "没有尚未生成子页的选中热点")
            parent_scene = decoded(node["scene_document"])
            section_context = {section.get("hotspot_id"): section.get("body", "")
                               for section in (parent_scene or {}).get("sections", [])}
            frozen = {"title": node["title"], "description": node["description"], "depth": node["depth"],
                      "content_format": "knowledge-v1", "kind": "children",
                      "settings": settings, "selected_keywords": keywords, "image_requested": image_requested,
                      "children": [{"hotspot_id": h["id"], "label": h["label"], "node_id": gen_id("node_"),
                                    "context": section_context.get(h["id"], "")} for h in hotspots]}
            conn.execute(text(
                "INSERT INTO generation_jobs(id,operation_id,fingerprint,project_id,node_id,input,provider_config,previous_status,message) "
                "VALUES(:jid,:op,:fp,:pid,:nid,CAST(:input AS jsonb),CAST(:providers AS jsonb),:previous,'任务已排队')"
            ), {"jid": job_id, "op": operation_id, "fp": digest, "pid": project_id, "nid": node_id,
                "input": json.dumps(frozen), "providers": json.dumps(providers), "previous": node["status"]})
            conn.execute(text("UPDATE nodes SET status='generating',updated_at=NOW() WHERE id=:nid"), {"nid": node_id})
            self.client.enqueue_in_transaction(conn, {
                "workflow_name": "children-v1", "workflow_id": job_id,
                "queue_name": "flipbook-children", "app_version": "children-v1",
            }, job_id)
            return self.sync_emit(conn, job_id)

    @staticmethod
    def active_project(conn, project_id: str) -> bool:
        return bool(conn.execute(text(
            f"SELECT 1 FROM generation_jobs WHERE project_id=:pid AND status IN {ACTIVE_SQL} LIMIT 1"
        ), {"pid": project_id}).first())

    def create_page(self, job_id: str, project_id: str, node_id: str | None, operation_id: str,
                    kind: str, payload: dict, providers: dict, image_requested: bool) -> dict:
        validate_content_model(providers)
        identity = {"kind": kind, "node_id": node_id, "payload": payload["identity"],
                    "providers": providers, "image_requested": image_requested}
        digest = hashlib.sha256(json.dumps(identity, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        with self.engine.begin() as conn:
            project = conn.execute(text("SELECT * FROM projects WHERE id=:pid FOR UPDATE"), {"pid": project_id}).mappings().first()
            if not project:
                raise HTTPException(404, "项目不存在")
            existing = conn.execute(text("SELECT * FROM generation_jobs WHERE project_id=:pid AND operation_id=:op"),
                                    {"pid": project_id, "op": operation_id}).mappings().first()
            if existing:
                if existing["fingerprint"] != digest:
                    raise HTTPException(409, "同一操作 ID 的生成输入不同，请发起新的操作")
                return snapshot(existing)
            if self.active_project(conn, project_id):
                raise HTTPException(409, "作品已有活动任务，请先恢复或取消它")
            settings = decoded(project["settings"])
            frozen = {**payload, "settings": settings, "image_requested": image_requested, "kind": kind}
            previous = "draft"
            target = gen_id("node_") if kind == "analyze" else node_id
            if kind == "analyze":
                if project["root_node_id"]:
                    raise HTTPException(409, "项目已有根页面，请编辑现有页面或新建作品")
                frozen["source_type"] = "image" if payload.get("asset_url") else "text"
                frozen["content_format"] = "image-v1" if payload.get("asset_url") else "knowledge-v1"
                label = str(payload.get("text") or payload.get("filename") or project["name"])[:200]
                frozen["subject"] = {"hotspot_id": "root", "node_id": target, "label": label}
            else:
                frozen["content_format"] = "knowledge-v1"
                node = conn.execute(text("SELECT * FROM nodes WHERE id=:nid AND project_id=:pid FOR UPDATE"),
                                    {"nid": node_id, "pid": project_id}).mappings().first()
                if not node:
                    raise HTTPException(404, "页面不存在")
                if node["status"] == "generating":
                    raise HTTPException(409, "页面已有生成任务")
                if conn.execute(text("SELECT 1 FROM hotspots WHERE node_id=:nid LIMIT 1"), {"nid": node_id}).first():
                    raise HTTPException(409, "此页面已有热点；为保护坐标和子页链接，请新建作品生成另一版本")
                if decoded(node["scene_document"]) is not None:
                    raise HTTPException(409, "此页面有结构化正文，请直接编辑或新建作品，避免重新生成覆盖正文")
                parent = conn.execute(text("SELECT title,description FROM nodes WHERE id=:nid"),
                                      {"nid": node["parent_id"]}).mappings().first()
                hotspot = conn.execute(text("SELECT label FROM hotspots WHERE target_node_id=:nid LIMIT 1"), {"nid": node_id}).mappings().first()
                label = hotspot["label"] if hotspot else node["title"]
                old_hash = None
                if node["image_url"] and not image_requested:
                    path = url_to_disk_path(node["image_url"])
                    try:
                        old_data = path.read_bytes() if path else b""
                    except OSError:
                        old_data = b""
                    if not old_data:
                        raise HTTPException(400, "原图片缺失，请检查本地存储或明确生成新插图")
                    old_hash = hashlib.sha256(old_data).hexdigest()
                previous = node["status"]
                frozen.update({"source_type": node["source_type"], "title": node["title"], "description": node["description"],
                               "old_content_metadata": decoded(node["content_metadata"]),
                               "old_image_url": node["image_url"], "depth": node["depth"], "parent_id": node["parent_id"],
                               "old_image_sha256": old_hash,
                               "node_updated_at": node["updated_at"].isoformat(),
                               "parent_title": parent["title"] if parent else "", "parent_description": parent["description"] if parent else "",
                               "subject": {"hotspot_id": f"node:{node_id}", "node_id": node_id, "label": label}})
                conn.execute(text("UPDATE nodes SET status='generating' WHERE id=:nid"), {"nid": node_id})
            summary = {"source_type": frozen["source_type"], "input_sha256": payload["identity"].get("input_sha256", digest),
                       "file_sha256": payload.get("file_sha256"), "filename": payload.get("filename"),
                       "label": label, "generate_images": image_requested}
            conn.execute(text(
                "INSERT INTO generation_jobs(id,operation_id,fingerprint,project_id,node_id,kind,target_node_id,input_summary,"
                "input,provider_config,previous_status,message) VALUES(:jid,:op,:fp,:pid,:nid,:kind,:target,CAST(:summary AS jsonb),"
                "CAST(:input AS jsonb),CAST(:providers AS jsonb),:previous,'任务已排队')"
            ), {"jid": job_id, "op": operation_id, "fp": digest, "pid": project_id, "nid": node_id, "kind": kind,
                "target": target, "summary": json.dumps(summary), "input": json.dumps(frozen),
                "providers": json.dumps(providers), "previous": previous})
            self.client.enqueue_in_transaction(conn, {
                "workflow_name": "root-analysis-v1" if kind == "analyze" else "regenerate-v1", "workflow_id": job_id,
                "queue_name": "flipbook-children", "app_version": "children-v1",
            }, job_id)
            return self.sync_emit(conn, job_id)

    async def finish_page_failure(self, job_id: str, error: dict) -> dict:
        async with self.locked(job_id) as (conn, row):
            if row["status"] in TERMINAL:
                return snapshot(row)
            if row["node_id"]:
                await conn.execute("UPDATE nodes SET status=$1 WHERE id=$2", row["previous_status"], row["node_id"])
            return await self.emit(conn, job_id, status="failed", phase="done", pct=100, error=error,
                                   message="本次生成未完成，原有内容已保留", confirmation=None, required_credentials=[])

    async def commit_page(self, job_id: str, frozen: dict, page: dict, image_url: str | None,
                          localized: list, warnings: list[str]) -> dict:
        async with self.locked(job_id) as (conn, row):
            if row["status"] in TERMINAL or row["cancel_requested"]:
                return snapshot(row)
            prior = decoded(row["result"])
            if prior.get("nodes"):
                return snapshot(row)
            node_id = row["target_node_id"]
            is_root = row["kind"] == "analyze"
            knowledge = frozen.get("content_format") == "knowledge-v1"
            before = None if is_root else await capture_before(conn, row["project_id"], node_id)
            title = str((page.get("title") if knowledge or not is_root else page.get("summary")) or frozen["subject"]["label"])[:200]
            description = str((page.get("summary") if is_root else page.get("description")) or "")[:20000]
            if is_root:
                root = await conn.fetchval("SELECT root_node_id FROM projects WHERE id=$1", row["project_id"])
                if root:
                    raise RuntimeError("generation_root_changed")
                await conn.execute(
                    "INSERT INTO nodes(id,project_id,title,description,source_type,image_url,status) VALUES($1,$2,$3,$4,$5,$6,'draft')",
                    node_id, row["project_id"], title, description, frozen["source_type"], image_url,
                )
                await conn.execute("UPDATE projects SET root_node_id=$1,updated_at=NOW() WHERE id=$2", node_id, row["project_id"])
            else:
                node = await conn.fetchrow("SELECT * FROM nodes WHERE id=$1", node_id)
                if (not node or node["updated_at"].isoformat() != frozen["node_updated_at"]
                        or node["scene_document"] is not None or await conn.fetchval("SELECT 1 FROM hotspots WHERE node_id=$1", node_id)):
                    raise RuntimeError("generation_page_changed")
                await conn.execute("UPDATE nodes SET title=$1,description=$2,image_url=$3,status='generated',updated_at=NOW() WHERE id=$4",
                                   title, description, image_url, node_id)
                await conn.execute("UPDATE projects SET updated_at=NOW() WHERE id=$1", row["project_id"])
            scene, hotspots, metadata = await self.commit_content(conn, node_id, frozen, page, localized,
                                                                  decoded(row["provider_config"]), selected=is_root)
            node = {"id": node_id, "title": title, "description": description, "source_type": frozen["source_type"],
                    "image_url": image_url, "status": "draft" if is_root else "generated", "scene_document": scene,
                    "parent_id": None if is_root else frozen["parent_id"], "depth": 0 if is_root else frozen["depth"],
                    "hotspots": hotspots, "children": []}
            if metadata is not None:
                node["content_metadata"] = metadata
            await record_changes(conn, row["project_id"], [(node_id, before)], "generation")
            result = {"nodes": [node], "warnings": warnings, "failed_hotspot_ids": [], **node}
            if is_root:
                result.update({"node_id": node_id, "summary": description, "main_objects": page.get("main_objects") or [],
                               "scene_type": page.get("scene_type") or "other", "keywords": page.get("keywords") or []})
            return await self.emit(conn, job_id, node_id=node_id, status="partial" if warnings else "succeeded", phase="done", pct=100,
                                   result=result, message="页面已保存" + ("，请查看提示" if warnings else ""),
                                   required_credentials=[], confirmation=None)

    async def commit_content(self, conn, node_id: str, frozen: dict, page: dict, localized: list,
                             provider_config: dict, *, selected=False):
        """Content, structural connectors and provenance are one business transaction."""
        scene = None
        metadata = generation_metadata(frozen, provider_config)
        if frozen.get("content_format") == "knowledge-v1":
            document = normalize_knowledge(page)
            sections = document["sections"]
            hotspots = await insert_hotspots(conn, node_id, [{"kind": "section", "label": section["title"]}
                                                             for section in sections], selected=selected)
            scene = {"version": 1, "layout": document["layout"], "sections": [
                {**section, "hotspot_id": hotspot["id"]} for section, hotspot in zip(sections, hotspots, strict=True)
            ]}
        else:
            hotspots = await insert_hotspots(conn, node_id, localized, selected=selected)
        if metadata is not None:
            await conn.execute("UPDATE nodes SET scene_document=$1::jsonb,content_metadata=$2::jsonb WHERE id=$3",
                               json.dumps(scene) if scene is not None else None, json.dumps(metadata), node_id)
        return scene, hotspots, metadata

    async def transition(self, job_id: str, **changes) -> dict:
        async with self.locked(job_id) as (conn, row):
            if row["cancel_requested"] or row["status"] in TERMINAL:
                return snapshot(row)
            return await self.emit(conn, job_id, **changes)

    async def begin_attempt(self, job_id: str, child: dict, stage: str, attempt_no: int, credential_available: bool) -> dict:
        async with self.locked(job_id) as (conn, row):
            if row["cancel_requested"] or row["status"] in TERMINAL:
                return {"state": "cancelled"}
            attempt = await conn.fetchrow(
                "SELECT * FROM generation_attempts WHERE job_id=$1 AND hotspot_id=$2 AND stage=$3 AND attempt_no=$4",
                job_id, child["hotspot_id"], stage, attempt_no,
            )
            if attempt and attempt["state"] == "completed":
                return {"state": "completed", "value": decoded(attempt["result"])}
            if attempt and attempt["state"] == "failed":
                return {"state": "failed", "error": decoded(attempt["error"])}
            if attempt:
                confirmation_id = f"confirm_{attempt['request_id']}"
                await conn.execute(
                    "INSERT INTO generation_decisions(id,job_id,hotspot_id,stage,attempt_no) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
                    confirmation_id, job_id, child["hotspot_id"], stage, attempt_no,
                )
                can_accept = stage == "localize" or (stage == "image" and row["kind"] != "regenerate")
                confirmation = {"id": confirmation_id, "stage": stage, "hotspot_id": child["hotspot_id"],
                                "message": "上次请求结果不确定，可能已经计费。请确认后再决定是否重新调用。",
                                "can_accept": can_accept, "can_retry": True,
                                "accept_label": ("保留文字页面" if stage == "image" else "保留图片，稍后手动添加热点") if can_accept else None}
                await self.emit(conn, job_id, status="waiting_confirmation", phase=stage, message=confirmation["message"],
                                confirmation=confirmation, required_credentials=[])
                return {"state": "unknown", "confirmation_id": confirmation_id}
            if not credential_available:
                kind = "imggen" if stage == "image" else "llm"
                await self.emit(conn, job_id, status="waiting_credentials", phase=stage,
                                message="继续生成需要重新提供临时 API Key", required_credentials=[kind], confirmation=None)
                return {"state": "need_credentials"}
            await conn.execute(
                "INSERT INTO generation_attempts(job_id,hotspot_id,stage,attempt_no,request_id,state) VALUES($1,$2,$3,$4,$5,'started')",
                job_id, child["hotspot_id"], stage, attempt_no, gen_id("req_"),
            )
            await self.emit(conn, job_id, status="running", phase=stage, message={
                "plan": f"规划「{child['label']}」", "image": f"绘制「{child['label']}」", "localize": f"定位「{child['label']}」热点",
                "analyze": "分析根页面素材",
            }[stage], required_credentials=[], confirmation=None)
            return {"state": "invoke"}

    async def missing_asset_attempt(self, job_id: str, subject: dict, stage: str, attempt_no: int) -> dict | None:
        """Local loss cannot erase a previously admitted, possibly billed call."""
        async with self.locked(job_id) as (conn, row):
            if row["cancel_requested"] or row["status"] in TERMINAL:
                return {"state": "cancelled"}
            attempt = await conn.fetchrow(
                "SELECT state,result FROM generation_attempts WHERE job_id=$1 AND hotspot_id=$2 AND stage=$3 AND attempt_no=$4",
                job_id, subject["hotspot_id"], stage, attempt_no,
            )
            if not attempt:
                return None
            if attempt["state"] == "completed":
                # Reuse known remote work. The final commit still validates assets.
                return {"state": "completed", "value": decoded(attempt["result"])}
            if attempt["state"] != "started":
                return None
            confirmation_id = f"asset_recovery_{job_id}_{stage}_{attempt_no}"
            message = "本地图片缺失或已变化，上次请求结果仍不确定且可能已计费；请核实供应商结果后取消此任务"
            await self.emit(conn, job_id, status="waiting_confirmation", phase="recovery", message=message,
                            error={"code": "asset_recovery_required", "message": message},
                            confirmation={"id": confirmation_id, "stage": stage, "hotspot_id": subject["hotspot_id"],
                                          "message": message, "can_accept": False, "can_retry": False, "accept_label": None},
                            required_credentials=[])
            return {"state": "unknown", "confirmation_id": confirmation_id}

    async def complete_attempt(self, job_id: str, child: dict, stage: str, attempt_no: int,
                               *, value=None, error=None) -> None:
        async with self.locked(job_id) as (conn, row):
            # Preserve a known result even if cancel races; it must never be published after cancellation.
            await conn.execute(
                "UPDATE generation_attempts SET state=$1,result=$2::jsonb,error=$3::jsonb,updated_at=NOW() "
                "WHERE job_id=$4 AND hotspot_id=$5 AND stage=$6 AND attempt_no=$7",
                "failed" if error else "completed", json.dumps(value) if value is not None else None,
                json.dumps(error) if error else None, job_id, child["hotspot_id"], stage, attempt_no,
            )
            if not row["cancel_requested"] and row["status"] not in TERMINAL:
                await self.emit(conn, job_id, message="阶段成果已保存")

    async def decision(self, confirmation_id: str) -> str | None:
        async with self.pool.acquire() as conn:
            return await conn.fetchval("SELECT action FROM generation_decisions WHERE id=$1", confirmation_id)

    async def record_failure(self, job_id: str, child: dict, error: dict) -> None:
        async with self.locked(job_id) as (conn, row):
            if row["cancel_requested"] or row["status"] in TERMINAL:
                return
            result = decoded(row["result"])
            if child["hotspot_id"] not in result["failed_hotspot_ids"]:
                result["failed_hotspot_ids"].append(child["hotspot_id"])
                result["warnings"].append(f"「{child['label']}」未完成，其余页面已保留")
            await self.emit(conn, job_id, result=result, error=error, status="running")

    async def commit_child(self, job_id: str, child: dict, frozen: dict, page: dict,
                           image_url: str | None, localized: list, warnings: list[str], pct: int) -> dict:
        async with self.locked(job_id) as (conn, row):
            if row["cancel_requested"] or row["status"] in TERMINAL:
                return {"cancelled": True}
            result = decoded(row["result"])
            existing = next((n for n in result["nodes"] if n["id"] == child["node_id"]), None)
            if existing:
                return existing
            hotspot = await conn.fetchrow(
                "SELECT * FROM hotspots WHERE id=$1 AND node_id=$2 FOR UPDATE", child["hotspot_id"], row["node_id"],
            )
            if not hotspot or hotspot["target_node_id"]:
                raise RuntimeError("generation_parent_changed")
            parent_before = await capture_before(conn, row["project_id"], row["node_id"])
            title = str(page.get("title") or child["label"])[:200]
            description = str(page.get("description") or "")[:20000]
            source_type = "text" if frozen.get("content_format") == "knowledge-v1" else "image"
            await conn.execute(
                "INSERT INTO nodes(id,project_id,parent_id,depth,title,description,source_type,image_url,status) "
                "VALUES($1,$2,$3,$4,$5,$6,$7,$8,'generated')",
                child["node_id"], row["project_id"], row["node_id"], frozen["depth"] + 1, title, description, source_type, image_url,
            )
            await conn.execute("UPDATE hotspots SET target_node_id=$1 WHERE id=$2", child["node_id"], child["hotspot_id"])
            parent_scene = decoded(await conn.fetchval("SELECT scene_document FROM nodes WHERE id=$1", row["node_id"]))
            if parent_scene and frozen.get("content_format") == "knowledge-v1":
                for section in parent_scene.get("sections", []):
                    if section.get("hotspot_id") == child["hotspot_id"]:
                        section["target_node_id"] = child["node_id"]
                await conn.execute("UPDATE nodes SET scene_document=$1::jsonb WHERE id=$2", json.dumps(parent_scene), row["node_id"])
            scene, hotspots, metadata = await self.commit_content(conn, child["node_id"], frozen, page, localized,
                                                                  decoded(row["provider_config"]))
            node = {"id": child["node_id"], "parent_id": row["node_id"], "depth": frozen["depth"] + 1,
                    "title": title, "description": description, "source_type": source_type, "scene_document": scene,
                    "image_url": image_url, "status": "generated", "hotspots": hotspots, "children": [],
                    "hotspot_id": child["hotspot_id"]}
            if metadata is not None:
                node["content_metadata"] = metadata
            await record_changes(conn, row["project_id"], [(row["node_id"], parent_before), (child["node_id"], None)], "generation")
            result["nodes"].append(node)
            result["warnings"].extend(warnings)
            await conn.execute("UPDATE projects SET updated_at=NOW() WHERE id=$1", row["project_id"])
            await self.emit(conn, job_id, result=result, pct=pct, status="running", phase="commit", message=f"「{title}」已保存")
            return node

    async def finish(self, job_id: str) -> dict:
        async with self.locked(job_id) as (conn, row):
            if row["status"] in TERMINAL:
                return snapshot(row)
            result = decoded(row["result"])
            status = "succeeded" if not result["failed_hotspot_ids"] else ("partial" if result["nodes"] else "failed")
            await conn.execute(
                "UPDATE nodes SET status=$1,updated_at=NOW() WHERE id=$2",
                "completed" if status == "succeeded" else row["previous_status"], row["node_id"],
            )
            return await self.emit(conn, job_id, status=status, phase="done", pct=100, message={
                "succeeded": "全部子页面已保存", "partial": "部分子页面已保存，失败的热点可以重新生成", "failed": "本次没有完成子页面，现有内容已保留",
            }[status], confirmation=None, required_credentials=[])

    def notify(self, job_id: str, topic: str, message: dict, confirmation_id: str | None = None, action: str | None = None) -> dict:
        with self.engine.begin() as conn:
            initial = conn.execute(text("SELECT project_id,node_id FROM generation_jobs WHERE id=:jid"), {"jid": job_id}).mappings().first()
            if not initial:
                raise HTTPException(404, "生成任务不存在")
            conn.execute(text("SELECT id FROM projects WHERE id=:pid FOR UPDATE"), {"pid": initial["project_id"]})
            conn.execute(text("SELECT id FROM nodes WHERE id=:nid FOR UPDATE"), {"nid": initial["node_id"]})
            row = conn.execute(text("SELECT * FROM generation_jobs WHERE id=:jid FOR UPDATE"), {"jid": job_id}).mappings().one()
            if row["status"] in TERMINAL:
                if action:
                    raise HTTPException(409, "任务已结束，此确认已失效")
                return snapshot(row)
            if action:
                confirmation = decoded(row["confirmation"])
                decision = conn.execute(text("SELECT * FROM generation_decisions WHERE id=:cid AND job_id=:jid FOR UPDATE"),
                                        {"cid": confirmation_id, "jid": job_id}).mappings().first()
                if decision and decision["action"]:
                    if decision["action"] == action:
                        return snapshot(row)
                    raise HTTPException(409, "此确认已由其他操作处理")
                if not confirmation or confirmation["id"] != confirmation_id or not decision:
                    raise HTTPException(409, "此确认已失效，请刷新任务状态")
                if action == "accept" and not confirmation["can_accept"]:
                    raise HTTPException(409, "当前阶段没有可以保留的成果")
                conn.execute(text("UPDATE generation_decisions SET action=:action,resolved_at=NOW() WHERE id=:cid"),
                             {"action": action, "cid": confirmation_id})
                conn.execute(text(
                    "UPDATE generation_attempts SET state=:state,updated_at=NOW() "
                    "WHERE job_id=:jid AND hotspot_id=:hid AND stage=:stage AND attempt_no=:attempt"
                ), {"state": "accepted" if action == "accept" else "retry_authorized", "jid": job_id,
                    "hid": decision["hotspot_id"], "stage": decision["stage"], "attempt": decision["attempt_no"]})
            self.client.send_in_transaction(conn, job_id, message, topic=topic,
                                            idempotency_key=confirmation_id if action else gen_id("wake_"))
            if action:
                conn.execute(text("UPDATE generation_jobs SET status='running',confirmation=NULL,required_credentials='[]',message='已收到继续指令' WHERE id=:jid"), {"jid": job_id})
            return self.sync_emit(conn, job_id)

    async def cancel(self, job_id: str) -> dict:
        async with self.locked(job_id) as (conn, row):
            if row["status"] in TERMINAL:
                return snapshot(row)
            await conn.execute("UPDATE nodes SET status=$1,updated_at=NOW() WHERE id=$2", row["previous_status"], row["node_id"])
            return await self.emit(conn, job_id, status="cancelled", phase="cancelled", message="已取消；已完成的页面保留，已发送请求可能仍计费",
                                   cancel_requested=True, confirmation=None, required_credentials=[])

    async def fail(self, job_id: str) -> dict:
        async with self.locked(job_id) as (conn, row):
            if row["status"] in TERMINAL:
                return snapshot(row)
            # A failed executor must never turn a possibly billed request into
            # an ordinary unlocked failure. It requires explicit cancellation;
            # regular unknown-outcome retry/accept uses the still-live workflow.
            unresolved = await conn.fetchval(
                "SELECT 1 FROM generation_attempts WHERE job_id=$1 AND state='started' LIMIT 1", job_id,
            )
            if unresolved:
                return await self.emit(conn, job_id, status="waiting_confirmation", phase="recovery",
                                       message="执行器中断，远端结果可能已计费；请先取消此任务，再明确决定是否重新生成",
                                       error={"code": "execution_recovery_required", "message": "未确认请求已保留保护，取消前不会再次调用"},
                                       confirmation={"id": f"recovery_{job_id}", "stage": "recovery", "hotspot_id": None,
                                                     "message": "执行器中断，未确认结果可能已计费；请核实后取消此任务再重建",
                                                     "can_accept": False, "accept_label": None, "can_retry": False},
                                       required_credentials=[])
            await conn.execute("UPDATE nodes SET status=$1,updated_at=NOW() WHERE id=$2", row["previous_status"], row["node_id"])
            result = decoded(row["result"])
            return await self.emit(conn, job_id, status="partial" if result["nodes"] else "failed", phase="done",
                                   message="生成任务中断；已有页面保留，请检查配置后重新生成未完成热点", pct=100,
                                   error={"code": "generation_interrupted", "message": "生成任务中断，已有页面已保留"},
                                   confirmation=None, required_credentials=[])
