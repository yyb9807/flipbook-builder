"""Deterministic diagnostics and evidence-bound review gates, without an AI judge."""
from __future__ import annotations

import math
import re
from collections import Counter

from .artifacts import canonical_sha256
from .rubric import DIMENSIONS, RUBRIC_VERSION

METHOD_VERSION = "quality-diagnostics-v2"


def _run_digest(run):
    return canonical_sha256({key: value for key, value in run.items() if key != "run_sha256"})


def _validate_run(run):
    """Malformed local artifacts fail cleanly before traversing their contents."""
    if not isinstance(run, dict) or not isinstance(run.get("cases"), list) or len(run["cases"]) > 50:
        raise ValueError("invalid_run_structure")
    for output in run["cases"]:
        if not isinstance(output, dict) or not isinstance(output.get("case_id"), str):
            raise ValueError("invalid_case_output")
        for field in ("calls", "branch_path", "normalization_checks"):
            rows = output.get(field, [])
            if not isinstance(rows, list) or len(rows) > 200 or any(not isinstance(item, dict) for item in rows):
                raise ValueError("invalid_case_collection")
        branch = output.get("branch_node_ids", [])
        if not isinstance(branch, list) or any(not isinstance(item, str) for item in branch):
            raise ValueError("invalid_branch_ids")
        project = output.get("project") or {}
        if not isinstance(project, dict) or not isinstance(project.get("nodes", {}), dict):
            raise ValueError("invalid_project_structure")
        if project.get("root_node_id") is not None and not isinstance(project["root_node_id"], str):
            raise ValueError("invalid_root_identity")
        if len(project.get("nodes", {})) > 100:
            raise ValueError("too_many_output_nodes")
        for node in project.get("nodes", {}).values():
            if not isinstance(node, dict):
                raise ValueError("invalid_node_structure")
            if (not isinstance(node.get("id"), str)
                    or (node.get("parent_id") is not None and not isinstance(node["parent_id"], str))):
                raise ValueError("invalid_node_identity")
            children, hotspots = node.get("children", []), node.get("hotspots", [])
            if (not isinstance(children, list) or any(not isinstance(item, str) for item in children)
                    or not isinstance(hotspots, list) or len(hotspots) > 100
                    or any(not isinstance(item, dict) for item in hotspots)):
                raise ValueError("invalid_node_collections")
            if not isinstance(node.get("depth"), int) or isinstance(node.get("depth"), bool):
                raise ValueError("invalid_node_depth")
            for hotspot in hotspots:
                if (not isinstance(hotspot.get("id"), str) or not isinstance(hotspot.get("label"), str)
                        or (hotspot.get("target_node_id") is not None and not isinstance(hotspot["target_node_id"], str))):
                    raise ValueError("invalid_hotspot_identity")
            document = node.get("scene_document")
            if document is not None and (not isinstance(document, dict) or not isinstance(document.get("sections"), list)
                                         or any(not isinstance(item, dict) for item in document["sections"])):
                raise ValueError("invalid_scene_document")
            if document is not None:
                if not isinstance(document.get("layout"), str):
                    raise ValueError("invalid_scene_layout")
                for section in document["sections"]:
                    if (not isinstance(section.get("id"), str)
                            or (section.get("hotspot_id") is not None and not isinstance(section["hotspot_id"], str))
                            or (section.get("target_node_id") is not None and not isinstance(section["target_node_id"], str))):
                        raise ValueError("invalid_section_identity")


def _clean(value):
    return re.sub(r"\s+", "", str(value)).casefold()


def _finding(code, severity, evidence, **location):
    return {"code": code, "severity": severity, "evidence": evidence, **location}


def _box(hotspot):
    position, size = hotspot.get("position"), hotspot.get("size")
    if not isinstance(position, dict) or not isinstance(size, dict):
        return None
    values = [position.get("x"), position.get("y"), size.get("width"), size.get("height")]
    if any(isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item)
           for item in values):
        return None
    x, y, width, height = values
    if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > 1.000001 or y + height > 1.000001:
        return None
    return values


