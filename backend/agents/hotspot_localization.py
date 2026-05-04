import base64
import io
import time

from PIL import Image

from agents.base import BaseLLMAgent, LLMConfig, _log


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
        if not result or "hotspots" not in result:
            return {"hotspots": []}

        # 规范化坐标到 0-1 范围
        for hs in result["hotspots"]:
            for key in ("x", "y", "width", "height"):
                hs[key] = max(0.0, min(1.0, float(hs.get(key, 0.1))))

        return result

    async def generate_text_hotspots(self, main_objects: list[str], language: str = "zh") -> dict:
        """为文字内容生成虚拟热点（均匀分布）"""
        hotspots = []
        count = min(len(main_objects), 5)
        cols = 2
        for i, obj in enumerate(main_objects[:count]):
            col = i % cols
            row = i // cols
            hotspots.append({
                "id": f"hs_{i + 1}",
                "label": obj,
                "x": 0.1 + col * 0.45,
                "y": 0.15 + row * 0.3,
                "width": 0.35,
                "height": 0.2,
                "reason": f"展开关于「{obj}」的内容",
            })
        return {"hotspots": hotspots}
