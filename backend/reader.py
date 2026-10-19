"""Independent, filesystem-only publication reader. Never imports the editor app."""
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import FileResponse, HTMLResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from publication_files import ASSET_NAME, PUBLIC_FILES, PUBLICATION_ID, publication_directory

app = FastAPI(title="Flipbook Reader", docs_url=None, redoc_url=None, openapi_url=None)

_UNAVAILABLE_HTML = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>作品不可用 / Publication unavailable</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100dvh;padding:24px;display:grid;place-items:center;background:#f5f7f5;color:#20302b;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{width:min(100%,560px);padding:clamp(24px,6vw,48px);background:#fff;border:1px solid #d8e1dc}
.brand{margin:0 0 32px;color:#166a59;font-size:13px;font-weight:600;letter-spacing:.02em}h1{margin:0;font-size:30px;line-height:1.3;font-weight:600;letter-spacing:-.03em}
h1 span{display:block;margin-top:10px;font-size:23px;letter-spacing:-.02em}p{font-size:15px;line-height:1.8;margin:24px 0 0;overflow-wrap:anywhere}.english{margin-top:12px;color:#5b6b64;font-size:14px}
</style></head><body><main><p class="brand">Flipbook Builder · Reader</p>
<h1>作品不可用<span lang="en">Publication unavailable</span></h1>
<p>链接有误或作者已撤下，请联系分享者确认地址。</p>
<p class="english" lang="en">The link may be incorrect, or the author may have withdrawn this publication. Please contact the person who shared it to confirm the address.</p>
</main></body></html>"""


@app.exception_handler(StarletteHTTPException)
async def reader_not_found(request: Request, exc: StarletteHTTPException):
    if exc.status_code == 404 and "text/html" in request.headers.get("accept", "").lower():
        return HTMLResponse(_UNAVAILABLE_HTML, status_code=404)
    return await http_exception_handler(request, exc)


@app.middleware("http")
async def reader_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.update({
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, nofollow",
        # Rechecking the server makes withdrawal effective for future requests.
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    })
    return response


@app.get("/healthz")
async def health():
    return {"status": "ok"}


def public_file(publication_id: str, resource: str) -> Path:
    if not PUBLICATION_ID.fullmatch(publication_id):
        raise HTTPException(404, "作品不存在或已撤下")
    if resource not in PUBLIC_FILES and not (
        resource.startswith("assets/") and ASSET_NAME.fullmatch(resource.removeprefix("assets/"))
    ):
        raise HTTPException(404, "资源不存在")
    root = publication_directory().resolve()
    directory = root / publication_id
    file = directory / resource
    # Do not expose symlinks, including symlinked publication or assets folders.
    if (directory.is_symlink() or file.is_symlink() or (directory / "assets").is_symlink()
            or not file.resolve().is_relative_to(directory.resolve())
            or not directory.resolve().is_relative_to(root) or not file.is_file()):
        raise HTTPException(404, "作品不存在或已撤下")
    return file


@app.api_route("/p/{publication_id}/", methods=["GET", "HEAD"])
async def publication_index(publication_id: str):
    return FileResponse(public_file(publication_id, "index.html"), media_type="text/html")


@app.api_route("/p/{publication_id}/{resource:path}", methods=["GET", "HEAD"])
async def publication_resource(publication_id: str, resource: str):
    content_types = {".html": "text/html", ".json": "application/json", ".js": "text/javascript",
                     ".css": "text/css", ".png": "image/png"}
    file = public_file(publication_id, resource)
    return FileResponse(file, media_type=content_types[file.suffix])
