"""Admission, crash recovery and production-context tests; no real providers."""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

from scripts.quality_eval.artifacts import canonical_sha256, read_json, write_json
from scripts.quality_eval.production import RunConfig
from scripts.quality_eval.runner import _node, choose_branch, run_suite


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
            run = self.run_eval()
        self.assertEqual((run["status"], run["call_count"], run["reserved_output_tokens"]), ("completed", 6, 24000))
        case = run["cases"][0]
        project = case["project"]
        root, child, grandchild = [project["nodes"][node] for node in case["branch_node_ids"]]
        self.assertEqual(root["children"], [child["id"]])
        self.assertEqual(child["children"], [grandchild["id"]])
        self.assertEqual(root["scene_document"]["sections"][0]["target_node_id"], child["id"])
        self.assertEqual(child["scene_document"]["sections"][0]["target_node_id"], grandchild["id"])
        self.assertEqual(case["branch_path"][0]["parent_context_sha256"], canonical_sha256(root["scene_document"]["sections"][0]["body"]))
        self.assertNotIn("raw_response", json.dumps(run))
        self.assertEqual(run["run_sha256"], canonical_sha256({key: value for key, value in run.items() if key != "run_sha256"}))

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
        config = self.config(mode="live", base_url="https://provider.invalid/v1", model="synthetic-model", api_key="SYNTHETIC_HTTP_CREDENTIAL")
        bodies = []

        async def response(url, **options):
            self.assertEqual(url, "https://provider.invalid/v1/chat/completions")
            self.assertEqual(options["headers"]["Authorization"], "Bearer " + config.api_key)
            bodies.append(options["json"])
            index = (len(bodies) - 1) % 3
            return httpx.Response(200, request=httpx.Request("POST", url),
                                  json={"choices": [{"message": {"content": json.dumps(self.responses[("root", "child", "grandchild")[index]])}}]})

        with patch.object(httpx.AsyncClient, "post", side_effect=response):
            run = self.run_eval(config)
        self.assertEqual(run["status"], "completed")
        self.assertEqual(len(bodies), 6)
        self.assertIn("可独立阅读", bodies[0]["messages"][0]["content"])
        child_prompt = bodies[1]["messages"][-1]["content"]
        self.assertIn(self.responses["root"]["sections"][0]["body"], child_prompt)
        self.assertNotIn(self.suite["cases"][0]["input"]["text"], child_prompt)
        self.assertNotIn(config.api_key, json.dumps(bodies))

    def test_completed_run_resume_is_free_and_changed_configuration_is_rejected(self):
        self.run_eval()
        self.assertEqual(self.run_eval(resume=True)["call_count"], 6)
        with self.assertRaisesRegex(ValueError, "changed"):
            self.run_eval(RunConfig(max_calls=7, max_output_tokens=24000), resume=True)

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
