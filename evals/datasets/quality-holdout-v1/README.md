# Independently curated quality holdout v1

This frozen set contains **6 bilingual cases × 3 stages = 18 stages**, built from three new content families: two original text briefs and one original visual scene. Each family has Chinese and English views. The image cases share one independently authored scene; they do not count as independent visual replications.

The curator consulted only the dataset schema and pre-existing fixed-fixture formats, plus public primary science sources. Production prompts, live-model runs, review outputs, and proposed optimizations were not consulted. No real model inference was performed during authoring. Inspect holdout inputs only after the candidate model and implementation have been frozen. This small set supports regression investigation, not a statistical model ranking.

## Files

- `suite.json` and `cases/` follow `scripts/quality_eval/dataset.py`.
- `replay.json` contains contributor-authored controlled raw responses for every case/stage. They demonstrate offline plumbing and a coherent branch, **not live-model quality** or a model-generated answer key.
- `assets/scene.png` is the sole visual generation input. `assets/generate_scene.py` is original deterministic Pillow code; its independently recorded annotations are in `assets/geometry.json`. `assets/scene.svg` is an original vector rendition, not an alternate annotated raster.
- `sources/README.md` documents primary-source provenance. Network access is unnecessary to load, replay, or inspect the fixture.
- `author_fixture.py` reproducibly writes the original cases and replay from the already-generated image record. It is an authoring resource, not generation context.
- `FREEZE.json` binds the suite digest plus hashes of all support files. Never regenerate or revise an already-used holdout under the same frozen identity.

## Offline validation

From the repository root, run a Python with Pillow installed:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 evals/datasets/quality-holdout-v1/validate_fixture.py
```

The author used the bundled Python returned by `load_workspace_dependencies`. Validation calls the repository's real `load_suite`, `suite_digest`, and `load_recording`; checks all 18 controlled responses, branch-label reachability, exact image reconstruction, the visible-support bounding boxes and occlusion record, and the frozen file manifest. It prints only counts, the digest, and freeze status. These checks validate the fixture, not output semantics. Semantic claims require source-grounded review of real output.

To reproduce assets before the initial freeze only:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 evals/datasets/quality-holdout-v1/assets/generate_scene.py
PYTHONDONTWRITEBYTECODE=1 python3 evals/datasets/quality-holdout-v1/author_fixture.py
PYTHONDONTWRITEBYTECODE=1 python3 evals/datasets/quality-holdout-v1/validate_fixture.py --freeze
```

## Generation and review boundary

Generation receives only the case's visible input under the evaluation adapter and the normal branch context. `fact_checks`, `forbidden_claims`, `unknown_limits`, `dimension_notes`, `expected_hotspots`, `geometry.json`, replays, and authoring code are reviewer-only material. Do not append those resources to any model prompt, tune prompts against them, or represent their existence as knowledge the model was given.

Review anchors express relationships, event triggers, qualifications, conditions, and evidence limits. They are not keyword match lists. Root requirements apply to the overview; `all_pages_if_mentioned` requirements are conditional. A deeper page need not repeat the whole source, invent a worked example, fabricate physical properties, or supply an unsupported policy/observation. Follow the selected label and actual transmitted context when judging added depth and continuity.

All original prose, controlled replays, code, annotations, and graphics are MIT licensed. No third-party image or scientific illustration was copied.
