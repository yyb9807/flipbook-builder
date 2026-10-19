"""Integrity checks for reviewed fixtures, not a model-quality score."""
import importlib.util
import json
import shutil

import pytest
from PIL import Image

from scripts.quality_eval.dataset import (
    DEFAULT_SUITE,
    DatasetError,
    asset_path,
    case_digest,
    load_recording,
    load_suite,
    suite_digest,
)


@pytest.fixture
def copied(tmp_path):
    destination = tmp_path / "fixed-suite"
    shutil.copytree(DEFAULT_SUITE, destination)
    return destination


def update(path, callback):
    value = json.loads(path.read_text())
    callback(value)
    path.write_text(json.dumps(value, ensure_ascii=False))


def test_six_bilingual_cases_have_all_eighteen_honest_replay_stages():
    suite = load_suite()
    assert len(suite["cases"]) == 6
    assert {case["language"] for case in suite["cases"]} == {"zh", "en"}
    assert suite["recording_origin"] == "contributor-authored-controlled-replay"
    assert len({case["id"] for case in suite["cases"]}) == 6
    for case in suite["cases"]:
        root = json.loads(load_recording(suite, case["id"], "root"))
        child = json.loads(load_recording(suite, case["id"], "child"))
        grandchild = json.loads(load_recording(suite, case["id"], "grandchild"))
        labels = [hotspot["label"] for hotspot in root["hotspots"]] if case["input"]["kind"] == "image" else [section["title"] for section in root["sections"]]
        assert set(labels) & set(case["branch_steps"][0]["preferred_labels"])
        assert set(section["title"] for section in child["sections"]) & set(case["branch_steps"][1]["preferred_labels"])
        assert all(len(section["body"]) >= 20 for section in child["sections"] + grandchild["sections"])


def test_dataset_digest_is_portable_and_binds_case_and_raw_replay(copied):
    original = load_suite()
    clone = load_suite(copied)
    assert suite_digest(original) == suite_digest(clone)
    original_case_hash = case_digest(clone["cases"][0])
    clone["cases"][0]["unknown_limits"].append("A new information gap")
    assert case_digest(clone["cases"][0]) != original_case_hash
    assert suite_digest(original) != suite_digest(clone)
    update(copied / "replay.json", lambda value: value["responses"]["water-cycle-en"]["root"].update(title="Changed output"))
    assert suite_digest(original) != suite_digest(load_suite(copied))


def test_fact_anchors_are_exact_original_brief_excerpts_and_scoped():
    for case in load_suite()["cases"]:
        assert case["unknown_limits"]
        reference_ids = {reference["id"] for reference in case["source"]["references"]}
        for fact in case["fact_checks"]:
            assert fact["source_id"] in reference_ids
            assert fact["evidence_excerpt"] in case["source"]["text"]
            assert fact["applies_to"] in [["root"], ["all_pages_if_mentioned"]]
        assert all(forbidden["reason"] for forbidden in case["forbidden_claims"])


def test_two_image_languages_are_one_independent_original_scene():
    suite = load_suite()
    images = [case for case in suite["cases"] if case["input"]["kind"] == "image"]
    assert len(images) == 2 and suite["independent_visual_scenes"] == 1
    assert len({case["input"]["sha256"] for case in images}) == 1
    assert len({case["independent_visual_scene_id"] for case in images}) == 1
    assert all(case["source"]["license"] == "MIT" for case in images)


def test_original_generator_preserves_pixels_and_boxes_enclose_exact_color_extent(tmp_path):
    suite = load_suite()
    case = next(case for case in suite["cases"] if case["id"] == "shapes-en")
    module_spec = importlib.util.spec_from_file_location("original_shapes", DEFAULT_SUITE / "assets/generate_shapes.py")
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    regenerated = tmp_path / "shapes.png"
    module.generate(regenerated)
    with Image.open(asset_path(suite, case)) as image, Image.open(regenerated) as regenerated_image:
        assert image.tobytes() == regenerated_image.tobytes()
        pixels = image.load()
        for annotation, color in zip(case["expected_hotspots"], ((220, 70, 70), (55, 108, 197), (42, 136, 103))):
            positions = [(x, y) for y in range(image.height) for x in range(image.width) if pixels[x, y] == color]
            x, y = min(p[0] for p in positions), min(p[1] for p in positions)
            right, bottom = max(p[0] for p in positions) + 1, max(p[1] for p in positions) + 1
            assert annotation["box"] == {"x": x / image.width, "y": y / image.height,
                                         "width": (right - x) / image.width, "height": (bottom - y) / image.height}


@pytest.mark.parametrize("relative", ["../suite.json", "/etc/passwd", "https://example.org/image.png", "assets\\shapes.png"])
def test_external_or_escaping_asset_paths_are_rejected(relative):
    with pytest.raises(DatasetError):
        asset_path(load_suite(), relative)


def test_symlink_resources_are_rejected_even_if_the_target_is_inside_suite(copied):
    (copied / "assets/alias.png").symlink_to(copied / "assets/shapes.png")
    with pytest.raises(DatasetError, match="symlink"):
        asset_path(load_suite(copied), "assets/alias.png")


def test_changed_fixture_bytes_never_keep_the_declared_image_hash(copied):
    (copied / "assets/shapes.png").write_bytes(b"changed fixture")
    with pytest.raises(DatasetError, match="digest"):
        load_suite(copied)


@pytest.mark.parametrize("change,error", [
    (lambda case: case["fact_checks"][0].update(evidence_excerpt="An invented source excerpt"), "fact_anchor"),
    (lambda case: case["fact_checks"][0].update(source_id="missing-authority"), "fact_anchor"),
    (lambda case: case["branch_steps"][0].update(fallback_index=0), "branch_selector"),
    (lambda case: case["branch_steps"].pop(), "branch_steps"),
    (lambda case: case["source"].update(license="unknown"), "source_provenance"),
])
def test_broken_source_or_silent_branch_fallback_cannot_load(copied, change, error):
    update(copied / "cases/water-cycle-en.json", change)
    with pytest.raises(DatasetError, match=error):
        load_suite(copied)


def test_omitted_replay_stage_cannot_be_relabelled_as_full_coverage(copied):
    update(copied / "replay.json", lambda value: value["responses"]["shapes-en"].pop("grandchild"))
    with pytest.raises(DatasetError, match="coverage"):
        load_suite(copied)


def test_duplicate_json_keys_are_rejected(copied):
    (copied / "suite.json").write_text('{"id":"quality-v1","id":"hidden-replacement"}')
    with pytest.raises(DatasetError, match="duplicate"):
        load_suite(copied)


def test_unknown_recording_case_and_stage_are_explicit_errors():
    suite = load_suite()
    with pytest.raises(DatasetError, match="unknown_recording"):
        load_recording(suite, "nonexistent-case", "root")
    with pytest.raises(DatasetError, match="unknown_recording"):
        load_recording(suite, "water-cycle-zh", "unexpected-stage")
