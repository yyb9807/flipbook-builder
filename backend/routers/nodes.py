import asyncio
import json
from typing import Annotated, Literal

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from agents.base import get_imggen_config, get_llm_config
from content_metadata import ContentMetadata, public_content_metadata, validate_section_references
from database import get_pool
from hotspots import insert_hotspots, public_hotspot, synchronize_scene_sections
from jobs.locking import lock_project_write
from sse import _sse
from utils import gen_id
from version_history import capture_before, record_changes

router = APIRouter()


class SceneSection(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    id: str = Field(min_length=1, max_length=100)
    title: str = Field(max_length=200)
    body: str = Field(max_length=5000)
    hotspot_id: str | None = Field(default=None, min_length=1, max_length=160)
    target_node_id: str | None = Field(default=None, min_length=1, max_length=160)
    reference_ids: list[Annotated[str, StringConstraints(min_length=1, max_length=100)]] = Field(
        default_factory=list, max_length=6,
    )

    @model_validator(mode="after")
    def unique_references(self):
        if len(set(self.reference_ids)) != len(self.reference_ids):
            raise ValueError("正文区块不能重复关联同一条参考资料")
        return self


class SceneDocument(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    version: int = Field(ge=1, le=1)
    layout: Literal["atlas", "sequence"]
    sections: list[SceneSection] = Field(max_length=12)

    @model_validator(mode="after")
    def unique_sections(self):
        if len({section.id for section in self.sections}) != len(self.sections):
            raise ValueError("页面分区 id 不能重复")
        hotspot_ids = [section.hotspot_id for section in self.sections if section.hotspot_id]
        if len(set(hotspot_ids)) != len(hotspot_ids):
            raise ValueError("页面分区不能重复引用同一个热点")
        return self


class NodeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=20_000)
    scene_document: SceneDocument | None = None
    content_metadata: ContentMetadata | None = None
    expected_revision: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def valid_patch(self):
        if not (self.model_fields_set - {"expected_revision"}):
            raise ValueError("请提供需要修改的页面内容")
        for field in ("title", "description", "content_metadata"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} 不能为 null")
        return self


@router.patch("/projects/{project_id}/nodes/{node_id}")
async def update_node(
    project_id: str,
    node_id: str,
    body: NodeUpdate,
    pool: asyncpg.Pool = Depends(get_pool),
):
    async with pool.acquire() as conn, conn.transaction():
        await lock_project_write(conn, project_id, expected_revision=body.expected_revision)
        node = await conn.fetchrow(
            "SELECT * FROM nodes WHERE id = $1 AND project_id = $2 FOR UPDATE", node_id, project_id
        )
        if not node:
            raise HTTPException(404, "节点不存在")
        if node["status"] == "generating":
            raise HTTPException(409, "页面正在生成，请稍后编辑")
        before = await capture_before(conn, project_id, node_id)
        scene = None
        saved_hotspots = None
        if "scene_document" in body.model_fields_set:
            scene = body.scene_document.model_dump(exclude_none=True, exclude_unset=True) if body.scene_document else None
            scene, saved_hotspots = await synchronize_scene_sections(conn, node_id, scene, node.get("scene_document"))
        original_metadata = public_content_metadata(node.get("content_metadata"))
        metadata = original_metadata
        if body.content_metadata is not None:
            metadata = body.content_metadata.model_dump(exclude_none=True)
            original_provenance = (original_metadata or {}).get("provenance")
            if "provenance" in body.content_metadata.model_fields_set:
                if metadata.get("provenance") != original_provenance:
                    raise HTTPException(400, "生成说明由服务端记录，不能通过编辑伪造或删除")
            if original_provenance:
                metadata["provenance"] = original_provenance
        elif original_metadata and any(field in body.model_fields_set for field in ("title", "description", "scene_document")):
            # A same-batch explicit author declaration can mark edited content as
            # reviewed. Without it, a previous declaration never survives edits.
            changed = any(getattr(body, field) != node.get(field) for field in ("title", "description")
                          if field in body.model_fields_set)
            previous_scene = node.get("scene_document")
            if isinstance(previous_scene, str):
                previous_scene = json.loads(previous_scene)
            changed = changed or ("scene_document" in body.model_fields_set and scene != previous_scene)
            if changed:
                metadata = {**original_metadata, "review_status": "unreviewed"}
        effective_scene = scene if "scene_document" in body.model_fields_set else node.get("scene_document")
        if isinstance(effective_scene, str):
            effective_scene = json.loads(effective_scene)
        try:
            validate_section_references(effective_scene, metadata)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        values = []
        sets = []
        for field in ("title", "description", "scene_document"):
            if field in body.model_fields_set:
                value = getattr(body, field)
                if field == "scene_document":
                    value = json.dumps(scene, ensure_ascii=False) if scene is not None else None
                values.append(value)
                cast = "::jsonb" if field == "scene_document" else ""
                sets.append(f"{field} = ${len(values)}{cast}")
        if "content_metadata" in body.model_fields_set or metadata != original_metadata:
            values.append(json.dumps(metadata, ensure_ascii=False) if metadata is not None else None)
            sets.append(f"content_metadata = ${len(values)}::jsonb")
        values.extend([node_id, project_id])
        updated = await conn.fetchrow(
            f"UPDATE nodes SET {', '.join(sets)}, updated_at = NOW() "
            f"WHERE id = ${len(values)-1} AND project_id = ${len(values)} "
            "RETURNING id, title, description, scene_document, content_metadata", *values,
        )
        await conn.execute("UPDATE projects SET updated_at = NOW() WHERE id = $1", project_id)
        if saved_hotspots is None:
            saved_hotspots = [public_hotspot(hotspot) for hotspot in await conn.fetch(
                "SELECT * FROM hotspots WHERE node_id = $1 ORDER BY sort_order", node_id)]
        revision = await record_changes(conn, project_id, [(node_id, before)], "edit")
    result = dict(updated)
    if isinstance(result.get("scene_document"), str):
        result["scene_document"] = json.loads(result["scene_document"])
    result["content_metadata"] = public_content_metadata(result.get("content_metadata"))
    result["hotspots"] = saved_hotspots
    result["project_revision"] = revision
    return result


class HotspotUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=160)
    label: str | None = Field(default=None, max_length=200)
    selected: bool | None = None
    pos_x: float | None = Field(default=None, ge=0, le=1)
    pos_y: float | None = Field(default=None, ge=0, le=1)
    width: float | None = Field(default=None, gt=0, le=1)
    height: float | None = Field(default=None, gt=0, le=1)


