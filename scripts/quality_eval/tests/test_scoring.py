from __future__ import annotations

import copy

import pytest

from scripts.quality_eval.dataset import case_digest, load_suite, suite_digest
from scripts.quality_eval.artifacts import canonical_sha256
from scripts.quality_eval.rubric import DIMENSIONS, apply_review, review_template
from scripts.quality_eval.scoring import compare_runs, evaluate_run


def seal(run):
    run["run_sha256"] = canonical_sha256({key: value for key, value in run.items() if key != "run_sha256"})
    return run


def output_for(case):
    case_id = case["id"]
    ids = [f"{case_id}-{depth}" for depth in range(3)]
    nodes = {}
    for depth, node_id in enumerate(ids):
        sections, hotspots = [], []
        for index in range(3):
            hotspot_id = f"section_{index + 1}"
            label = (case["branch_steps"][depth]["preferred_labels"][0]
                     if index == 0 and depth < 2 else f"Section {depth}-{index}")
            target = ids[depth + 1] if index == 0 and depth < 2 else None
            sections.append({"id": hotspot_id, "hotspot_id": hotspot_id, "title": label,
                             "body": f"This is substantive controlled content for {case_id}, page {depth}, section {index}. It explains this distinct mechanism.",
                             "target_node_id": target})
            hotspots.append({"id": hotspot_id, "kind": "section", "label": label, "selected": False, "target_node_id": target})
        document = {"version": 1, "layout": "atlas", "sections": sections}
        if depth == 0 and case["input"]["kind"] == "image":
            document = None
            hotspots = [{"id": f"hotspot-{index}", "kind": "image", "label": item["label"],
                         "position": {"x": item["box"]["x"], "y": item["box"]["y"]},
                         "size": {"width": item["box"]["width"], "height": item["box"]["height"]},
                         "selected": False, "target_node_id": ids[1] if index == 0 else None}
                        for index, item in enumerate(case["expected_hotspots"])]
        nodes[node_id] = {"id": node_id, "parent_id": ids[depth - 1] if depth else None, "depth": depth,
                          "title": f"Controlled {case_id} page {depth}", "description": "Controlled explanatory description.",
                          "children": ids[depth + 1:depth + 2], "hotspots": hotspots,
                          "scene_document": document, "source_type": "image" if document is None else "text",
                          "image_url": None, "status": "completed"}
    return {"case_id": case_id, "case_sha256": case_digest(case), "status": "completed", "mode": "replay",
            "project": {"project_id": case_id, "name": case_id, "root_node_id": ids[0], "nodes": nodes,
                        "settings": {"max_depth": 3, "max_hotspots_per_page": 3, "visual_style": "encyclopedia", "language": case["language"]}},
            "branch_node_ids": ids,
            "branch_path": [{"stage": stage, "label": case["branch_steps"][index]["preferred_labels"][0]}
                            for index, stage in enumerate(("child", "grandchild"))],
            "calls": [{"stage": stage, "state": "completed", "ok": True} for stage in ("root", "child", "grandchild")]}


def fixture_run(suite):
    return seal({"schema_version": 1, "run_id": "test-controlled", "mode": "replay", "model": "controlled-fixture",
                 "suite_sha256": suite_digest(suite), "prompt_sources_sha256": "prompt-1", "producer_sha256": "producer-1",
                 "evaluator_sha256": "method-1", "repeat": 1,
                 "policy": {"branch_selection": "strict-preferred-label", "stage_count": 3, "repeat_count": 1},
                 "budgets": {"max_calls": 18, "max_reserved_output_tokens": 72000},
                 "call_count": 18, "reserved_output_tokens": 72000,
                 "cases": [output_for(case) for case in suite["cases"]], "status": "completed"})


def reviewed(run, suite, kind="calibration"):
    review = review_template(run, suite)
    review["reviewer"] = {"kind": kind, "name": "controlled test, not real human quality"}
    for case in review["cases"]:
        for item in case["dimensions"].values():
            item.update(score=4, reason="Controlled calibration assertion.", evidence="Controlled fixture page and section.")
        for item in case["fact_checks"]:
            item.update(verdict="supported", reason="Controlled calibration assertion.", evidence="Controlled fixture evidence.")
        for item in case["forbidden_claims"]:
            item.update(verdict="absent", reason="Controlled absence calibration.", evidence="All three controlled pages checked.")
    return review


