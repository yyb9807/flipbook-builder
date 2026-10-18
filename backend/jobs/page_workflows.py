"""Additional workflows: old children-v1 step order is intentionally untouched."""
import asyncio
import base64
import hashlib

from dbos import DBOS

from agents.composition import build_image_prompt, normalize
from agents.hotspot_localization import HotspotLocalizationAgent, sanitize_hotspots
from agents.image_generation import ImageGenerationAgent
from agents.input_analysis import InputAnalysisAgent
from agents.knowledge import compose_knowledge
from agents.page_generation import STYLE_PROMPTS, PageGenerationAgent
from jobs import providers
from jobs.workflows import database_operation, read_decision, runtime
from storage import url_to_disk_path


def asset_bytes(url: str, expected_sha: str | None = None) -> bytes:
    path = url_to_disk_path(url)
    try:
        data = path.read_bytes() if path else b""
    except OSError:
        data = b""
    if not data or (expected_sha and hashlib.sha256(data).hexdigest() != expected_sha):
        raise providers.ProviderFailure("local_asset_unavailable", "已保存的图片缺失或已变化，原页面已保留，请检查本地存储", False)
    return data


async def perform_page(stage, config, frozen, page=None, image=None):
    settings = frozen["settings"]
    language = settings.get("language", "zh")
    if stage == "analyze":
        agent = InputAnalysisAgent(config)
        agent.safe_errors = True
        if frozen["source_type"] == "image":
            return await agent.analyze_image(base64.b64encode(asset_bytes(frozen["asset_url"], frozen["asset_sha256"])).decode(), language)
        return await agent.analyze_text(frozen["text"], language, style_desc=STYLE_PROMPTS.get(settings.get("visual_style"), STYLE_PROMPTS["encyclopedia"]),
                                        **({"content_format": "knowledge-v1"} if frozen.get("content_format") == "knowledge-v1" else {}))
    if stage == "plan":
        agent = PageGenerationAgent(config)
        agent.safe_errors = True
        knowledge = frozen.get("content_format") == "knowledge-v1"
        return await agent.generate(hotspot_label=frozen["subject"]["label"], parent_title=frozen["title"] if knowledge else frozen["parent_title"],
                                    parent_description=frozen["description"] if knowledge else frozen["parent_description"],
                                    visual_style=settings.get("visual_style", "encyclopedia"), language=language,
                                    **({"content_format": "knowledge-v1"} if frozen.get("content_format") == "knowledge-v1" else {}))
    if stage == "image":
        url = await ImageGenerationAgent(config).generate(prompt=page["image_prompt"], project_id=frozen["project_id"],
                                                          node_id=frozen["subject"]["node_id"], single_attempt=True,
                                                          use_cache=frozen["kind"] != "regenerate")
        data = asset_bytes(url)
        return {"url": url, "sha256": hashlib.sha256(data).hexdigest()}
    data = asset_bytes(image["url"], image.get("sha256"))
    agent = HotspotLocalizationAgent(config)
    agent.safe_errors = True
    topics = page.get("sub_topics") or page.get("main_objects_zh") or page.get("main_objects") or []
    raw = await agent.localize(base64.b64encode(data).decode(), topics, language)
    return sanitize_hotspots(raw.get("hotspots"), settings.get("max_hotspots_per_page", 3))


@DBOS.step(retries_allowed=False)
async def page_load(job_id):
    return await database_operation(lambda: runtime().store.input(job_id))


@DBOS.step(retries_allowed=False)
async def page_provider(job_id, stage, attempt_no, page=None, image=None):
    service = runtime()
    service.check_running()
    frozen = await database_operation(lambda: service.store.input(job_id))
    subject = frozen["subject"]
    # Local missing/corrupt assets are known failures, never a charge-confirmation loop.
    try:
        if stage == "analyze" and frozen.get("asset_url"):
            asset_bytes(frozen["asset_url"], frozen["asset_sha256"])
        if stage == "localize":
            asset_bytes(image["url"], image.get("sha256"))
    except providers.ProviderFailure as failure:
        gate = await database_operation(lambda: service.store.missing_asset_attempt(job_id, subject, stage, attempt_no))
        if gate is not None:
            return gate
        return {"state": "failed", "error": {"code": failure.code, "message": failure.message}}
    config = service.vault.get(job_id, "imggen" if stage == "image" else "llm")
    secrets = service.vault.secrets(job_id)
    gate = await database_operation(lambda: service.store.begin_attempt(job_id, subject, stage, attempt_no, config is not None))
    if gate["state"] != "invoke":
        return gate
    try:
        service.check_running()
        result = await perform_page(stage, config, frozen, page, image)
        if stage in {"analyze", "plan"} and frozen.get("content_format") == "knowledge-v1":
            result = compose_knowledge(result, STYLE_PROMPTS.get(frozen["settings"].get("visual_style"), STYLE_PROMPTS["encyclopedia"]))
    except Exception as exc:
        failure = exc if isinstance(exc, providers.ProviderFailure) else providers.public_failure(exc)
        if failure.unknown:
            return await database_operation(lambda: service.store.begin_attempt(job_id, subject, stage, attempt_no, False))
        error = {"code": failure.code, "message": failure.message}
        await database_operation(lambda: service.store.complete_attempt(job_id, subject, stage, attempt_no, error=error))
        return {"state": "failed", "error": error}
    service.check_running()
    result = providers.redact(result, secrets)
    await database_operation(lambda: service.store.complete_attempt(job_id, subject, stage, attempt_no, value=result))
    return {"state": "completed", "value": result}


