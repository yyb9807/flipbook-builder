"""Bounded, expiring process memory. Never pass these values through DBOS."""
import time
from dataclasses import dataclass

from agents.base import ImgGenConfig, LLMConfig


@dataclass
class Entry:
    llm: LLMConfig
    image: ImgGenConfig
    expires: float


class CredentialVault:
    def __init__(self, ttl_seconds: float = 1800, capacity: int = 100):
        self.ttl = ttl_seconds
        self.capacity = capacity
        self._entries: dict[str, Entry] = {}

    def provide(self, job_id: str, llm: LLMConfig, image: ImgGenConfig) -> None:
        self.prune()
        if job_id not in self._entries and len(self._entries) >= self.capacity:
            oldest = min(self._entries, key=lambda key: self._entries[key].expires)
            self.discard(oldest)
        self._entries[job_id] = Entry(llm, image, time.monotonic() + self.ttl)

    def get(self, job_id: str, kind: str) -> LLMConfig | ImgGenConfig | None:
        self.prune()
        entry = self._entries.get(job_id)
        if not entry:
            return None
        config = entry.llm if kind == "llm" else entry.image
        return config if config.api_key else None

    def secrets(self, job_id: str) -> list[str]:
        self.prune()
        entry = self._entries.get(job_id)
        return [entry.llm.api_key, entry.image.api_key] if entry else []

    def discard(self, job_id: str) -> None:
        self._entries.pop(job_id, None)

    def prune(self) -> None:
        now = time.monotonic()
        for job_id in list(self._entries):
            if self._entries[job_id].expires <= now:
                self.discard(job_id)

    def clear(self) -> None:
        self._entries.clear()


def provider_metadata(llm: LLMConfig, image: ImgGenConfig) -> dict:
    return {"llm_base_url": llm.base_url, "llm_model": llm.model,
            "imggen_base_url": image.base_url, "imggen_model": image.model}