def _iou(left, right):
    x, y, width, height = left
    a, b, w, h = right
    overlap = max(0, min(x + width, a + w) - max(x, a)) * max(0, min(y + height, b + h) - max(y, b))
    return overlap / (width * height + w * h - overlap)


def _geometry(case, node, findings):
    expected = case.get("expected_hotspots", [])
    if not expected:
        return None
    actual = [hotspot for hotspot in node.get("hotspots", []) if hotspot.get("kind") != "section"]
    unused = set(range(len(actual)))
    rows, true_positive = [], 0
    for truth in expected:
        aliases = {_clean(label) for label in [truth["label"], *truth.get("aliases", [])]}
        candidates = [index for index in sorted(unused) if _clean(actual[index].get("label", "")) in aliases]
        match = candidates[0] if candidates else None
        row = {"annotation_id": truth["id"], "label": truth["label"], "matched": match is not None,
               "iou": None, "center_in_annotation": None}
        if match is None:
            if truth.get("required", True):
                findings.append(_finding("missing_grounded_hotspot", "error", truth["label"], node_id=node.get("id")))
        else:
            unused.remove(match)
            hotspot = actual[match]
            row["hotspot_id"] = hotspot.get("id")
            box = _box(hotspot)
            if box is not None:
                target = truth["box"]
                target_box = [target[key] for key in ("x", "y", "width", "height")]
                row["iou"] = round(_iou(box, target_box), 6)
                center_x, center_y = box[0] + box[2] / 2, box[1] + box[3] / 2
                row["center_in_annotation"] = (target_box[0] <= center_x <= target_box[0] + target_box[2]
                                               and target_box[1] <= center_y <= target_box[1] + target_box[3])
                if row["iou"] >= case.get("iou_threshold", 0.5) and row["center_in_annotation"]:
                    true_positive += 1
                else:
                    findings.append(_finding("hotspot_grounding_mismatch", "error", row.copy(),
                                             node_id=node.get("id"), hotspot_id=hotspot.get("id")))
        rows.append(row)
    for index in sorted(unused):
        findings.append(_finding("unmatched_image_hotspot", "warning", actual[index].get("label", ""),
                                 node_id=node.get("id"), hotspot_id=actual[index].get("id")))
    return {"scope": "single_fixed_synthetic_image", "iou_threshold": case.get("iou_threshold", 0.5),
            "expected_count": len(expected), "actual_count": len(actual), "true_positive": true_positive,
            "precision": true_positive / len(actual) if actual else 0,
            "recall": true_positive / len(expected), "annotations": rows}


