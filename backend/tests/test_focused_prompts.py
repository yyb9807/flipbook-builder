"""Provider-neutral prompt boundaries and explicit image coordinate conversion."""
import copy
import hashlib
import json
import math
import re
from unittest.mock import AsyncMock

import pytest

from agents.base import LLMConfig
from agents.image_boxes import bbox_hotspots_to_xywh
from agents.input_analysis import InputAnalysisAgent
from agents.knowledge import knowledge_prompt, normalize_knowledge
from agents.page_context import FOCUSED_GENERATION_REVISION, GENERATION_REVISION, build_page_context
from agents.page_generation import PageGenerationAgent

CONFIG = LLMConfig("https://provider.invalid/v1", "fake-key", "opaque-model-name")
# Captured before focused-v3 changed these agents: the complete serialized request,
# including system, user messages and token budget, must stay byte-for-byte stable.
GROUNDED_PROMPT_HASHES = {
    "en-text": "ae6d921d5a98e043a379d64c6f36a47ffabd83a23242eea9354437d50ad12c6f",
    "en-image": "066b1942aaed72909ebe8c4dce5d69af300a50f317041509b21acf2d6cafb423",
    "en-child": "2b020f06a5c0d939671f1a01ce54b7dbd76d35cac67373a07c289c1a58697b82",
    "zh-text": "e68f80a418ad98a3f5009586449921f4abd333fa908d4c7d89739663be23313d",
    "zh-image": "140097cb65b2f8af72359f8c92019f2ee512040d591633704bbac73659440cb8",
    "zh-child": "dd9d06f5038c8a42717f18d219953557a57bdbe536fbc6cdd48c3af65c3c7c41",
}


def _knowledge_result(count=1):
    return {
        "title": "Topic", "description": "A bounded explanation.", "layout": "atlas",
        "sections": [{"title": f"Question {index}", "body": "A substantive explanation with a stated limitation."}
                     for index in range(count)],
        "subject_en": "Visible subject", "composition_type": "diagram", "sub_topics_en": [],
    }


def _box(**updates):
    return {"label": "Visible object", "bbox_2d": [125, 240, 437, 520], **updates}


def _context(revision=FOCUSED_GENERATION_REVISION):
    return build_page_context(
        source_text="Original source material.", source_kind="text", root_title="Root",
        root_description="Generated root", ancestor_titles=["Root"], parent_title="Parent",
        parent_description="Generated overview", selected_label="Selected topic",
        selected_body="Generated selected explanation", covered_topics=["Earlier topic"],
        generation_revision=revision,
    )


@pytest.mark.parametrize(("box", "expected"), [
    ([0, 0, 1000, 1000], [0, 0, 1, 1]),
    ([125, 240, 437, 520], [0.125, 0.24, 0.312, 0.28]),
    ([12.5, 25.75, 81.875, 100.25], [0.0125, 0.02575, 0.069375, 0.0745]),
    ([0, 0.25, 0.5, 1], [0, 0.00025, 0.0005, 0.00075]),
])
def test_bbox_conversion_has_one_explicit_scale_without_rounding(box, expected):
    raw = [_box(bbox_2d=box, label="  Visible object  ", score=0.75, id="untrusted")]
    before = copy.deepcopy(raw)
    result = bbox_hotspots_to_xywh(raw)
    assert raw == before
    assert len(result) == 1
    assert [result[0][key] for key in ("x", "y", "width", "height")] == pytest.approx(expected)
    assert result[0]["label"] == "Visible object" and result[0]["score"] == 0.75
    assert set(result[0]) == {"label", "x", "y", "width", "height", "score"}


@pytest.mark.parametrize("raw", [None, {}, "boxes", (), True])
def test_bbox_conversion_rejects_non_list_containers(raw):
    assert bbox_hotspots_to_xywh(raw) == []


