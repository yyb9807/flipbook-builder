"""A bounded, resumable root → child → grandchild content experiment."""
from __future__ import annotations

import base64
import copy
import hashlib
import shutil
import uuid
from pathlib import Path

from .artifacts import (
    canonical_sha256,
    evaluator_sha256,
    now,
    producer_sha256,
    read_json,
    redact,
    run_lock,
    source_hashes,
    write_json,
)
from .dataset import asset_path, case_digest, load_recording, suite_digest
from .production import CallGuard, RunConfig, StageBlocked, agents


def _identity(config, suite):
    return {"config": config.public(), "suite_sha256": suite_digest(suite),
            "producer_sha256": producer_sha256()}


def _project(case):
    return {"project_id": "eval_" + case["id"], "name": case["id"], "root_node_id": None,
            "settings": {"max_depth": 4, "max_hotspots_per_page": 3, "visual_style": "encyclopedia", "language": case["language"]},
            "nodes": {}}


def _node(case, stage, result, *, parent=None, image_url=None, model):
    node_id = case["id"] + "_" + stage
    image = stage == "root" and case["input"]["kind"] == "image"
    node = {"id": node_id, "parent_id": parent["id"] if parent else None,
            "depth": parent["depth"] + 1 if parent else 0,
            "title": str((result.get("summary") if image else result.get("title")) or case["id"])[:200],
            "description": str((result.get("summary") if stage == "root" else result.get("description")) or "")[:20000],
            "source_type": "image" if image else "text", "image_url": image_url if image else None,
            "children": [], "hotspots": [], "status": "draft" if stage == "root" else "generated", "scene_document": None,
            "content_metadata": {"version": 1, "provenance": {"kind": "ai", "input_kind": "image" if image else "text" if stage == "root" else "parent_page", "model": model},
                                 "references": [], "review_status": "unreviewed"}}
    if image:
        from agents.hotspot_localization import sanitize_hotspots

        for index, hotspot in enumerate(sanitize_hotspots(result.get("hotspots"), 3)):
            node["hotspots"].append({"id": node_id + "_hs_" + str(index + 1), "kind": "image", "label": hotspot["label"],
                                     "position": {"x": hotspot["x"], "y": hotspot["y"]},
                                     "size": {"width": hotspot["width"], "height": hotspot["height"]},
                                     "score": hotspot.get("score"), "selected": stage == "root", "target_node_id": None})
    else:
        sections = []
        for index, section in enumerate(result["sections"]):
            hotspot_id = node_id + "_hs_" + str(index + 1)
            node["hotspots"].append({"id": hotspot_id, "kind": "section", "label": section["title"], "position": None,
                                     "size": None, "score": None, "selected": stage == "root", "target_node_id": None})
            sections.append({"id": section["id"], "title": section["title"], "body": section["body"], "hotspot_id": hotspot_id})
        node["scene_document"] = {"version": 1, "layout": result["layout"], "sections": sections}
    return node


def choose_branch(parent, selector):
    def normalized(value):
        return " ".join(value.split()).casefold()

    allowed = {normalized(label) for label in selector["preferred_labels"]}
    matches = [hotspot for hotspot in parent["hotspots"] if normalized(hotspot["label"]) in allowed]
    if len(matches) != 1:
        raise StageBlocked("branch_selector_missing" if not matches else "branch_selector_ambiguous")
    selected = matches[0]
    context = next((section["body"] for section in (parent.get("scene_document") or {}).get("sections", [])
                    if section.get("hotspot_id") == selected["id"]), "") or parent["description"]
    return selected, context


def _connect(parent, child, hotspot):
    parent["children"].append(child["id"])
    for item in parent["hotspots"]:
        item["selected"] = item["id"] == hotspot["id"]
    hotspot.update(selected=True, target_node_id=child["id"])
    for section in (parent.get("scene_document") or {}).get("sections", []):
        if section.get("hotspot_id") == hotspot["id"]:
            section["target_node_id"] = child["id"]


