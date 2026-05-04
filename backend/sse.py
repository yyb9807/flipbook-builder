"""SSE (Server-Sent Events) 工具：
- _sse: 把 dict 序列化为 SSE 格式
- sse_endpoint: 装饰器，统一处理客户端断开 / bg_tasks 取消 / 异常时 yield error 事件

两个 router（projects、nodes）的 stream 生成器之前各自写了一份 try/except/finally
取消逻辑（约 50 行重复），现在统一走这里。
"""
from __future__ import annotations

import asyncio
import json
import traceback
from collections.abc import AsyncIterator, Callable

from agents.base import _log


def _sse(data: dict) -> str:
    """把 dict 序列化为单条 SSE 消息（`data: ...\\n\\n`），中文不转义。"""
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


# 包装后的 generator 类型：内部 generator 通过 task_registry list 注册它启动的后台任务，
# 我们在客户端断开时统一取消这些任务，避免烧 LLM/IMG 调用配额。
StreamFn = Callable[[list[asyncio.Task]], AsyncIterator[str]]


def sse_stream(name: str) -> Callable[[StreamFn], Callable[[], AsyncIterator[str]]]:
    """装饰器：把一个接受 bg_tasks 参数的 async generator 包成"自动处理取消和异常的 SSE 流"。

    用法：
        @sse_stream("ANALYZE")
        async def stream(bg_tasks):
            yield _sse({"step": 0, ...})
            t = asyncio.ensure_future(image_agent.generate(...))
            bg_tasks.append(t)
            ...
            yield _sse({"done": True, ...})

    自动处理：
    - asyncio.CancelledError / GeneratorExit（客户端断开）→ 取消 bg_tasks，记日志，re-raise
    - 其他异常 → yield 一个 {"error": "..."} 事件后退出
    - finally 兜底再次取消所有未完成 bg_tasks
    """

    def decorator(stream_fn: StreamFn) -> Callable[[], AsyncIterator[str]]:
        async def wrapper() -> AsyncIterator[str]:
            bg_tasks: list[asyncio.Task] = []
            try:
                async for event in stream_fn(bg_tasks):
                    yield event
            except (asyncio.CancelledError, GeneratorExit):
                _log(f"════ {name} cancelled (client disconnected)")
                for t in bg_tasks:
                    if not t.done():
                        t.cancel()
                raise
            except Exception as e:  # noqa: BLE001
                print(traceback.format_exc())
                yield _sse({"error": str(e)})
            finally:
                for t in bg_tasks:
                    if not t.done():
                        t.cancel()

        return wrapper

    return decorator


async def heartbeat_until(
    task: asyncio.Task,
    *,
    on_tick: Callable[[int], dict],
    interval: float = 5.0,
) -> AsyncIterator[str]:
    """等待 task 完成期间每 interval 秒 yield 一次心跳事件，防止 SSE 连接断开。

    用法：
        img_task = asyncio.ensure_future(image_agent.generate(...))
        bg_tasks.append(img_task)
        async for ev in heartbeat_until(img_task, on_tick=lambda s: {"step": 1, "pct": ..., "message": f"生成中 {s}s"}):
            yield ev
        result = await img_task
    """
    elapsed = 0
    while not task.done():
        await asyncio.sleep(interval)
        elapsed += int(interval)
        yield _sse(on_tick(elapsed))
