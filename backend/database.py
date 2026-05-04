from pathlib import Path

import asyncpg
from fastapi import Request


async def create_pool(dsn: str) -> asyncpg.Pool:
    return await asyncpg.create_pool(dsn, min_size=2, max_size=10)


async def apply_schema(pool: asyncpg.Pool) -> None:
    sql = (Path(__file__).parent / "schema.sql").read_text()
    async with pool.acquire() as conn:
        await conn.execute(sql)


def get_pool(request: Request) -> asyncpg.Pool:
    return request.app.state.pool
