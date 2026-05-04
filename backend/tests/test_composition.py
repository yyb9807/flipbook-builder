"""composition.py 是纯函数，最适合做 unit test。"""
import pytest

from agents.composition import VALID_COMPOSITIONS, build_image_prompt, normalize


class TestNormalize:
    def test_valid_passthrough(self):
        for c in VALID_COMPOSITIONS:
            assert normalize(c) == c

    def test_case_insensitive(self):
        assert normalize("MAP") == "map"
        assert normalize("Plate") == "plate"

    def test_none_or_empty_falls_back_to_plate(self):
        assert normalize(None) == "plate"
        assert normalize("") == "plate"
        assert normalize("   ") == "plate"

    def test_fuzzy_map_keywords(self):
        # LLM 可能返回中文或描述性字符串
        assert normalize("公园 map") == "map"
        assert normalize("city tourist map") == "map"
        assert normalize("地图") == "map"
        assert normalize("aerial bird's-eye") == "map"

    def test_fuzzy_scene_keywords(self):
        assert normalize("busy scene") == "scene"
        assert normalize("故事场景") == "scene"
        assert normalize("event narrative") == "scene"

    def test_fuzzy_diagram_keywords(self):
        assert normalize("剖面图") == "diagram"
        assert normalize("cross-section") == "diagram"
        assert normalize("exploded") == "diagram"

    def test_unknown_falls_back_to_plate(self):
        assert normalize("totally unrelated") == "plate"


class TestBuildImagePrompt:
    BASE_TOPICS = ["sakura forest", "wooden bridge", "tour boat", "stone lantern"]

    def test_map_includes_aerial_keywords(self):
        p = build_image_prompt("map", "Gucun Park", self.BASE_TOPICS, "DK style")
        assert "tourist map" in p
        assert "bird's-eye" in p
        assert "Gucun Park" in p
        # 必须包含所有 sub_topics
        for topic in self.BASE_TOPICS:
            assert topic in p

    def test_plate_emphasizes_separation(self):
        p = build_image_prompt("plate", "Sakura", self.BASE_TOPICS, "DK style")
        assert "encyclopedia" in p.lower() or "plate" in p.lower()
        # 用「distinct / isolated」表达分离（散文风，避免命令式）
        assert "distinct" in p.lower() or "isolated" in p.lower()

    def test_scene_uses_richard_scarry(self):
        p = build_image_prompt("scene", "Spring Festival", self.BASE_TOPICS, "DK")
        assert "Richard Scarry" in p
        assert "vignette" in p.lower()

    def test_diagram_uses_cutaway(self):
        p = build_image_prompt("diagram", "Steam Engine", self.BASE_TOPICS, "DK")
        assert "cutaway" in p.lower() or "cross-section" in p.lower() or "exploded" in p.lower()

    def test_invalid_composition_falls_back_to_plate(self):
        p_invalid = build_image_prompt("garbage", "Foo", self.BASE_TOPICS, "")
        p_plate = build_image_prompt("plate", "Foo", self.BASE_TOPICS, "")
        # normalize 会把 garbage → plate，所以两者一致
        assert p_invalid == p_plate

    def test_subject_appears_in_output(self):
        p = build_image_prompt("plate", "Cherry Blossom Culture", [], "DK")
        assert "Cherry Blossom Culture" in p

    def test_style_desc_embedded(self):
        p = build_image_prompt("plate", "Foo", ["a", "b", "c", "d"], "WATERCOLOR_STYLE_X")
        assert "WATERCOLOR_STYLE_X" in p

    def test_only_first_4_subtopics_used(self):
        topics = [f"item_{i}" for i in range(10)]
        p = build_image_prompt("plate", "Foo", topics, "")
        # 只用前 4 个
        assert "item_0" in p
        assert "item_3" in p
        assert "item_5" not in p

    def test_empty_subtopics_falls_back_to_subject(self):
        p = build_image_prompt("plate", "MySubject", [], "")
        # 没有 sub_topics 时用 subject 兜底
        assert "MySubject" in p


@pytest.mark.parametrize("comp", ["map", "plate", "scene", "diagram"])
def test_all_compositions_produce_non_empty(comp):
    p = build_image_prompt(comp, "X", ["a", "b", "c", "d"], "Y")
    assert len(p) > 100
    assert "16:9" in p  # 所有都是宽屏