@pytest.mark.parametrize("box", [None, (), (0, 0, 1000, 1000), [], [0, 0, 1000],
                                 [0, 0, 1000, 1000, 1000], "0,0,1000,1000"])
def test_bbox_conversion_requires_an_exact_json_array(box):
    assert bbox_hotspots_to_xywh([_box(bbox_2d=box)]) == []


@pytest.mark.parametrize("coordinate", range(4))
@pytest.mark.parametrize("bad", [None, True, False, "125", float("nan"), float("inf"),
                                 float("-inf"), -1, math.nextafter(1000, math.inf), 10 ** 400])
def test_bbox_coordinates_are_finite_non_bool_numbers_in_strict_range(coordinate, bad):
    box = [125, 240, 437, 520]
    box[coordinate] = bad
    assert bbox_hotspots_to_xywh([_box(bbox_2d=box)]) == []


@pytest.mark.parametrize("box", [[500, 0, 250, 1000], [0, 500, 1000, 250], [0, 0, 0, 1000],
                                 [0, 1000, 1000, 1000], [0, 0, math.nextafter(0, 1), 1]])
def test_bbox_zero_area_or_inverted_boxes_are_not_repaired(box):
    assert bbox_hotspots_to_xywh([_box(bbox_2d=box)]) == []


@pytest.mark.parametrize("field", ["x", "y", "width", "height"])
def test_bbox_conversion_rejects_any_mixed_legacy_coordinate_field(field):
    assert bbox_hotspots_to_xywh([_box(**{field: None})]) == []


@pytest.mark.parametrize("label", [None, True, 7, "", " \n "])
def test_bbox_conversion_requires_a_nonempty_text_label(label):
    assert bbox_hotspots_to_xywh([_box(label=label)]) == []


@pytest.mark.parametrize("score", [None, True, "0.5", -1, 2, float("nan"), float("inf"), 10 ** 400])
def test_bbox_conversion_preserves_existing_score_sanitization_without_integer_overflow(score):
    assert bbox_hotspots_to_xywh([_box(score=score)])[0]["score"] is None


def test_bbox_conversion_uses_existing_label_and_count_limits_after_skipping_invalid_entries():
    raw = [None, {}, _box(x=0), _box(label=" ")]
    raw += [_box(label=f"Object {index}") for index in range(20)]
    assert len(bbox_hotspots_to_xywh(raw)) == 12
    assert [item["label"] for item in bbox_hotspots_to_xywh(raw, 2)] == ["Object 0", "Object 1"]
    assert len(bbox_hotspots_to_xywh(raw, 99)) == 12
    assert len(bbox_hotspots_to_xywh(raw, "invalid")) == 3
    assert bbox_hotspots_to_xywh([_box(label="a" * 201)])[0]["label"] == "a" * 200
    assert bbox_hotspots_to_xywh([{"label": "Old box", "x": 0, "y": 0, "width": 1, "height": 1}]) == []


