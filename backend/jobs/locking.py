"""Shared write admission: project first, then nodes and jobs in that order."""
from fastapi import HTTPException

from jobs.models import ACTIVE_SQL


async def lock_project_write(conn, project_id: str, *, allow_active: bool = False):
    # Read via fetchval: this is a row lock, not a content mutation.
    await conn.fetchval("SELECT id FROM projects WHERE id=$1 FOR UPDATE", project_id)
    if not allow_active and await conn.fetchval(
        f"SELECT 1 FROM generation_jobs WHERE project_id=$1 AND status IN {ACTIVE_SQL} LIMIT 1", project_id,
    ):
        raise HTTPException(409, "作品有未结束的生成任务，请先恢复或取消它")
