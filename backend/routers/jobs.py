import asyncio
import hashlib
import json
import re
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from agents.base import get_imggen_config, get_llm_config
from jobs.models import TERMINAL, CreateJobBody, CreatePageJobBody, ResolveJobBody
from storage import MAX_IMAGE_BYTES, normalize_image, save_normalized_image

router = APIRouter()


def get_jobs(request: Request):
    service = getattr(request.app.state, "jobs", None)
    if service is None or service.stopping:
        raise HTTPException(503, "持久生成服务暂不可用")
    return service


@router.post("/projects/{project_id}/nodes/{node_id}/generation-jobs", status_code=202)
async def create_job(project_id: str, node_id: str, body: CreateJobBody, request: Request, service=Depends(get_jobs)):
    return await service.submit(project_id, node_id, body, get_llm_config(request), get_imggen_config(request))


@router.get("/projects/{project_id}/jobs")
async def list_jobs(project_id: str, active: bool = True, operation_id: str | None = Query(None, max_length=100), service=Depends(get_jobs)):
    return {"jobs": await service.store.list(project_id, active, operation_id)}


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, service=Depends(get_jobs)):
    return await service.store.get(job_id)


@router.get("/jobs/{job_id}/events")
async def job_events(job_id: str, request: Request, after: int = Query(0, ge=0), service=Depends(get_jobs)):
    await service.store.get(job_id)
    header = request.headers.get("last-event-id")
    if header:
        try:
            after = max(after, int(header))
        except ValueError as exc:
            raise HTTPException(400, "事件游标无效") from exc
        if int(header) < 0:
            raise HTTPException(400, "事件游标无效")

    async def stream():
        cursor = after
        idle = 0
        while not await request.is_disconnected():
            events = await service.store.events(job_id, cursor)
            for event in events:
                cursor = event["id"]
                yield f"id: {cursor}\ndata: {json.dumps(event['snapshot'], ensure_ascii=False)}\n\n"
            current = await service.store.get(job_id)
            if current["status"] in TERMINAL and cursor >= current["last_event_id"]:
                return
            idle += 1
            if idle % 20 == 0:
                yield ": keepalive\n\n"
            await asyncio.sleep(0.25)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache", "X-Accel-Buffering": "no",
    })


@router.post("/jobs/{job_id}/credentials")
async def credentials(job_id: str, request: Request, service=Depends(get_jobs)):
    if not any(header in request.headers for header in ("x-llm-api-key", "x-imggen-api-key")):
        raise HTTPException(400, "恢复任务时请显式提供 API Key")
    return await service.provide_credentials(job_id, get_llm_config(request), get_imggen_config(request))


@router.post("/jobs/{job_id}/retry")
async def retry(job_id: str, body: ResolveJobBody, service=Depends(get_jobs)):
    return await service.resolve(job_id, body.confirmation_id, "retry")


@router.post("/jobs/{job_id}/accept")
async def accept(job_id: str, body: ResolveJobBody, service=Depends(get_jobs)):
    return await service.resolve(job_id, body.confirmation_id, "accept")


@router.post("/jobs/{job_id}/cancel")
async def cancel(job_id: str, service=Depends(get_jobs)):
    return await service.cancel(job_id)


async def submit_analysis(request, project_id, operation_id, file, text, keywords, file_sha256, generate_images):
    try:
        command = CreatePageJobBody(operation_id=operation_id, generate_images=generate_images)
    except ValidationError as exc:
        raise HTTPException(422, "生成操作 ID 或参数无效") from exc
    text = (text or "").strip()
    if len(text) > 20000:
        raise HTTPException(422, "文字内容最多 20000 字符")
    terms = list(dict.fromkeys(word.strip() for word in (keywords or "").split(",") if word.strip()))
    if len(terms) > 50 or any(len(term) > 200 for term in terms):
        raise HTTPException(422, "关键词最多 50 个，每项最多 200 字符")
    if file_sha256 and not re.fullmatch(r"[a-f0-9]{64}", file_sha256):
        raise HTTPException(422, "文件摘要无效")
    service = getattr(getattr(request.scope.get("app"), "state", None), "jobs", None)
    existing = await service.store.list(project_id, False, command.operation_id) if service else []
    data = None
    raw_hash = None
    if file and file.filename:
        contents = bytearray()
        while chunk := await file.read(1024 * 1024):
            contents.extend(chunk)
            if len(contents) > MAX_IMAGE_BYTES:
                raise HTTPException(413, "图片文件超过 20 MB 上限")
        raw_hash = hashlib.sha256(contents).hexdigest()
        if file_sha256 and file_sha256 != raw_hash:
            raise HTTPException(409, "重新选择的图片与原操作不一致，请发起新的操作")
        try:
            data = normalize_image(bytes(contents))
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
    elif file_sha256:
        if not existing:
            raise HTTPException(422, "首次提交需要上传原文件")
        frozen = await service.store.input(existing[0]["job_id"])
        if (frozen.get("file_sha256") != file_sha256 or frozen.get("text") != text
                or frozen.get("keywords") != terms or existing[0]["kind"] != "analyze"):
            raise HTTPException(409, "同一操作 ID 的文件或文字输入不同")
        return await service.submit_page(project_id, None, command.operation_id, "analyze", frozen,
                                         command.generate_images, get_llm_config(request), get_imggen_config(request))
    if data is None and not text:
        raise HTTPException(400, "请上传图片或填写文字内容")
    service = get_jobs(request)
    # A project must exist before filesystem storage. Hashes are independent of URL.
    input_hash = hashlib.sha256(data if data is not None else text.encode()).hexdigest()
    payload = {"identity": {"input_sha256": input_hash, "file_sha256": raw_hash, "text": text, "keywords": terms},
               "text": text, "keywords": terms, "file_sha256": raw_hash,
               "filename": Path(file.filename).name[:200] if file and file.filename else None}
    if data is not None:
        frozen = await service.store.input(existing[0]["job_id"]) if existing else {}
        # Reuse only exact content; mismatched inputs are rejected by store fingerprint.
        url = frozen.get("asset_url") if frozen.get("asset_sha256") == input_hash else None
        if not url:
            url = await save_normalized_image(project_id, "root-input.png", data)
        payload.update({"asset_url": url, "asset_sha256": input_hash})
    return await service.submit_page(project_id, None, command.operation_id, "analyze", payload,
                                     command.generate_images, get_llm_config(request), get_imggen_config(request))


@router.post("/projects/{project_id}/analysis-jobs", status_code=202)
async def create_analysis_job(
    project_id: str, request: Request, operation_id: str = Form(...), file: UploadFile | None = File(None),
    text: str | None = Form(None), keywords: str | None = Form(None), file_sha256: str | None = Form(None),
    generate_images: bool | None = Form(None),
):
    return await submit_analysis(request, project_id, operation_id, file, text, keywords, file_sha256, generate_images)


@router.post("/projects/{project_id}/nodes/{node_id}/regeneration-jobs", status_code=202)
async def create_regeneration_job(project_id: str, node_id: str, body: CreatePageJobBody, request: Request, service=Depends(get_jobs)):
    return await service.submit_page(project_id, node_id, body.operation_id, "regenerate", {"identity": {}},
                                     body.generate_images, get_llm_config(request), get_imggen_config(request))