def evaluate_case(case, output):
    findings = []
    if output.get("status") != "completed":
        findings.append(_finding("execution_incomplete", "error", output.get("status")))
    project = output.get("project") or {}
    nodes = project.get("nodes") or {}
    if not isinstance(nodes, dict):
        findings.append(_finding("invalid_project_nodes", "error", "nodes must be an object"))
        nodes = {}
    branch = output.get("branch_node_ids", [])
    if len(branch) != 3 or len(set(branch)) != 3 or any(node_id not in nodes for node_id in branch):
        findings.append(_finding("incomplete_three_page_branch", "error", branch))
    if project.get("root_node_id") not in nodes:
        findings.append(_finding("missing_root", "error", project.get("root_node_id")))
    if len(nodes) != 3 or set(nodes) != set(branch):
        findings.append(_finding("unexpected_or_unreachable_pages", "error", list(nodes)))
    if branch and project.get("root_node_id") != branch[0]:
        findings.append(_finding("branch_root_mismatch", "error", project.get("root_node_id")))
    bodies = {}
    for key, node in nodes.items():
        if not isinstance(node, dict):
            findings.append(_finding("invalid_node", "error", key))
            continue
        node_id = node.get("id")
        if node_id != key:
            findings.append(_finding("node_identity_mismatch", "error", key, node_id=node_id))
        parent = node.get("parent_id")
        if parent is not None and parent not in nodes:
            findings.append(_finding("missing_parent", "error", parent, node_id=node_id))
        elif parent is not None and node_id not in nodes[parent].get("children", []):
            findings.append(_finding("parent_missing_child", "error", parent, node_id=node_id))
        children = node.get("children", [])
        if len(children) != len(set(children)):
            findings.append(_finding("duplicate_child", "error", children, node_id=node_id))
        for child_id in children:
            child = nodes.get(child_id, {})
            if not child or child.get("parent_id") != node_id or child.get("depth") != node.get("depth", -1) + 1:
                findings.append(_finding("child_relation_mismatch", "error", child_id, node_id=node_id))
        hotspots = node.get("hotspots", [])
        hotspot_map = {item.get("id"): item for item in hotspots}
        if len(hotspot_map) != len(hotspots):
            findings.append(_finding("duplicate_hotspot_id", "error", "Hotspot IDs must be unique", node_id=node_id))
        labels = [_clean(item.get("label", "")) for item in hotspots]
        if len(set(labels)) != len(labels):
            findings.append(_finding("duplicate_hotspot_label", "warning", labels, node_id=node_id))
        boxes = []
        for hotspot in hotspots:
            target = hotspot.get("target_node_id")
            if target and (target not in children or target not in nodes):
                findings.append(_finding("dangling_hotspot_target", "error", target, node_id=node_id,
                                         hotspot_id=hotspot.get("id")))
            if hotspot.get("kind") != "section":
                rectangle = _box(hotspot)
                if rectangle is None:
                    findings.append(_finding("invalid_hotspot_geometry", "error", hotspot.get("label"),
                                             node_id=node_id, hotspot_id=hotspot.get("id")))
                elif rectangle in boxes:
                    findings.append(_finding("duplicate_hotspot_box", "error", rectangle, node_id=node_id))
                else:
                    boxes.append(rectangle)
        document = node.get("scene_document")
        if not document:
            if node_id != project.get("root_node_id") or case.get("input", {}).get("kind") != "image":
                findings.append(_finding("missing_knowledge_document", "error", "Expected knowledge-v1", node_id=node_id))
            continue
        sections = document.get("sections", [])
        if document.get("version") != 1 or document.get("layout") not in {"atlas", "sequence"} or not 1 <= len(sections) <= 6:
            findings.append(_finding("invalid_knowledge_structure", "error", document, node_id=node_id))
        if len(sections) < 3:
            findings.append(_finding("few_sections", "warning", len(sections), node_id=node_id))
        if len({section.get("id") for section in sections}) != len(sections):
            findings.append(_finding("duplicate_section_id", "error", "Section IDs must be unique", node_id=node_id))
        for section in sections:
            body = section.get("body", "")
            location = {"node_id": node_id, "section_id": section.get("id")}
            if not isinstance(body, str) or len(body.strip()) < 20:
                findings.append(_finding("empty_or_short_body", "error", body, **location))
                continue
            normalized = _clean(body)
            if normalized in bodies:
                findings.append(_finding("duplicate_body", "error", {"also_in": bodies[normalized], "text": body}, **location))
            bodies[normalized] = location
            if re.fullmatch(r".*[?？]", body.strip()) and len(re.findall(r"[。.!！]", body)) == 0:
                findings.append(_finding("question_only_body", "warning", body, **location))
            if re.search(r"(?:下一页|下页|next page).{0,30}(?:解释|介绍|了解|explain|learn)|(?:TODO|待补充|placeholder)", body, re.I):
                findings.append(_finding("placeholder_or_deferred_body", "warning", body, **location))
            hotspot_id = section.get("hotspot_id", section.get("id"))
            hotspot = hotspot_map.get(hotspot_id)
            if hotspot is None or hotspot.get("kind") != "section":
                findings.append(_finding("missing_section_connection", "error", hotspot_id, **location))
            elif (section.get("target_node_id") or None) != (hotspot.get("target_node_id") or None):
                findings.append(_finding("section_target_mismatch", "error", hotspot_id, **location))
    if branch and all(node_id in nodes for node_id in branch):
        for depth, node_id in enumerate(branch):
            node = nodes[node_id]
            expected_parent = branch[depth - 1] if depth else None
            if node.get("depth") != depth or node.get("parent_id") != expected_parent:
                findings.append(_finding("branch_depth_or_parent_mismatch", "error", node_id))
        for parent, child in zip(branch, branch[1:]):
            if not any(hotspot.get("target_node_id") == child for hotspot in nodes[parent].get("hotspots", [])):
                findings.append(_finding("branch_not_reachable", "error", child, node_id=parent))
    for diagnostic in output.get("normalization_checks", []):
        if (diagnostic.get("invalid_hotspot_count", 0) or diagnostic.get("raw_invalid")
                or diagnostic.get("geometry_changed")):
            findings.append(_finding("raw_output_filtered", "error", diagnostic, stage=diagnostic.get("stage")))
    geometry = _geometry(case, nodes.get(project.get("root_node_id"), {}), findings)
    return {"case_id": case["id"], "execution_status": output.get("status"),
            "automatic_gate": "failed" if any(item["severity"] == "error" for item in findings) else "passed",
            "findings": findings, "geometry": geometry,
            "page_count": len(nodes), "body_sections": len(bodies)}


