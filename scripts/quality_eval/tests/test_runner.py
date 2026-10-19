"""Admission, crash recovery and production-context tests; no real providers."""
import asyncio
import base64
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from PIL import Image

from scripts.quality_eval.artifacts import canonical_sha256, read_json, write_json
from scripts.quality_eval.production import RunConfig, StageBlocked
from scripts.quality_eval.runner import FOCUSED_REPLAY_ADAPTER, _adapt_focused_recording, _diagnostics, _node, choose_branch, run_suite


def document(title, section_title, body=None):
    return {"title": title, "description": "An independently readable introduction to this topic.", "layout": "atlas",
            "sections": [{"title": section_title, "body": body or "A concrete explanation of how this mechanism works and why it affects the larger system."}],
            "subject_en": "mechanism", "composition_type": "diagram", "sub_topics_en": ["mechanism"]}


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.suite = {"cases": [{"id": "case_" + str(index), "language": "en", "input": {"kind": "text", "text": "Fixed source material."},
                                 "branch_steps": [{"preferred_labels": ["Mechanism"]}, {"preferred_labels": ["Detail"]}]}
                                for index in range(2)]}
        self.responses = {"root": document("Root", "Mechanism"), "child": document("Child", "Detail"),
                          "grandchild": document("Grandchild", "Further detail")}
        self.patches = [patch("scripts.quality_eval.runner.suite_digest", return_value="fixture-suite"),
                        patch("scripts.quality_eval.runner.case_digest", side_effect=canonical_sha256),
                        patch("scripts.quality_eval.runner.load_recording", side_effect=lambda suite, case, stage: json.dumps(self.responses[stage]))]
        for patched in self.patches:
            patched.start()
        self.addCleanup(self.temporary.cleanup)
        self.addCleanup(patch.stopall)

    def config(self, **kwargs):
        return RunConfig(max_calls=6, max_output_tokens=24000, **kwargs)

    def run_eval(self, config=None, resume=False):
        return asyncio.run(run_suite(self.suite, self.directory, config or self.config(), resume=resume))

    def test_replay_runs_production_normalization_and_connects_three_levels(self):
        with patch.object(httpx.AsyncClient, "post", side_effect=AssertionError("network forbidden")):
            run = self.run_eval(self.config(generation_revision="grounded-v2"))
        self.assertEqual((run["status"], run["call_count"], run["reserved_output_tokens"]), ("completed", 6, 24000))
        case = run["cases"][0]
        project = case["project"]
        root, child, grandchild = [project["nodes"][node] for node in case["branch_node_ids"]]
        self.assertEqual(root["children"], [child["id"]])
        self.assertEqual(child["children"], [grandchild["id"]])
        self.assertEqual(root["scene_document"]["sections"][0]["target_node_id"], child["id"])
        self.assertEqual(child["scene_document"]["sections"][0]["target_node_id"], grandchild["id"])
        context = case["branch_path"][0]["parent_context"]
        self.assertEqual(case["branch_path"][0]["parent_context_sha256"], canonical_sha256(context))
        self.assertEqual(json.loads(context)["selected_section"]["body"], root["scene_document"]["sections"][0]["body"])
        self.assertEqual(json.loads(context)["source"]["text"], self.suite["cases"][0]["input"]["text"])
        self.assertEqual(json.loads(case["branch_path"][1]["parent_context"])["ancestor_titles"], [root["title"], child["title"]])
        self.assertNotIn("raw_response", json.dumps(run))
        self.assertEqual(run["run_sha256"], canonical_sha256({key: value for key, value in run.items() if key != "run_sha256"}))

    def test_default_revision_keeps_selected_body_and_actual_context_hash(self):
        with patch("scripts.quality_eval.runner.generation_context", side_effect=AssertionError("legacy context changed")):
            run = self.run_eval()
        self.assertEqual(run["policy"]["generation_revision"], "legacy-v1")
        self.assertEqual(run["policy"]["max_image_hotspots"], 3)
        checkpoint = read_json(self.directory / "checkpoint.json")
        self.assertEqual(checkpoint["identity"]["config"]["generation_revision"], "legacy-v1")
        self.assertEqual(checkpoint["identity"]["config"]["max_image_hotspots"], 3)
        for case in run["cases"]:
            self.assertEqual(case["project"]["settings"]["max_hotspots_per_page"], 3)
            nodes = case["project"]["nodes"]
            for step in case["branch_path"]:
                parent = nodes[step["parent_node_id"]]
                body = next(section["body"] for section in parent["scene_document"]["sections"]
                            if section["hotspot_id"] == step["hotspot_id"])
                self.assertEqual(step["parent_context_kind"], "legacy-v1")
                self.assertEqual(step["parent_context"], body)
                self.assertEqual(step["parent_context_sha256"], canonical_sha256(body))

    def test_invalid_revision_is_rejected_before_any_dispatch_or_checkpoint(self):
        for revision in ("grounded-v3", "", None, []):
            with self.subTest(revision=revision), self.assertRaisesRegex(ValueError, "invalid_generation_revision"):
                self.run_eval(self.config(generation_revision=revision))
        self.assertFalse((self.directory / "checkpoint.json").exists())

    def test_focused_replay_reencodes_only_authored_boxes_and_records_both_response_hashes(self):
        path = self.directory / "source.png"
        Image.new("RGB", (16, 12), (20, 60, 100)).save(path)
        self.suite["cases"] = [{"id": "image-case", "language": "en", "input": {"kind": "image"},
                                 "branch_steps": [{"preferred_labels": ["Mechanism"]}, {"preferred_labels": ["Detail"]}]}]
        self.responses["root"] = {
            "summary": "Unchanged authored summary.", "keywords": [{"label": "Original direction", "description": "Unchanged body."}],
            "hotspots": [{"id": "original-id", "label": "Mechanism", "x": 0.12525, "y": 0.2, "width": 0.3125, "height": 0.4,
                          "score": 0.75, "reason": "Unchanged authored explanation."}],
        }
        original = json.dumps(self.responses["root"])
        config = self.config(generation_revision="focused-v3", max_image_hotspots=5)
        with patch("scripts.quality_eval.runner.asset_path", return_value=path):
            run = self.run_eval(config)
            checkpoint = read_json(self.directory / "checkpoint.json")
            stage = checkpoint["cases"][0]["stages"][0]
            public_call = run["cases"][0]["calls"][0]
            adapted = json.loads(stage["raw_response"])
            self.assertEqual(run["status"], "completed")
            self.assertEqual(run["policy"]["recording_adapter"], FOCUSED_REPLAY_ADAPTER)
            self.assertEqual(public_call["recording_adapter"], FOCUSED_REPLAY_ADAPTER)
            self.assertEqual(public_call["original_recording_response_sha256"], hashlib.sha256(original.encode()).hexdigest())
            self.assertEqual(public_call["recording_response_sha256"], hashlib.sha256(stage["raw_response"].encode()).hexdigest())
            self.assertEqual(adapted["summary"], self.responses["root"]["summary"])
            self.assertEqual(adapted["keywords"], self.responses["root"]["keywords"])
            self.assertEqual(adapted["hotspots"][0]["reason"], self.responses["root"]["hotspots"][0]["reason"])
            self.assertEqual(adapted["hotspots"][0]["label"], "Mechanism")
            self.assertEqual(adapted["hotspots"][0]["bbox_2d"], [125.25, 200.0, 437.75, 600.0000000000001])
            self.assertNotIn("x", adapted["hotspots"][0])
            root = run["cases"][0]["project"]["nodes"]["image-case_root"]
            self.assertAlmostEqual(root["hotspots"][0]["position"]["x"], 0.12525)
            self.assertAlmostEqual(root["hotspots"][0]["size"]["height"], 0.4)
            self.assertEqual(run["cases"][0]["normalization_checks"][0]["invalid_hotspot_count"], 0)
            self.assertEqual(json.dumps(self.responses["root"]), original)
            for step in run["cases"][0]["branch_path"]:
                self.assertEqual(step["parent_context_kind"], "focused-v3")
                self.assertEqual(json.loads(step["parent_context"])["context_version"], "focused-v3")
            self.assertTrue(all(call["recording_adapter"] == "none" for call in run["cases"][0]["calls"][1:]))

            # Reconsume a received image result with its frozen prompt, without another transport call.
            stage["state"] = "response_received"
            stage.pop("normalized_output")
            stage.pop("normalized_sha256")
            checkpoint["cases"][0]["status"] = "running"
            write_json(self.directory / "checkpoint.json", checkpoint)
            resumed = self.run_eval(config, resume=True)
            self.assertEqual(resumed["call_count"], run["call_count"])
            self.assertEqual(resumed["cases"][0]["project"], run["cases"][0]["project"])

    def test_focused_replay_rejects_invalid_and_mixed_recordings_before_dispatch(self):
        valid = {"label": "Mechanism", "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4}
        invalid = [{**valid, "x": True}, {**valid, "x": float("nan")}, {**valid, "width": -0.1},
                   {**valid, "height": 1}, {**valid, "width": 1e-30}, {**valid, "bbox_2d": [100, 200, 400, 600]},
                   {"label": "Mechanism", "bbox_2d": [100, 200, 400, 600]}, {**valid, "label": ""}]
        for index, hotspot in enumerate(invalid):
            raw = json.dumps({"hotspots": [valid, hotspot]})
            with self.subTest(index=index), self.assertRaisesRegex(StageBlocked, "invalid_focused_replay_recording"):
                _adapt_focused_recording(raw)
        with self.assertRaisesRegex(StageBlocked, "invalid_focused_replay_recording"):
            _adapt_focused_recording('{"hotspots": [], "hotspots": []}')
        self.suite["cases"] = [{"id": "image-case", "language": "en", "input": {"kind": "image"}, "branch_steps": []}]
        self.responses["root"] = {"summary": "An invalid recording must remain invalid.", "hotspots": [invalid[0]]}
        config = self.config(generation_revision="focused-v3")
        with patch("scripts.quality_eval.runner.agents") as dispatch:
            run = self.run_eval(config)
            resumed = self.run_eval(config, resume=True)
            dispatch.assert_not_called()
        self.assertEqual(run["cases"][0]["error"], "invalid_focused_replay_recording")
        self.assertEqual((run["call_count"], resumed["call_count"]), (0, 0))

    def test_focused_live_never_adapts_old_protocol_or_reads_recordings(self):
        path = self.directory / "source.png"
        Image.new("RGB", (16, 12), (20, 60, 100)).save(path)
        self.suite["cases"] = [{"id": "image-case", "language": "en", "input": {"kind": "image"},
                                 "branch_steps": [{"preferred_labels": ["Mechanism"]}, {"preferred_labels": ["Detail"]}]}]
        raw = json.dumps({"summary": "Unadapted provider response.", "hotspots": [
            {"label": "Mechanism", "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4}]})
        config = self.config(mode="live", base_url="https://provider.invalid/v1", model="synthetic-model",
                             api_key="SYNTHETIC_HTTP_CREDENTIAL", generation_revision="focused-v3")

        async def response(url, **options):
            return httpx.Response(200, request=httpx.Request("POST", url),
                                  json={"choices": [{"message": {"content": raw}}]})

        with patch("scripts.quality_eval.runner.asset_path", return_value=path), \
                patch("scripts.quality_eval.runner.load_recording", side_effect=AssertionError("live recording read")), \
                patch("scripts.quality_eval.runner._adapt_focused_recording", side_effect=AssertionError("live adaptation")), \
                patch.object(httpx.AsyncClient, "post", side_effect=response):
            run = self.run_eval(config)
        self.assertEqual(run["call_count"], 1)
        self.assertEqual(run["policy"]["recording_adapter"], "none")
        output = run["cases"][0]
        self.assertEqual(output["project"]["nodes"]["image-case_root"]["hotspots"], [])
        self.assertEqual(output["calls"][0]["recording_adapter"], "none")
        self.assertNotIn("original_recording_response_sha256", output["calls"][0])
        self.assertEqual(output["normalization_checks"][0]["invalid_hotspot_count"], 1)
        self.assertEqual(read_json(self.directory / "checkpoint.json")["cases"][0]["stages"][0]["raw_response"], raw)

    def test_focused_diagnostics_validate_bbox_protocol_without_repairing_mixed_fields(self):
        from scripts.quality_eval.production import agents
        agents(self.config(), None, None)
        hotspot = {"label": "Visible object", "bbox_2d": [100, 200, 400, 600]}
        for box, expected in ((hotspot, 0), ({**hotspot, "x": 0.1}, 1), ({**hotspot, "bbox_2d": [100, 200, 99, 600]}, 1)):
            stage = {"stage": "root", "raw_response": json.dumps({"hotspots": [box]})}
            self.assertEqual(_diagnostics(stage, {"hotspots": []}, generation_revision="focused-v3")["invalid_hotspot_count"], expected)

    def test_image_hotspot_limit_validation_excludes_bool_and_out_of_range_values(self):
        for maximum in (True, False, 0, 13, 1.5, "5", None):
            with self.subTest(maximum=maximum), self.assertRaisesRegex(ValueError, "invalid_max_image_hotspots"):
                self.run_eval(self.config(max_image_hotspots=maximum))
        self.assertFalse((self.directory / "checkpoint.json").exists())
        for maximum in (1, 12):
            self.config(max_image_hotspots=maximum).validate()

    def test_image_hotspot_limit_preserves_real_boxes_and_is_frozen_on_resume(self):
        path = self.directory / "source.png"
        Image.new("RGB", (16, 12), (20, 60, 100)).save(path)
        case = {"id": "image-case", "language": "en", "input": {"kind": "image"},
                "branch_steps": [{"preferred_labels": ["Mechanism"]}, {"preferred_labels": ["Detail"]}]}
        self.suite["cases"] = [case]
        hotspots = [{"label": "Mechanism" if index == 0 else f"Shape {index + 1}",
                     "x": 0.02 + index * 0.18, "y": 0.1, "width": 0.12, "height": 0.2} for index in range(5)]
        self.responses["root"] = {"summary": "Five visible shapes.", "keywords": [], "hotspots": hotspots}
        for maximum in (3, 5):
            with self.subTest(maximum=maximum), patch("scripts.quality_eval.runner.asset_path", return_value=path):
                config = self.config(**({"max_image_hotspots": maximum} if maximum == 5 else {}))
                directory = self.directory / str(maximum)
                run = asyncio.run(run_suite(self.suite, directory, config))
                self.assertEqual(run["status"], "completed")
                output = run["cases"][0]
                root = output["project"]["nodes"][output["project"]["root_node_id"]]
                self.assertEqual(len(root["hotspots"]), maximum)
                for actual, expected in zip(root["hotspots"], hotspots[:maximum], strict=True):
                    self.assertEqual(actual["label"], expected["label"])
                    self.assertEqual(actual["position"], {"x": expected["x"], "y": expected["y"]})
                    self.assertEqual(actual["size"], {"width": expected["width"], "height": expected["height"]})
                checkpoint = read_json(directory / "checkpoint.json")
                self.assertEqual(output["project"]["settings"]["max_hotspots_per_page"], maximum)
                self.assertEqual(run["policy"]["max_image_hotspots"], maximum)
                self.assertEqual(checkpoint["identity"]["config"]["max_image_hotspots"], maximum)
                resumed = asyncio.run(run_suite(self.suite, directory, config, resume=True))
                self.assertEqual(resumed["run_sha256"], run["run_sha256"])
                before = (directory / "checkpoint.json").read_bytes()
                changed = self.config(max_image_hotspots=5 if maximum == 3 else 3)
                with patch("scripts.quality_eval.runner.agents", side_effect=AssertionError("unexpected provider dispatch")):
                    with self.assertRaisesRegex(ValueError, "resume_configuration_or_sources_changed"):
                        asyncio.run(run_suite(self.suite, directory, changed, resume=True))
                self.assertEqual((directory / "checkpoint.json").read_bytes(), before)
                self.assertEqual(read_json(directory / "checkpoint.json")["call_count"], 3)

    def test_call_and_token_budgets_reject_before_dispatch(self):
        config = RunConfig(max_calls=1, max_output_tokens=4000)
        run = self.run_eval(config)
        self.assertEqual(run["call_count"], 1)
        self.assertEqual(run["reserved_output_tokens"], 4000)
        self.assertEqual(run["cases"][0]["error"], "call_budget_exceeded")
        other = self.directory / "token"
        run = asyncio.run(run_suite(self.suite, other, RunConfig(max_output_tokens=3999)))
        self.assertEqual(run["call_count"], 0)
        self.assertEqual(run["cases"][0]["error"], "output_token_budget_exceeded")

    def test_oversized_prompt_does_not_dispatch(self):
        config = self.config()
        config.max_prompt_bytes = 1
        run = self.run_eval(config)
        self.assertEqual(run["call_count"], 0)
        self.assertEqual(run["cases"][0]["error"], "prompt_byte_budget_exceeded")

    def test_expired_time_budget_does_not_dispatch(self):
        config = self.config(timeout_seconds=0.000001)
        run = self.run_eval(config)
        self.assertEqual(run["call_count"], 0)
        self.assertEqual(run["cases"][0]["error"], "run_time_budget_exceeded")

    def test_invalid_body_fails_normalization_without_retry(self):
        self.responses["root"]["sections"][0]["body"] = "short"
        run = self.run_eval()
        self.assertEqual(run["call_count"], 2)
        self.assertTrue(all(case["status"] == "failed" for case in run["cases"]))
        resumed = self.run_eval(resume=True)
        self.assertEqual(resumed["call_count"], 2)

    def test_unexpected_branch_is_not_replaced_by_unrelated_index(self):
        self.responses["root"]["sections"][0]["title"] = "Unrelated"
        run = self.run_eval()
        self.assertEqual(run["call_count"], 2)
        self.assertEqual(run["cases"][0]["error"], "branch_selector_missing")
        self.assertEqual(len(run["cases"][0]["branch_node_ids"]), 1)

    def test_ambiguous_branch_is_blocked(self):
        parent = {"hotspots": [{"label": "same"}, {"label": "Same"}]}
        with self.assertRaisesRegex(ValueError, "ambiguous"):
            choose_branch(parent, {"preferred_labels": ["same"]})

    def test_explicit_first_hotspot_explores_actual_output_without_expected_labels(self):
        self.responses["root"]["sections"][0]["title"] = "An actual model heading"
        self.responses["child"]["sections"][0]["title"] = "A deeper actual heading"
        config = self.config(branch_selection="first-hotspot")
        run = self.run_eval(config)
        self.assertEqual(run["status"], "completed")
        self.assertEqual(run["policy"]["branch_selection"], "first-hotspot")
        self.assertEqual([step["label"] for step in run["cases"][0]["branch_path"]],
                         ["An actual model heading", "A deeper actual heading"])
        self.assertEqual(self.run_eval(config, resume=True)["call_count"], 6)
        with self.assertRaisesRegex(ValueError, "changed"):
            self.run_eval(self.config(), resume=True)

    def test_first_hotspot_policy_stops_when_no_actual_entry_exists(self):
        with self.assertRaisesRegex(ValueError, "missing"):
            choose_branch({"hotspots": []}, {"preferred_labels": ["Imagined entry"]}, policy="first-hotspot")

    def test_missing_image_summary_keeps_production_empty_parent_context(self):
        from scripts.quality_eval.production import agents
        agents(self.config(), None, None)
        case = {"id": "image-case", "input": {"kind": "image"}}
        for result in ({"hotspots": []}, {"summary": None, "hotspots": []}):
            root = _node(case, "root", result, model="synthetic-only")
            self.assertEqual(root["description"], "")

    def test_unknown_outcome_stops_entire_run_and_resume_never_retries(self):
        config = self.config(mode="live", base_url="https://provider.invalid/v1", model="synthetic-model", api_key="SYNTHETIC_KEY_ONLY")
        transport = AsyncMock(side_effect=httpx.ReadTimeout("SYNTHETIC_KEY_ONLY"))
        # Import production agent classes without performing any provider call.
        from scripts.quality_eval.production import agents
        agents(config, None, None)
        with patch("agents.base.BaseLLMAgent._call_openai_compat", transport):
            run = self.run_eval(config)
            self.assertEqual(run["call_count"], 1)
            self.assertEqual(run["cases"][1]["status"], "pending")
            resumed = self.run_eval(config, resume=True)
        self.assertEqual(resumed["call_count"], 1)
        self.assertEqual(transport.await_count, 1)
        self.assertNotIn("SYNTHETIC_KEY_ONLY", (self.directory / "checkpoint.json").read_text())

    def test_response_received_can_finish_normalization_without_another_call(self):
        original = self.run_eval()
        checkpoint = read_json(self.directory / "checkpoint.json")
        stage = checkpoint["cases"][0]["stages"][-1]
        stage["state"] = "response_received"
        stage.pop("normalized_output")
        stage.pop("normalized_sha256")
        checkpoint["cases"][0]["status"] = "running"
        write_json(self.directory / "checkpoint.json", checkpoint)
        resumed = self.run_eval(resume=True)
        self.assertEqual(resumed["status"], "completed")
        self.assertEqual(resumed["call_count"], original["call_count"])
        self.assertEqual(resumed["cases"][0]["project"], original["cases"][0]["project"])

    def test_tampered_received_response_is_not_replayed_or_sent_again(self):
        self.run_eval()
        checkpoint = read_json(self.directory / "checkpoint.json")
        stage = checkpoint["cases"][0]["stages"][-1]
        stage["state"] = "response_received"
        stage["raw_response"] += " tampered"
        checkpoint["cases"][0]["status"] = "running"
        write_json(self.directory / "checkpoint.json", checkpoint)
        resumed = self.run_eval(resume=True)
        self.assertEqual(resumed["call_count"], 6)
        self.assertEqual(resumed["cases"][0]["error"], "checkpoint_response_changed")

    def test_live_http_adapter_uses_actual_prompt_and_never_sends_source_as_credentials(self):
        self.suite["cases"][0]["source"] = {"text": "REVIEW_ONLY_NOT_GENERATOR_INPUT"}
        self.suite["cases"][0]["fact_checks"] = [{"claim": "REVIEW_ONLY_FACT"}]
        for generation_revision in ("legacy-v1", "grounded-v2", "focused-v3"):
            with self.subTest(revision=generation_revision):
                config = self.config(mode="live", base_url="https://provider.invalid/v1", model="synthetic-model",
                                     api_key="SYNTHETIC_HTTP_CREDENTIAL", generation_revision=generation_revision)
                bodies = []

                async def response(url, **options):
                    self.assertEqual(url, "https://provider.invalid/v1/chat/completions")
                    self.assertEqual(options["headers"]["Authorization"], "Bearer " + config.api_key)
                    bodies.append(options["json"])
                    index = (len(bodies) - 1) % 3
                    return httpx.Response(200, request=httpx.Request("POST", url),
                                          json={"choices": [{"message": {"content": json.dumps(self.responses[("root", "child", "grandchild")[index]])}}]})

                with patch.object(httpx.AsyncClient, "post", side_effect=response):
                    run = asyncio.run(run_suite(self.suite, self.directory / generation_revision, config))
                    actual = list(bodies)
                    from agents.base import LLMConfig
                    from agents.input_analysis import InputAnalysisAgent
                    from agents.page_generation import STYLE_PROMPTS, PageGenerationAgent

                    provider = LLMConfig(config.base_url, config.api_key, config.model)
                    revision = {"generation_revision": generation_revision} if generation_revision != "legacy-v1" else {}

                    async def production_requests():
                        for case, output in zip(self.suite["cases"], run["cases"], strict=True):
                            await InputAnalysisAgent(provider).analyze_text(case["input"]["text"], case["language"],
                                                                          STYLE_PROMPTS["encyclopedia"], content_format="knowledge-v1",
                                                                          **revision)
                            for step in output["branch_path"]:
                                parent = output["project"]["nodes"][step["parent_node_id"]]
                                await PageGenerationAgent(provider).generate(hotspot_label=step["label"], parent_title=parent["title"],
                                                                             parent_description=step["parent_context"], language=case["language"],
                                                                             selected_keywords=[], content_format="knowledge-v1", **revision)

                    asyncio.run(production_requests())
                self.assertEqual(run["status"], "completed")
                self.assertEqual(len(actual), 6)
                self.assertEqual(actual, bodies[6:])
                if generation_revision != "focused-v3":
                    self.assertIn("可独立阅读", actual[0]["messages"][0]["content"])
                child_prompt = actual[1]["messages"][-1]["content"]
                self.assertIn(self.responses["root"]["sections"][0]["body"], child_prompt)
                if revision:
                    self.assertIn(self.suite["cases"][0]["input"]["text"], child_prompt)
                    self.assertEqual(json.loads(run["cases"][0]["branch_path"][0]["parent_context"])["context_version"], generation_revision)
                else:
                    self.assertNotIn(self.suite["cases"][0]["input"]["text"], child_prompt)
                self.assertNotIn("REVIEW_ONLY", json.dumps(actual))
                self.assertIn(run["cases"][0]["branch_path"][0]["parent_context"], child_prompt)
                self.assertNotIn(config.api_key, json.dumps(actual))

    def test_image_revision_matches_production_prompt_and_legacy_summary_fallback(self):
        path = self.directory / "source.png"
        Image.new("RGB", (16, 12), (20, 60, 100)).save(path)
        case = {"id": "image-case", "language": "en", "input": {"kind": "image"},
                "branch_steps": [{"preferred_labels": ["Mechanism"]}, {"preferred_labels": ["Detail"]}]}
        self.suite["cases"] = [case]
        image_result = {"summary": "A visible shape on a plain background.", "keywords": [],
                        "hotspots": [{"label": "Mechanism", "x": 0.1, "y": 0.1, "width": 0.5, "height": 0.5}]}
        for generation_revision in ("legacy-v1", "grounded-v2", "focused-v3"):
            with self.subTest(revision=generation_revision):
                config = self.config(mode="live", base_url="https://provider.invalid/v1", model="synthetic-model",
                                     api_key="SYNTHETIC_IMAGE_CREDENTIAL", generation_revision=generation_revision)
                bodies = []

                async def response(url, **options):
                    bodies.append(options["json"])
                    index = (len(bodies) - 1) % 3
                    raw = image_result if index == 0 else self.responses[("root", "child", "grandchild")[index]]
                    if index == 0 and generation_revision == "focused-v3":
                        raw = {**image_result, "hotspots": [{"label": "Mechanism", "bbox_2d": [100, 100, 600, 600]}]}
                    return httpx.Response(200, request=httpx.Request("POST", url),
                                          json={"choices": [{"message": {"content": json.dumps(raw)}}]})

                with patch("scripts.quality_eval.runner.asset_path", return_value=path), patch.object(httpx.AsyncClient, "post", side_effect=response):
                    run = asyncio.run(run_suite(self.suite, self.directory / generation_revision, config))
                    from agents.base import LLMConfig
                    from agents.input_analysis import InputAnalysisAgent

                    revision = {"generation_revision": generation_revision} if generation_revision != "legacy-v1" else {}
                    asyncio.run(InputAnalysisAgent(LLMConfig(config.base_url, config.api_key, config.model)).analyze_image(
                        base64.b64encode(path.read_bytes()).decode(), "en", **revision))
                self.assertEqual(run["status"], "completed")
                self.assertEqual(len(bodies), 4)
                self.assertEqual(bodies[0], bodies[-1])
                self.assertEqual(bodies[0]["max_tokens"], 1200)
                step = run["cases"][0]["branch_path"][0]
                self.assertEqual(step["parent_context_kind"], generation_revision)
                self.assertEqual(step["parent_context_sha256"], canonical_sha256(step["parent_context"]))
                if revision:
                    self.assertEqual(json.loads(step["parent_context"])["source"],
                                     {"kind": "image_without_original_text", "text": "", "truncated": False})
                else:
                    self.assertEqual(step["parent_context"], image_result["summary"])

    def test_changed_evaluator_rejects_resume_before_dispatch_or_checkpoint_write(self):
        self.run_eval()
        paths = [self.directory / name for name in ("checkpoint.json", "run.json")]
        before = [path.read_bytes() for path in paths]
        with patch("scripts.quality_eval.runner.evaluator_sha256", return_value="changed-evaluator"), \
                patch("scripts.quality_eval.runner.agents") as dispatch:
            with self.assertRaisesRegex(ValueError, "resume_configuration_or_sources_changed"):
                self.run_eval(resume=True)
            dispatch.assert_not_called()
        self.assertEqual([path.read_bytes() for path in paths], before)

    def test_focused_resume_rejects_changed_producer_and_revision_before_writing(self):
        config = self.config(generation_revision="focused-v3")
        self.run_eval(config)
        paths = [self.directory / name for name in ("checkpoint.json", "run.json")]
        before = [path.read_bytes() for path in paths]
        with patch("scripts.quality_eval.runner.producer_sha256", return_value="changed-producer"), \
                patch("scripts.quality_eval.runner.agents") as dispatch:
            with self.assertRaisesRegex(ValueError, "resume_configuration_or_sources_changed"):
                self.run_eval(config, resume=True)
            dispatch.assert_not_called()
        with self.assertRaisesRegex(ValueError, "resume_configuration_or_sources_changed"):
            self.run_eval(self.config(generation_revision="grounded-v2"), resume=True)
        self.assertEqual([path.read_bytes() for path in paths], before)

    def test_completed_run_resume_is_free_and_changed_configuration_is_rejected(self):
        self.run_eval()
        self.assertEqual(self.run_eval(resume=True)["call_count"], 6)
        with self.assertRaisesRegex(ValueError, "changed"):
            self.run_eval(RunConfig(max_calls=7, max_output_tokens=24000), resume=True)
        with self.assertRaisesRegex(ValueError, "changed"):
            self.run_eval(self.config(generation_revision="grounded-v2"), resume=True)
        self.assertEqual(read_json(self.directory / "checkpoint.json")["call_count"], 6)

    def test_echoed_credential_is_redacted_from_private_and_public_outputs(self):
        secret = "SYNTHETIC_ECHO_CREDENTIAL"
        self.responses["root"]["description"] += secret
        run = self.run_eval(self.config(api_key=secret))
        self.assertNotIn(secret, json.dumps(run))
        self.assertNotIn(secret, (self.directory / "checkpoint.json").read_text())
        self.assertIn("[redacted]", (self.directory / "checkpoint.json").read_text())

    def test_short_live_key_preserves_checkpoint_schema_and_free_resume(self):
        config = self.config(mode="live", base_url="https://provider.invalid/v1", model="synthetic-model", api_key="token")
        self.responses["root"]["description"] += " Echoed credential: token."
        calls = []

        async def response(url, **options):
            self.assertEqual(options["headers"]["Authorization"], "Bearer token")
            stage = ("root", "child", "grandchild")[len(calls) % 3]
            calls.append(stage)
            return httpx.Response(200, request=httpx.Request("POST", url),
                                  json={"choices": [{"message": {"content": json.dumps(self.responses[stage])}}]})

        with patch.object(httpx.AsyncClient, "post", side_effect=response):
            original = self.run_eval(config)
            resumed = self.run_eval(config, resume=True)
        checkpoint = read_json(self.directory / "checkpoint.json")
        self.assertEqual(checkpoint["identity"]["config"]["max_output_tokens"], 24000)
        self.assertEqual(checkpoint["budgets"]["max_reserved_output_tokens"], 24000)
        self.assertEqual(checkpoint["mode"], "live")
        self.assertEqual(original["status"], "completed")
        self.assertEqual(resumed["run_sha256"], original["run_sha256"])
        self.assertEqual(len(calls), 6)
        self.assertNotIn("api_key", checkpoint["identity"]["config"])
        raw = checkpoint["cases"][0]["stages"][0]["raw_response"]
        self.assertNotIn("Echoed credential: token.", raw)
        self.assertIn("Echoed credential: [redacted].", raw)

    def test_short_unknown_key_cannot_change_unknown_state_or_repeat_charge(self):
        config = self.config(mode="live", base_url="https://provider.invalid/v1", model="synthetic-model", api_key="unknown")
        from scripts.quality_eval.production import agents
        agents(config, None, None)
        transport = AsyncMock(side_effect=httpx.ReadTimeout("unknown"))
        with patch("agents.base.BaseLLMAgent._call_openai_compat", transport):
            original = self.run_eval(config)
            resumed = self.run_eval(config, resume=True)
        checkpoint = read_json(self.directory / "checkpoint.json")
        stage = checkpoint["cases"][0]["stages"][0]
        self.assertEqual(stage["state"], "outcome_unknown")
        self.assertEqual(stage["error"], "provider_outcome_unknown")
        self.assertEqual((original["call_count"], resumed["call_count"]), (1, 1))
        self.assertEqual(resumed["cases"][1]["status"], "pending")
        self.assertEqual(transport.await_count, 1)


if __name__ == "__main__":
    unittest.main()
