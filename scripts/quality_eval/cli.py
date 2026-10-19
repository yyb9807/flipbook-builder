"""Explicit commands for generating, reviewing and comparing quality experiments."""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

from .artifacts import ROOT, canonical_sha256, read_json, write_json
from .dataset import load_suite, suite_digest
from .production import RunConfig
from .runner import run_suite


def _read_run(directory, suite):
    from .scoring import _validate_run

    run = read_json(Path(directory) / "run.json")
    _validate_run(run)
    expected = run.get("run_sha256")
    if expected != canonical_sha256({key: value for key, value in run.items() if key != "run_sha256"}):
        raise ValueError("run_hash_mismatch")
    if run["suite_sha256"] != suite_digest(suite):
        raise ValueError("run_suite_mismatch")
    return run


def _review(directory, explicit=None):
    path = Path(explicit) if explicit else Path(directory) / "review.json"
    if explicit and not path.is_file():
        raise ValueError("explicit_review_file_not_found")
    return read_json(path) if path.exists() else None


def _configuration(args):
    if args.resume:
        checkpoint = read_json(Path(args.resume) / "checkpoint.json")
        identity = checkpoint.get("identity") if isinstance(checkpoint, dict) else None
        saved = identity.get("config") if isinstance(identity, dict) else None
        if not isinstance(saved, dict) or set(saved) != set(RunConfig().public()):
            raise ValueError("invalid_checkpoint_configuration")
        if saved["mode"] == "live" and not args.live:
            raise ValueError("live_resume_requires_explicit_live_flag")
        values = {**saved}
        for argument in ("base_url", "model", "max_calls", "max_output_tokens", "timeout_seconds", "branch_selection", "generation_revision", "max_image_hotspots"):
            if getattr(args, argument) is not None:
                values[argument] = getattr(args, argument)
    else:
        if args.live and any(getattr(args, name) is None for name in (
                "base_url", "model", "max_calls", "max_output_tokens", "timeout_seconds")):
            raise ValueError("live_requires_provider_model_and_explicit_call_token_time_budgets")
        values = RunConfig().public()
        values["mode"] = "live" if args.live else "replay"
        for argument in ("base_url", "model", "max_calls", "max_output_tokens", "timeout_seconds", "branch_selection", "generation_revision", "max_image_hotspots"):
            if getattr(args, argument) is not None:
                values[argument] = getattr(args, argument)
    if values["mode"] == "live":
        if not args.api_key_env or not os.environ.get(args.api_key_env):
            raise ValueError("live_requires_explicit_nonempty_api_key_environment_variable")
        values["api_key"] = os.environ[args.api_key_env]
    elif args.api_key_env:
        raise ValueError("replay_does_not_accept_credentials")
    return RunConfig(**values)


def parser():
    command = argparse.ArgumentParser(description="Fixed-sample production-agent quality evaluation; replay is always offline.")
    commands = command.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run", help="Run recorded samples; paid calls require --live and explicit budgets.")
    run.add_argument("--output", type=Path)
    run.add_argument("--resume", type=Path)
    run.add_argument("--live", action="store_true")
    run.add_argument("--base-url")
    run.add_argument("--model")
    run.add_argument("--api-key-env", help="Explicit environment variable name; no .env is loaded.")
    run.add_argument("--max-calls", type=int)
    run.add_argument("--max-output-tokens", type=int, help="Total reserved output-token ceiling, not measured billing.")
    run.add_argument("--timeout-seconds", type=float)
    run.add_argument("--branch-selection", choices=("strict-preferred-label", "first-hotspot"),
                     help="Strict fixture labels by default; first-hotspot explores actual output without label hints.")
    run.add_argument("--generation-revision", choices=("legacy-v1", "grounded-v2", "focused-v3"),
                     help="New runs default to legacy-v1; resume preserves the frozen revision unless explicitly overridden.")
    run.add_argument("--max-image-hotspots", type=int,
                     help="Retain at most 1–12 actual image hotspots; new runs default to 3 and resume preserves the frozen limit.")
    template = commands.add_parser("review-template", help="Export a blank, run-bound grading template.")
    template.add_argument("run_dir", type=Path)
    template.add_argument("--output", type=Path)
    template.add_argument("--reviewer-kind", choices=("human", "agent", "calibration"), default="human")
    apply = commands.add_parser("apply-review", help="Validate a filled review and rebuild the report.")
    apply.add_argument("run_dir", type=Path)
    apply.add_argument("review", type=Path)
    report = commands.add_parser("report", help="Rebuild an existing report without model calls.")
    report.add_argument("run_dir", type=Path)
    report.add_argument("--review", type=Path)
    compare = commands.add_parser("compare", help="Compare compatible, equally covered experiments.")
    compare.add_argument("base", type=Path)
    compare.add_argument("candidate", type=Path)
    compare.add_argument("--output", type=Path, required=True)
    compare.add_argument("--base-review", type=Path)
    compare.add_argument("--candidate-review", type=Path)
    for subcommand in (run, template, apply, report, compare):
        subcommand.add_argument("--suite", type=Path)
    return command


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        suite = load_suite(args.suite)
        from .report import write_report
        from .rubric import apply_review, review_template
        from .scoring import compare_runs

        if args.command == "run":
            if args.output and args.resume:
                raise ValueError("choose_output_or_resume")
            directory = args.resume or args.output or ROOT / "evals" / "runs" / (
                datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8])
            config = _configuration(args)
            run = asyncio.run(run_suite(suite, directory, config, resume=bool(args.resume)))
            write_report(run, suite, directory, review=_review(directory))
            print(f"{run['mode']}: {run['status']}; calls={run['call_count']}; reserved_output_tokens={run['reserved_output_tokens']}")
            print(directory / "report.html")
            return 0 if run["status"] == "completed" else 2
        if args.command == "compare":
            base, candidate = _read_run(args.base, suite), _read_run(args.candidate, suite)
            comparison = compare_runs(base, candidate, suite, _review(args.base, args.base_review),
                                      _review(args.candidate, args.candidate_review))
            args.output.mkdir(parents=True, exist_ok=True)
            write_json(args.output / "comparison.json", comparison)
            write_report(candidate, suite, args.output, review=_review(args.candidate, args.candidate_review),
                         comparison=comparison)
            print(args.output / "report.html")
            return 0
        run = _read_run(args.run_dir, suite)
        if args.command == "review-template":
            output = args.output or args.run_dir / "review-template.json"
            write_json(output, review_template(run, suite, reviewer_kind=args.reviewer_kind))
            print(output)
        elif args.command == "apply-review":
            review = read_json(args.review)
            apply_review(run, suite, review)
            write_json(args.run_dir / "review.json", review)
            write_report(run, suite, args.run_dir, review=review)
            print(args.run_dir / "report.html")
        else:
            write_report(run, suite, args.run_dir, review=_review(args.run_dir, args.review))
            print(args.run_dir / "report.html")
        return 0
    except (ValueError, OSError, KeyError) as exc:
        print(f"Evaluation stopped: {exc}", file=sys.stderr)
        return 2