async def run_page_provider(job_id, stage, page=None, image=None):
    attempt = 0
    while True:
        result = await page_provider(job_id, stage, attempt, page, image)
        if result["state"] in {"completed", "failed", "cancelled"}:
            return result
        if result["state"] == "need_credentials":
            await DBOS.recv_async(topic="credentials", timeout_seconds=86400)
            continue
        action = await read_decision(result["confirmation_id"])
        while action is None:
            await DBOS.recv_async(topic="decision", timeout_seconds=86400)
            action = await read_decision(result["confirmation_id"])
        if action == "accept":
            return {"state": "accepted"}
        attempt += 1


@DBOS.step(retries_allowed=False)
async def page_compose(job_id, analysis):
    frozen = await database_operation(lambda: runtime().store.input(job_id))
    page = dict(analysis)
    # Composition is a separately checkpointed pure transformation, no provider retry.
    if frozen["kind"] == "analyze":
        page["composition_type"] = normalize(page.get("composition_type"))
        topics = page.get("main_objects") or []
        style = STYLE_PROMPTS.get(frozen["settings"].get("visual_style"), STYLE_PROMPTS["encyclopedia"])
        page["image_prompt"] = build_image_prompt(page["composition_type"], str(page.get("subject_en") or page.get("summary") or frozen.get("text") or "Knowledge"), topics, style)
        extra = frozen.get("keywords") or []
        page["main_objects_zh"] = list(dict.fromkeys(extra + (page.get("main_objects_zh") or topics)))[:50]
    else:
        page["image_prompt"] = str(page.get("image_prompt") or frozen["subject"]["label"])[:20000]
    return page


@DBOS.step(retries_allowed=False)
async def uploaded_localization(job_id, page):
    frozen = await database_operation(lambda: runtime().store.input(job_id))
    return sanitize_hotspots(page.get("hotspots"), frozen["settings"].get("max_hotspots_per_page", 3))


@DBOS.step(retries_allowed=False)
async def page_fail(job_id, error):
    result = await database_operation(lambda: runtime().store.finish_page_failure(job_id, error))
    runtime().vault.discard(job_id)
    return result


@DBOS.step(retries_allowed=False)
async def page_commit(job_id, frozen, page, image, localized, warnings):
    runtime().check_running()
    # No checkpoint publishes a URL whose underlying completed asset disappeared.
    if image:
        try:
            asset_bytes(image["url"], image.get("sha256"))
        except providers.ProviderFailure as failure:
            error = {"code": failure.code, "message": failure.message}
            result = await database_operation(lambda: runtime().store.finish_page_failure(job_id, error))
            runtime().vault.discard(job_id)
            return result
    result = await database_operation(lambda: runtime().store.commit_page(job_id, frozen, page, image["url"] if image else None, localized, warnings))
    runtime().vault.discard(job_id)
    return result


async def run_page(job_id, kind):
    service = runtime()
    task = asyncio.current_task()
    service.tasks.add(task)
    service.job_tasks[job_id] = task
    try:
        frozen = await page_load(job_id)
        first = await run_page_provider(job_id, "analyze" if kind == "analyze" else "plan")
        if first["state"] == "cancelled":
            return {"cancelled": True}
        if first["state"] == "failed":
            return await page_fail(job_id, first["error"])
        page = await page_compose(job_id, first["value"])
        warnings = []
        image = None
        if kind == "analyze" and frozen.get("asset_url"):
            image = {"url": frozen["asset_url"], "sha256": frozen["asset_sha256"]}
        elif kind == "regenerate" and frozen.get("old_image_url"):
            image = {"url": frozen["old_image_url"], "sha256": frozen["old_image_sha256"]}
        if frozen["image_requested"] and not (kind == "analyze" and frozen["source_type"] == "image"):
            generated = await run_page_provider(job_id, "image", page)
            if generated["state"] == "cancelled":
                return {"cancelled": True}
            if generated["state"] == "completed":
                image = generated["value"]
            elif kind == "regenerate":
                return await page_fail(job_id, generated.get("error") or {"code": "generation_not_completed", "message": "图片未完成，原页面已保留"})
            else:
                warnings.append("封面图片未完成，已保留分析文字")
        localized = []
        if image and frozen.get("content_format") != "knowledge-v1":
            if kind == "analyze" and frozen["source_type"] == "image" and "hotspots" in page:
                localized = await uploaded_localization(job_id, page)
            else:
                located = await run_page_provider(job_id, "localize", page, image)
                if located["state"] == "cancelled":
                    return {"cancelled": True}
                if located["state"] == "completed":
                    localized = located["value"]
                elif located.get("error", {}).get("code") == "local_asset_unavailable":
                    return await page_fail(job_id, located["error"])
            if not localized:
                warnings.append("未定位到可用热点，请手动添加")
        return await page_commit(job_id, frozen, page, image, localized, warnings)
    finally:
        service.tasks.discard(task)
        if service.job_tasks.get(job_id) is task:
            service.job_tasks.pop(job_id, None)


@DBOS.workflow(name="root-analysis-v1")
async def analyze_root_workflow(job_id: str):
    return await run_page(job_id, "analyze")


@DBOS.workflow(name="regenerate-v1")
async def regenerate_page_workflow(job_id: str):
    return await run_page(job_id, "regenerate")