def _text_review(item):
    return (isinstance(item, dict) and isinstance(item.get("reason"), str) and bool(item["reason"].strip())
            and isinstance(item.get("evidence"), str) and bool(item["evidence"].strip()))


def _agent_evidence(item, output, *, allow_empty=False, root_required=False):
    """Validate provenance of quotations, without judging their meaning."""
    if not isinstance(item, dict) or not isinstance(item.get("reason"), str) or not item["reason"].strip():
        return False
    evidence = item.get("evidence")
    if not isinstance(evidence, list) or len(evidence) > 200 or (not evidence and not allow_empty):
        return False
    project = output.get("project") or {}
    nodes = project.get("nodes") or {}
    cited_roots = False
    for citation in evidence:
        if not isinstance(citation, dict) or not isinstance(citation.get("node_id"), str):
            return False
        node = nodes.get(citation["node_id"])
        quote = citation.get("quote")
        if not isinstance(node, dict) or not isinstance(quote, str) or not quote.strip():
            return False
        sections = (node.get("scene_document") or {}).get("sections", [])
        if "section_id" in citation:
            section_id = citation["section_id"]
            if not isinstance(section_id, str):
                return False
            texts = [section.get("body", "") for section in sections if section.get("id") == section_id]
        else:
            texts = [node.get("title", ""), node.get("description", "")]
            texts.extend(hotspot.get("label", "") for hotspot in node.get("hotspots", []))
            texts.extend(value for section in sections for value in (section.get("title", ""), section.get("body", "")))
        if not any(isinstance(value, str) and quote in value for value in texts):
            return False
        cited_roots |= citation["node_id"] == project.get("root_node_id")
    return not root_required or cited_roots


def _agent_unreviewed(item, field):
    return (isinstance(item, dict) and item.get(field) is None and isinstance(item.get("reason"), str)
            and item.get("evidence") == [])