class UpdateHotspotsBody(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    hotspots: list[HotspotUpdate] = Field(max_length=100)
    expected_revision: int | None = Field(default=None, ge=0)


class HotspotCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    label: str = Field(min_length=1, max_length=200)
    pos_x: float = Field(ge=0, le=1)
    pos_y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)
    expected_revision: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def inside_image(self):
        if self.pos_x + self.width > 1.000001 or self.pos_y + self.height > 1.000001:
            raise ValueError("热点区域必须完整位于图片内")
        if not self.label.strip():
            raise ValueError("请填写热点名称")
        return self


@router.post("/projects/{project_id}/nodes/{node_id}/hotspots", status_code=201)
async def create_hotspot(
    project_id: str, node_id: str, body: HotspotCreate, pool: asyncpg.Pool = Depends(get_pool),
):
    async with pool.acquire() as conn, conn.transaction():
        await lock_project_write(conn, project_id, expected_revision=body.expected_revision)
        node = await conn.fetchrow(
            "SELECT id, status, scene_document FROM nodes WHERE id = $1 AND project_id = $2 FOR UPDATE", node_id, project_id
        )
        if not node:
            raise HTTPException(404, "节点不存在")
        if node["status"] == "generating":
            raise HTTPException(409, "页面正在生成，请稍后添加热点")
        if node.get("scene_document") is not None:
            raise HTTPException(409, "页面使用结构化正文，请添加内容区块作为分支起点")
        count = await conn.fetchval("SELECT COUNT(*) FROM hotspots WHERE node_id = $1", node_id)
        if count >= 12:
            raise HTTPException(400, "每个页面最多添加 12 个热点")
        before = await capture_before(conn, project_id, node_id)
        result = await insert_hotspots(conn, node_id, [{
            "label": body.label.strip(), "x": body.pos_x, "y": body.pos_y,
            "width": body.width, "height": body.height, "score": None,
        }], selected=True, sort_offset=count)
        await conn.execute("UPDATE projects SET updated_at = NOW() WHERE id = $1", project_id)
        revision = await record_changes(conn, project_id, [(node_id, before)], "hotspot_added")
    result[0]["project_revision"] = revision
    return result[0]