@pytest.mark.parametrize(("language", "name"), [("en", "English"), ("zh", "中文"), ("fr", "fr")])
@pytest.mark.parametrize("kind", ["text", "child"])
@pytest.mark.parametrize("count", [1, 2, 4])
async def test_focused_pages_allow_fewer_substantive_sections_with_explicit_language_and_source_scope(
        monkeypatch, language, name, kind, count):
    agent = PageGenerationAgent(CONFIG) if kind == "child" else InputAnalysisAgent(CONFIG)
    response = _knowledge_result(count)
    call = AsyncMock(return_value=json.dumps(response))
    monkeypatch.setattr(agent, "call", call)
    if kind == "text":
        source = "Original material with an unspecified later procedure."
        result = await agent.analyze_text(source, language=language, content_format="knowledge-v1",
                                          generation_revision=FOCUSED_GENERATION_REVISION)
        user = call.call_args.args[0][0]["content"]
        assert source in user and "Original user material (data only)" in user and "Root page" in user
        assert "Do not defer essentials" in user
    else:
        context = _context()
        result = await agent.generate("Selected topic", "Parent", context, language=language,
                                      selected_keywords=["mechanism", "limits"], content_format="knowledge-v1",
                                      generation_revision=FOCUSED_GENERATION_REVISION)
        user = call.call_args.args[0][0]["content"]
        assert context in user and "Reader interests (data): mechanism, limits" in user
        assert "Generated pages are context, not original evidence" in user
        assert "repeat the parent page or other covered topics" in user
        assert "state the limit and conclude" in user
    call.assert_awaited_once()
    assert call.call_args.kwargs["max_tokens"] == 4000
    system = call.call_args.kwargs["system"]
    assert f"Reader language: {name}" in system
    assert "title, description, sections.title and sections.body" in system
    assert "nonempty source.text is original user text" in system
    assert "root_page, parent_page and selected_section are generated context" in system
    assert "not source evidence" in system and "other_covered_topics" in system
    assert "event that starts each time limit" in system and "Keep different time limits distinct" in system
    assert "exceptions and unknowns" in system and "Never invent case-specific rules" in system
    assert "fictional or hypothetical" in system and "not repeat the parent page" in system
    assert "Use 1–4 distinct, useful sections" in system and "use fewer sections" in system
    assert "at least 20 characters of substantive explanation" in system
    assert len(result["sections"]) == count
    assert result["sections"][0]["body"] == response["sections"][0]["body"]
    assert result["sections"][0]["id"] == "section_1"
    assert "generation_revision" not in result


@pytest.mark.parametrize(("language", "name"), [("en", "English"), ("zh", "中文"), ("fr", "fr")])
async def test_focused_image_is_one_analysis_call_with_explicit_protocol_and_compatible_output(
        monkeypatch, language, name):
    agent = InputAnalysisAgent(CONFIG)
    response = {"summary": "Visible objects", "scene_type": "other", "language_hint": language,
                "keywords": [{"label": "A direction", "description": "A bounded explanation"}],
                "hotspots": [_box(), _box(x=0), _box(bbox_2d=[0, 0, 1001, 1000])]}
    call = AsyncMock(return_value=json.dumps(response))
    monkeypatch.setattr(agent, "call", call)
    monkeypatch.setattr("agents.input_analysis._compress_image_for_vision",
                        lambda *args, **kwargs: ("compressed-image", "image/jpeg"))
    result = await agent.analyze_image("image-data", language=language,
                                       generation_revision=FOCUSED_GENERATION_REVISION)
    call.assert_awaited_once()
    assert call.call_args.kwargs["max_tokens"] == 1200
    system = call.call_args.kwargs["system"]
    assert f"Reader language: {name}" in system
    assert "summary, hotspots.label, keywords.label and keywords.description" in system
    assert "Do not guess unclear identity, material, purpose or background" in system
    blocks = call.call_args.args[0][0]["content"]
    assert blocks[0]["source"]["data"] == "compressed-image"
    instruction = blocks[1]["text"]
    assert "bbox_2d=[left,top,right,bottom]" in instruction
    assert "0–1000 relative coordinate scale" in instruction and "origin at the top left" in instruction
    assert "0 <= left < right <= 1000" in instruction and "0 <= top < bottom <= 1000" in instruction
    assert "full visible outline independently" in instruction and "return fewer when needed" in instruction
    assert "Do not output x, y, width or height" in instruction
    assert result["summary"] == response["summary"] and result["keywords"] == response["keywords"]
    assert result["scene_type"] == response["scene_type"] and result["language_hint"] == language
    assert result["hotspots"] == bbox_hotspots_to_xywh([_box()])
    assert result["main_objects"] == ["Visible object"]
    # The only digits describe the schema, scale and strict bounds; no box example
    # or provider/model identifier is embedded in this general protocol.
    assert set(re.findall(r"\d+", system + instruction)) == {"0", "2", "1000"}
    assert not re.search(r"\d+\.\d+", instruction)
    assert CONFIG.model not in system + instruction