def _review_case(case, output, entry, *, agent=False):
    errors, failures = [], []
    if not isinstance(entry, dict) or entry.get("case_sha256") != output.get("case_sha256"):
        return {"status": "invalid", "errors": ["case_review_hash_mismatch_or_missing"], "failures": []}
    partial = agent and output.get("status") != "completed"
    unreviewed = []
    inspected = entry.get("inspected_node_ids")
    nodes = (output.get("project") or {}).get("nodes", {})
    scope_ok = (isinstance(inspected, list) and all(isinstance(node_id, str) for node_id in inspected)
                and len(inspected) == len(set(inspected)) and set(inspected) == set(nodes))
    if agent and not scope_ok:
        errors.append("inspected_node_coverage_mismatch")
    dimensions = entry.get("dimensions", {})
    if not isinstance(dimensions, dict):
        dimensions = {}
    if set(dimensions) != set(DIMENSIONS):
        errors.append("dimension_coverage_mismatch")
    for key in DIMENSIONS:
        item = dimensions.get(key, {})
        if not isinstance(item, dict):
            item = {}
        score = item.get("score")
        if partial and _agent_unreviewed(item, "score"):
            unreviewed.append(f"dimension:{key}")
            continue
        evidence_ok = _agent_evidence(item, output) if agent else _text_review(item)
        if isinstance(score, bool) or not isinstance(score, int) or not 0 <= score <= 4 or not evidence_ok:
            errors.append(f"unreviewed_dimension:{key}")
        elif score < 3:
            failures.append(f"dimension_below_acceptance:{key}")
    for collection, verdicts in (("fact_checks", {"supported", "contradicted", "not_mentioned"}),
                                ("forbidden_claims", {"absent", "present"})):
        expected = {item["id"]: item for item in case.get(collection, [])}
        rows = entry.get(collection, [])
        if not isinstance(rows, list):
            rows = []
        actual = {item["id"]: item for item in rows if isinstance(item, dict) and isinstance(item.get("id"), str)}
        if set(actual) != set(expected) or len(rows) != len(actual):
            errors.append(f"{collection}_coverage_mismatch")
        for key, check in expected.items():
            item = actual.get(key, {})
            verdict = item.get("verdict")
            if partial and _agent_unreviewed(item, "verdict"):
                unreviewed.append(f"{collection}:{key}")
                continue
            absent = verdict in {"absent", "not_mentioned"} if isinstance(verdict, str) else False
            root_required = collection == "fact_checks" and "root" in check.get("applies_to", []) and not absent
            evidence_ok = (_agent_evidence(item, output, allow_empty=absent and scope_ok and bool(nodes),
                                           root_required=root_required) if agent else _text_review(item))
            if not isinstance(verdict, str) or verdict not in verdicts or not evidence_ok:
                errors.append(f"unreviewed_{collection}:{key}")
            elif verdict in {"contradicted", "present"}:
                failures.append(f"{collection}_failed:{key}")
            elif verdict == "not_mentioned" and "root" in check.get("applies_to", []):
                failures.append(f"required_fact_missing:{key}")
    result = {"status": "invalid" if errors else "partial" if partial else "failed" if failures else "passed",
              "errors": errors, "failures": failures}
    if agent:
        result.update(inspected_node_ids=inspected if scope_ok else [], unreviewed_items=unreviewed)
    return result


