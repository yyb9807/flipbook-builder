"""Reviewable, concurrency-safe page version restoration."""
import json

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from database import get_pool
from jobs.locking import lock_project_write
from version_history import (
    capture_before,
    decoded,
    merge_restore,
    persist_restored_content,
    public_node,
    record_changes,
    validate_restored_asset,
    version_summary,
)

router = APIRouter()


class RestoreVersionBody(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    operation_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    expected_revision: int = Field(ge=0)


async def get_version(conn, project_id: str, node_id: str, version_id: str):
    row = await conn.fetchrow("SELECT * FROM node_versions WHERE id=$1 AND project_id=$2 AND node_id=$3",
                              version_id, project_id, node_id)
    if not row:
        raise HTTPException(404, "页面版本不存在")
    return row


@router.get("/projects/{project_id}/nodes/{node_id}/versions")
async def list_versions(project_id: str, node_id: str, pool: asyncpg.Pool = Depends(get_pool)):
    async with pool.acquire() as conn, conn.transaction():
        revision = await lock_project_write(conn, project_id, allow_active=True)
        if revision is None:
            raise HTTPException(404, "项目不存在")
        content = await capture_before(conn, project_id, node_id)
        if content is None:
            raise HTTPException(404, "页面不存在")
        rows = await conn.fetch("SELECT * FROM node_versions WHERE project_id=$1 AND node_id=$2 ORDER BY sequence DESC", project_id, node_id)
        return {"project_revision": revision, "current_version_id": rows[0]["id"], "versions": [version_summary(row) for row in rows]}


@router.get("/projects/{project_id}/nodes/{node_id}/versions/{version_id}")
async def preview_version(project_id: str, node_id: str, version_id: str, pool: asyncpg.Pool = Depends(get_pool)):
    async with pool.acquire() as conn, conn.transaction():
        revision = await lock_project_write(conn, project_id, allow_active=True)
        if revision is None:
            raise HTTPException(404, "项目不存在")
        current = await capture_before(conn, project_id, node_id)
        if current is None:
            raise HTTPException(404, "页面不存在")
        row = await get_version(conn, project_id, node_id, version_id)
        restored, preserved = merge_restore(decoded(row["snapshot"]), current)
        return {"project_revision": revision, "version": version_summary(row),
                "preview": await public_node(conn, project_id, node_id, content=restored), "preserved_branch_count": preserved}


@router.post("/projects/{project_id}/nodes/{node_id}/versions/{version_id}/restore")
async def restore_version(project_id: str, node_id: str, version_id: str, body: RestoreVersionBody,
                          pool: asyncpg.Pool = Depends(get_pool)):
    async with pool.acquire() as conn, conn.transaction():
        # Idempotency lookup precedes mutable revision and active-job checks.
        await lock_project_write(conn, project_id, allow_active=True)
        operation = await conn.fetchrow("SELECT * FROM version_restore_operations WHERE project_id=$1 AND operation_id=$2",
                                        project_id, body.operation_id)
        if operation:
            if (operation["node_id"], operation["version_id"], operation["expected_revision"]) != (node_id, version_id, body.expected_revision):
                raise HTTPException(409, "同一恢复操作 ID 的参数不同，请发起新的恢复操作")
            return decoded(operation["result"])
        await lock_project_write(conn, project_id, expected_revision=body.expected_revision)
        current = await capture_before(conn, project_id, node_id)
        if current is None:
            raise HTTPException(404, "页面不存在")
        row = await get_version(conn, project_id, node_id, version_id)
        restored, preserved = merge_restore(decoded(row["snapshot"]), current)
        validate_restored_asset(restored, project_id)
        await persist_restored_content(conn, node_id, restored)
        revision = await record_changes(conn, project_id, [(node_id, current)], "restore")
        latest_id = await conn.fetchval("SELECT id FROM node_versions WHERE node_id=$1 ORDER BY sequence DESC LIMIT 1", node_id)
        result = {"project_revision": revision, "node": await public_node(conn, project_id, node_id),
                  "restored_version_id": latest_id, "preserved_branch_count": preserved}
        await conn.execute(
            "INSERT INTO version_restore_operations(project_id,operation_id,node_id,version_id,expected_revision,result) "
            "VALUES($1,$2,$3,$4,$5,$6::jsonb)", project_id, body.operation_id, node_id, version_id,
            body.expected_revision, json.dumps(result, ensure_ascii=False),
        )
        return result
