"""FastAPI lifecycle and public durable-job actions (single executor per database)."""
import asyncio
import os

import asyncpg
from dbos import DBOS, DBOSClient
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError

from agents.base import ImgGenConfig, LLMConfig
from database import apply_schema
from jobs import page_workflows, workflows
from jobs.credentials import CredentialVault, provider_metadata
from jobs.models import TERMINAL
from jobs.store import JobStore, fingerprint
from utils import gen_id

assert page_workflows  # Register new workflows while preserving children-v1.

LOCK_NAMESPACE = (1179404624, 1246708307)


class JobService:
    def __init__(self, pool, dsn: str):
        self.pool, self.dsn = pool, dsn
        self.vault = CredentialVault()
        self.stopping = False
        self.tasks: set[asyncio.Task] = set()
        self.job_tasks: dict[str, asyncio.Task] = {}
        self.lock = None
        self.engine = None
        self.client = None
        self.monitor = None

    def check_running(self):
        if self.stopping or self.lock is None or self.lock.is_closed():
            # BaseException: not persisted as a failed step; recovery remains possible.
            raise asyncio.CancelledError("durable_executor_stopping")

    async def start(self):
        self.lock = await asyncpg.connect(self.dsn)
        acquired = await self.lock.fetchval("SELECT pg_try_advisory_lock($1,$2)", *LOCK_NAMESPACE)
        if not acquired:
            await self.lock.close()
            raise RuntimeError("Another durable executor owns this database; use one uvicorn worker")
        self.lock.add_termination_listener(self._lock_lost)
        await apply_schema(self.pool)
        sql_dsn = self.dsn.replace("postgresql://", "postgresql+psycopg://", 1).replace("postgres://", "postgresql+psycopg://", 1)
        self.engine = create_engine(sql_dsn, pool_size=3, max_overflow=2, pool_pre_ping=True)
        workflows.SERVICE = self
        DBOS(config={
            "name": "flipbook-builder", "application_version": "children-v1", "executor_id": "flipbook-single",
            "system_database_url": sql_dsn, "enable_otlp": False, "log_level": "WARN", "max_executor_threads": 8,
        })
        # Must run on this lifespan's live loop: recovery then uses the asyncpg pool's loop too.
        DBOS.launch()
        self.client = DBOSClient(system_database_engine=self.engine, application_name="flipbook-builder", use_listen_notify=False)
        self.store = JobStore(self.pool, self.engine, self.client)
        await DBOS.register_queue_async("flipbook-children", worker_concurrency=4)
        self.monitor = asyncio.create_task(self._monitor())

    def _lock_lost(self, _connection):
        if self.stopping:
            return
        self.stopping = True
        self.vault.clear()
        for task in list(self.tasks):
            task.cancel()
        # Fail closed. A supervisor may restart; no more work is admitted in this process.
        asyncio.get_running_loop().call_soon(os.kill, os.getpid(), 15)

    async def stop(self):
        self.stopping = True
        self.vault.clear()
        if self.monitor:
            self.monitor.cancel()
            await asyncio.gather(self.monitor, return_exceptions=True)
        for task in list(self.tasks):
            task.cancel()
        if self.tasks:
            await asyncio.gather(*list(self.tasks), return_exceptions=True)
        def destroy_runtime():
            # DBOS owns the loop's default executor and destroys it. Do all
            # subsequent synchronous cleanup in this same already-running thread.
            DBOS.destroy(workflow_completion_timeout_sec=0)
            if self.client:
                self.client.destroy()
            if self.engine:
                self.engine.dispose()

        try:
            await asyncio.to_thread(destroy_runtime)
        finally:
            if self.lock and not self.lock.is_closed():
                await self.lock.close()
            workflows.SERVICE = None

    async def _monitor(self):
        while True:
            await asyncio.sleep(1)
            self.vault.prune()
            try:
                async with self.pool.acquire() as conn:
                    ids = await conn.fetch("SELECT id FROM generation_jobs WHERE status NOT IN ('succeeded','partial','failed','cancelled') AND phase <> 'recovery'")
                for row in ids:
                    status = await DBOS.get_workflow_status_async(row["id"])
                    if status and status.status in {"ERROR", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"}:
                        await self.store.fail(row["id"])
                        self.vault.discard(row["id"])
            except Exception:
                # Monitoring is read/reconciliation only; a database outage must
                # not kill the monitor or reissue any model operation.
                await asyncio.sleep(0.5)

    async def submit(self, project_id: str, node_id: str, body, llm: LLMConfig, image: ImgGenConfig) -> dict:
        self.check_running()
        candidate = gen_id("job_")
        self.vault.provide(candidate, llm, image)
        try:
            result = await asyncio.to_thread(self.store.create, candidate, project_id, node_id, body.operation_id,
                                            body.selected_keywords, provider_metadata(llm, image),
                                            bool(image.api_key) if body.generate_images is None else body.generate_images,
                                            body.generate_images)
        except IntegrityError as failure:
            self.vault.discard(candidate)
            if getattr(failure.orig, "sqlstate", None) != "23505":
                raise
            # Different node locks can race for a project-scoped operation ID.
            result = await self.store.existing_operation(project_id, body.operation_id,
                fingerprint(node_id, body.selected_keywords, provider_metadata(llm, image), body.generate_images))
        except BaseException:
            self.vault.discard(candidate)
            raise
        if result["job_id"] != candidate:
            self.vault.discard(candidate)
            if result["status"] not in TERMINAL:
                self.vault.provide(result["job_id"], llm, image)
                result = await asyncio.to_thread(self.store.notify, result["job_id"], "credentials", {"available": True})
        if result["status"] in TERMINAL:
            self.vault.discard(result["job_id"])
        return result

    async def submit_page(self, project_id: str, node_id: str | None, operation_id: str, kind: str,
                          payload: dict, generate_images: bool | None, llm: LLMConfig, image: ImgGenConfig) -> dict:
        self.check_running()
        existing = await self.store.list(project_id, False, operation_id)
        image_requested = (existing[0]["input_summary"].get("generate_images", bool(image.api_key)) if existing
                           else bool(image.api_key)) if generate_images is None else generate_images
        candidate = gen_id("job_")
        self.vault.provide(candidate, llm, image)
        try:
            payload = {**payload, "project_id": project_id}
            result = await asyncio.to_thread(self.store.create_page, candidate, project_id, node_id, operation_id,
                                            kind, payload, provider_metadata(llm, image), image_requested)
        except BaseException:
            self.vault.discard(candidate)
            raise
        if result["job_id"] != candidate:
            self.vault.discard(candidate)
            if result["status"] not in TERMINAL:
                self.vault.provide(result["job_id"], llm, image)
                result = await asyncio.to_thread(self.store.notify, result["job_id"], "credentials", {"available": True})
        if result["status"] in TERMINAL:
            self.vault.discard(result["job_id"])
        return result

    async def provide_credentials(self, job_id: str, llm: LLMConfig, image: ImgGenConfig) -> dict:
        self.check_running()
        current = await self.store.get(job_id)
        if current["status"] in TERMINAL:
            raise HTTPException(409, "任务已结束")
        if provider_metadata(llm, image) != current["provider_config"]:
            raise HTTPException(409, "恢复凭据的服务地址和模型必须与任务原配置一致")
        if not llm.api_key and not image.api_key:
            raise HTTPException(400, "请提供此任务所需的 API Key")
        self.vault.provide(job_id, llm, image)
        return await asyncio.to_thread(self.store.notify, job_id, "credentials", {"available": True})

    async def resolve(self, job_id: str, confirmation_id: str, action: str) -> dict:
        self.check_running()
        return await asyncio.to_thread(self.store.notify, job_id, "decision", {"confirmation_id": confirmation_id},
                                       confirmation_id, action)

    async def cancel(self, job_id: str) -> dict:
        self.check_running()
        result = await self.store.cancel(job_id)
        self.vault.discard(job_id)
        if result["status"] == "cancelled":
            await DBOS.cancel_workflow_async(job_id)
            local_task = self.job_tasks.get(job_id)
            if local_task:
                local_task.cancel()
                await asyncio.gather(local_task, return_exceptions=True)
        return result