def evaluate_run(run: dict, suite: dict, review: dict | None = None) -> dict:
    """Report execution, diagnostics and human approval as separate decisions."""
    from .dataset import case_digest, suite_digest
    from .artifacts import evaluator_sha256

    _validate_run(run)

    run_hash = _run_digest(run)
    binding_errors = []
    if run.get("run_sha256") != run_hash:
        binding_errors.append("run_hash_mismatch")
    if run.get("suite_sha256") != suite_digest(suite):
        binding_errors.append("suite_hash_mismatch")
    expected = {case["id"]: case for case in suite["cases"]}
    outputs = run.get("cases", [])
    output_ids = [output.get("case_id") for output in outputs]
    if set(output_ids) != set(expected) or len(output_ids) != len(set(output_ids)):
        binding_errors.append("case_coverage_mismatch")
    results = []
    for output in outputs:
        case = expected.get(output.get("case_id"))
        if case is None:
            continue
        if output.get("case_sha256") != case_digest(case):
            binding_errors.append(f"case_hash_mismatch:{case['id']}")
        results.append(evaluate_case(case, output))
    review_errors = []
    reviewer = review.get("reviewer", {}) if isinstance(review, dict) else {}
    if not isinstance(reviewer, dict):
        reviewer = {}
    if review is not None:
        if not isinstance(review, dict):
            review_errors.append("invalid_review")
            review = {}
        if (review.get("schema_version") != 1 or review.get("rubric_version") != RUBRIC_VERSION
                or review.get("evaluator_sha256") != evaluator_sha256()
                or review.get("run_sha256") != run_hash or review.get("suite_sha256") != run.get("suite_sha256")):
            review_errors.append("review_binding_mismatch")
        if (not isinstance(reviewer.get("kind"), str) or reviewer["kind"] not in {"human", "calibration", "agent"}
                or not isinstance(reviewer.get("name"), str) or not reviewer["name"].strip()):
            review_errors.append("reviewer_missing_or_invalid")
        if reviewer.get("kind") == "agent" and any(not isinstance(reviewer.get(field), str) or not reviewer[field].strip()
                                                  for field in ("model", "version")):
            review_errors.append("agent_reviewer_provenance_missing")
        entries = review.get("cases", [])
        if not isinstance(entries, list):
            entries = []
        entries_by_id = {item["case_id"]: item for item in entries
                         if isinstance(item, dict) and isinstance(item.get("case_id"), str)}
        if set(entries_by_id) != set(expected) or len(entries_by_id) != len(entries):
            review_errors.append("review_case_coverage_mismatch")
        for output, result in zip((item for item in outputs if item.get("case_id") in expected), results):
            result["review"] = _review_case(expected[output["case_id"]], output, entries_by_id.get(output["case_id"]),
                                            agent=reviewer.get("kind") == "agent")
            if review_errors:
                result["review"]["status"] = "invalid"
                result["review"]["errors"] = [*result["review"]["errors"], *review_errors]
    else:
        for result in results:
            result["review"] = {"status": "not_reviewed", "errors": [], "failures": []}
    execution_ok = not binding_errors and bool(results) and all(item["execution_status"] == "completed" for item in results)
    automatic_ok = execution_ok and all(item["automatic_gate"] == "passed" for item in results)
    reviewed_ok = automatic_ok and not review_errors and review is not None and all(item["review"]["status"] == "passed" for item in results)
    human_approved = reviewed_ok and run.get("mode") == "live" and reviewer.get("kind") == "human"
    agent_quality = "not_reviewed"
    if review is not None and reviewer.get("kind") == "agent":
        if review_errors or binding_errors or any(item["review"]["status"] == "invalid" for item in results):
            agent_quality = "invalid"
        elif any(item["review"]["status"] == "partial" for item in results):
            agent_quality = "partial"
        else:
            agent_quality = "passed" if reviewed_ok and run.get("mode") == "live" else "failed"
    return {
        "schema_version": 1, "method_version": METHOD_VERSION, "rubric_version": RUBRIC_VERSION,
        "evaluator_sha256": evaluator_sha256(),
        "run_sha256": run_hash, "suite_sha256": run.get("suite_sha256"), "mode": run.get("mode"),
        "execution": "passed" if execution_ok else "failed",
        "automatic": "passed" if automatic_ok else "failed",
        "human_quality": "not_reviewed" if review is None or reviewer.get("kind") == "agent" else "approved" if human_approved else "not_approved",
        "agent_quality": agent_quality,
        "calibration": "passed" if reviewed_ok and (run.get("mode") == "replay" or reviewer.get("kind") == "calibration") else "not_applicable",
        "reviewer": reviewer, "binding_errors": binding_errors, "review_errors": review_errors, "cases": results,
        "overall_quality_score": None,
        "limitations": ["Replay is controlled fixture calibration, not a real model quality measurement.",
                        "Automatic checks do not establish factual accuracy or semantic consistency.",
                        "Agent review verifies quoted evidence locations but does not constitute human approval.",
                        "One branch per case and one synthetic image do not establish statistical superiority or visual generalization."],
    }


