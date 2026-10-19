"""Versioned human review contract; never infer factual correctness from structure."""
from __future__ import annotations

RUBRIC_VERSION = "quality-rubric-v2"
DIMENSIONS = {
    "body": {
        "label": "正文实质与事实 / Substance and facts",
        "anchors": ["空白、主要内容错误或编造", "多数内容浅薄或有明显事实错误", "有解释，但有遗漏或待核实结论", "解释充分、依据一致，仅有小瑕疵", "准确具体、机制清晰，恰当说明不确定性"],
    },
    "hotspots": {
        "label": "热点语义与定位 / Hotspot relevance and grounding",
        "anchors": ["入口不可用或指向错误对象", "多数入口含糊、错误或重复", "入口可用但部分标签/位置或深挖价值不足", "标签、位置和展开主题基本准确", "入口精确清晰、互有区分，适合继续探索"],
    },
    "cross_page": {
        "label": "跨页推进与一致性 / Progression and consistency",
        "anchors": ["主要跨页矛盾、偏题或流程断裂", "大量重复、关键术语或关系不一致", "大体连贯，但重复或深度推进不足", "父子主题一致，解释逐层深入", "三层内容互补，术语、因果和边界一致"],
    },
    "instruction": {
        "label": "指令与素材边界 / Instruction and source fidelity",
        "anchors": ["违背核心约束或编造真实身份/来源", "多项语言、素材或输出要求未遵循", "核心要求满足，仍有明显边界问题", "要求基本满足，区分已知与未知", "完整遵循素材、语言和知识边界，无额外编造"],
    },
}


def review_template(run: dict, suite: dict, *, reviewer_kind="human") -> dict:
    """A deliberately incomplete template bound to one exact run and dataset."""
    from .artifacts import canonical_sha256, evaluator_sha256

    if reviewer_kind not in {"human", "calibration", "agent"}:
        raise ValueError("invalid_reviewer_kind")
    cases = {case["id"]: case for case in suite["cases"]}
    result = {
        "schema_version": 1, "rubric_version": RUBRIC_VERSION,
        "evaluator_sha256": evaluator_sha256(),
        "run_sha256": canonical_sha256({key: value for key, value in run.items() if key != "run_sha256"}),
        "suite_sha256": run.get("suite_sha256"),
        "reviewer": {"kind": reviewer_kind, "name": ""},
        "cases": [],
    }
    if reviewer_kind == "agent":
        result["reviewer"].update(model="", version="")
    for output in run.get("cases", []):
        case = cases.get(output.get("case_id"), {})
        result["cases"].append({
            "case_id": output.get("case_id"), "case_sha256": output.get("case_sha256"),
            # Required for agent reviews; human/calibration reviews retain their
            # existing free-text evidence contract.
            "inspected_node_ids": [],
            "dimensions": {key: {"score": None, "reason": "", "evidence": [] if reviewer_kind == "agent" else ""} for key in DIMENSIONS},
            "fact_checks": [{"id": item["id"], "verdict": None, "reason": "", "evidence": [] if reviewer_kind == "agent" else ""}
                            for item in case.get("fact_checks", [])],
            "forbidden_claims": [{"id": item["id"], "verdict": None, "reason": "", "evidence": [] if reviewer_kind == "agent" else ""}
                                 for item in case.get("forbidden_claims", [])],
        })
    return result


def apply_review(run: dict, suite: dict, review: dict) -> dict:
    from .scoring import evaluate_run

    if not isinstance(review, dict):
        raise ValueError("Review must be an object")
    assessment = evaluate_run(run, suite, review)
    if (assessment["binding_errors"] or assessment["review_errors"]
            or any(case["review"]["status"] == "invalid" for case in assessment["cases"])):
        raise ValueError("Review is incomplete or does not match this exact run, dataset and rubric")
    return assessment