@router.patch("/projects/{project_id}/nodes/{node_id}/hotspots")
async def update_hotspots(
    project_id: str,
    node_id: str,
    body: UpdateHotspotsBody,
    pool: asyncpg.Pool = Depends(get_pool),
):
    async with pool.acquire() as conn, conn.transaction():
        await lock_project_write(conn, project_id, expected_revision=body.expected_revision)
        node = await conn.fetchrow(
            "SELECT id, status, scene_document, content_metadata FROM nodes WHERE id = $1 AND project_id = $2 FOR UPDATE", node_id, project_id
        )
        if not node:
            raise HTTPException(404, "节点不存在")
        if node["status"] == "generating":
            raise HTTPException(409, "页面正在生成，请稍后编辑")

        ids = [hotspot.id for hotspot in body.hotspots]
        if len(set(ids)) != len(ids):
            raise HTTPException(400, "同一热点不能重复提交")
        existing = await conn.fetch(
            "SELECT * FROM hotspots WHERE node_id = $1 AND id = ANY($2::text[]) FOR UPDATE", node_id, ids
        )
        existing_by_id = {hotspot["id"]: hotspot for hotspot in existing}
        if any(hotspot_id not in existing_by_id for hotspot_id in ids):
            raise HTTPException(404, "热点不存在或不属于当前页面")
        for upd in body.hotspots:
            previous = existing_by_id[upd.id]
            x = upd.pos_x if upd.pos_x is not None else previous["pos_x"]
            y = upd.pos_y if upd.pos_y is not None else previous["pos_y"]
            width = upd.width if upd.width is not None else previous["width"]
            height = upd.height if upd.height is not None else previous["height"]
            changes_geometry = bool({"pos_x", "pos_y", "width", "height"} & upd.model_fields_set)
            if previous.get("kind", "image") == "section":
                if changes_geometry:
                    raise HTTPException(400, "内容区块连接没有图片位置或尺寸")
                if upd.label is not None and not upd.label.strip():
                    raise HTTPException(400, "请填写区块名称")
            if changes_geometry and (x + width > 1.000001 or y + height > 1.000001):
                raise HTTPException(400, "热点区域必须完整位于图片内")
        before = await capture_before(conn, project_id, node_id)
        for upd in body.hotspots:
            # 构建动态 UPDATE
            sets = []
            vals = []
            if upd.label is not None:
                sets.append(f"label = ${len(vals)+1}")
                vals.append(upd.label)
            if upd.selected is not None:
                sets.append(f"selected = ${len(vals)+1}")
                vals.append(upd.selected)
            if upd.pos_x is not None:
                sets.append(f"pos_x = ${len(vals)+1}")
                vals.append(upd.pos_x)
            if upd.pos_y is not None:
                sets.append(f"pos_y = ${len(vals)+1}")
                vals.append(upd.pos_y)
            if upd.width is not None:
                sets.append(f"width = ${len(vals)+1}")
                vals.append(upd.width)
            if upd.height is not None:
                sets.append(f"height = ${len(vals)+1}")
                vals.append(upd.height)

            if sets:
                vals.append(upd.id)
                vals.append(node_id)
                await conn.execute(
                    f"UPDATE hotspots SET {', '.join(sets)} WHERE id = ${len(vals)-1} AND node_id = ${len(vals)}",
                    *vals,
                )
        metadata = public_content_metadata(node.get("content_metadata"))
        renamed = {upd.id: upd.label for upd in body.hotspots
                   if upd.label is not None and upd.label != existing_by_id[upd.id].get("label")}
        if renamed:
            renamed_sections = {hotspot_id: label for hotspot_id, label in renamed.items()
                                if existing_by_id[hotspot_id].get("kind", "image") == "section"}
            raw_scene = node.get("scene_document")
            scene = json.loads(raw_scene) if isinstance(raw_scene, str) else raw_scene
            if renamed_sections and scene:
                for section in scene.get("sections", []):
                    if section.get("hotspot_id") in renamed_sections:
                        section["title"] = renamed_sections[section["hotspot_id"]]
                await conn.execute("UPDATE nodes SET scene_document = $1::jsonb WHERE id = $2",
                                   json.dumps(scene, ensure_ascii=False), node_id)
            # Labels are page content in both image and section modes. Only an
            # actual rename invalidates an author's earlier review declaration.
            await conn.execute("UPDATE nodes SET content_metadata = CASE WHEN content_metadata IS NULL THEN NULL ELSE "
                               "jsonb_set(content_metadata, '{review_status}', '\"unreviewed\"'::jsonb) END, "
                               "updated_at = NOW() WHERE id = $1", node_id)
            if metadata is not None:
                metadata = {**metadata, "review_status": "unreviewed"}
        await conn.execute("UPDATE projects SET updated_at = NOW() WHERE id = $1", project_id)
        revision = await record_changes(conn, project_id, [(node_id, before)], "hotspot_edit")

    return {"status": "ok", "content_metadata": metadata, "project_revision": revision}


class GenerateChildrenBody(BaseModel):
    selected_keywords: list[Annotated[str, StringConstraints(max_length=200)]] = Field(default_factory=list, max_length=50)


