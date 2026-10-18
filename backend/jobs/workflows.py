"""Deterministic async orchestration; every remote stage has a business intent too."""
import asyncio

import asyncpg
from dbos import DBOS

from agents.knowledge import KnowledgeFormatError, compose_knowledge
from agents.page_generation import STYLE_PROMPTS
from jobs import providers

SERVICE = None


def runtime():
    if SERVICE is None:
        raise RuntimeError("durable_service_not_initialized")
    return SERVICE


async def database_operation(operation):
    """Retry local I/O only. Never wrap or reissue a provider request here."""
    while True:
        runtime().check_running()
        try:
            return await operation()
        except (asyncpg.PostgresConnectionError, asyncpg.CannotConnectNowError,
                asyncpg.SerializationError, asyncpg.DeadlockDetectedError, OSError, TimeoutError):
            await asyncio.sleep(0.5)


@DBOS.step(retries_allowed=False)
async def load_input(job_id: str) -> dict:
    return await database_operation(lambda: runtime().store.input(job_id))


@DBOS.step(retries_allowed=False)
async def provider_step(job_id: str, child_index: int, stage: str, attempt_no: int,
                        page: dict | None = None, image_url: str | None = None) -> dict:
    service = runtime()
    service.check_running()
    frozen = await database_operation(lambda: service.store.input(job_id))
    child = frozen["children"][child_index]
    config = service.vault.get(job_id, "imggen" if stage == "image" else "llm")
    secrets = service.vault.secrets(job_id)
    gate = await database_operation(lambda: service.store.begin_attempt(job_id, child, stage, attempt_no, config is not None))
    if gate["state"] != "invoke":
        return gate
    try:
        service.check_running()
        state = await database_operation(lambda: service.store.get(job_id))
        result = await providers.perform(stage, config, frozen, child, page, image_url, state["project_id"])
        if stage == "plan" and frozen.get("content_format") == "knowledge-v1":
            result = compose_knowledge(result, STYLE_PROMPTS.get(frozen["settings"].get("visual_style"), STYLE_PROMPTS["encyclopedia"]))
    except (providers.ProviderFailure, KnowledgeFormatError) as exc:
        failure = exc if isinstance(exc, providers.ProviderFailure) else providers.public_failure(exc)
        if failure.unknown:
            return await database_operation(lambda: service.store.begin_attempt(job_id, child, stage, attempt_no, False))
        error = {"code": failure.code, "message": failure.message}
        await database_operation(lambda: service.store.complete_attempt(job_id, child, stage, attempt_no, error=error))
        return {"state": "failed", "error": error}
    except Exception:
        # Even an unexpected provider/adapter error must not be serialized by
        # DBOS with a raw request object or echoed credential attached.
        return await database_operation(lambda: service.store.begin_attempt(job_id, child, stage, attempt_no, False))
    service.check_running()
    result = providers.redact(result, secrets)
    await database_operation(lambda: service.store.complete_attempt(job_id, child, stage, attempt_no, value=result))
    return {"state": "completed", "value": result}


@DBOS.step(retries_allowed=False)
async def read_decision(confirmation_id: str) -> str | None:
    return await database_operation(lambda: runtime().store.decision(confirmation_id))


@DBOS.step(retries_allowed=False)
async def failure_step(job_id: str, child: dict, error: dict) -> None:
    await database_operation(lambda: runtime().store.record_failure(job_id, child, error))


@DBOS.step(retries_allowed=False)
async def commit_step(job_id: str, child: dict, frozen: dict, page: dict, image_url: str | None,
                      localized: list, warnings: list[str], pct: int) -> dict:
    runtime().check_running()
    return await database_operation(lambda: runtime().store.commit_child(job_id, child, frozen, page, image_url, localized, warnings, pct))


@DBOS.step(retries_allowed=False)
async def finish_step(job_id: str) -> dict:
    result = await database_operation(lambda: runtime().store.finish(job_id))
    runtime().vault.discard(job_id)
    return result


async def run_provider(job_id: str, index: int, stage: str, page=None, image_url=None) -> dict:
    attempt_no = 0
    while True:
        result = await provider_step(job_id, index, stage, attempt_no, page, image_url)
        if result["state"] in {"completed", "failed", "cancelled"}:
            return result
        if result["state"] == "need_credentials":
            # Only a notification is checkpointed, never credentials.
            await DBOS.recv_async(topic="credentials", timeout_seconds=86400)
            continue
        confirmation_id = result["confirmation_id"]
        action = await read_decision(confirmation_id)
        while action is None:
            await DBOS.recv_async(topic="decision", timeout_seconds=86400)
            action = await read_decision(confirmation_id)
        if action == "accept":
            return {"state": "accepted"}
        attempt_no += 1


@DBOS.workflow(name="children-v1")
async def generate_children_workflow(job_id: str) -> dict:
    service = runtime()
    task = asyncio.current_task()
    service.tasks.add(task)
    service.job_tasks[job_id] = task
    try:
        frozen = await load_input(job_id)
        for index, child in enumerate(frozen["children"]):
            planned = await run_provider(job_id, index, "plan")
            if planned["state"] == "cancelled":
                return {"cancelled": True}
            if planned["state"] == "failed":
                await failure_step(job_id, child, planned["error"])
                continue
            page = planned["value"]
            image_url = None
            localized = []
            warnings = []
            if frozen["image_requested"]:
                image = await run_provider(job_id, index, "image", page)
                if image["state"] == "cancelled":
                    return {"cancelled": True}
                if image["state"] == "completed":
                    image_url = image["value"]
                else:
                    warnings.append(f"「{child['label']}」保留文字页面，插图尚未完成")
            if image_url and frozen.get("content_format") != "knowledge-v1":
                localized_result = await run_provider(job_id, index, "localize", page, image_url)
                if localized_result["state"] == "cancelled":
                    return {"cancelled": True}
                if localized_result["state"] == "completed":
                    localized = localized_result["value"]
                if not localized:
                    warnings.append(f"「{child['label']}」未定位到可用热点，请手动添加")
            committed = await commit_step(job_id, child, frozen, page, image_url, localized, warnings,
                                          int((index + 1) * 95 / len(frozen["children"])))
            if committed.get("cancelled"):
                return {"cancelled": True}
        return await finish_step(job_id)
    finally:
        service.tasks.discard(task)
        if service.job_tasks.get(job_id) is task:
            service.job_tasks.pop(job_id, None)
