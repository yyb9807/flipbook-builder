"""sse.py：_sse 序列化 + sse_stream 装饰器的 取消/异常 行为。"""
import asyncio
import json

import pytest

from sse import _sse, sse_stream


class TestSseSerializer:
    def test_basic_dict(self):
        s = _sse({"step": 1, "pct": 50})
        assert s.startswith("data: ")
        assert s.endswith("\n\n")
        # 把数据部分 parse 出来
        body = s[len("data: ") : -2]
        assert json.loads(body) == {"step": 1, "pct": 50}

    def test_chinese_not_escaped(self):
        s = _sse({"message": "分析中"})
        # ensure_ascii=False，中文应直接出现
        assert "分析中" in s
        assert "\\u" not in s


@pytest.mark.asyncio
class TestSseStreamDecorator:
    async def _collect(self, gen):
        return [item async for item in gen]

    async def test_passes_through_events(self):
        @sse_stream("TEST")
        async def stream(_bg_tasks):
            yield _sse({"a": 1})
            yield _sse({"b": 2})

        events = await self._collect(stream())
        assert len(events) == 2
        assert "a" in events[0]
        assert "b" in events[1]

    async def test_exception_yields_error_event(self):
        @sse_stream("TEST")
        async def stream(_bg_tasks):
            yield _sse({"step": 0})
            raise ValueError("boom")

        events = await self._collect(stream())
        assert len(events) == 2
        # 最后一个事件应包含 error
        last = json.loads(events[-1][len("data: ") : -2])
        assert last["error"] == "boom"

    async def test_cancellation_propagates_and_cancels_bg_tasks(self):
        long_task_handle = None

        async def long_task():
            await asyncio.sleep(60)

        @sse_stream("TEST")
        async def stream(bg_tasks):
            nonlocal long_task_handle
            long_task_handle = asyncio.ensure_future(long_task())
            bg_tasks.append(long_task_handle)
            yield _sse({"step": 0})
            await asyncio.sleep(60)  # 会被外层 cancel

        gen = stream()
        first = await gen.__anext__()
        assert "step" in first

        # 主动取消（模拟客户端断开）
        await gen.aclose()

        # bg_task 应该被装饰器调用 .cancel() 标记
        assert long_task_handle is not None
        assert long_task_handle.cancelled() or long_task_handle.cancelling() > 0


# pytest-asyncio 配置
@pytest.fixture(scope="session")
def event_loop_policy():
    return asyncio.DefaultEventLoopPolicy()