def _durable_children_response(request: Request, service, job: dict) -> StreamingResponse:
    from jobs.models import TERMINAL

    async def durable_stream():
        cursor = 0
        idle = 0
        while not await request.is_disconnected():
            for event in await service.store.events(job["job_id"], cursor):
                cursor = event["id"]
                state = event["snapshot"]
                if state["status"] in TERMINAL:
                    payload = {"job_id": job["job_id"], "done": True, **state["result"]}
                    if state["status"] in {"failed", "cancelled"}:
                        payload["error"] = state["message"]
                    yield _sse(payload)
                    return
                yield _sse({"job_id": job["job_id"], "step": 2, "pct": state["pct"], "message": state["message"]})
            idle += 1
            if idle % 80 == 0:
                yield ": keepalive\n\n"
            await asyncio.sleep(0.25)

    return StreamingResponse(durable_stream(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"})


@router.post("/projects/{project_id}/nodes/{node_id}/generate-children")
async def generate_children(
    project_id: str,
    node_id: str,
    request: Request,
    body: GenerateChildrenBody = GenerateChildrenBody(),
    pool: asyncpg.Pool = Depends(get_pool),
):
    llm_config = get_llm_config(request)
    imggen_config = get_imggen_config(request)
    service = getattr(getattr(request.scope.get("app"), "state", None), "jobs", None)
    operation_id = request.headers.get("x-operation-id")
    if service is not None and operation_id:
        # Stable operation replay precedes every mutable node/hotspot precheck.
        from pydantic import ValidationError

        from jobs.models import CreateJobBody
        try:
            command = CreateJobBody(operation_id=operation_id, selected_keywords=body.selected_keywords)
        except ValidationError as exc:
            raise HTTPException(422, "生成操作 ID 或关键词无效") from exc
        job = await service.submit(project_id, node_id, command, llm_config, imggen_config)
        return _durable_children_response(request, service, job)

    # 验证和预读（必须在 generator 外完成）
    async with pool.acquire() as conn:
        project = await conn.fetchrow("SELECT * FROM projects WHERE id = $1", project_id)
        if not project:
            raise HTTPException(404, "项目不存在")
        node = await conn.fetchrow(
            "SELECT * FROM nodes WHERE id = $1 AND project_id = $2", node_id, project_id
        )
        if not node:
            raise HTTPException(404, "节点不存在")
        settings = json.loads(project["settings"]) if isinstance(project["settings"], str) else project["settings"]
        max_depth = settings.get("max_depth", 4)
        if node["depth"] >= max_depth:
            raise HTTPException(400, f"已达到最大深度 {max_depth}")
        selected_hotspots = await conn.fetch(
            "SELECT * FROM hotspots WHERE node_id = $1 AND selected = true ORDER BY sort_order",
            node_id,
        )

    if not selected_hotspots:
        raise HTTPException(400, "没有选中的热点")
    if node["status"] == "generating":
        raise HTTPException(409, "这个页面正在生成，请等待当前任务结束")

    service = getattr(getattr(request.scope.get("app"), "state", None), "jobs", None)
    if service is not None:
        # Legacy clients keep their SSE payload. Execution belongs to DBOS;
        # closing this subscription never cancels the durable business job.
        if all(hotspot["target_node_id"] for hotspot in selected_hotspots):
            async def already_done():
                yield _sse({"done": True, "nodes": []})
            return StreamingResponse(already_done(), media_type="text/event-stream")
        from jobs.models import CreateJobBody
        job = await service.submit(project_id, node_id, CreateJobBody(
            operation_id=request.headers.get("x-operation-id") or gen_id("legacy_"),
            selected_keywords=body.selected_keywords,
        ), llm_config, imggen_config)

        return _durable_children_response(request, service, job)

    raise HTTPException(503, "持久生成服务暂不可用；没有调用模型")


@router.post("/projects/{project_id}/nodes/{node_id}/regenerate", status_code=202)
async def regenerate_node(project_id: str, node_id: str, request: Request):
    """Legacy address, asynchronous 202 protocol; use job events for completion."""
    from jobs.models import CreatePageJobBody
    from routers.jobs import get_jobs
    service = get_jobs(request)
    try:
        body = await request.json()
    except (ValueError, RuntimeError):
        body = {}
    if not isinstance(body, dict):
        raise HTTPException(422, "生成参数无效")
    from pydantic import ValidationError
    try:
        command = CreatePageJobBody(operation_id=body.pop("operation_id", None) or request.headers.get("x-operation-id") or gen_id("legacy_"), **body)
    except ValidationError as exc:
        raise HTTPException(422, "生成参数无效") from exc
    return await service.submit_page(project_id, node_id, command.operation_id, "regenerate", {"identity": {}},
                                     command.generate_images, get_llm_config(request), get_imggen_config(request))
