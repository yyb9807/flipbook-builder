"""Versioned, bounded offline fixtures; source anchors are for human review.

No fact assertion here is a keyword-based semantic pass. The private directory
field is only a local resource locator and is excluded from every public hash.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

from PIL import Image

from .artifacts import canonical_sha256


DEFAULT_SUITE = Path(__file__).resolve().parents[2] / "evals/datasets/quality-v1"
STAGES = ("root", "child", "grandchild")
_ID = re.compile(r"^[a-z][a-z0-9-]{1,79}$")


class DatasetError(ValueError):
    """The fixed evaluation input or its declared provenance is inconsistent."""


def _public(value):
    if isinstance(value, dict):
        return {key: _public(item) for key, item in value.items() if not key.startswith("_")}
    if isinstance(value, list):
        return [_public(item) for item in value]
    return value


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise DatasetError("duplicate_json_key")
        result[key] = value
    return result


def _bad_constant(_value):
    raise DatasetError("nonfinite_json_number")


def _read_json(path: Path, maximum: int = 1_000_000):
    if not path.is_file() or path.stat().st_size > maximum:
        raise DatasetError("missing_or_oversized_dataset_file")
    try:
        return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_pairs,
                          parse_constant=_bad_constant)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise DatasetError("invalid_dataset_json") from exc


def _text(value, maximum: int = 20_000) -> bool:
    return isinstance(value, str) and 0 < len(value.strip()) <= maximum


def _identifier(value) -> bool:
    return isinstance(value, str) and bool(_ID.fullmatch(value))


def _reference(reference: dict) -> bool:
    if not _text(reference.get("title"), 500):
        return False
    try:
        date.fromisoformat(reference.get("checked_on", ""))
        if "url" in reference:
            if not _text(reference["url"], 2000):
                return False
            parsed = urlsplit(reference["url"])
            if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
                return False
    except (TypeError, ValueError):
        return False
    return True


def _relative_file(directory: Path, relative: str) -> Path:
    if not _text(relative, 300) or Path(relative).is_absolute() or "\\" in relative:
        raise DatasetError("invalid_dataset_path")
    parts = Path(relative).parts
    if any(part in {"..", "."} for part in parts) or not parts:
        raise DatasetError("invalid_dataset_path")
    cursor = directory
    for part in parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise DatasetError("dataset_symlink_not_allowed")
    path = cursor.resolve()
    if not path.is_relative_to(directory) or not path.is_file():
        raise DatasetError("missing_or_escaping_dataset_file")
    return path


def asset_path(suite: dict, case_or_path: dict | str) -> Path:
    """Resolve an allowlisted suite-relative resource, never an external URL."""
    relative = case_or_path.get("input", {}).get("image_path") if isinstance(case_or_path, dict) else case_or_path
    return _relative_file(Path(suite["_directory"]).resolve(), relative)


def _unique_ids(items: object, field: str) -> list[dict]:
    if not isinstance(items, list) or not items or len(items) > 100:
        raise DatasetError(f"invalid_{field}")
    ids = [item.get("id") if isinstance(item, dict) else None for item in items]
    if any(not _identifier(item) for item in ids) or len(set(ids)) != len(ids):
        raise DatasetError(f"invalid_{field}_ids")
    return items


def _validate_case(suite: dict, case: dict) -> None:
    if (not isinstance(case, dict) or case.get("schema_version") != 1 or not _identifier(case.get("id"))
            or case.get("version") != suite["version"] or case.get("language") not in {"zh", "en"}
            or not _text(case.get("title"), 300)):
        raise DatasetError("invalid_case_identity")
    source = case.get("source")
    if (not isinstance(source, dict) or source.get("license") != "MIT" or not _text(source.get("text"))
            or not _text(source.get("notes")) or source.get("kind") not in {
                "primary-source-summary", "synthetic-closed-world", "original-synthetic-image"}):
        raise DatasetError("invalid_source_provenance")
    references = _unique_ids(source.get("references"), "reference")
    reference_ids = {reference["id"] for reference in references}
    if any(not _reference(reference) for reference in references):
        raise DatasetError("invalid_source_reference")
    for fact in _unique_ids(case.get("fact_checks"), "fact_check"):
        if (not _text(fact.get("claim")) or not _text(fact.get("evidence_excerpt"))
                or fact["evidence_excerpt"] not in source["text"] or fact.get("source_id") not in reference_ids
                or fact.get("severity") not in {"critical", "major"}
                or fact.get("applies_to") not in [["root"], ["all_pages_if_mentioned"]]):
            raise DatasetError("invalid_fact_anchor")
    for forbidden in _unique_ids(case.get("forbidden_claims"), "forbidden_claim"):
        if (not _text(forbidden.get("claim")) or not _text(forbidden.get("reason"))
                or forbidden.get("severity") not in {"critical", "major"}):
            raise DatasetError("invalid_forbidden_claim")
    steps = case.get("branch_steps")
    if not isinstance(steps, list) or len(steps) != 2:
        raise DatasetError("invalid_branch_steps")
    for step in steps:
        labels = step.get("preferred_labels") if isinstance(step, dict) else None
        if (not isinstance(labels, list) or not 1 <= len(labels) <= 12
                or any(not _text(label, 200) for label in labels)
                or "fallback_index" in step):
            raise DatasetError("invalid_fixed_branch_selector")
    notes = case.get("dimension_notes")
    if not isinstance(notes, dict) or any(not _text(notes.get(key)) for key in ("body", "hotspots", "cross_page", "instruction")):
        raise DatasetError("missing_review_dimension_anchor")
    if (not isinstance(case.get("unknown_limits"), list) or not case["unknown_limits"]
            or any(not _text(limit) for limit in case["unknown_limits"])):
        raise DatasetError("missing_information_gap")
    content = case.get("input")
    if not isinstance(content, dict) or content.get("kind") not in {"text", "image"}:
        raise DatasetError("invalid_case_input")
    if content["kind"] == "text":
        if not _text(content.get("text")) or content["text"] != source["text"]:
            raise DatasetError("text_source_mismatch")
        return
    path = asset_path(suite, case)
    if path.stat().st_size > 2_000_000 or _sha(path.read_bytes()) != content.get("sha256"):
        raise DatasetError("fixture_asset_digest_mismatch")
    try:
        with Image.open(path) as image:
            if image.format != "PNG" or image.size != (content.get("width"), content.get("height")):
                raise DatasetError("fixture_asset_dimensions_mismatch")
            image.verify()
    except OSError as exc:
        raise DatasetError("invalid_fixture_image") from exc
    if case.get("iou_threshold") != 0.5 or not _identifier(case.get("independent_visual_scene_id")):
        raise DatasetError("invalid_image_evaluation_scope")
    for hotspot in _unique_ids(case.get("expected_hotspots"), "expected_hotspot"):
        box = hotspot.get("box")
        if (not _text(hotspot.get("label"), 200) or not isinstance(hotspot.get("aliases"), list)
                or any(not _text(alias, 200) for alias in hotspot["aliases"])
                or hotspot.get("required") is not True or not isinstance(box, dict)):
            raise DatasetError("invalid_image_annotation")
        coordinates = [box.get(key) for key in ("x", "y", "width", "height")]
        if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in coordinates):
            raise DatasetError("invalid_annotation_coordinates")
        x, y, width, height = coordinates
        if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > 1 or y + height > 1:
            raise DatasetError("invalid_annotation_bounds")


def _recordings(suite: dict) -> dict:
    result = _read_json(asset_path(suite, suite["recordings_path"]), 2_000_000)
    if (not isinstance(result, dict) or result.get("schema_version") != 1 or result.get("suite_id") != suite["id"]
            or result.get("origin") != "contributor-authored-controlled-replay"):
        raise DatasetError("invalid_replay_provenance")
    responses = result.get("responses")
    if not isinstance(responses, dict) or set(responses) != {case["id"] for case in suite["cases"]}:
        raise DatasetError("replay_case_coverage_mismatch")
    for stages in responses.values():
        if not isinstance(stages, dict) or set(stages) != set(STAGES):
            raise DatasetError("replay_stage_coverage_mismatch")
        if any(not isinstance(response, (dict, str)) for response in stages.values()):
            raise DatasetError("invalid_raw_replay_response")
    return result


def load_suite(path: Path | str | None = None) -> dict:
    directory = Path(path or DEFAULT_SUITE).expanduser().resolve()
    if directory.is_file():
        directory = directory.parent
    suite = _read_json(_relative_file(directory, "suite.json"), 100_000)
    if (not isinstance(suite, dict) or suite.get("schema_version") != 1 or not _identifier(suite.get("id"))
            or not _text(suite.get("version"), 30) or suite.get("stages") != list(STAGES)
            or suite.get("license") != "MIT" or suite.get("recording_origin") != "contributor-authored-controlled-replay"
            or not _text(suite.get("recordings_path"), 300)):
        raise DatasetError("invalid_suite_identity")
    case_files = suite.get("case_files")
    if (not isinstance(case_files, list) or not 1 <= len(case_files) <= 50
            or any(not isinstance(relative, str) for relative in case_files)
            or len(set(case_files)) != len(case_files)):
        raise DatasetError("invalid_case_manifest")
    suite["_directory"] = str(directory)
    suite["cases"] = [_read_json(_relative_file(directory, relative), 200_000) for relative in case_files]
    _unique_ids(suite["cases"], "case")
    for case in suite["cases"]:
        _validate_case(suite, case)
    scenes = {case["independent_visual_scene_id"] for case in suite["cases"] if case["input"]["kind"] == "image"}
    if len(scenes) != suite.get("independent_visual_scenes"):
        raise DatasetError("independent_scene_count_mismatch")
    _relative_file(directory, "LICENSE")
    _recordings(suite)
    return suite


def case_digest(case: dict) -> str:
    return canonical_sha256(_public(case))


def suite_digest(suite: dict) -> str:
    """Bind case data, original bytes and the controlled raw-response recording."""
    files = {suite["recordings_path"], "LICENSE"}
    files.update(case["input"]["image_path"] for case in suite["cases"] if case["input"]["kind"] == "image")
    return canonical_sha256(_public({"suite": suite, "files": {
        name: _sha(asset_path(suite, name).read_bytes()) for name in sorted(files)
    }}))


def load_recording(suite: dict, case_id: str, stage: str) -> str:
    if stage not in STAGES or case_id not in {case["id"] for case in suite["cases"]}:
        raise DatasetError("unknown_recording_stage")
    response = _recordings(suite)["responses"][case_id][stage]
    return response if isinstance(response, str) else json.dumps(response, ensure_ascii=False, allow_nan=False)
