"""Small, deterministic and private evaluation artifact primitives."""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def canonical_sha256(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def now() -> str:
    return datetime.now(UTC).isoformat()


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".writing-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(value, output, indent=2, ensure_ascii=False, allow_nan=False)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def source_hashes() -> dict[str, str]:
    paths = ["backend/agents/" + name + ".py" for name in (
        "base", "input_analysis", "page_generation", "knowledge", "composition", "hotspot_localization", "page_context")]
    paths += ["backend/jobs/providers.py", "backend/jobs/page_workflows.py", "backend/jobs/store.py", "backend/utils.py"]
    return {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in paths}


def producer_sha256() -> str:
    paths = [Path(__file__).with_name(name) for name in ("artifacts.py", "production.py", "runner.py", "cli.py", "dataset.py")]
    return canonical_sha256({**source_hashes(), **{path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}})


def evaluator_sha256() -> str:
    return canonical_sha256({name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
                             for name in ("scoring.py", "rubric.py", "report.py")})


def redact(value, secret: str):
    if isinstance(value, str):
        return value.replace(secret, "[redacted]") if secret else value
    if isinstance(value, list):
        return [redact(item, secret) for item in value]
    if isinstance(value, dict):
        return {redact(key, secret): redact(item, secret) for key, item in value.items()}
    return value


@contextmanager
def run_lock(directory):
    # flock is released by the OS after a crash; a leftover file is not a stale lock.
    import fcntl

    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (directory / ".run.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("run_already_locked") from None
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
