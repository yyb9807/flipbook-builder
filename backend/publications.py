"""Immutable, server-authored publications, independent of source project lifetime."""
import fcntl
import hashlib
import html
import json
import math
import os
import re
import shutil
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from fastapi import HTTPException

import storage
from content_metadata import public_content_metadata, validate_section_references
from jobs.locking import lock_project_write
from publication_files import PUBLICATION_ID, publication_directory

MAX_PROJECT_NODES = 1000
MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024
MAX_ASSET_BYTES = 200 * 1024 * 1024


def _decoded(value):
    return json.loads(value) if isinstance(value, str) else value


def _conflict(message="作品分支不完整，无法发布；请先修复页面与分支关系"):
    raise HTTPException(409, message)


def _root() -> Path:
    directory = publication_directory()
    directory.mkdir(parents=True, exist_ok=True)
    return directory


@contextmanager
def _project_lock(project_id: str):
    # Hash IDs rather than using caller-controlled path components.
    directory = _root() / ".locks"
    directory.mkdir(exist_ok=True)
    path = directory / (hashlib.sha256(project_id.encode()).hexdigest() + ".lock")
    with path.open("a+b") as file:
        try:
            fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            # This is transient admission, not a revision/idempotency conflict.
            # Clients must retain their pending operation ID after unknown outcomes.
            raise HTTPException(503, "该作品正在发布或撤下，请稍后使用同一操作重试", headers={"Retry-After": "1"}) from None
        try:
            yield
        finally:
            fcntl.flock(file, fcntl.LOCK_UN)


def _manifests(project_id: str | None):
    root = _root()
    for base, state in ((root, "published"), (root / ".withdrawn", "withdrawn")):
        if not base.is_dir():
            continue
        for directory in base.iterdir():
            if not PUBLICATION_ID.fullmatch(directory.name) or directory.is_symlink() or not directory.is_dir():
                continue
            manifest_path = directory / "manifest.json"
            if manifest_path.is_symlink():
                continue
            try:
                manifest = json.loads(manifest_path.read_text())
            except (OSError, ValueError):
                continue
            if (project_id is None or manifest.get("project_id") == project_id) and manifest.get("id") == directory.name:
                yield manifest, state, directory


def _summary(manifest, state):
    base = os.environ.get("PUBLICATION_BASE_URL", "http://localhost:8081").rstrip("/")
    return {**{key: manifest[key] for key in (
        "id", "project_id", "name", "source_revision", "created_at", "page_count", "content_hash",
    )}, "state": state, "url": f"{base}/p/{manifest['id']}/"}


def list_publications(project_id: str | None = None) -> list[dict]:
    return sorted((_summary(manifest, state) for manifest, state, _ in _manifests(project_id)),
                  key=lambda item: (item["created_at"], item["id"]), reverse=True)


def withdraw_publication(project_id: str, publication_id: str) -> dict:
    if not PUBLICATION_ID.fullmatch(publication_id):
        raise HTTPException(404, "发布版本不存在")
    with _project_lock(project_id):
        for manifest, state, directory in _manifests(project_id):
            if manifest["id"] != publication_id:
                continue
            if state == "published":
                withdrawn = _root() / ".withdrawn"
                withdrawn.mkdir(exist_ok=True)
                directory.rename(withdrawn / publication_id)
                # Only the private receipt is retained. Existing downloads cannot be recalled.
                for item in (withdrawn / publication_id).iterdir():
                    if item.name != "manifest.json":
                        try:
                            shutil.rmtree(item) if item.is_dir() else item.unlink()
                        except OSError:
                            pass  # Already withdrawn atomically; cleanup must not undo its receipt.
            return _summary(manifest, "withdrawn")
    raise HTTPException(404, "发布版本不存在")


def _scene(value, hotspots):
    if value is None:
        if any(item["kind"] == "section" for item in hotspots.values()):
            _conflict()
        return None
    value = _decoded(value)
    if not isinstance(value, dict) or value.get("version") != 1 or value.get("layout") not in {"atlas", "sequence"}:
        _conflict("页面正文格式无法发布，请先保存有效正文")
    selected = {"version": 1, "layout": value["layout"], "sections": []}
    ids, retained = set(), set()
    sections = value.get("sections")
    if not isinstance(sections, list) or len(sections) > 12:
        _conflict()
    for section in sections:
        if not isinstance(section, dict):
            _conflict()
        item = {key: section.get(key) for key in ("id", "title", "body")}
        if (not isinstance(item["id"], str) or not 1 <= len(item["id"]) <= 100 or item["id"] in ids
                or not isinstance(item["title"], str) or len(item["title"]) > 200
                or not isinstance(item["body"], str) or len(item["body"]) > 5000):
            _conflict()
        ids.add(item["id"])
        if "reference_ids" in section:
            item["reference_ids"] = section["reference_ids"]
        hotspot_id, target = section.get("hotspot_id"), section.get("target_node_id")
        if hotspot_id:
            hotspot = hotspots.get(hotspot_id)
            if not hotspot or hotspot_id in retained or (target and target != hotspot["target_node_id"]):
                _conflict()
            item["hotspot_id"] = hotspot_id
            if hotspot["target_node_id"]:
                item["target_node_id"] = hotspot["target_node_id"]
            retained.add(hotspot_id)
        elif target:
            _conflict()
        selected["sections"].append(item)
    if any(item["kind"] == "section" and identity not in retained for identity, item in hotspots.items()):
        _conflict()
    if selected["sections"] and any(item["target_node_id"] and identity not in retained for identity, item in hotspots.items()):
        _conflict("正文未展示已有分支连接，请先整理页面区块后发布")
    return selected