def agent_reviewed(run, suite):
    """Contract fixture only: these quotations do not establish factual truth."""
    review = review_template(run, suite, reviewer_kind="agent")
    review["reviewer"] = {"kind": "agent", "name": "controlled contract test", "model": "test-agent", "version": "test-v1"}
    for entry, output in zip(review["cases"], run["cases"], strict=True):
        project = output["project"]
        entry["inspected_node_ids"] = list(project["nodes"])
        root = project["nodes"].get(project["root_node_id"])
        evidence = [{"node_id": root["id"], "quote": root["title"]}] if root else []
        if not root:
            continue
        for item in entry["dimensions"].values():
            item.update(score=4, reason="Controlled agent contract assertion.", evidence=copy.deepcopy(evidence))
        for item in entry["fact_checks"]:
            item.update(verdict="supported", reason="Controlled agent contract assertion.", evidence=copy.deepcopy(evidence))
        for item in entry["forbidden_claims"]:
            item.update(verdict="absent", reason="Controlled available-page inspection.", evidence=[])
    return review


@pytest.fixture
def setup():
    suite = load_suite()
    return suite, fixture_run(suite)


def test_complete_structure_is_not_model_quality(setup):
    suite, run = setup
    result = evaluate_run(run, suite)
    assert result["execution"] == result["automatic"] == "passed"
    assert result["human_quality"] == "not_reviewed"
    assert result["overall_quality_score"] is None
    assert all(case["review"]["status"] == "not_reviewed" for case in result["cases"])


def test_incomplete_review_never_passes_or_applies(setup):
    suite, run = setup
    review = review_template(run, suite)
    assert evaluate_run(run, suite, review)["human_quality"] == "not_approved"
    with pytest.raises(ValueError, match="incomplete"):
        apply_review(run, suite, review)


def test_replay_calibration_cannot_be_human_model_approval(setup):
    suite, run = setup
    review = reviewed(run, suite)
    result = apply_review(run, suite, review)
    assert result["calibration"] == "passed"
    assert result["human_quality"] == "not_approved"
    review["reviewer"]["kind"] = "human"
    assert apply_review(run, suite, review)["human_quality"] == "not_approved"


def test_live_requires_explicit_complete_human_review(setup):
    suite, run = setup
    run["mode"] = "live"
    seal(run)
    assert apply_review(run, suite, reviewed(run, suite))["human_quality"] == "not_approved"
    assert apply_review(run, suite, reviewed(run, suite, "human"))["human_quality"] == "approved"


def test_agent_review_never_grants_human_approval(setup):
    suite, run = setup
    run["mode"] = "live"
    seal(run)
    result = apply_review(run, suite, agent_reviewed(run, suite))
    assert result["agent_quality"] == "passed"
    assert result["human_quality"] == "not_reviewed"
    assert result["calibration"] == "not_applicable"
    assert all(case["review"]["status"] == "passed" for case in result["cases"])


@pytest.mark.parametrize("field", ["name", "model", "version"])
def test_agent_identity_requires_explicit_provenance(setup, field):
    suite, run = setup
    review = agent_reviewed(run, suite)
    review["reviewer"].pop(field)
    assert evaluate_run(run, suite, review)["agent_quality"] == "invalid"
    with pytest.raises(ValueError):
        apply_review(run, suite, review)


@pytest.mark.parametrize("mutation", [
    lambda citation: citation.update(node_id="unproduced-page"),
    lambda citation: citation.update(section_id="missing-section"),
    lambda citation: citation.update(section_id=[]),
    lambda citation: citation.update(quote="A quotation invented by the reviewer."),
    lambda citation: citation.update(quote=" "),
])
def test_agent_citations_must_locate_actual_output(setup, mutation):
    suite, run = setup
    review = agent_reviewed(run, suite)
    mutation(review["cases"][0]["dimensions"]["body"]["evidence"][0])
    with pytest.raises(ValueError):
        apply_review(run, suite, review)


def test_agent_section_quote_is_bound_to_named_body(setup):
    suite, run = setup
    review = agent_reviewed(run, suite)
    output = run["cases"][0]
    root = output["project"]["nodes"][output["project"]["root_node_id"]]
    section = root["scene_document"]["sections"][0]
    review["cases"][0]["dimensions"]["body"]["evidence"] = [
        {"node_id": root["id"], "section_id": section["id"], "quote": section["body"]}]
    apply_review(run, suite, review)
    review["cases"][0]["dimensions"]["body"]["evidence"][0]["section_id"] = root["scene_document"]["sections"][1]["id"]
    with pytest.raises(ValueError):
        apply_review(run, suite, review)


