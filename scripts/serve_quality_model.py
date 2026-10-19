#!/usr/bin/env python3
"""Serve one pinned local MLX model for bounded quality experiments.

Install MLX-VLM in a separate environment; this is not a backend dependency.
The wrapper changes transport settings only. It never rewrites prompts, repairs
model text, retries inference, or permits loading a different checkpoint.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import re
import threading
import time

MODEL_ID = "mlx-community/Qwen3-VL-2B-Instruct-4bit"
MODEL_REVISION = "9c4f5209e57b31f4b9dfba735de3fb983739c9cc"
MLX_VLM_VERSION = "0.7.8"
WEIGHTS_SHA256 = "4750d95a2162829e127a94e83ac350d498d02070aab216c4687da48804a06ffb"
REQUEST_TIMEOUT_SECONDS = 120


def validate_messages(messages):
    """Validate media in place; never load URLs/paths or rewrite prompt content."""
    if not isinstance(messages, list) or not 1 <= len(messages) <= 64:
        raise ValueError("invalid_local_model_messages")
    images = 0
    for message in messages:
        if (not isinstance(message, dict) or set(message) != {"role", "content"}
                or message["role"] not in {"system", "user", "assistant"}):
            raise ValueError("unsupported_local_model_message")
        content = message["content"]
        if isinstance(content, str) and content:
            continue
        if not isinstance(content, list) or not content or message["role"] != "user":
            raise ValueError("unsupported_local_model_content")
        for block in content:
            if not isinstance(block, dict):
                raise ValueError("unsupported_local_model_content")
            if set(block) == {"type", "text"} and block["type"] == "text" and isinstance(block["text"], str):
                continue
            if (set(block) != {"type", "image_url"} or block["type"] != "image_url"
                    or not isinstance(block["image_url"], dict) or set(block["image_url"]) != {"url"}
                    or not isinstance(block["image_url"]["url"], str)):
                raise ValueError("unsupported_local_model_media")
            match = re.fullmatch(r"data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})", block["image_url"]["url"])
            if not match:
                raise ValueError("only_local_image_data_uris_are_allowed")
            try:
                data = base64.b64decode(match[2], validate=True)
                if not data or len(data) > 2_000_000:
                    raise ValueError("invalid_local_model_image_size")
                from PIL import Image

                with Image.open(io.BytesIO(data)) as image:
                    if (image.format != {"png": "PNG", "jpeg": "JPEG", "webp": "WEBP"}[match[1]]
                            or image.width * image.height > 40_000_000 or max(image.size) > 12_000
                            or getattr(image, "n_frames", 1) != 1):
                        raise ValueError("unsupported_local_model_image")
                    image.verify()
            except Exception as exc:
                raise ValueError("invalid_local_model_image") from exc
            images += 1
            if images > 1:
                raise ValueError("only_one_local_image_per_request")


class LocalModelPolicy:
    """Expose only chat completions and read-only local service information."""

    def __init__(self, app, model_path: Path, events_path: Path, seed: int, max_tokens: int, max_calls: int,
                 request_timeout_seconds: float = REQUEST_TIMEOUT_SECONDS):
        self.app = app
        self.model_path = str(model_path)
        self.events_path = events_path
        self.seed = seed
        self.max_tokens = max_tokens
        self.max_calls = max_calls
        if not 0 < request_timeout_seconds <= REQUEST_TIMEOUT_SECONDS:
            raise ValueError("invalid_local_model_request_deadline")
        self.request_timeout_seconds = request_timeout_seconds
        self.active = False
        prior = [json.loads(line) for line in events_path.read_text().splitlines()] if events_path.exists() else []
        self.request_count = sum(record.get("event") == "admitted" for record in prior)
        self.started = time.time()
        self.packages = {
            name: importlib.metadata.version(name)
            for name in ("mlx-vlm", "mlx", "mlx-metal", "transformers", "huggingface-hub", "uvicorn")
        }

    async def respond(self, send, status, value):
        body = json.dumps(value, ensure_ascii=False).encode()
        await send({"type": "http.response.start", "status": status,
                    "headers": [(b"content-type", b"application/json"),
                                (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})

    def capabilities(self):
        return {
            "model": MODEL_ID, "model_revision": MODEL_REVISION,
            "weights_sha256": WEIGHTS_SHA256,
            "model_path": self.model_path, "packages": self.packages,
            "python": platform.python_version(), "pid": os.getpid(),
            "runtime_policy_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            "protocol": "openai-chat-completions", "inputs": ["text", "image_url-data-uri"],
            "temperature": 0.0, "seed": self.seed, "enable_thinking": False,
            "max_output_tokens_per_request": self.max_tokens,
            "max_generation_requests": self.max_calls,
            "concurrency": 1, "retries": 0, "remote_code": False, "offline": True,
            "prefix_cache": False, "vision_cache_size": 0,
            "context_management": [], "automatic_compaction": False,
            "request_timeout_seconds": self.request_timeout_seconds,
            "timeout_behavior": "fail_stop_process_no_automatic_restart_or_retry",
            "request_count": self.request_count, "request_active": self.active,
            "started_at_unix": self.started,
        }

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        method, path = scope["method"], scope["path"]
        if method == "GET" and path in {"/health", "/round9/capabilities"}:
            return await self.respond(send, 200, self.capabilities())
        if method == "GET" and path in {"/models", "/v1/models"}:
            return await self.respond(send, 200, {"object": "list", "data": [
                {"id": MODEL_ID, "object": "model", "owned_by": "local",
                 "revision": MODEL_REVISION, "loaded": True}]})
        if method != "POST" or path not in {"/chat/completions", "/v1/chat/completions"}:
            return await self.respond(send, 404, {"error": "unsupported_local_model_endpoint"})
        if self.active:
            return await self.respond(send, 409, {"error": "local_model_request_already_active"})
        body = bytearray()
        while True:
            event = await receive()
            if event["type"] == "http.disconnect":
                return
            body.extend(event.get("body", b""))
            if len(body) > 1_000_000:
                return await self.respond(send, 413, {"error": "local_model_request_too_large"})
            if not event.get("more_body", False):
                break
        try:
            payload = json.loads(body)
            if not isinstance(payload, dict) or payload.get("model") != MODEL_ID:
                raise ValueError("local_model_identity_mismatch")
            permitted = {"model", "messages", "max_tokens", "temperature", "seed", "stream", "enable_thinking",
                         "context_management"}
            if set(payload) - permitted:
                raise ValueError("unsupported_local_model_request_parameter")
            maximum = payload.get("max_tokens", self.max_tokens)
            if type(maximum) is not int or not 1 <= maximum <= self.max_tokens:
                raise ValueError("local_model_output_limit_exceeded")
            validate_messages(payload.get("messages"))
            policy = {"temperature": 0.0, "seed": self.seed, "stream": False, "enable_thinking": False,
                      "context_management": []}
            if any(key in payload and payload[key] != value for key, value in policy.items()):
                raise ValueError("local_model_sampling_policy_mismatch")
            payload.update(policy, model=self.model_path, max_tokens=maximum)
        except (ValueError, TypeError) as exc:
            return await self.respond(send, 400, {"error": str(exc)})
        # Reading a body may yield, so test again immediately before admission.
        if self.active:
            return await self.respond(send, 409, {"error": "local_model_request_already_active"})
        if self.request_count >= self.max_calls:
            return await self.respond(send, 429, {"error": "local_model_request_budget_exhausted"})
        self.active = True
        self.request_count += 1
        number, started = self.request_count, time.monotonic()
        admission = {"event": "admitted", "request_number": number,
                     "request_sha256": hashlib.sha256(body).hexdigest(), "max_tokens": maximum,
                     "temperature": 0.0, "seed": self.seed, "model": MODEL_ID,
                     "model_revision": MODEL_REVISION, "admitted_at_unix": time.time()}
        try:
            with self.events_path.open("a") as output:
                output.write(json.dumps(admission, ensure_ascii=False) + "\n")
                output.flush()
                os.fsync(output.fileno())
        except OSError:
            self.active = False
            raise

        def fail_stop(reason):
            record = {"event": "terminated", "request_number": number, "reason": reason,
                      "elapsed_seconds": round(time.monotonic() - started, 6),
                      "action": "process_exit_no_retry"}
            try:
                with self.events_path.open("a") as output:
                    output.write(json.dumps(record) + "\n")
                    output.flush()
                    os.fsync(output.fileno())
            finally:
                # Cancelling asyncio.to_thread cannot stop native inference.
                # Terminate this isolated service, preserving the admitted call.
                os._exit(124)

        watchdog = threading.Timer(self.request_timeout_seconds, fail_stop, args=("request_deadline_exceeded",))
        watchdog.daemon = True
        watchdog.start()
        forwarded = json.dumps(payload, ensure_ascii=False).encode()
        headers = [(key, value) for key, value in scope.get("headers", []) if key.lower() != b"content-length"]
        forwarded_scope = {**scope, "headers": [*headers, (b"content-length", str(len(forwarded)).encode())]}
        sent_body = False
        response = bytearray()
        status = None

        async def forward_receive():
            nonlocal sent_body
            if not sent_body:
                sent_body = True
                return {"type": "http.request", "body": forwarded, "more_body": False}
            return await receive()

        async def record_send(event):
            nonlocal status
            if event["type"] == "http.response.start":
                status = event["status"]
            elif event["type"] == "http.response.body":
                response.extend(event.get("body", b""))
            await send(event)

        try:
            await self.app(forwarded_scope, forward_receive, record_send)
        except BaseException:
            fail_stop("request_handler_interrupted")
            raise
        finally:
            watchdog.cancel()
            record = {"event": "finished", "request_number": number, "status": status,
                      "elapsed_seconds": round(time.monotonic() - started, 6),
                      "request_sha256": hashlib.sha256(body).hexdigest(),
                      "response_sha256": hashlib.sha256(response).hexdigest(),
                      "max_tokens": maximum, "temperature": 0.0, "seed": self.seed,
                      "model": MODEL_ID, "model_revision": MODEL_REVISION}
            try:
                result = json.loads(response)
                record["usage"] = result.get("usage")
                record["timings"] = result.get("timings")
                record["finish_reasons"] = [choice.get("finish_reason") for choice in result.get("choices", [])]
            except (ValueError, AttributeError):
                record["response_json"] = False
            try:
                with self.events_path.open("a") as output:
                    output.write(json.dumps(record, ensure_ascii=False) + "\n")
                    output.flush()
                    os.fsync(output.fileno())
            finally:
                self.active = False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-path", required=True, type=Path)
    parser.add_argument("--port", type=int, default=18084)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--max-tokens", type=int, default=4000)
    parser.add_argument("--max-calls", type=int, default=42)
    parser.add_argument("--events", type=Path, default=Path("/tmp/flipbook-round9-model-events.jsonl"))
    args = parser.parse_args()
    model_path = args.model_path.resolve()
    if model_path.name != MODEL_REVISION or not (model_path / "model.safetensors").is_file():
        parser.error("model-path must be the exact pinned Hugging Face snapshot")
    if any(model_path.glob("*.py")):
        parser.error("remote Python model files are forbidden")
    manifest_path = model_path.parent / "manifest.json"
    if not manifest_path.is_file():
        parser.error("the downloaded snapshot must have a verified manifest.json beside it")
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("revision") != MODEL_REVISION or manifest.get("model") != MODEL_ID:
        parser.error("download manifest identity differs from the pinned model")
    weights = next((item for item in manifest.get("files", []) if item.get("name") == "model.safetensors"), {})
    if weights.get("sha256") != WEIGHTS_SHA256:
        parser.error("download manifest weights differ from the pinned checksum")
    for item in manifest["files"]:
        local = model_path / item["name"]
        if local.parent != model_path or not local.is_file():
            parser.error("invalid or missing manifest file")
        with local.open("rb") as handle:
            digest = hashlib.file_digest(handle, "sha256").hexdigest()
        if local.stat().st_size != item["size"] or digest != item["sha256"]:
            parser.error("download manifest file checksum mismatch")
    if not 1 <= args.max_tokens <= 4000:
        parser.error("max-tokens must be between 1 and 4000")
    if not 1 <= args.max_calls <= 42:
        parser.error("max-calls must be between 1 and 42")
    if importlib.metadata.version("mlx-vlm") != MLX_VLM_VERSION:
        parser.error(f"install the pinned mlx-vlm=={MLX_VLM_VERSION}")
    args.events.parent.mkdir(parents=True, exist_ok=True)
    for name in ("MLX_VLM_PRELOAD_ADAPTER", "MLX_VLM_PRELOAD_IMAGE_MODEL", "MLX_VLM_PRELOAD_TTS_MODEL",
                 "MLX_VLM_PRELOAD_STT_MODEL", "MLX_VLM_PRELOAD_EMBEDDING_MODEL", "MLX_VLM_PRELOAD_DECISION_MODEL",
                 "MLX_VLM_PRELOAD_RERANKER_MODEL", "MLX_VLM_DRAFT_MODEL", "MLX_VLM_SERVER_API_KEY"):
        os.environ.pop(name, None)
    os.environ.update({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
                       "HF_HUB_DISABLE_TELEMETRY": "1", "MLX_TRUST_REMOTE_CODE": "false",
                       "MLX_VLM_PRELOAD_MODEL": str(model_path),
                       "MLX_VLM_MAX_TOKENS": str(args.max_tokens), "MLX_VLM_MAX_NUM_SEQS": "1",
                       "MLX_VLM_ENABLE_THINKING": "0", "APC_ENABLED": "0", "MLX_VLM_VISION_CACHE_SIZE": "0",
                       "OMP_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2", "VECLIB_MAXIMUM_THREADS": "2"})
    import uvicorn
    from mlx_vlm.server import app

    service = LocalModelPolicy(app, model_path, args.events, args.seed, args.max_tokens, args.max_calls)
    print(json.dumps(service.capabilities(), ensure_ascii=False), flush=True)
    uvicorn.run(service, host="127.0.0.1", port=args.port, workers=1, server_header=False)


if __name__ == "__main__":
    main()
