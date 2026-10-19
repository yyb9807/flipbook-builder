"""Offline consistency validation, not a semantic grading or model-inference tool."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

from PIL import Image, ImageChops

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2]))
from scripts.quality_eval.dataset import load_suite, suite_digest, load_recording


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def manifest():
    return {str(path.relative_to(HERE)): sha(path) for path in sorted(HERE.rglob('*'))
            if path.is_file() and path.name != 'FREEZE.json' and '__pycache__' not in path.parts}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--freeze', action='store_true', help='Write initial freeze exactly once after validation')
    args = parser.parse_args()
    suite = load_suite(HERE)
    assert len(suite['cases']) == 6
    assert len(suite['stages']) == 3
    assert {case['language'] for case in suite['cases']} == {'zh', 'en'}
    assert sum(case['input']['kind'] == 'text' for case in suite['cases']) == 4
    assert sum(case['input']['kind'] == 'image' for case in suite['cases']) == 2
    assert suite['independent_visual_scenes'] == 1
    recording_count = 0
    for case in suite['cases']:
        responses = {}
        for stage in suite['stages']:
            raw = load_recording(suite, case['id'], stage)
            responses[stage] = json.loads(raw)
            assert isinstance(responses[stage], dict)
            recording_count += 1
        root = responses['root']
        if case['input']['kind'] == 'text':
            assert case['input']['text'] == case['source']['text']
            root_labels = [section['title'] for section in root['sections']]
        else:
            assert root['language_hint'] == case['language']
            root_labels = [entry['label'] for entry in root['hotspots']]
            assert len(root_labels) == 5
            assert {entry['label'] for entry in root['keywords']} == set(root_labels)
            assert {entry['label']: {key: entry[key] for key in ('x', 'y', 'width', 'height')} for entry in root['hotspots']} == {entry['label']: entry['box'] for entry in case['expected_hotspots']}
        for labels, step in ((root_labels, case['branch_steps'][0]), ([section['title'] for section in responses['child']['sections']], case['branch_steps'][1])):
            assert set(value.casefold() for value in labels) & set(value.casefold() for value in step['preferred_labels'])
        assert all(isinstance(section['body'], str) and section['body'].strip() for stage in ('child', 'grandchild') for section in responses[stage]['sections'])
    assert recording_count == 18

    spec = importlib.util.spec_from_file_location('holdout_original_scene', HERE / 'assets/generate_scene.py')
    generator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(generator)
    generated, svg, recorded_objects = generator.build_scene()
    with Image.open(HERE / 'assets/scene.png') as original:
        assert original.size == (1000, 700)
        assert ImageChops.difference(original.convert('RGB'), generated).getbbox() is None
    geometry = json.loads((HERE / 'assets/geometry.json').read_text())
    assert geometry['png_sha256'] == sha(HERE / 'assets/scene.png')
    assert geometry['objects'] == recorded_objects
    assert (HERE / 'assets/scene.svg').read_text() == svg
    assert len(recorded_objects) == 5
    assert any(entry['occluded_pixels'] > 0 for entry in recorded_objects)
    assert max(entry['visible_pixels'] for entry in recorded_objects) > 4 * min(entry['visible_pixels'] for entry in recorded_objects)
    boxes = {entry['id']: entry['box'] for entry in recorded_objects}
    for case in suite['cases']:
        if case['input']['kind'] == 'image':
            assert {entry['id']: entry['box'] for entry in case['expected_hotspots']} == boxes

    digest = suite_digest(suite)
    freeze_path = HERE / 'FREEZE.json'
    if args.freeze:
        if freeze_path.exists():
            raise SystemExit('Freeze already exists; preserve the frozen holdout identity.')
        freeze = dict(schema_version=1, suite_id=suite['id'], suite_sha256=digest,
                      frozen_at_utc=datetime.now(timezone.utc).isoformat(timespec='seconds'),
                      case_count=6, stage_count=18, content_families=3, independent_visual_scenes=1,
                      origin='independent-curator; no production prompts, runs, reviews, optimization plans, or real inference consulted',
                      files_sha256=manifest())
        freeze_path.write_text(json.dumps(freeze, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    frozen_at = None
    if freeze_path.exists():
        freeze = json.loads(freeze_path.read_text())
        assert freeze['suite_sha256'] == digest
        assert freeze['files_sha256'] == manifest()
        frozen_at = freeze['frozen_at_utc']
    print(json.dumps(dict(valid=True, cases=6, stages=18, independent_visual_scenes=1, suite_sha256=digest, frozen_at_utc=frozen_at, checks=['repository dataset schema and provenance', '18-stage controlled replay parsing and branch reachability', 'exact original pixel reconstruction and visible-support boxes', 'multiscale and occlusion records', 'frozen full-file manifest']), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
