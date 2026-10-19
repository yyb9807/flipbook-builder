import html
import io
import json
import time
import zipfile
from pathlib import Path

import asyncpg
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from agents.base import _log
from content_metadata import public_content_metadata
from database import get_pool
from hotspots import public_hotspot
from jobs.locking import lock_project_write
from storage import UPLOAD_DIR, url_to_disk_path
from utils import gen_id

_BackendDir = Path(__file__).parent.parent

router = APIRouter()


class CreateProjectBody(BaseModel):
    name: str
    settings: dict = {}


@router.get("/projects")
async def list_projects(pool: asyncpg.Pool = Depends(get_pool)):
    """返回所有项目列表，每个项目附带其根页面的缩略图。"""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                p.id, p.name, p.created_at, p.updated_at, p.root_node_id,
                n.image_url AS thumbnail, n.title AS root_title,
                (SELECT COUNT(*) FROM nodes WHERE project_id = p.id) AS node_count
            FROM projects p
            LEFT JOIN nodes n ON n.id = p.root_node_id
            ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC
            LIMIT 100
            """
        )
    return {
        "projects": [
            {
                "project_id": r["id"],
                "name": r["name"],
                "thumbnail": r["thumbnail"],
                "root_title": r["root_title"],
                "node_count": r["node_count"],
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
            }
            for r in rows
        ]
    }


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str, pool: asyncpg.Pool = Depends(get_pool)):
    """删除项目（级联删除节点和热点）。"""
    async with pool.acquire() as conn, conn.transaction():
        await lock_project_write(conn, project_id)
        # Project -> nodes -> jobs, identical to admission/commit/cancel.
        await conn.fetch(
            "SELECT id, image_url FROM nodes WHERE project_id = $1 ORDER BY id FOR UPDATE", project_id
        )
        if await conn.fetchval(
            "SELECT 1 FROM generation_jobs WHERE project_id=$1 "
            "AND status IN ('queued','running','waiting_credentials','waiting_confirmation','cancelling') LIMIT 1", project_id,
        ):
            raise HTTPException(409, "作品有未结束的生成任务，请先取消任务再删除")
        # 删数据库记录（hotspots / nodes 应有 ON DELETE CASCADE）
        result = await conn.execute("DELETE FROM projects WHERE id = $1", project_id)
        if result.endswith("0"):
            raise HTTPException(404, "项目不存在")

    # 删图片文件
    project_dir = UPLOAD_DIR / project_id
    if project_dir.exists():
        try:
            import shutil
            shutil.rmtree(project_dir)
        except Exception as e:
            print(f"删除项目文件失败: {e}")

    return {"status": "deleted"}


@router.post("/projects")
async def create_project(body: CreateProjectBody, pool: asyncpg.Pool = Depends(get_pool)):
    project_id = gen_id("proj_")
    settings = {
        "max_depth": body.settings.get("max_depth", 4),
        "max_hotspots_per_page": body.settings.get("max_hotspots_per_page", 3),
        "visual_style": body.settings.get("visual_style", "encyclopedia"),
        "language": body.settings.get("language", "zh"),
    }
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO projects (id, name, settings) VALUES ($1, $2, $3)",
            project_id, body.name, json.dumps(settings),
        )
    return {"project_id": project_id, "name": body.name, "settings": settings}


@router.get("/projects/{project_id}")
async def get_project(project_id: str, pool: asyncpg.Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        project = await conn.fetchrow("SELECT * FROM projects WHERE id = $1", project_id)
        if not project:
            raise HTTPException(404, "项目不存在")

        nodes_rows = await conn.fetch(
            "SELECT * FROM nodes WHERE project_id = $1 ORDER BY created_at", project_id
        )
        hotspot_rows = await conn.fetch(
            """SELECT h.* FROM hotspots h
               JOIN nodes n ON h.node_id = n.id
               WHERE n.project_id = $1
               ORDER BY h.sort_order""",
            project_id,
        )

    # 组装 hotspot 映射
    hotspots_by_node: dict[str, list] = {}
    for h in hotspot_rows:
        node_id = h["node_id"]
        hotspots_by_node.setdefault(node_id, []).append(public_hotspot(h))

    # 组装节点映射
    nodes: dict[str, dict] = {}
    children_map: dict[str, list] = {}
    for n in nodes_rows:
        nodes[n["id"]] = {
            "id": n["id"],
            "parent_id": n["parent_id"],
            "depth": n["depth"],
            "title": n["title"],
            "description": n["description"],
            "source_type": n["source_type"],
            "image_url": n["image_url"],
            "status": n["status"],
            "scene_document": json.loads(n["scene_document"]) if isinstance(n.get("scene_document"), str) else n.get("scene_document"),
            "content_metadata": public_content_metadata(n.get("content_metadata")),
            "hotspots": hotspots_by_node.get(n["id"], []),
            "children": [],
        }
        if n["parent_id"]:
            children_map.setdefault(n["parent_id"], []).append(n["id"])

    for parent_id, child_ids in children_map.items():
        if parent_id in nodes:
            nodes[parent_id]["children"] = child_ids

    return {
        "project_id": project["id"],
        "name": project["name"],
        "root_node_id": project["root_node_id"],
        "revision": project.get("revision", 0),
        "settings": json.loads(project["settings"]) if isinstance(project["settings"], str) else project["settings"],
        "nodes": nodes,
    }


@router.post("/projects/{project_id}/analyze", status_code=202)
async def analyze_upload(
    request: Request, project_id: str, file: UploadFile | None = File(None), text: str | None = Form(None),
    keywords: str | None = Form(None), operation_id: str | None = Form(None), file_sha256: str | None = Form(None),
    generate_images: bool | None = Form(None),
):
    """Legacy address, asynchronous 202 protocol. Closing HTTP never cancels a job."""
    from routers.jobs import submit_analysis
    return await submit_analysis(request, project_id, operation_id or request.headers.get("x-operation-id") or gen_id("legacy_"),
                                 file, text, keywords, file_sha256, generate_images)


async def _load_full_project(project_id: str, pool: asyncpg.Pool) -> dict:
    """加载完整的项目数据（节点 + 热点）。供 export 端点和 get_project 共用。"""
    async with pool.acquire() as conn:
        project = await conn.fetchrow("SELECT * FROM projects WHERE id = $1", project_id)
        if not project:
            raise HTTPException(404, "项目不存在")
        nodes_rows = await conn.fetch(
            "SELECT * FROM nodes WHERE project_id = $1 ORDER BY created_at", project_id
        )
        hotspot_rows = await conn.fetch(
            """SELECT h.* FROM hotspots h
               JOIN nodes n ON h.node_id = n.id
               WHERE n.project_id = $1
               ORDER BY h.sort_order""",
            project_id,
        )
    settings = project["settings"]
    if isinstance(settings, str):
        settings = json.loads(settings)
    nodes = [dict(node) for node in nodes_rows]
    for node in nodes:
        if isinstance(node.get("scene_document"), str):
            node["scene_document"] = json.loads(node["scene_document"])
        node["content_metadata"] = public_content_metadata(node.get("content_metadata"))
    return {
        "project_id": project["id"],
        "name": project["name"],
        "root_node_id": project["root_node_id"],
        "settings": settings,
        "created_at": project["created_at"].isoformat() if project["created_at"] else None,
        "updated_at": project["updated_at"].isoformat() if project["updated_at"] else None,
        "nodes": nodes,
        "hotspots": [dict(h) for h in hotspot_rows],
    }


@router.get("/projects/{project_id}/export.json")
async def export_project_json(project_id: str, pool: asyncpg.Pool = Depends(get_pool)):
    """导出项目结构 + 节点 + 热点的完整 JSON（不含图片二进制）。
    图片仍以 image_url 引用 UPLOAD_URL_PREFIX 路径，便于在线 viewer 复用。"""
    data = await _load_full_project(project_id, pool)
    # datetime 字段需要在内层节点也处理
    for n in data["nodes"]:
        for k in ("created_at", "updated_at"):
            if k in n and n[k]:
                n[k] = n[k].isoformat()
    # 加导出标记
    data["_export"] = {
        "version": 1,
        "exported_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "kind": "flipbook-builder-json",
    }
    return JSONResponse(data)


@router.get("/projects/{project_id}/export.zip")
async def export_project_zip(project_id: str, pool: asyncpg.Pool = Depends(get_pool)):
    """导出离线 ZIP 包：
       index.html  — 含 JSON 数据的 viewer
       images/*.png — 实际图片文件（不再 base64 内嵌）
       README.txt  — 简短使用说明

    相比 base64 内嵌的单 HTML，ZIP 体积更小（base64 比原文件大 33%），
    并且打开速度更快（不需要 parse 巨型字符串）。
    """
    data = await _load_full_project(project_id, pool)
    nodes = data["nodes"]
    hotspots = data["hotspots"]

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        # ── 1. 图片：复制到 images/ 目录 + 重写 image_url 为相对路径 ──
        for n in nodes:
            url = n.get("image_url")
            src = url_to_disk_path(url) if isinstance(url, str) else None
            if src and src.exists():
                ext = src.suffix or ".png"
                dest = f"images/{n['id']}{ext}"
                try:
                    zf.write(src, dest)
                    n["image_url"] = f"./{dest}"
                except Exception as e:
                    _log(f"export.zip: skip {url} ({e})")
            # datetime → str
            for k in ("created_at", "updated_at"):
                if k in n and n[k] and not isinstance(n[k], str):
                    n[k] = n[k].isoformat()

        # ── 2. index.html（含数据）──
        payload = {
            "name": data["name"],
            "root_node_id": data["root_node_id"],
            "nodes": nodes,
            "hotspots": hotspots,
        }
        payload_json = _html_safe_json(payload)
        title = html.escape(data["name"] or "翻翻书", quote=True)
        viewer_html = _STATIC_VIEWER_HTML.replace("__TITLE__", title).replace("__PAYLOAD__", payload_json)
        zf.writestr("index.html", viewer_html)

        # ── 3. README ──
        readme = (
            f"翻翻书 · {data['name']}\n"
            f"{'=' * 40}\n\n"
            f"使用方法：\n"
            f"  1. 解压本压缩包\n"
            f"  2. 双击 index.html 在浏览器中打开\n"
            f"  3. 不需要联网，所有内容已离线打包\n\n"
            f"包含：\n"
            f"  - index.html       离线浏览器（HTML + JS 一体）\n"
            f"  - images/          所有页面的图片\n"
            f"  - README.txt       本文件\n"
        )
        zf.writestr("README.txt", readme)

    buf.seek(0)
    # 中文文件名走 RFC 5987 编码（filename*）；basic filename 用 ASCII 兜底
    from urllib.parse import quote
    raw_name = (data["name"] or "flipbook").replace("/", "_").replace("\\", "_")[:60]
    encoded_name = quote(f"{raw_name}.zip")
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename=flipbook.zip; filename*=UTF-8''{encoded_name}",
        },
    )


# ── 离线 HTML viewer 模板 ──
# 模板放在 backend/templates/viewer.html，启动时一次读入并 cache。
# 修改模板时直接编辑 .html 文件（IDE 支持 HTML 高亮 / 格式化），无需碰这个 router。
_TEMPLATE_PATH = _BackendDir / "templates" / "viewer.html"
_STATIC_VIEWER_HTML = _TEMPLATE_PATH.read_text(encoding="utf-8")


def _html_safe_json(data: dict) -> str:
    """JSON embedded in an HTML script must not contain HTML delimiters."""
    serialized = json.dumps(data, ensure_ascii=False, default=str)
    for char, escaped in (("&", "\\u0026"), ("<", "\\u003c"), (">", "\\u003e"),
                          ("\u2028", "\\u2028"), ("\u2029", "\\u2029")):
        serialized = serialized.replace(char, escaped)
    return serialized
