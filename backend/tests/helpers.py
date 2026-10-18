"""Small async connection doubles used by security regression tests."""
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, Mock

from fastapi import Request


def request_with(headers: dict[str, str] | None = None) -> Request:
    return Request({"type": "http", "headers": [
        (key.encode(), value.encode()) for key, value in (headers or {}).items()
    ]})



class FakePool:
    def __init__(self, conn=None):
        self.conn = conn or Mock()
        self.conn.fetchrow = AsyncMock()
        self.conn.fetch = AsyncMock(return_value=[])
        self.conn.fetchval = AsyncMock(return_value=0)
        self.conn.execute = AsyncMock()
        self.transaction_exits = []

        @asynccontextmanager
        async def transaction():
            try:
                yield
            except BaseException as exc:
                self.transaction_exits.append(type(exc))
                raise
            else:
                self.transaction_exits.append(None)

        self.conn.transaction = transaction

    @asynccontextmanager
    async def acquire(self):
        yield self.conn
