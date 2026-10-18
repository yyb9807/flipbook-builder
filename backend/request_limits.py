"""Bound the whole ASGI request before multipart parsing can spool it to disk."""
from starlette.exceptions import HTTPException
from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Receive, Scope, Send


class RequestBodyLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int = 22 * 1024 * 1024):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers", []))
        if b"content-length" in headers:
            try:
                declared_length = int(headers[b"content-length"])
                if declared_length < 0:
                    raise ValueError
            except ValueError:
                await PlainTextResponse("无效的 Content-Length", status_code=400)(scope, receive, send)
                return
            if declared_length > self.max_bytes:
                await PlainTextResponse("请求内容过大，图片文件最多 20 MB", status_code=413)(scope, receive, send)
                return
        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise HTTPException(413, "请求内容过大，图片文件最多 20 MB")
            return message

        await self.app(scope, limited_receive, send)