def compare_runs(base, candidate, suite, base_review=None, candidate_review=None):
    left, right = evaluate_run(base, suite, base_review), evaluate_run(candidate, suite, candidate_review)
    reasons = []
    for field in ("suite_sha256", "mode", "policy", "repeat", "budgets", "evaluator_sha256"):
        if base.get(field) != candidate.get(field):
            reasons.append(f"different_{field}")
    def coverage(run):
        return sorted((item.get("case_id"), item.get("case_sha256"), item.get("status"),
                       tuple(_clean(step.get("label", "")) for step in item.get("branch_path", [])),
                       tuple(call.get("stage") for call in item.get("calls", []))) for item in run.get("cases", []))
    if coverage(base) != coverage(candidate):
        reasons.append("different_coverage_or_actual_branch")
    if left["execution"] != "passed" or right["execution"] != "passed":
        reasons.append("incomplete_or_invalid_run")
    review_reasons = ["generation_runs_not_comparable"] if reasons else []
    for label, assessment in (("base", left), ("candidate", right)):
        if (assessment["review_errors"] or not assessment["cases"]
                or any(item["review"]["status"] not in {"passed", "failed"} for item in assessment["cases"])):
            review_reasons.append(f"{label}_review_missing_invalid_or_partial")
    for field in ("kind", "name", "model", "version"):
        if left["reviewer"].get(field) != right["reviewer"].get(field):
            review_reasons.append(f"different_reviewer_{field}")
    def page_summaries(output):
        nodes = (output.get("project") or {}).get("nodes", {})
        return [{"title": nodes.get(node_id, {}).get("title", ""),
                 "description": nodes.get(node_id, {}).get("description", ""),
                 "sections": [{"title": section.get("title", ""), "body": section.get("body", "")}
                              for section in (nodes.get(node_id, {}).get("scene_document") or {}).get("sections", [])],
                 "hotspot_labels": [hotspot.get("label", "") for hotspot in nodes.get(node_id, {}).get("hotspots", [])]}
                for node_id in output.get("branch_node_ids", [])]
    def indexed(run):
        return {item.get("case_id"): item for item in run.get("cases", [])}
    base_outputs, candidate_outputs = indexed(base), indexed(candidate)
    left_cases = {item["case_id"]: item for item in left["cases"]}
    right_cases = {item["case_id"]: item for item in right["cases"]}
    def review_entries(review):
        entries = review.get("cases", []) if isinstance(review, dict) else []
        return {item["case_id"]: item for item in entries
                if isinstance(item, dict) and isinstance(item.get("case_id"), str)} if isinstance(entries, list) else {}
    base_reviews, candidate_reviews = review_entries(base_review), review_entries(candidate_review)
    deltas = []
    for case_id in sorted(base_outputs.keys() & candidate_outputs.keys()):
        row = {"case_id": case_id}
        for label, outputs, evaluated, reviews in (("base", base_outputs, left_cases, base_reviews),
                                                   ("candidate", candidate_outputs, right_cases, candidate_reviews)):
            result = evaluated.get(case_id, {})
            review_result = result.get("review", {})
            row[label] = {"pages": page_summaries(outputs[case_id]), "geometry": result.get("geometry"),
                          "findings": result.get("findings", []), "review_status": review_result.get("status"),
                          "dimension_scores": {key: value.get("score") for key, value in reviews.get(case_id, {}).get("dimensions", {}).items()}
                          if review_result.get("status") in {"passed", "failed", "partial"} else None}
        deltas.append(row)
    return {"schema_version": 1, "method_version": METHOD_VERSION,
            "comparable": not reasons, "reasons": reasons,
            "review_scores_comparable": not review_reasons, "review_comparison_reasons": review_reasons,
            "base_run_sha256": left["run_sha256"], "candidate_run_sha256": right["run_sha256"],
            "implementation_changed": base.get("producer_sha256") != candidate.get("producer_sha256"),
            "prompt_sources_changed": base.get("prompt_sources_sha256") != candidate.get("prompt_sources_sha256"),
            "models": {"base": base.get("model"), "candidate": candidate.get("model")},
            "reviewers": {"base": left["reviewer"], "candidate": right["reviewer"]},
            "producer_sha256": {"base": base.get("producer_sha256"), "candidate": candidate.get("producer_sha256")},
            "automatic_findings": {"base": dict(Counter(item["severity"] for case in left["cases"] for item in case["findings"])),
                                   "candidate": dict(Counter(item["severity"] for case in right["cases"] for item in case["findings"]))},
            "case_deltas": deltas,
            "winner": None, "quality_score_delta": None,
            "note": "Generation comparability and review-score comparability are separate. Scores are shown as individual judgments; no statistical model ranking or automatic quality winner."}