def test_agent_child_quote_cannot_fulfil_required_root_fact(setup):
    suite, run = setup
    review = agent_reviewed(run, suite)
    output = run["cases"][0]
    child = output["project"]["nodes"][output["branch_node_ids"][1]]
    root_fact = next(check for check in suite["cases"][0]["fact_checks"] if check["applies_to"] == ["root"])
    item = next(item for item in review["cases"][0]["fact_checks"] if item["id"] == root_fact["id"])
    item["evidence"] = [{"node_id": child["id"], "quote": child["title"]}]
    with pytest.raises(ValueError):
        apply_review(run, suite, review)


@pytest.mark.parametrize("scope", [[], ["invented-page"], None, [[], []]])
def test_agent_absence_claim_requires_all_actual_pages_inspected(setup, scope):
    suite, run = setup
    review = agent_reviewed(run, suite)
    review["cases"][0]["inspected_node_ids"] = scope
    with pytest.raises(ValueError):
        apply_review(run, suite, review)


def test_agent_required_root_fact_not_mentioned_remains_failure(setup):
    suite, run = setup
    review = agent_reviewed(run, suite)
    root_fact = next(check for check in suite["cases"][0]["fact_checks"] if check["applies_to"] == ["root"])
    item = next(item for item in review["cases"][0]["fact_checks"] if item["id"] == root_fact["id"])
    item.update(verdict="not_mentioned", evidence=[])
    result = apply_review(run, suite, review)
    assert result["cases"][0]["review"]["status"] == "failed"
    assert f"required_fact_missing:{root_fact['id']}" in result["cases"][0]["review"]["failures"]


def test_agent_partial_failed_execution_can_be_saved_without_fabricating_review(setup):
    suite, run = setup
    output = run["cases"][0]
    output.update(status="failed", branch_node_ids=[], branch_path=[], calls=[])
    output["project"].update(root_node_id=None, nodes={})
    run["status"] = "incomplete"
    seal(run)
    review = agent_reviewed(run, suite)
    result = apply_review(run, suite, review)
    assert result["agent_quality"] == "partial"
    assert result["human_quality"] == "not_reviewed"
    assert result["execution"] == "failed"
    assert result["cases"][0]["review"]["status"] == "partial"
    assert result["cases"][0]["review"]["unreviewed_items"]
    assert not result["cases"][0]["review"]["errors"]
    comparison = compare_runs(run, run, suite, review, review)
    assert not comparison["comparable"]


def test_agent_completed_case_cannot_leave_dimension_unreviewed(setup):
    suite, run = setup
    review = agent_reviewed(run, suite)
    review["cases"][0]["dimensions"]["cross_page"].update(score=None, reason="Unavailable", evidence=[])
    with pytest.raises(ValueError):
        apply_review(run, suite, review)


@pytest.mark.parametrize("mutation,code", [
    (lambda root: root["scene_document"]["sections"][0].update(body="Only a title"), "empty_or_short_body"),
    (lambda root: root["scene_document"]["sections"][1].update(body=root["scene_document"]["sections"][0]["body"]), "duplicate_body"),
    (lambda root: root["hotspots"][0].update(target_node_id="absent"), "dangling_hotspot_target"),
    (lambda root: root["scene_document"]["sections"][0].update(target_node_id=None), "section_target_mismatch"),
    (lambda root: root.update(children=[]), "parent_missing_child"),
])
def test_bad_content_and_graph_fail_automatic_gate(setup, mutation, code):
    suite, run = setup
    output = next(case for case in run["cases"] if case["project"]["nodes"][case["project"]["root_node_id"]]["scene_document"])
    mutation(output["project"]["nodes"][output["project"]["root_node_id"]])
    seal(run)
    result = evaluate_run(run, suite)
    assert result["automatic"] == "failed"
    assert code in {item["code"] for case in result["cases"] for item in case["findings"]}