def _diagnostics(stage, result):
    from agents.hotspot_localization import sanitize_hotspots
    from utils import extract_json

    raw = extract_json(stage.get("raw_response", ""))
    diagnostic = {"stage": stage["stage"], "raw_invalid": not isinstance(raw, dict)}
    if isinstance(raw, dict):
        if isinstance(raw.get("sections"), list):
            diagnostic.update(raw_section_count=len(raw["sections"]), normalized_section_count=len(result.get("sections", [])))
        if isinstance(raw.get("hotspots"), list):
            diagnostic.update(raw_hotspot_count=len(raw["hotspots"]), normalized_hotspot_count=len(result.get("hotspots", [])),
                              invalid_hotspot_count=len(raw["hotspots"]) - len(sanitize_hotspots(raw["hotspots"])))
    return diagnostic


def _public(checkpoint):
    run = {key: copy.deepcopy(checkpoint[key]) for key in (
        "schema_version", "run_id", "mode", "model", "provider", "created_at", "suite_sha256", "producer_sha256",
        "prompt_sources_sha256", "evaluator_sha256", "source_hashes", "budgets", "policy", "repeat", "call_count", "reserved_output_tokens", "status")}
    run["evidence_kind"] = "controlled_fixture" if run["mode"] == "replay" else "live_provider"
    run["cases"] = []
    for case in checkpoint["cases"]:
        public = {key: copy.deepcopy(case[key]) for key in (
            "case_id", "case_sha256", "mode", "status", "project", "branch_node_ids", "branch_path", "normalization_checks")}
        if case.get("error"):
            public["error"] = case["error"]
        public["calls"] = [{**{key: item[key] for key in (
            "stage", "state", "model", "latency_seconds", "max_tokens", "prompt_sha256", "response_sha256", "error") if key in item},
                            "ok": item["state"] == "completed"} for item in case["stages"]]
        run["cases"].append(public)
    run["run_sha256"] = canonical_sha256(run)
    return run