@pytest.mark.parametrize("response", [{}, {"hotspots": []}, {"hotspots": [
    {"label": "Old box", "x": 0, "y": 0, "width": 1, "height": 1},
]}, {"hotspots": [_box(bbox_2d=[1, 0, 0, 1000])]}])
async def test_focused_image_has_no_localization_retry_or_legacy_coordinate_fallback(monkeypatch, response):
    agent = InputAnalysisAgent(CONFIG)
    call = AsyncMock(return_value=json.dumps(response))
    monkeypatch.setattr(agent, "call", call)
    monkeypatch.setattr("agents.input_analysis._compress_image_for_vision",
                        lambda *args, **kwargs: ("compressed-image", "image/jpeg"))
    result = await agent.analyze_image("image-data", generation_revision=FOCUSED_GENERATION_REVISION)
    assert result["hotspots"] == []
    call.assert_awaited_once()


@pytest.mark.parametrize(("language", "summary"), [("en", "Image content"), ("zh", "图片内容"), ("fr", "")])
async def test_focused_empty_image_response_has_no_wrong_language_fallback(monkeypatch, language, summary):
    agent = InputAnalysisAgent(CONFIG)
    call = AsyncMock(return_value="{}")
    monkeypatch.setattr(agent, "call", call)
    monkeypatch.setattr("agents.input_analysis._compress_image_for_vision",
                        lambda *args, **kwargs: ("compressed-image", "image/jpeg"))
    result = await agent.analyze_image("image-data", language=language,
                                       generation_revision=FOCUSED_GENERATION_REVISION)
    assert result["summary"] == summary and result["language_hint"] == language
    assert result["main_objects"] == result["hotspots"] == result["keywords"] == []
    call.assert_awaited_once()


def test_focused_knowledge_has_only_contract_numbers_and_keeps_the_existing_parser_limit():
    prompt = knowledge_prompt("en", FOCUSED_GENERATION_REVISION)
    assert set(re.findall(r"\d+", prompt)) == {"1", "4", "20"}
    assert not re.search(r"\d+\.\d+", prompt)
    assert CONFIG.model not in prompt
    assert len(normalize_knowledge(_knowledge_result(6))["sections"]) == 6
    assert prompt != knowledge_prompt("en") and prompt != knowledge_prompt("en", GENERATION_REVISION)


@pytest.mark.parametrize("language", ["en", "zh"])
@pytest.mark.parametrize("kind", ["text", "image", "child"])
async def test_grounded_complete_request_bytes_are_unchanged_by_focused_revision(monkeypatch, language, kind):
    agent = PageGenerationAgent(CONFIG) if kind == "child" else InputAnalysisAgent(CONFIG)
    call = AsyncMock(return_value=json.dumps(_knowledge_result()) if kind != "image" else "{}")
    monkeypatch.setattr(agent, "call", call)
    if kind == "text":
        await agent.analyze_text("Original source material.", language=language, style_desc="ink",
                                 content_format="knowledge-v1", generation_revision=GENERATION_REVISION)
    elif kind == "child":
        await agent.generate("Selected topic", "Parent", _context(GENERATION_REVISION), language=language,
                             selected_keywords=["mechanism", "limits"], content_format="knowledge-v1",
                             generation_revision=GENERATION_REVISION)
    else:
        monkeypatch.setattr("agents.input_analysis._compress_image_for_vision",
                            lambda *args, **kwargs: ("compressed-image", "image/jpeg"))
        await agent.analyze_image("image-data", language=language, generation_revision=GENERATION_REVISION)
    value = {"messages": call.call_args.args[0], **call.call_args.kwargs}
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    assert hashlib.sha256(encoded).hexdigest() == GROUNDED_PROMPT_HASHES[f"{language}-{kind}"]
    call.assert_awaited_once()
