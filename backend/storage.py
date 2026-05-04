import hashlib
import shutil
from pathlib import Path

import aiofiles
import httpx

UPLOAD_DIR = Path(__file__).parent.parent / "data" / "uploads"
"""图片在磁盘上的根目录。"""

IMG_CACHE_DIR = Path(__file__).parent.parent / "data" / "img_cache"
"""按 prompt+model 的 SHA256 缓存生成过的图片。重复 prompt 直接复用，省一次 IMG API 调用。"""

UPLOAD_URL_PREFIX = "/uploads/"
"""image_url 字段统一用 `/uploads/{project_id}/{filename}` 格式。
   FastAPI 把 UPLOAD_DIR mount 到 /uploads，所以前端直接 <img src="/uploads/..."> 即可。"""


def cache_key(model: str, prompt: str) -> str:
    """同一个 (模型, prompt) 应该产出同一张图（除了模型本身的随机种子）。
    注意：dall-e-3 / flux 即使 prompt 一样也会有随机性，但实际场景里我们的 prompt
    是用主题 + sub_topics 拼出来的，重复概率高的是规则法 fallback / 用户重新生成时。"""
    h = hashlib.sha256()
    h.update(model.encode("utf-8"))
    h.update(b"\x00")
    h.update(prompt.encode("utf-8"))
    return h.hexdigest()


def cached_image_path(key: str) -> Path:
    return IMG_CACHE_DIR / f"{key}.png"


async def serve_from_cache(
    cache_key_str: str, project_id: str, filename: str
) -> str | None:
    """如果缓存里有这个 key，复制到项目目录返回 URL；没有返回 None。"""
    src = cached_image_path(cache_key_str)
    if not src.exists():
        return None
    dst_dir = UPLOAD_DIR / project_id
    dst_dir.mkdir(parents=True, exist_ok=True)
    dst = dst_dir / filename
    shutil.copy2(src, dst)
    return f"{UPLOAD_URL_PREFIX}{project_id}/{filename}"


async def cache_image(cache_key_str: str, src_url: str) -> None:
    """生成完成后把图存一份到缓存目录。src_url 是 /uploads/... 形式。"""
    src = url_to_disk_path(src_url)
    if not src or not src.exists():
        return
    IMG_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    dst = cached_image_path(cache_key_str)
    if not dst.exists():  # 避免并发竞态
        try:
            shutil.copy2(src, dst)
        except Exception:
            pass  # cache 失败不影响主流程


def ensure_project_dir(project_id: str) -> Path:
    d = UPLOAD_DIR / project_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def url_to_disk_path(url: str) -> Path | None:
    """把 image_url（如 /uploads/proj_xxx/node_yyy.png）映射到磁盘 Path。
    不是 /uploads/ 前缀则返回 None。"""
    if not isinstance(url, str) or not url.startswith(UPLOAD_URL_PREFIX):
        return None
    rel = url[len(UPLOAD_URL_PREFIX):]
    return UPLOAD_DIR / rel


async def save_upload(project_id: str, filename: str, contents: bytes) -> str:
    d = ensure_project_dir(project_id)
    path = d / filename
    async with aiofiles.open(path, "wb") as f:
        await f.write(contents)
    return f"{UPLOAD_URL_PREFIX}{project_id}/{filename}"


async def save_bytes(project_id: str, filename: str, data: bytes) -> str:
    return await save_upload(project_id, filename, data)


async def download_and_save(url: str, project_id: str, filename: str) -> str:
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.get(url)
        r.raise_for_status()
    return await save_upload(project_id, filename, r.content)