async def run_suite(suite, directory, config: RunConfig | None = None, *, resume=False):
    config = config or RunConfig()
    config.validate()
    directory = Path(directory)
    with run_lock(directory):
        checkpoint_path = directory / "checkpoint.json"
        identity = _identity(config, suite)
        if resume:
            checkpoint = read_json(checkpoint_path)
            if checkpoint.get("identity") != identity:
                raise ValueError("resume_configuration_or_sources_changed")
        else:
            if checkpoint_path.exists() or (directory / "run.json").exists():
                raise ValueError("run_directory_already_contains_results")
            sources = source_hashes()
            checkpoint = {"schema_version": 1, "run_id": str(uuid.uuid4()), "created_at": now(), "identity": identity,
                          "mode": config.mode, "model": config.model, "provider": {"base_url": config.base_url, "model": config.model},
                          "suite_sha256": identity["suite_sha256"], "producer_sha256": identity["producer_sha256"],
                          "source_hashes": sources, "prompt_sources_sha256": canonical_sha256(sources),
                          "evaluator_sha256": evaluator_sha256(),
                          "budgets": {"max_calls": config.max_calls, "max_reserved_output_tokens": config.max_output_tokens,
                                      "timeout_seconds": config.timeout_seconds, "max_prompt_bytes": config.max_prompt_bytes},
                          "policy": {"branch_selection": "strict-preferred-label", "stage_count": 3, "repeat_count": 1},
                          "repeat": 1, "call_count": 0, "reserved_output_tokens": 0, "status": "running", "cases": []}
            for case in suite["cases"]:
                checkpoint["cases"].append({"case_id": case["id"], "case_sha256": case_digest(case), "mode": config.mode,
                                            "status": "pending", "project": _project(case), "branch_node_ids": [],
                                            "branch_path": [], "normalization_checks": [], "stages": []})

        def save():
            # Provider-controlled text is redacted at receipt, before parsing,
            # and normalized content is redacted before entering this state.
            # Replacing over the whole checkpoint would corrupt schema names
            # (e.g. a local provider key "token" inside max_output_tokens).
            write_json(checkpoint_path, checkpoint)
            write_json(directory / "run.json", _public(checkpoint))

        guard = CallGuard(config, checkpoint, save)
        save()
        if any(stage["state"] in {"in_flight", "outcome_unknown"}
               for case in checkpoint["cases"] for stage in case["stages"]):
            checkpoint["status"] = "incomplete"
            save()
            return _public(checkpoint)
        stop = False
        for case, result in zip(suite["cases"], checkpoint["cases"], strict=True):
            if result["status"] == "completed":
                continue
            result.update(project=_project(case), branch_node_ids=[], branch_path=[], normalization_checks=[], status="running")
            result.pop("error", None)
            parent = None
            for index, stage_name in enumerate(("root", "child", "grandchild")):
                stage = next((item for item in result["stages"] if item["stage"] == stage_name), None)
                if stage is None:
                    stage = {"stage": stage_name, "state": "planned", "model": config.model}
                    result["stages"].append(stage)
                guard.current = stage
                try:
                    if stage["state"] in {"in_flight", "outcome_unknown", "failed"}:
                        raise StageBlocked("prior_attempt_not_retried")
                    hotspot, context = choose_branch(parent, case["branch_steps"][index - 1]) if parent else (None, None)
                    analysis, generation = agents(config, guard, lambda c=case["id"], s=stage_name: load_recording(suite, c, s))
                    if stage["state"] == "completed":
                        output = stage["normalized_output"]
                        if canonical_sha256(output) != stage["normalized_sha256"]:
                            raise StageBlocked("checkpoint_output_changed")
                    elif parent:
                        output = await generation.generate(hotspot_label=hotspot["label"], parent_title=parent["title"],
                                                           parent_description=context, language=case["language"],
                                                           selected_keywords=[], content_format="knowledge-v1")
                    elif case["input"]["kind"] == "text":
                        from agents.page_generation import STYLE_PROMPTS

                        output = await analysis.analyze_text(case["input"]["text"], case["language"],
                                                             STYLE_PROMPTS["encyclopedia"], content_format="knowledge-v1")
                    else:
                        image_path = asset_path(suite, case)
                        image_bytes = image_path.read_bytes()
                        if len(image_bytes) > 2_000_000:
                            raise StageBlocked("image_byte_budget_exceeded")
                        output = await analysis.analyze_image(base64.b64encode(image_bytes).decode(), case["language"])
                    output = redact(output, config.api_key)
                    stage.update(state="completed", normalized_output=output, normalized_sha256=canonical_sha256(output))
                    image_url = None
                    if not parent and case["input"]["kind"] == "image":
                        image_path = asset_path(suite, case)
                        image_url = "assets/" + hashlib.sha256(image_path.read_bytes()).hexdigest() + ".png"
                        (directory / "assets").mkdir(exist_ok=True)
                        shutil.copyfile(image_path, directory / image_url)
                    node = _node(case, stage_name, output, parent=parent, image_url=image_url, model=config.model)
                    result["normalization_checks"].append(_diagnostics(stage, output))
                    if parent:
                        _connect(parent, node, hotspot)
                        result["branch_path"].append({"stage": stage_name, "hotspot_id": hotspot["id"], "label": hotspot["label"],
                                                      "parent_node_id": parent["id"], "parent_context_sha256": canonical_sha256(context)})
                    else:
                        result["project"]["root_node_id"] = node["id"]
                    result["project"]["nodes"][node["id"]] = node
                    result["branch_node_ids"].append(node["id"])
                    parent = node
                    save()
                except Exception as exc:
                    if isinstance(exc, StageBlocked):
                        code = str(exc)
                    else:
                        code = "invalid_normalized_content"
                        if stage["state"] == "response_received":
                            stage.update(state="failed", error=code)
                    result.update(status="blocked" if isinstance(exc, StageBlocked) else "failed", error=code)
                    save()
                    if stage["state"] in {"in_flight", "outcome_unknown"}:
                        stop = True
                    break
            else:
                result["status"] = "completed"
                save()
            if stop:
                break
        checkpoint["status"] = "completed" if all(case["status"] == "completed" for case in checkpoint["cases"]) else "incomplete"
        guard.checkpoint_time()
        save()
        return _public(checkpoint)