def snapshot_project(project, rows, hotspot_rows):
    """Validate the whole graph before selecting only reader-facing content."""
    if not rows or len(rows) > MAX_PROJECT_NODES:
        _conflict("作品需要 1 至 1000 个完整页面才能发布")
    by_id = {row["id"]: row for row in rows}
    root = project["root_node_id"]
    if root not in by_id or by_id[root]["parent_id"] is not None or by_id[root]["depth"] != 0:
        _conflict()
    children = {identity: [] for identity in by_id}
    hotspots = {identity: {} for identity in by_id}
    targets = set()
    for row in rows:
        parent = row["parent_id"]
        if row["id"] != root:
            if parent not in by_id or row["depth"] != by_id[parent]["depth"] + 1:
                _conflict()
            children[parent].append(row["id"])
        if row["status"] == "generating":
            _conflict("页面正在生成，请完成或取消生成后发布")
    for row in hotspot_rows:
        node_id, target, kind = row["node_id"], row["target_node_id"], row["kind"]
        if node_id not in by_id or kind not in {"section", "image"}:
            _conflict()
        if target:
            if target not in by_id or by_id[target]["parent_id"] != node_id or target in targets:
                _conflict()
            targets.add(target)
        item = {"id": row["id"], "label": row["label"], "kind": kind, "selected": False, "target_node_id": target}
        if kind == "section":
            if any(row[key] is not None for key in ("pos_x", "pos_y", "width", "height", "score")):
                _conflict()
            item.update(position=None, size=None)
        else:
            coordinates = [row[key] for key in ("pos_x", "pos_y", "width", "height")]
            if any(not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1 for value in coordinates):
                _conflict()
            if coordinates[2] <= 0 or coordinates[3] <= 0:
                _conflict()
            item.update(position={"x": coordinates[0], "y": coordinates[1]},
                        size={"width": coordinates[2], "height": coordinates[3]})
        hotspots[node_id][row["id"]] = item
    if targets != set(by_id) - {root}:
        _conflict()
    reached, pending = set(), [root]
    while pending:
        identity = pending.pop()
        if identity in reached:
            _conflict()
        reached.add(identity)
        pending.extend(children[identity])
    if reached != set(by_id):
        _conflict()
    nodes = {}
    for row in rows:
        identity = row["id"]
        scene = _scene(row.get("scene_document"), hotspots[identity])
        if not (row["title"].strip() or row["description"].strip() or row["image_url"]
                or any(section["body"].strip() for section in (scene or {}).get("sections", []))):
            _conflict("作品含空白页面，请补齐内容后发布")
        node = {key: row[key] for key in ("id", "parent_id", "depth", "title", "description", "source_type", "image_url")}
        node.update(children=children[identity], hotspots=list(hotspots[identity].values()), status="completed")
        if scene is not None:
            node["scene_document"] = scene
        metadata = public_content_metadata(row.get("content_metadata"))
        try:
            validate_section_references(scene, metadata)
        except ValueError as exc:
            raise HTTPException(409, "正文引用的来源资料缺失或无效，请先整理引用后发布") from exc
        if metadata is not None:
            node["content_metadata"] = metadata
        nodes[identity] = node
    settings = _decoded(project["settings"])
    settings = settings if isinstance(settings, dict) else {}
    public_settings = {}
    for key, default in (("max_depth", 4), ("max_hotspots_per_page", 3)):
        value = settings.get(key)
        public_settings[key] = value if type(value) is int and 1 <= value <= 1000 else default
    style, language = settings.get("visual_style"), settings.get("language")
    public_settings["visual_style"] = style if isinstance(style, str) and 1 <= len(style) <= 100 else "encyclopedia"
    public_settings["language"] = language if isinstance(language, str) and re.fullmatch(
        r"[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*", language,
    ) and len(language) <= 35 else "zh"
    return {"project_id": project["id"], "name": project["name"], "root_node_id": root,
            "settings": public_settings, "nodes": nodes}


