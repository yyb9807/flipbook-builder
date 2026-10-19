"""Prompt revision boundaries without a database or any provider requests."""
import hashlib
import json
import re
from unittest.mock import AsyncMock

import pytest

from agents.base import LLMConfig
from agents.input_analysis import InputAnalysisAgent
from agents.knowledge import knowledge_prompt
from agents.page_context import GENERATION_REVISION, build_page_context
from agents.page_generation import PageGenerationAgent
from tests.knowledge_fixtures import knowledge_result

CONFIG = LLMConfig("https://provider.invalid/v1", "fake-key", "fake-model")
# Captured before grounded-v2: compare the complete message/system/token bytes,
# rather than assuming that an omitted marker merely selects similar wording.
LEGACY_PROMPT_HASHES = {
    "text": "777b10026084c783eba12ce8efe83e9515a7d8a28cbbe806abfac4803b99aa6a",
    "image": "fa118e2f44dd9f2ca9869b74bd0e7730c093f3a4e40a25334960aa0822f78f01",
    "child": "e86c6807913215350037b27350aa4efced656ca5636ddb47e113d762c1f89d93",
}


def recorded_prompt(call):
    return {"messages": call.call_args.args[0], **call.call_args.kwargs}


@pytest.mark.parametrize("revision", [None, "unknown-future-revision"])
@pytest.mark.parametrize("kind", ["text", "image", "child"])
async def test_markerless_or_unrecognized_revision_retains_complete_old_request(monkeypatch, revision, kind):
    agent = PageGenerationAgent(CONFIG) if kind == "child" else InputAnalysisAgent(CONFIG)
    call = AsyncMock(return_value=json.dumps(knowledge_result()) if kind != "image" else "{}")
    monkeypatch.setattr(agent, "call", call)
    if kind == "text":
        await agent.analyze_text("Original source material.", language="en", style_desc="ink",
                                 content_format="knowledge-v1", generation_revision=revision)
    elif kind == "child":
        await agent.generate("Selected topic", "Parent title", "Parent body", language="en",
                             selected_keywords=["mechanism", "limits"], content_format="knowledge-v1",
                             generation_revision=revision)
    else:
        monkeypatch.setattr("agents.input_analysis._compress_image_for_vision",
                            lambda *args, **kwargs: ("compressed-image", "image/jpeg"))
        await agent.analyze_image("image-data", language="en", generation_revision=revision)
    encoded = json.dumps(recorded_prompt(call), ensure_ascii=False, sort_keys=True,
                         separators=(",", ":")).encode()
    assert hashlib.sha256(encoded).hexdigest() == LEGACY_PROMPT_HASHES[kind]
    call.assert_awaited_once()


@pytest.mark.parametrize(("language", "name"), [("en", "English"), ("zh", "中文")])
@pytest.mark.parametrize("kind", ["text", "child"])
async def test_grounded_knowledge_language_and_source_scopes_use_one_unchanged_contract(monkeypatch, language,
                                                                                      name, kind):
    agent = PageGenerationAgent(CONFIG) if kind == "child" else InputAnalysisAgent(CONFIG)
    call = AsyncMock(return_value=json.dumps(knowledge_result()))
    monkeypatch.setattr(agent, "call", call)
    source = "A fictional scenario. The source leaves the later procedure unspecified."
    if kind == "text":
        result = await agent.analyze_text(source, language=language, content_format="knowledge-v1",
                                          generation_revision=GENERATION_REVISION)
        user = call.call_args.args[0][0]["content"]
        assert source in user and "这是根页" in user and "主要事实留到子页" in user
    else:
        context = build_page_context(
            source_text=source, source_kind="text", root_title="Root", root_description="Generated root",
            ancestor_titles=["Root"], parent_title="Parent", parent_description="Generated overview",
            selected_label="Selected topic", selected_body="Generated selected explanation",
            covered_topics=["Earlier topic"],
        )
        result = await agent.generate("Selected topic", "Parent", context, language=language,
                                      content_format="knowledge-v1", generation_revision=GENERATION_REVISION)
        user = call.call_args.args[0][0]["content"]
        assert context in user and "不复述父页" in user
    call.assert_awaited_once()
    assert call.call_args.kwargs["max_tokens"] == 4000
    system = call.call_args.kwargs["system"]
    assert f"读者语言：{name}" in system and "可独立阅读" in system
    assert "sections.title和sections.body必须全部使用读者语言" in system
    assert "source.text仅在非空时代表原始用户文本" in system
    assert "可能含模型推断，不得升级为原始事实" in system
    assert "虚构、假设或示意素材始终保留该身份" in system
    assert "必要条件与充分条件" in system and "起算条件" in system
    assert result["sections"][0]["id"] == "section_1"
    assert result["sections"][0]["body"] == knowledge_result()["sections"][0]["body"]
    assert "generation_revision" not in result


@pytest.mark.parametrize(("language", "name"), [("en", "English"), ("zh", "中文")])
async def test_grounded_image_measures_actual_bounds_without_numeric_example_or_repair(monkeypatch,
                                                                                       language, name):
    agent = InputAnalysisAgent(CONFIG)
    response = {"summary": "Observed shapes", "scene_type": "abstract", "language_hint": language,
                "keywords": [], "hotspots": [
                    {"id": "hs_1", "label": "Visible object", "x": 0.17, "y": 0.24,
                     "width": 0.29, "height": 0.31},
                ]}
    call = AsyncMock(return_value=json.dumps(response))
    monkeypatch.setattr(agent, "call", call)
    monkeypatch.setattr("agents.input_analysis._compress_image_for_vision",
                        lambda *args, **kwargs: ("compressed-image", "image/jpeg"))
    result = await agent.analyze_image("image-data", language=language, generation_revision=GENERATION_REVISION)
    call.assert_awaited_once()
    assert call.call_args.kwargs["max_tokens"] == 1200
    system = call.call_args.kwargs["system"]
    assert f"读者语言为{name}" in system
    assert "summary、hotspots.label、keywords.label和keywords.description" in system
    assert "看不清的材质、身份、用途与背景不猜测" in system
    blocks = call.call_args.args[0][0]["content"]
    assert blocks[0]["source"]["data"] == "compressed-image"
    instruction = blocks[1]["text"]
    assert "最左、最上、最右、最下四条边" in instruction
    assert "完整可见边界" in instruction and "x+width、y+height不超过1" in instruction
    assert not re.search(r"\d+\.\d+", instruction)
    # Parsing remains the existing sanitizer, with the model's actual geometry.
    box = result["hotspots"][0]
    assert [box[key] for key in ("x", "y", "width", "height")] == [0.17, 0.24, 0.29, 0.31]


def test_grounded_revision_is_explicit_without_changing_the_default_prompt():
    assert knowledge_prompt("en") == knowledge_prompt("en", None)
    assert knowledge_prompt("en") == knowledge_prompt("en", "future")
    assert knowledge_prompt("en") != knowledge_prompt("en", GENERATION_REVISION)