def test_geometry_error_is_not_hidden_by_valid_coordinates(setup):
    suite, run = setup
    output = next(case for case in run["cases"] if not case["project"]["nodes"][case["project"]["root_node_id"]]["scene_document"])
    root = output["project"]["nodes"][output["project"]["root_node_id"]]
    root["hotspots"][0]["position"] = {"x": 0, "y": 0}
    root["hotspots"][0]["size"] = {"width": 0.01, "height": 0.01}
    seal(run)
    result = evaluate_run(run, suite)
    assert result["automatic"] == "failed"
    assert "hotspot_grounding_mismatch" in {item["code"] for case in result["cases"] for item in case["findings"]}


def test_filtered_invalid_raw_output_remains_failure(setup):
    suite, run = setup
    run["cases"][0]["normalization_checks"] = [{"stage": "root", "invalid_hotspot_count": 1}]
    seal(run)
    result = evaluate_run(run, suite)
    assert result["automatic"] == "failed"
    assert result["cases"][0]["findings"][0]["code"] == "raw_output_filtered"


@pytest.mark.parametrize("change", ["contradiction", "forbidden", "low_dimension", "missing_fact"])
def test_semantic_negative_controls_require_human_failure(setup, change):
    suite, run = setup
    review = reviewed(run, suite)
    case = review["cases"][0]
    if change == "contradiction":
        case["fact_checks"][0]["verdict"] = "contradicted"
    elif change == "forbidden":
        case["forbidden_claims"][0]["verdict"] = "present"
    elif change == "low_dimension":
        case["dimensions"]["cross_page"]["score"] = 0
    else:
        case["fact_checks"][0]["verdict"] = "not_mentioned"
    result = apply_review(run, suite, review)
    assert result["calibration"] == "not_applicable"
    assert result["cases"][0]["review"]["status"] == "failed"


@pytest.mark.parametrize("change", ["run", "suite", "case", "rubric", "method", "reviewer", "dimensions", "facts", "duplicate_fact",
                                    "cases_null", "cases_string", "case_null", "dimension_null", "fact_verdict_list", "reviewer_kind_list",
                                    "case_id_list", "fact_id_list"])
def test_mismatched_or_incomplete_review_cannot_apply(setup, change):
    suite, run = setup
    review = reviewed(run, suite)
    if change in {"run", "suite"}:
        review[change + "_sha256"] = "wrong"
    elif change == "case":
        review["cases"][0]["case_sha256"] = "wrong"
    elif change == "rubric":
        review["rubric_version"] = "wrong"
    elif change == "method":
        review["evaluator_sha256"] = "wrong"
    elif change == "reviewer":
        review["reviewer"] = None
    elif change == "dimensions":
        review["cases"][0]["dimensions"] = None
    elif change == "facts":
        review["cases"][0]["fact_checks"] = []
    elif change.startswith("cases_"):
        review["cases"] = None if change == "cases_null" else "malformed"
    elif change == "case_null":
        review["cases"][0] = None
    elif change == "dimension_null":
        review["cases"][0]["dimensions"]["body"] = None
    elif change == "fact_verdict_list":
        review["cases"][0]["fact_checks"][0]["verdict"] = []
    elif change == "reviewer_kind_list":
        review["reviewer"]["kind"] = []
    elif change == "case_id_list":
        review["cases"][0]["case_id"] = []
    elif change == "fact_id_list":
        review["cases"][0]["fact_checks"][0]["id"] = []
    else:
        review["cases"][0]["fact_checks"].append(copy.deepcopy(review["cases"][0]["fact_checks"][0]))
    with pytest.raises(ValueError):
        apply_review(run, suite, review)
    comparison = compare_runs(run, run, suite, review, review)
    invalid = [row[side] for row in comparison["case_deltas"] for side in ("base", "candidate")
               if row[side]["review_status"] == "invalid"]
    assert invalid and all(item["dimension_scores"] is None for item in invalid)


@pytest.mark.parametrize("malformed", [None, [], "review"])
def test_nonobject_review_is_rejected(setup, malformed):
    suite, run = setup
    with pytest.raises(ValueError):
        apply_review(run, suite, malformed)
    comparison = compare_runs(run, run, suite, malformed, malformed)
    assert all(row[side]["dimension_scores"] is None for row in comparison["case_deltas"] for side in ("base", "candidate"))


@pytest.mark.parametrize("mutation", [
    lambda run: run.update(cases=None),
    lambda run: run["cases"].__setitem__(0, None),
    lambda run: run["cases"][0].update(branch_node_ids=[[]]),
    lambda run: run["cases"][0].update(project={"nodes": []}),
])
def test_malformed_run_fails_cleanly(setup, mutation):
    suite, run = setup
    mutation(run)
    with pytest.raises(ValueError):
        evaluate_run(run, suite)


