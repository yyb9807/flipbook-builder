"""Production prompts and normalization with an admission guard at the call boundary.

Only replay replaces the transport. Live requests use BaseLLMAgent's actual
provider adapter. No imports of main, dotenv, database or job executors.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import sys
import time
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from .artifacts import ROOT, canonical_sha256, redact


class StageBlocked(ValueError):
    pass


@dataclass
class RunConfig:
    mode: str = "replay"
    base_url: str = "https://replay.invalid/v1"
    model: str = "controlled-fixture"
    api_key: str = field(default="REPLAY_ONLY_NOT_A_CREDENTIAL", repr=False)
    max_calls: int = 18
    max_output_tokens: int = 66400
    timeout_seconds: float = 300
    max_prompt_bytes: int = 262144
    branch_selection: str = "strict-preferred-label"
    generation_revision: str = "legacy-v1"
    max_image_hotspots: int = 3

    def validate(self):
        if any(not isinstance(value, str) for value in (self.mode, self.base_url, self.model, self.api_key, self.branch_selection)):
            raise ValueError("invalid_run_configuration")
        parsed = urlsplit(self.base_url)
        if (parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username is not None
                or parsed.password is not None or parsed.query or parsed.fragment
                or any(char.isspace() for char in self.base_url)):
            raise ValueError("invalid_provider_url")
        try:
            _ = parsed.port
        except ValueError:
            raise ValueError("invalid_provider_url") from None
        if self.mode not in {"replay", "live"} or not self.api_key or not self.model.strip():
            raise ValueError("invalid_run_configuration")
        if self.branch_selection not in {"strict-preferred-label", "first-hotspot"}:
            raise ValueError("invalid_branch_selection")
        if not isinstance(self.generation_revision, str) or self.generation_revision not in {"legacy-v1", "grounded-v2", "focused-v3"}:
            raise ValueError("invalid_generation_revision")
        if type(self.max_image_hotspots) is not int or not 1 <= self.max_image_hotspots <= 12:
            raise ValueError("invalid_max_image_hotspots")
        if self.mode == "live" and (self.api_key in self.model or self.api_key in self.base_url):
            raise ValueError("credential_in_provider_identity")
        if (type(self.max_calls) is not int or not 1 <= self.max_calls <= 1000
                or type(self.max_output_tokens) is not int or not 1 <= self.max_output_tokens <= 4_000_000
                or type(self.timeout_seconds) not in {int, float} or not 0 < self.timeout_seconds <= 86400
                or type(self.max_prompt_bytes) is not int or not 1 <= self.max_prompt_bytes <= 2_000_000):
            raise ValueError("invalid_run_budget")

    def public(self):
        return {name: getattr(self, name) for name in (
            "mode", "base_url", "model", "max_calls", "max_output_tokens", "timeout_seconds", "max_prompt_bytes", "branch_selection",
            "generation_revision", "max_image_hotspots")}


class CallGuard:
    def __init__(self, config, checkpoint, save):
        self.config, self.checkpoint, self.save = config, checkpoint, save
        self.started = time.monotonic()
        self.spent = checkpoint.get("elapsed_seconds", 0)
        self.current = None

    def remaining(self):
        return self.config.timeout_seconds - self.spent - (time.monotonic() - self.started)

    def checkpoint_time(self):
        self.checkpoint["elapsed_seconds"] = self.spent + time.monotonic() - self.started

    async def invoke(self, agent, messages, max_tokens, system):
        stage = self.current
        prompt = {"messages": messages, "max_tokens": max_tokens, "system": system}
        encoded = json.dumps(prompt, ensure_ascii=False, allow_nan=False).encode()
        prompt_hash = hashlib.sha256(encoded).hexdigest()
        if len(encoded) > self.config.max_prompt_bytes:
            raise StageBlocked("prompt_byte_budget_exceeded")
        if stage.get("state") == "response_received":
            if stage.get("prompt_sha256") != prompt_hash:
                raise StageBlocked("resume_prompt_changed")
            if hashlib.sha256(stage["raw_response"].encode()).hexdigest() != stage.get("response_sha256"):
                raise StageBlocked("checkpoint_response_changed")
            return stage["raw_response"]
        if stage.get("state") in {"in_flight", "outcome_unknown", "failed"}:
            raise StageBlocked("prior_attempt_not_retried")
        if self.checkpoint["call_count"] >= self.config.max_calls:
            raise StageBlocked("call_budget_exceeded")
        if self.checkpoint["reserved_output_tokens"] + max_tokens > self.config.max_output_tokens:
            raise StageBlocked("output_token_budget_exceeded")
        if self.remaining() <= 0:
            raise StageBlocked("run_time_budget_exceeded")
        stage.update(state="in_flight", prompt_sha256=prompt_hash, max_tokens=max_tokens,
                     system_sha256=canonical_sha256(system))
        self.checkpoint["call_count"] += 1
        self.checkpoint["reserved_output_tokens"] += max_tokens
        self.checkpoint_time()
        self.save()
        started = time.monotonic()
        try:
            raw = await asyncio.wait_for(
                agent.production_call(messages, max_tokens=max_tokens, system=system),
                timeout=min(120, self.remaining()),
            )
            if not isinstance(raw, str) or len(raw.encode()) > 1_000_000:
                raise ValueError("invalid_provider_response_size")
            safe = redact(raw, self.config.api_key)
            stage.update(state="response_received", raw_response=safe,
                         response_sha256=hashlib.sha256(safe.encode()).hexdigest())
            return safe
        except Exception as exc:
            import httpx

            known = isinstance(exc, (ValueError, TypeError)) or (
                isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in {400, 401, 403, 404, 405, 413, 422, 429})
            stage.update(state="failed" if known else "outcome_unknown",
                         error="invalid_provider_response" if known else "provider_outcome_unknown")
            raise StageBlocked(stage["error"]) from None
        finally:
            stage["latency_seconds"] = round(time.monotonic() - started, 6)
            self.checkpoint_time()
            self.save()


def agents(config, guard, recording):
    # The normal application imports use backend as their Python root. This adds
    # that directory without booting its API or loading environment files.
    backend = str(ROOT / "backend")
    if backend not in sys.path:
        sys.path.insert(0, backend)
    from agents.base import LLMConfig
    from agents.input_analysis import InputAnalysisAgent
    from agents.page_generation import PageGenerationAgent

    class Guarded:
        async def call(self, messages, max_tokens=2000, system=None):
            return await guard.invoke(self, messages, max_tokens, system)

        async def production_call(self, messages, max_tokens=2000, system=None):
            return await super().call(messages, max_tokens=max_tokens, system=system)

        async def _call_anthropic(self, messages, max_tokens, system):
            if config.mode == "replay":
                return recording()
            return await super()._call_anthropic(messages, max_tokens, system)

        async def _call_openai_compat(self, messages, max_tokens, system):
            if config.mode == "replay":
                return recording()
            return await super()._call_openai_compat(messages, max_tokens, system)

    class Analysis(Guarded, InputAnalysisAgent):
        pass

    class Generation(Guarded, PageGenerationAgent):
        pass

    provider = LLMConfig(config.base_url, config.api_key, config.model)
    analysis, generation = Analysis(provider), Generation(provider)
    analysis.safe_errors = generation.safe_errors = True
    return analysis, generation
