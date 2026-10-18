import os
import sys
import time
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException, Request

from utils import extract_json


def _log(msg: str):
    """带时间戳的日志，强制 flush 不被 stdout 缓冲影响。"""
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr, flush=True)


@dataclass
class LLMConfig:
    base_url: str
    api_key: str
    model: str


@dataclass
class ImgGenConfig:
    base_url: str
    api_key: str
    model: str


def _provider_values(request: Request, prefix: str, env_prefix: str, default_url: str, default_model: str) -> dict:
    """Endpoint and credential always come from the same configuration group.

    Sending any provider header opts into BYOK. A missing/empty client key must
    never fall back to a deployment secret, even when only the URL was supplied.
    """
    fields = ("base-url", "api-key", "model")
    client_config = any(f"x-{prefix}-{field}" in request.headers for field in fields)
    if client_config:
        values = {
            "base_url": request.headers.get(f"x-{prefix}-base-url") or default_url,
            "api_key": request.headers.get(f"x-{prefix}-api-key", ""),
            "model": request.headers.get(f"x-{prefix}-model") or default_model,
        }
    else:
        values = {
            "base_url": os.getenv(f"{env_prefix}_BASE_URL") or default_url,
            "api_key": os.getenv(f"{env_prefix}_API_KEY", ""),
            "model": os.getenv(f"{env_prefix}_MODEL") or default_model,
        }
    try:
        parsed = urlsplit(values["base_url"])
        if (parsed.scheme not in {"http", "https"} or not parsed.hostname
                or parsed.username is not None or parsed.password is not None
                or parsed.query or parsed.fragment or any(c.isspace() for c in values["base_url"])):
            raise ValueError
        _ = parsed.port
    except ValueError as exc:
        raise HTTPException(400, "模型服务地址必须是有效的 HTTP(S) URL，且不能包含凭据、查询参数或片段") from exc
    values["base_url"] = values["base_url"].rstrip("/")
    return values


def get_llm_config(request: Request) -> LLMConfig:
    return LLMConfig(**_provider_values(request, "llm", "LLM", "https://api.anthropic.com", "claude-sonnet-4-6"))


def get_imggen_config(request: Request) -> ImgGenConfig:
    return ImgGenConfig(**_provider_values(request, "imggen", "IMG_GEN", "https://api.openai.com/v1", "dall-e-3"))


class BaseLLMAgent:
    def __init__(self, config: LLMConfig):
        self.config = config
        self.safe_errors = False

    async def call(self, messages: list[dict], max_tokens: int = 2000, system: str | None = None) -> str:
        if not self.config.api_key:
            raise HTTPException(400, "LLM API Key 未配置，请在设置页面填写后重试")

        # 估算 payload 大小（含图片就大）
        size_kb = sum(
            len(str(m).encode("utf-8")) for m in messages
        ) / 1024
        has_image = any(
            isinstance(m.get("content"), list) and any(
                isinstance(c, dict) and c.get("type") == "image" for c in m["content"]
            )
            for m in messages
        )

        is_anthropic = urlsplit(self.config.base_url).hostname in {"anthropic.com", "api.anthropic.com"}
        api_kind = "anthropic" if is_anthropic else "openai-compat"

        agent_name = type(self).__name__
        _log(f"⇢ LLM call [{agent_name}] model={self.config.model} api={api_kind} payload={size_kb:.0f}KB image={has_image} max_tokens={max_tokens}")

        t0 = time.time()
        try:
            if is_anthropic:
                result = await self._call_anthropic(messages, max_tokens, system)
            else:
                result = await self._call_openai_compat(messages, max_tokens, system)
            elapsed = time.time() - t0
            _log(f"⇠ LLM done [{agent_name}] took={elapsed:.1f}s response={len(result)}chars")
            return result
        except Exception as e:
            elapsed = time.time() - t0
            _log(f"✕ LLM fail [{agent_name}] took={elapsed:.1f}s err={type(e).__name__}" + ("" if self.safe_errors else f": {str(e)[:200]}"))
            raise

    async def _call_anthropic(self, messages: list[dict], max_tokens: int, system: str | None) -> str:
        """调用 Anthropic /v1/messages，启用 prompt caching：
        相同的 system prompt 在 5 分钟内重复使用时，缓存 token 只收 10% 价（节省 ~90%）。
        我们的场景：page_generation / input_analysis 的 system 都是固定模板，
        生成 4 个子页面时只第一次完整收费，后 3 次几乎免费。
        """
        url = self.config.base_url.rstrip("/") + "/v1/messages"
        payload: dict = {
            "model": self.config.model,
            "max_tokens": max_tokens,
            "messages": messages,
        }
        if system:
            # 把 system 包成 block 列表 + cache_control 触发缓存。系统会自动按内容 hash 命中。
            payload["system"] = [
                {
                    "type": "text",
                    "text": system,
                    "cache_control": {"type": "ephemeral"},
                }
            ]

        headers = {
            "x-api-key": self.config.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
            # prompt caching 在 2024-08 后是 GA，但加 beta header 兼容老版本中转
            "anthropic-beta": "prompt-caching-2024-07-31",
        }

        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(url, json=payload, headers=headers)
            r.raise_for_status()
            data = r.json()
            # 记录 cache 命中情况（可看到节省效果）
            usage = data.get("usage") or {}
            cache_read = usage.get("cache_read_input_tokens", 0)
            cache_create = usage.get("cache_creation_input_tokens", 0)
            if cache_read or cache_create:
                _log(f"  · cache: read={cache_read} create={cache_create} (省 ~{int(cache_read * 0.9)} tokens)")
            return data["content"][0]["text"]

    async def _call_openai_compat(self, messages: list[dict], max_tokens: int, system: str | None) -> str:
        url = self.config.base_url.rstrip("/") + "/chat/completions"
        all_messages = []
        if system:
            all_messages.append({"role": "system", "content": system})
        # Agents use one internal image block format; OpenAI-compatible APIs
        # require image_url blocks rather than Anthropic's image/source shape.
        for message in messages:
            content = message.get("content")
            if isinstance(content, list):
                converted = []
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "image":
                        source = block.get("source", {})
                        if source.get("type") == "base64":
                            converted.append({"type": "image_url", "image_url": {
                                "url": f"data:{source['media_type']};base64,{source['data']}",
                            }})
                        elif source.get("type") == "url":
                            converted.append({"type": "image_url", "image_url": {"url": source["url"]}})
                        else:
                            raise ValueError("不支持的图像输入格式")
                    else:
                        converted.append(block)
                all_messages.append({**message, "content": converted})
            else:
                all_messages.append(message)

        payload = {
            "model": self.config.model,
            "max_tokens": max_tokens,
            "messages": all_messages,
        }

        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(url, json=payload, headers=headers)
            r.raise_for_status()
            data = r.json()
            return data["choices"][0]["message"]["content"]

    def extract_json(self, text: str):
        return extract_json(text)