def _json_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def _html(project):
    payload = _json_bytes(project).decode()
    for character in "<>&\u2028\u2029":
        payload = payload.replace(character, f"\\u{ord(character):04x}")
    language = "en" if str(project["settings"]["language"]).startswith("en") else "zh-CN"
    return (f'<!doctype html><html lang="{language}"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta name="referrer" content="no-referrer">'
            f'<title>{html.escape(project["name"], quote=True)}</title><link rel="stylesheet" href="player.css">'
            '</head><body><div id="flipbook-player"><p>正在打开作品… / Opening project…</p></div>'
            f'<script id="flipbook-data" type="application/json">{payload}</script>'
            '<script src="player.js"></script></body></html>').encode()


def _write_snapshot(staging: Path, snapshot, project_id: str):
    runtime = Path(os.environ.get("PUBLICATION_RUNTIME_DIR", Path(__file__).parent / "publication_runtime"))
    for name in ("player.js", "player.css"):
        source = runtime / name
        if source.is_symlink() or not source.is_file() or source.stat().st_size > 5 * 1024 * 1024:
            raise HTTPException(503, "发布阅读器尚未构建，请先完成服务器部署")
        shutil.copyfile(source, staging / name)
    assets = staging / "assets"
    assets.mkdir()
    copied, total = {}, 0
    for node in snapshot["nodes"].values():
        url = node["image_url"]
        if not url:
            continue
        if url not in copied:
            source = storage.url_to_disk_path(url)
            expected_prefix = f"/uploads/{project_id}/"
            if (not isinstance(url, str) or not url.startswith(expected_prefix)
                    or not re.fullmatch(r"[A-Za-z0-9_-]+\.png", url[len(expected_prefix):]) or source is None
                    or not source.is_file() or source.suffix != ".png"):
                _conflict("页面图片缺失或不是本作品的本地图片，无法完整发布")
            unresolved = storage.UPLOAD_DIR / url[len(storage.UPLOAD_URL_PREFIX):]
            if unresolved.is_symlink() or unresolved.parent.is_symlink():
                _conflict("发布图片不能引用符号链接")
            if source.stat().st_size > storage.MAX_IMAGE_BYTES:
                _conflict("发布图片超过大小限制")
            data = source.read_bytes()
            total += len(data)
            if not data.startswith(b"\x89PNG\r\n\x1a\n") or total > MAX_ASSET_BYTES:
                _conflict("发布图片无效或总大小超过 200 MB")
            name = hashlib.sha256(data).hexdigest() + ".png"
            (assets / name).write_bytes(data)
            copied[url] = "assets/" + name
        node["image_url"] = copied[url]
    data = _json_bytes(snapshot)
    if len(data) > MAX_SNAPSHOT_BYTES:
        _conflict("发布内容超过 16 MB，请先精简作品")
    (staging / "project.json").write_bytes(data)
    (staging / "index.html").write_bytes(_html(snapshot))
    hashes = {str(file.relative_to(staging)): hashlib.sha256(file.read_bytes()).hexdigest()
              for file in sorted(staging.rglob("*")) if file.is_file()}
    return hashlib.sha256(_json_bytes(hashes)).hexdigest()


async def create_publication(pool, project_id: str, operation_id: str, expected_revision: int):
    with _project_lock(project_id):
        for manifest, state, _ in _manifests(project_id):
            if manifest["operation_id"] == operation_id:
                if manifest["source_revision"] != expected_revision:
                    raise HTTPException(409, "同一发布操作 ID 的参数不同，请发起新的发布操作")
                return _summary(manifest, state), False
        identity = "pub_" + uuid.uuid4().hex
        staging = _root() / (".staging-" + identity)
        staging.mkdir()
        try:
            async with pool.acquire() as conn, conn.transaction():
                await lock_project_write(conn, project_id, expected_revision=expected_revision)
                project = await conn.fetchrow("SELECT * FROM projects WHERE id=$1", project_id)
                rows = await conn.fetch("SELECT * FROM nodes WHERE project_id=$1 ORDER BY created_at,id", project_id)
                hotspots = await conn.fetch("SELECT h.* FROM hotspots h JOIN nodes n ON n.id=h.node_id "
                                            "WHERE n.project_id=$1 ORDER BY h.sort_order,h.id", project_id)
                snapshot = snapshot_project(project, rows, hotspots)
                content_hash = _write_snapshot(staging, snapshot, project_id)
                manifest = {"version": 1, "id": identity, "project_id": project_id, "operation_id": operation_id,
                            "name": project["name"], "source_revision": expected_revision,
                            "created_at": datetime.now(UTC).isoformat(), "page_count": len(rows), "content_hash": content_hash}
                (staging / "manifest.json").write_bytes(_json_bytes(manifest))
            # No database commit or other fallible content work follows this visibility boundary.
            # The independent file lock still serializes requests through the rename.
            staging.rename(_root() / identity)
            return _summary(manifest, "published"), True
        finally:
            if staging.exists():
                shutil.rmtree(staging)
