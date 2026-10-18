import base64
import io
import math
import time

from PIL import Image

from agents.base import BaseLLMAgent, LLMConfig, _log
from storage import url_to_disk_path


def sanitize_hotspots(raw: object, max_count: int = 12) -> list[dict]:
    """Accept only actual, finite image rectangles; never invent coordinates/scores."""
    if not isinstance(raw, list):
        return []
    limit = min(12, max(1, max_count if isinstance(max_count, int) else 3))
    valid = []
    for hotspot in raw:
        if not isinstance(hotspot, dict) or not isinstance(hotspot.get("label"), str):
            continue
        label = hotspot["label"].strip()[:200]
        coordinates = [hotspot.get(field) for field in ("x", "y", "width", "height")]
        if not label or any(isinstance(value, bool) or not isinstance(value, (int, float))
                            or not math.isfinite(value) for value in coordinates):
            continue
        x, y, width, height = coordinates
        if (x < 0 or y < 0 or width <= 0 or height <= 0
                or x + width > 1.000001 or y + height > 1.000001):
            continue
        score = hotspot.get("score")
        if (isinstance(score, bool) or not isinstance(score, (int, float))
                or not math.isfinite(score) or not 0 <= score <= 1):
            score = None
        valid.append({"label": label, "x": float(x), "y": float(y), "width": float(width),
                      "height": float(height), "score": score})
        if len(valid) >= limit:
            break
    return valid


def _compress_image_for_vision(image_b64: str, max_side: int = 768, jpeg_quality: int = 75) -> tuple[str, str]:
    """把图片压缩到最长边 max_side、JPEG 质量 jpeg_quality，返回 (新 base64, media_type)。
    显著减少视觉模型处理时间（>5x 提速）。"""
    t0 = time.time()
    try:
        raw = base64.b64decode(image_b64)
        orig_size_kb = len(raw) / 1024
        img = Image.open(io.BytesIO(raw))
        # 转成 RGB（PNG 可能带 alpha 通道）
        if img.mode in ("RGBA", "LA", "P"):
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[-1] if img.mode in ("RGBA", "LA") else None)
            img = bg
        elif img.mode != "RGB":
            img = img.convert("RGB")

        # 等比缩放：长边不超过 max_side
        w, h = img.size
        if max(w, h) > max_side:
            if w >= h:
                new_w = max_side
                new_h = int(h * max_side / w)
            else:
                new_h = max_side
                new_w = int(w * max_side / h)
            img = img.resize((new_w, new_h), Image.LANCZOS)

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=jpeg_quality, optimize=True)
        new_size_kb = len(buf.getvalue()) / 1024
        _log(f"  · img-compress {orig_size_kb:.0f}KB → {new_size_kb:.0f}KB took={time.time() - t0:.2f}s")
        return base64.b64encode(buf.getvalue()).decode(), "image/jpeg"
    except Exception as e:
        _log(f"  · img-compress FAILED took={time.time() - t0:.2f}s err={e}")
        return image_b64, "image/jpeg"


class HotspotLocalizationAgent(BaseLLMAgent):
    def __init__(self, config: LLMConfig):
        super().__init__(config)

    async def localize_asset(
        self, image_url: str | None, main_objects: list[str], language: str = "zh", max_hotspots: int = 3,
    ) -> list[dict]:
        """One localization call for a safe local image, or an explicit empty result."""
        path = url_to_disk_path(image_url)
        if path is None or not path.is_file():
            return []
        try:
            encoded = base64.b64encode(path.read_bytes()).decode()
            result = await self.localize(encoded, main_objects, language)
            return sanitize_hotspots(result.get("hotspots"), max_hotspots)
        except Exception as exc:
            _log(f"图片热点定位失败: {type(exc).__name__}")
            return []

    async def localize(self, image_b64: str, main_objects: list[str], language: str = "zh") -> dict:
        # 压缩到 768px 长边、JPEG q75，显著提速视觉调用
        image_b64, media_type = _compress_image_for_vision(image_b64, max_side=768, jpeg_quality=75)
        objects_str = "、".join(main_objects) if main_objects else "图中主要区域"
        system = (
            "你是一个图像区域定位专家。你的任务是在图片中标注可点击探索的热点区域。"
            "坐标必须使用 0-1 之间的小数（相对于图片宽高的比例）。"
            f"请用{language}语言填写标签，输出严格的 JSON 格式。"
        )
        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": image_b64,
                        },
                    },
                    {
                        "type": "text",
                        "text": (
                            f"已识别的主要对象：{objects_str}\n\n"
                            "请在图片中标注 3-5 个适合作为可点击探索入口的热点区域。\n"
                            "要求：\n"
                            "- 区域不要互相重叠\n"
                            "- 选择视觉上清晰、内容丰富的区域\n"
                            "- 坐标全部使用 0-1 之间的小数（x=左边距比例，y=上边距比例）\n\n"
                            "返回 JSON 格式：\n"
                            "{\n"
                            '  "hotspots": [\n'
                            "    {\n"
                            '      "id": "hs_1",\n'
                            '      "label": "区域名称",\n'
                            '      "x": 0.3,\n'
                            '      "y": 0.4,\n'
                            '      "width": 0.2,\n'
                            '      "height": 0.15,\n'
                            '      "reason": "为什么这个区域适合展开"\n'
                            "    }\n"
                            "  ]\n"
                            "}"
                        ),
                    },
                ],
            }
        ]

        # max_tokens=600 对热点 JSON 足够（5 个热点 ≈ 400 字）
        raw = await self.call(messages, max_tokens=600, system=system)
        result = self.extract_json(raw)
        if not isinstance(result, dict):
            return {"hotspots": []}
        return {"hotspots": sanitize_hotspots(result.get("hotspots"))}
