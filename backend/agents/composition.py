"""图片 prompt 构图模板工厂。

把"画什么样的构图"和"用什么风格"解耦：
- 构图（composition_type）：map / plate / scene / diagram，根据内容类型选
- 风格（style_desc）：DK 图鉴 / 水彩 / 极简 等，由用户在 settings 里选
"""

VALID_COMPOSITIONS = {"map", "plate", "scene", "diagram"}


def normalize(composition_type: str | None) -> str:
    """容错：LLM 可能返回任意字符串，统一映射到 4 个有效值。默认 plate。"""
    if not composition_type:
        return "plate"
    c = composition_type.strip().lower()
    if c in VALID_COMPOSITIONS:
        return c
    # 模糊映射
    if any(k in c for k in ("map", "地图", "park", "city", "tourist", "aerial", "bird")):
        return "map"
    if any(k in c for k in ("scene", "story", "event", "busy", "narrative", "故事", "事件")):
        return "scene"
    if any(k in c for k in ("diagram", "cutaway", "cross", "section", "exploded", "剖面", "结构")):
        return "diagram"
    return "plate"


def build_image_prompt(
    composition_type: str,
    subject_en: str,
    sub_topics_en: list[str],
    style_desc: str,
) -> str:
    """组装英文 image prompt。

    Prompt 结构遵循 DALL-E 3 / FLUX 最佳实践：
        Subject → Composition → Items → Style → Format
    每段一句完整自然散文（不用 "MUST" / "NOT" 等命令式 —— DALL-E 3 对正向描述响应更好），
    总长度控制在 350-450 字符（含 style_desc），避免被截断。
    """
    comp = normalize(composition_type)
    items = sub_topics_en[:4] if sub_topics_en else [subject_en]
    items_text = _list_with_and(items)

    if comp == "map":
        return (
            f"A hand-drawn illustrated tourist map of {subject_en}, viewed from a bird's-eye "
            f"aerial perspective like a vintage theme-park guide. The map shows {items_text} "
            "as small labeled landmarks placed at their natural locations across the canvas, "
            "connected by winding paths through soft watercolor greenery, water, and earth tones. "
            f"{style_desc}. "
            "Wide 16:9 layout, rich cartographic detail, gentle hand-lettered labels."
        )

    if comp == "diagram":
        return (
            f"A technical illustrated cutaway diagram of {subject_en}, drawn as an isometric "
            f"exploded view that reveals internal structure. Four components are clearly visible "
            f"and labeled: {items_text}, separated in space with thin leader lines connecting "
            "each to its name. "
            f"{style_desc}. "
            "Wide 16:9 layout, engineering reference book aesthetic, calm neutral palette."
        )

    if comp == "scene":
        return (
            f"A richly illustrated busy storybook spread depicting {subject_en}, in the tradition "
            "of Richard Scarry's busy world. The canvas contains four distinct micro-vignettes "
            f"side by side: {items_text}, each in its own corner of the scene with tiny characters "
            "and props doing different activities. "
            f"{style_desc}. "
            "Wide 16:9 layout, warm and curious atmosphere, soft hand-drawn line work."
        )

    # default: plate (encyclopedia)
    return (
        f"An illustrated encyclopedia reference plate about {subject_en}, presented like a page "
        f"from a DK Eyewitness book. The plate displays four distinct subjects arranged across "
        f"clean off-white paper with breathing space around each: {items_text}, each rendered "
        "as its own isolated specimen with a small handwritten label. "
        f"{style_desc}. "
        "Wide 16:9 layout, museum-display aesthetic, soft natural lighting."
    )


def _list_with_and(items: list[str]) -> str:
    """把 ['a', 'b', 'c', 'd'] 渲染为 'a, b, c, and d' —— DALL-E 3 对自然语言列表响应更好。"""
    items = [x for x in items if x]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return ", ".join(items[:-1]) + f", and {items[-1]}"
