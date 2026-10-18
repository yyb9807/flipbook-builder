"""Validated, immutable local image assets and provider-aware generation cache."""
import hashlib
import io
import json
import re
import shutil
import uuid
import warnings
from pathlib import Path

import aiofiles
import httpx
from PIL import Image, ImageOps, UnidentifiedImageError

UPLOAD_DIR = Path(__file__).parent.parent / "data" / "uploads"
IMG_CACHE_DIR = Path(__file__).parent.parent / "data" / "img_cache"
UPLOAD_URL_PREFIX = "/uploads/"
MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
MAX_IMAGE_SIDE = 12_000
_ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}


def normalize_image(contents: bytes) -> bytes:
    """Decode real pixels, enforce limits, and strip active data/metadata as PNG.

    Neither the multipart MIME type nor the client filename is a trust boundary.
    Animated input is rejected so a harmless first frame cannot mask other data.
    """
    if not contents or len(contents) > MAX_IMAGE_BYTES:
        raise ValueError("图片不能为空，且文件不能超过 20 MB")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(contents)) as image:
                if image.format not in _ALLOWED_FORMATS:
                    raise ValueError("仅支持真实的 JPG / PNG / WEBP 图片")
                width, height = image.size
                if (width < 1 or height < 1 or width * height > MAX_IMAGE_PIXELS
                        or max(width, height) > MAX_IMAGE_SIDE):
                    raise ValueError("图片尺寸过大：最多 4000 万像素，单边不超过 12000 像素")
                if getattr(image, "n_frames", 1) != 1:
                    raise ValueError("请上传静态图片，不支持动画")
                image.load()
                transposed = ImageOps.exif_transpose(image)
                mode = "RGBA" if "A" in transposed.getbands() or "transparency" in transposed.info else "RGB"
                # A new image avoids carrying EXIF, text chunks, or other metadata.
                clean = Image.new(mode, transposed.size)
                clean.paste(transposed.convert(mode))
                out = io.BytesIO()
                clean.save(out, format="PNG")
                return out.getvalue()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ValueError("无法解码图片，请上传有效的 JPG / PNG / WEBP") from exc


def cache_key(model: str, prompt: str, *, provider: str = "", parameters: dict | None = None) -> str:
    identity = {"version": 2, "provider": provider.rstrip("/"), "model": model,
                "prompt": prompt, "parameters": parameters or {}}
    return hashlib.sha256(json.dumps(identity, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def cached_image_path(key: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{64}", key):
        raise ValueError("无效缓存标识")
    return IMG_CACHE_DIR / f"{key}.png"


def ensure_project_dir(project_id: str) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,160}", project_id):
        raise ValueError("无效项目标识")
    directory = UPLOAD_DIR / project_id
    directory.mkdir(parents=True, exist_ok=True)
    if not directory.resolve().is_relative_to(UPLOAD_DIR.resolve()):
        raise ValueError("图片路径必须位于上传目录内")
    return directory


def _new_asset_path(project_id: str, filename: str) -> tuple[Path, str]:
    directory = ensure_project_dir(project_id)
    stem = re.sub(r"[^A-Za-z0-9_-]", "_", Path(filename).stem)[:80] or "image"
    safe_name = f"{stem}_{uuid.uuid4().hex}.png"
    return directory / safe_name, f"{UPLOAD_URL_PREFIX}{project_id}/{safe_name}"


def url_to_disk_path(url: str) -> Path | None:
    if not isinstance(url, str) or not url.startswith(UPLOAD_URL_PREFIX):
        return None
    path = (UPLOAD_DIR / url[len(UPLOAD_URL_PREFIX):]).resolve()
    if not path.is_relative_to(UPLOAD_DIR.resolve()):
        return None
    return path


async def serve_from_cache(cache_key_str: str, project_id: str, filename: str) -> str | None:
    src = cached_image_path(cache_key_str)
    if not src.is_file():
        return None
    dst, url = _new_asset_path(project_id, filename)
    shutil.copy2(src, dst)
    return url


async def cache_image(cache_key_str: str, src_url: str) -> None:
    src = url_to_disk_path(src_url)
    if not src or not src.is_file():
        return
    IMG_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    dst = cached_image_path(cache_key_str)
    temp = dst.with_name(f".{dst.name}.{uuid.uuid4().hex}.tmp")
    try:
        if not dst.exists():
            shutil.copy2(src, temp)
            temp.replace(dst)
    except OSError:
        pass  # An optional cache write must not invalidate a completed asset.
    finally:
        temp.unlink(missing_ok=True)


async def save_upload(project_id: str, filename: str, contents: bytes) -> str:
    return await save_normalized_image(project_id, filename, normalize_image(contents))


async def save_normalized_image(project_id: str, filename: str, data: bytes) -> str:
    """Persist bytes already returned by normalize_image, without a second decode."""
    path, url = _new_asset_path(project_id, filename)
    async with aiofiles.open(path, "xb") as file:
        await file.write(data)
    return url


async def save_bytes(project_id: str, filename: str, data: bytes) -> str:
    return await save_upload(project_id, filename, data)


async def download_and_save(url: str, project_id: str, filename: str) -> str:
    async with httpx.AsyncClient(timeout=60) as client, client.stream("GET", url) as response:
        response.raise_for_status()
        contents = bytearray()
        async for chunk in response.aiter_bytes():
            contents.extend(chunk)
            if len(contents) > MAX_IMAGE_BYTES:
                raise ValueError("模型返回的图片超过 20 MB")
    return await save_upload(project_id, filename, bytes(contents))
