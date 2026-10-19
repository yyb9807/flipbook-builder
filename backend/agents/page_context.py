"""Bounded generation inputs shared by durable admission and quality experiments."""
from __future__ import annotations

import json
import os

GENERATION_REVISION = "grounded-v2"
FOCUSED_GENERATION_REVISION = "focused-v3"
EXPERIMENTAL_GENERATION_REVISIONS = frozenset({GENERATION_REVISION, FOCUSED_GENERATION_REVISION})


def configured_generation_revision() -> str | None:
    """New behavior is experimental and must be explicitly enabled by the host.

    New admissions validate the host setting and persist their own decision.
    Replays use only that frozen marker, never the current host configuration.
    """
    value = os.getenv("KNOWLEDGE_GENERATION_REVISION", "").strip()
    if not value:
        return None
    if value not in EXPERIMENTAL_GENERATION_REVISIONS:
        raise ValueError(
            "KNOWLEDGE_GENERATION_REVISION 配置错误：仅支持 grounded-v2 或 focused-v3；"
            "未设置或留空时使用当前默认生成行为"
        )
    return value


def bounded_text(value: str | None, limit: int) -> str:
    text = value if isinstance(value, str) else ""
    if len(text) <= limit:
        return text
    marker = "\n[内容过长，中段已省略 / middle omitted]\n"
    remaining = limit - len(marker)
    return text[:remaining // 2] + marker + text[-(remaining - remaining // 2):]


def build_page_context(*, source_text: str | None, source_kind: str,
                       root_title: str, root_description: str, ancestor_titles: list[str],
                       parent_title: str, parent_description: str, selected_label: str,
                       selected_body: str, covered_topics: list[str],
                       generation_revision: str = GENERATION_REVISION) -> str:
    """Keep source, page context and coverage distinct; never manufacture facts.

    The source must be the original user text, never an evaluator fact list.
    An image's generated overview is page context, not a verified visual source.
    Callers persist the returned string before any provider attempt.
    """
    original = source_text if isinstance(source_text, str) else ""
    context = {
        "context_version": generation_revision,
        "source": {"kind": "user_text" if original else source_kind,
                   "text": bounded_text(original, 8000), "truncated": len(original) > 8000},
        "root_page": {"title": bounded_text(root_title, 200),
                      "overview": bounded_text(root_description, 2000),
                      "is_original_source": False},
        "ancestor_titles": [bounded_text(title, 200) for title in ancestor_titles[:12]],
        "parent_page": {"title": bounded_text(parent_title, 200),
                        "overview": bounded_text(parent_description, 2000)},
        "selected_section": {"title": bounded_text(selected_label, 200),
                             "body": bounded_text(selected_body, 5000)},
        "other_covered_topics": [bounded_text(title, 200) for title in covered_topics[:6]],
    }
    return json.dumps(context, ensure_ascii=False, separators=(",", ":"))
