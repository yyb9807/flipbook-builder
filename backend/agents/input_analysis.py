from agents.base import BaseLLMAgent, LLMConfig
from agents.composition import build_image_prompt
from agents.composition import normalize as normalize_composition
from agents.hotspot_localization import _compress_image_for_vision, sanitize_hotspots
from agents.knowledge import compose_knowledge, knowledge_prompt


class InputAnalysisAgent(BaseLLMAgent):
    def __init__(self, config: LLMConfig):
        super().__init__(config)

    async def analyze_image(self, image_b64: str, language: str = "zh") -> dict:
        # 压缩到 768px / JPEG q75，显著提速视觉调用
        image_b64, media_type = _compress_image_for_vision(image_b64, max_side=768, jpeg_quality=75)
        system = (
            "你是一个图片内容分析专家，专门为交互式知识翻页书分析素材。"
            "你的目标是挖掘图片中可以深度展开的知识主题和探索角度。"
            f"请用{language}语言回答，输出严格的 JSON 格式。"
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
                            "请深度分析这张图片，以知识翻页书的视角挖掘可展开的内容，返回 JSON：\n"
                            "{\n"
                            '  "summary": "一句话描述图片内容",\n'
                            '  "scene_type": "landscape/map/interior/portrait/abstract/other",\n'
                            '  "language_hint": "zh",\n'
                            '  "hotspots": [\n'
                            '    {"id": "hs_1", "label": "区域名称", "x": 0.3, "y": 0.4, "width": 0.2, "height": 0.15}\n'
                            '  ],\n'
                            '  "keywords": [\n'
                            '    {"label": "关键词1", "description": "这个方向可以展开的内容说明"}\n'
                            '  ]\n'
                            "}\n\n"
                            "hotspots：列出 3-5 个图片中最显著、互不重叠的可点击区域。\n"
                            "  - x/y/width/height 全部使用 0-1 之间的小数（相对图片宽高的比例）\n"
                            "  - x = 区域左上角的横向比例，y = 纵向比例\n"
                            "  - label 用简洁的名词\n"
                            "keywords：列出 4-8 个可深度展开的知识主题词（例如：历史文化、生态知识、摄影技巧等），要有探索价值。"
                        ),
                    },
                ],
            }
        ]

        raw = await self.call(messages, max_tokens=1200, system=system)
        result = self.extract_json(raw)
        if not result or not isinstance(result, dict):
            return {
                "summary": "图片内容",
                "main_objects": [],
                "scene_type": "other",
                "language_hint": language,
                "keywords": [],
                "hotspots": [],
            }
        if "keywords" not in result:
            result["keywords"] = []
        result["hotspots"] = sanitize_hotspots(result.get("hotspots"))
        # 兼容：从 hotspots 派生 main_objects（用于子页面生成的关键对象）
        if "main_objects" not in result or not result["main_objects"]:
            result["main_objects"] = [hs.get("label", "") for hs in result.get("hotspots", []) if hs.get("label")]
        return result

    async def analyze_text(self, text: str, language: str = "zh", style_desc: str = "",
                           content_format: str | None = None) -> dict:
        if content_format == "knowledge-v1":
            raw = await self.call(
                [{"role": "user", "content": f"知识页素材：\n{text}"}], max_tokens=4000,
                system=knowledge_prompt(language),
            )
            return compose_knowledge(self.extract_json(raw), style_desc)
        system = (
            "你是交互式知识翻页书的内容策划专家。"
            "你要把用户的文字素材转化为一张『可深度探索的封面图』。"
            "画面构图要根据内容类型选最合适的："
            "**地点/景区/城市** → 手绘旅游地图（鸟瞰），"
            "**物品/抽象主题** → DK 图鉴标本式（多个分离主体），"
            "**故事/事件** → Richard Scarry 繁忙场景（多个 micro-scene），"
            "**流程/机制** → 剖面图/拆解图。"
            f"请用{language}语言回答，所有英文字段必须用英文，输出严格的 JSON 格式。"
        )
        messages = [
            {
                "role": "user",
                "content": (
                    f"请分析以下文字内容，挖掘可探索的主题：\n\n"
                    f"{text}\n\n"
                    "**生成步骤**：\n"
                    "1. 判断内容类型：是『地点/景区』、『物品/主题』、『故事/事件』，还是『流程/机制』？\n"
                    "2. 决定 main_objects（4 个**具体的、画得出来的英文名词**）作为图中的可点击主体\n"
                    "3. 给出英文 subject_en（图片主题，简洁的英文短语）\n\n"
                    "返回 JSON：\n"
                    "{\n"
                    '  "summary": "一句话描述内容",\n'
                    '  "subject_en": "英文主题短语，如 \'Gucun Park, Shanghai\' 或 \'Cherry Blossom Culture\'",\n'
                    '  "composition_type": "map / plate / scene / diagram 之一",\n'
                    '  "main_objects": ["英文具体名词1", "英文具体名词2", "英文具体名词3", "英文具体名词4"],\n'
                    '  "main_objects_zh": ["中文标签1", "中文标签2", "中文标签3", "中文标签4"],\n'
                    '  "scene_type": "story / article / description / place / other",\n'
                    f'  "language_hint": "{language}",\n'
                    '  "keywords": [\n'
                    '    {"label": "关键词1", "description": "可展开的方向说明"}\n'
                    '  ]\n'
                    "}\n\n"
                    "**composition_type 选择规则**：\n"
                    "- map：内容是地点/公园/城市/景区/某地区域 → 鸟瞰地图\n"
                    "- plate：内容是某物品/某抽象概念/某文化主题 → 图鉴标本式\n"
                    "- scene：内容是故事/事件/某段历史/节日 → 多个 micro-scene\n"
                    "- diagram：内容是机器/系统/工艺流程 → 剖面拆解\n\n"
                    "**main_objects 要求**：4 个**具体名词**，画得出来。例如「樱花」√、「文化」✗。"
                    "如果是地图（map），这 4 个就是图上的 4 个景点（如 sakura forest, wooden bridge）。"
                    "如果是图鉴（plate），就是 4 个独立物品。\n"
                    "**main_objects_zh**：和 main_objects 一一对应的中文显示标签（用于热点 label）。"
                ),
            }
        ]

        raw = await self.call(messages, max_tokens=1500, system=system)
        result = self.extract_json(raw)
        if not result or not isinstance(result, dict):
            result = {
                "summary": text[:50],
                "subject_en": text[:60],
                "composition_type": "plate",
                "main_objects": [],
                "main_objects_zh": [],
                "scene_type": "other",
                "language_hint": language,
                "keywords": [],
            }
        # 补全字段
        result.setdefault("subject_en", result.get("summary", text[:60]))
        result.setdefault("composition_type", "plate")
        result.setdefault("main_objects", [])
        result.setdefault("main_objects_zh", result.get("main_objects", []))
        result.setdefault("keywords", [])
        # 由后端组装最终 image_prompt（不再让 LLM 自己拼）
        result["composition_type"] = normalize_composition(result.get("composition_type"))
        result["image_prompt"] = build_image_prompt(
            composition_type=result["composition_type"],
            subject_en=result["subject_en"],
            sub_topics_en=result.get("main_objects") or [],
            style_desc=style_desc or "",
        )
        return result
