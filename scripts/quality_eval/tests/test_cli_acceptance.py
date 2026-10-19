"""Process-level offline acceptance, separate from runner unit tests."""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from scripts.quality_eval.cli import main
from scripts.quality_eval.production import RunConfig


ROOT = Path(__file__).resolve().parents[3]
ENTRY = ROOT / "scripts/evaluate_quality.py"


@pytest.mark.parametrize("arguments,filename,value,error", [
    (["report"], "run.json", [], "invalid_run_structure"),
    (["run", "--resume"], "checkpoint.json", {"identity": {"config": None}}, "invalid_checkpoint_configuration"),
    (["run", "--resume"], "checkpoint.json", {"identity": {"config": {**RunConfig().public(), "model": None}}},
     "invalid_run_configuration"),
])
def test_cli_rejects_malformed_local_artifacts_without_traceback(tmp_path, capsys, arguments, filename, value, error):
    (tmp_path / filename).write_text(json.dumps(value))
    assert main([*arguments, str(tmp_path)]) == 2
    assert error in capsys.readouterr().err


@contextmanager
def local_provider(*, unknown=False):
    """Real loopback HTTP, with only contributor-authored response fixtures."""
    suite_dir = ROOT / "evals/datasets/quality-v1"
    manifest = json.loads((suite_dir / "suite.json").read_text())
    cases = [json.loads((suite_dir / path).read_text()) for path in manifest["case_files"]]
    recordings = json.loads((suite_dir / "replay.json").read_text())["responses"]
    responses = [recordings[case["id"]][stage] for case in cases for stage in ("root", "child", "grandchild")]
    state = {"calls": [], "key": "SYNTHETIC_LOOPBACK_ONLY_QUALITY_KEY_8293"}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            state["calls"].append({"path": self.path, "body": body,
                                   "authorized": self.headers.get("Authorization") == "Bearer " + state["key"]})
            if unknown:
                self.connection.shutdown(socket.SHUT_RDWR)
                self.connection.close()
                return
            raw = json.dumps(responses[len(state["calls"]) - 1], ensure_ascii=False)
            # Exercise exact credential redaction through the real response parser.
            if len(state["calls"]) == 1:
                value = json.loads(raw)
                value["description"] += " " + state["key"]
                raw = json.dumps(value, ensure_ascii=False)
            payload = json.dumps({"choices": [{"message": {"content": raw}}]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    state["url"] = f"http://127.0.0.1:{server.server_port}/v1"
    try:
        yield state
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def invoke_live(directory, provider, *, calls=18, resume=False):
    arguments = ["run", "--live", "--api-key-env", "QUALITY_ACCEPTANCE_KEY"]
    if resume:
        arguments += ["--resume", str(directory)]
    else:
        arguments += ["--output", str(directory), "--base-url", provider["url"], "--model", "synthetic-loopback-only",
                      "--max-calls", str(calls), "--max-output-tokens", "66400", "--timeout-seconds", "30"]
    process = subprocess.run([sys.executable, str(ENTRY), *arguments], cwd=ROOT,
                             env={**os.environ, "QUALITY_ACCEPTANCE_KEY": provider["key"]},
                             capture_output=True, text=True, timeout=45, check=False)
    assert provider["key"] not in process.stdout + process.stderr
    for path in directory.rglob("*"):
        if path.is_file() and path.suffix in {".json", ".html"}:
            assert provider["key"] not in path.read_text()
    return process


def test_complete_offline_cli_does_not_use_network_or_deployment_keys(tmp_path):
    guard = tmp_path / "guard"
    guard.mkdir()
    (guard / "sitecustomize.py").write_text(
        "import socket\n"
        "def denied(*args, **kwargs):\n"
        "    raise RuntimeError('OFFLINE_ACCEPTANCE_NETWORK_DENIED')\n"
        "socket.socket.connect = denied\n"
        "socket.getaddrinfo = denied\n",
        encoding="utf-8",
    )
    canary = "OFFLINE_ONLY_DEPLOYMENT_KEY_MUST_NOT_BE_USED_7319"
    environment = {**os.environ, "PYTHONPATH": str(guard), "LLM_API_KEY": canary,
                   "IMG_GEN_API_KEY": canary, "LLM_BASE_URL": "http://127.0.0.1:9",
                   "DATABASE_URL": "postgresql://unused.invalid/never_connect"}

    def invoke(*arguments, expected=0):
        process = subprocess.run([sys.executable, str(ENTRY), *map(str, arguments)],
                                 cwd=ROOT, env=environment, capture_output=True, text=True,
                                 timeout=60, check=False)
        assert process.returncode == expected, process.stdout + process.stderr
        assert canary not in process.stdout + process.stderr
        return process

    baseline, candidate, comparison = (tmp_path / name for name in ("baseline", "candidate", "comparison"))
    invoke("run", "--output", baseline)
    invoke("run", "--output", candidate)
    invoke("review-template", baseline, "--output", tmp_path / "review.json")
    invoke("review-template", baseline, "--reviewer-kind", "agent", "--output", tmp_path / "agent-template.json")
    agent_template = json.loads((tmp_path / "agent-template.json").read_text())
    assert agent_template["reviewer"]["kind"] == "agent"
    assert agent_template["cases"][0]["dimensions"]["body"]["evidence"] == []
    invoke("report", baseline)
    invoke("compare", baseline, candidate, "--output", comparison)

    # A synthetic acceptance input tests review ingestion, not factual judgment.
    review_path = tmp_path / "review.json"
    review = json.loads(review_path.read_text())
    review["reviewer"] = {"kind": "calibration", "name": "Synthetic CLI ingestion test; no human quality judgment"}
    for case in review["cases"]:
        for dimension in case["dimensions"].values():
            dimension.update(score=3, reason="Synthetic ingestion calibration only.", evidence="Controlled fixture test input.")
        for fact in case["fact_checks"]:
            fact.update(verdict="supported", reason="Synthetic calibration verdict.", evidence="Controlled fixture test input.")
        for claim in case["forbidden_claims"]:
            claim.update(verdict="absent", reason="Synthetic calibration verdict.", evidence="Controlled fixture test input.")
    review_path.write_text(json.dumps(review))
    invoke("apply-review", baseline, review_path)
    assessed = json.loads((baseline / "assessment.json").read_text())
    assert assessed["calibration"] == "passed"
    assert assessed["human_quality"] == "not_approved"
    assert assessed["overall_quality_score"] is None
    saved_review = (baseline / "review.json").read_bytes()
    review["run_sha256"] = "obsolete-output"
    review_path.write_text(json.dumps(review))
    invoke("apply-review", baseline, review_path, expected=2)
    assert (baseline / "review.json").read_bytes() == saved_review

    for directory in (baseline, candidate):
        run = json.loads((directory / "run.json").read_text())
        assert run["mode"] == "replay"
        assert len(run["cases"]) == 6
        assert sum(len(case["project"]["nodes"]) for case in run["cases"]) == 18
        assert all(case["status"] == "completed" for case in run["cases"])
        assert (directory / "report.html").is_file()
        assert (directory / "assessment.json").is_file()
    for path in tmp_path.rglob("*"):
        if path.is_file() and path.suffix in {".json", ".html", ".md"}:
            assert canary not in path.read_text()


def test_complete_cli_uses_real_http_adapter_with_synthetic_provider(tmp_path):
    with local_provider() as provider:
        process = invoke_live(tmp_path / "http", provider)
        assert process.returncode == 0, process.stdout + process.stderr
        assert len(provider["calls"]) == 18
        assert all(call["authorized"] and call["path"] == "/v1/chat/completions" for call in provider["calls"])
        assert sum(call["body"]["max_tokens"] for call in provider["calls"]) == 66400
        root = json.loads((ROOT / "evals/datasets/quality-v1/replay.json").read_text())["responses"]["water-cycle-zh"]["root"]
        child_prompt = str(provider["calls"][1]["body"]["messages"][-1]["content"])
        assert root["sections"][0]["body"] in child_prompt
        assert root["sections"][1]["body"] not in child_prompt
        assessment = json.loads((tmp_path / "http/assessment.json").read_text())
        assert assessment["human_quality"] == "not_reviewed"
        assert assessment["overall_quality_score"] is None


def test_cli_call_budget_prevents_new_dispatch_on_resume(tmp_path):
    with local_provider() as provider:
        directory = tmp_path / "capped"
        assert invoke_live(directory, provider, calls=1).returncode == 2
        assert len(provider["calls"]) == 1
        assert invoke_live(directory, provider, resume=True).returncode == 2
        assert len(provider["calls"]) == 1


def test_cli_unknown_http_result_stops_all_calls_and_resume(tmp_path):
    with local_provider(unknown=True) as provider:
        directory = tmp_path / "unknown"
        assert invoke_live(directory, provider).returncode == 2
        assert len(provider["calls"]) == 1
        run = json.loads((directory / "run.json").read_text())
        assert run["cases"][0]["calls"][0]["state"] == "outcome_unknown"
        assert invoke_live(directory, provider, resume=True).returncode == 2
        assert len(provider["calls"]) == 1