@pytest.mark.parametrize("change", ["branch", "budget", "coverage", "method"])
def test_unfair_comparisons_do_not_rank_models(setup, change):
    suite, base = setup
    candidate = copy.deepcopy(base)
    if change == "branch":
        candidate["cases"][0]["branch_path"][0]["label"] = "Another actual topic"
    elif change == "budget":
        candidate["budgets"]["max_calls"] = 20
    elif change == "method":
        candidate["evaluator_sha256"] = "different evaluator"
    else:
        candidate["cases"].pop()
    seal(candidate)
    comparison = compare_runs(base, candidate, suite)
    assert not comparison["comparable"]
    assert comparison["winner"] is comparison["quality_score_delta"] is None


def test_prompt_and_implementation_changes_disclosed_with_body_pairs(setup):
    suite, base = setup
    candidate = copy.deepcopy(base)
    candidate.update(producer_sha256="new-producer", prompt_sources_sha256="new-prompt")
    seal(candidate)
    comparison = compare_runs(base, candidate, suite)
    assert comparison["comparable"]
    assert comparison["implementation_changed"] and comparison["prompt_sources_changed"]
    assert len(comparison["case_deltas"]) == 6
    assert comparison["case_deltas"][0]["base"]["pages"][0]["title"]


def test_unreviewed_runs_remain_generation_comparable_without_score_comparison(setup):
    suite, run = setup
    comparison = compare_runs(run, run, suite)
    assert comparison["comparable"]
    assert not comparison["review_scores_comparable"]
    assert "base_review_missing_invalid_or_partial" in comparison["review_comparison_reasons"]


def test_human_and_agent_scores_are_not_directly_comparable(setup):
    suite, run = setup
    comparison = compare_runs(run, run, suite, reviewed(run, suite, "human"), agent_reviewed(run, suite))
    assert comparison["comparable"]
    assert not comparison["review_scores_comparable"]
    assert "different_reviewer_kind" in comparison["review_comparison_reasons"]
    assert all(row[side]["dimension_scores"] for row in comparison["case_deltas"] for side in ("base", "candidate"))
    assert comparison["quality_score_delta"] is comparison["winner"] is None


@pytest.mark.parametrize("field", ["name", "model", "version"])
def test_different_agent_provenance_prevents_score_comparison(setup, field):
    suite, run = setup
    base_review = agent_reviewed(run, suite)
    candidate_review = copy.deepcopy(base_review)
    candidate_review["reviewer"][field] = "different-provenance"
    comparison = compare_runs(run, run, suite, base_review, candidate_review)
    assert comparison["comparable"]
    assert not comparison["review_scores_comparable"]
    assert f"different_reviewer_{field}" in comparison["review_comparison_reasons"]


def test_matching_complete_agent_reviews_allow_descriptive_score_comparison(setup):
    suite, run = setup
    review = agent_reviewed(run, suite)
    # A complete, valid low score is still comparable evidence, not an approval.
    review["cases"][0]["dimensions"]["body"]["score"] = 2
    comparison = compare_runs(run, run, suite, review, review)
    assert comparison["comparable"]
    assert comparison["review_scores_comparable"]
    assert not comparison["review_comparison_reasons"]
    assert comparison["quality_score_delta"] is comparison["winner"] is None


def test_boolean_score_is_not_a_numeric_rating(setup):
    suite, run = setup
    review = reviewed(run, suite)
    review["cases"][0]["dimensions"][next(iter(DIMENSIONS))]["score"] = True
    with pytest.raises(ValueError):
        apply_review(run, suite, review)


@pytest.mark.parametrize("binding", ["run_sha256", "evaluator_sha256"])
def test_global_review_binding_invalidates_each_case_and_comparison_scores(setup, binding):
    suite, run = setup
    review = reviewed(run, suite)
    review[binding] = "stale"
    result = evaluate_run(run, suite, review)
    assert "review_binding_mismatch" in result["review_errors"]
    assert all(case["review"]["status"] == "invalid" for case in result["cases"])
    comparison = compare_runs(run, run, suite, review, review)
    assert all(case[side]["dimension_scores"] is None for case in comparison["case_deltas"] for side in ("base", "candidate"))
