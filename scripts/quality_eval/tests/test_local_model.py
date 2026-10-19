"""Local model transport boundaries; fake ASGI only, no MLX or network calls."""
from __future__ import annotations

import asyncio
import base64
import io
import json
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image

from scripts import serve_quality_model as local_model


ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture(autouse=True)
def package_metadata(monkeypatch):
    monkeypatch.setattr(local_model.importlib.metadata, "version", lambda _name: "no-inference-test")


def image_uri(image_format="PNG", *, declared_format=None):
    stream = io.BytesIO()
    Image.new("RGB", (8, 6), color=(17, 81, 149)).save(stream, format=image_format)
    mime = declared_format or {"PNG": "png", "JPEG": "jpeg", "WEBP": "webp"}[image_format]
    return f"data:image/{mime};base64," + base64.b64encode(stream.getvalue()).decode("ascii")


def payload(content="Synthetic transport test.", **parameters):
    return {"model": local_model.MODEL_ID, "messages": [{"role": "user", "content": content}],
            "max_tokens": 1, **parameters}


async def invoke(service, value, *, body_gate=None, received=None):
    body = json.dumps(value).encode()
    sent = []

    async def receive():
        if received is not None:
            received.append(True)
        if body_gate is not None:
            await body_gate.wait()
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(event):
        sent.append(event)

    await service({"type": "http", "method": "POST", "path": "/v1/chat/completions", "headers": []},
                  receive, send)
    return sent[0]["status"]


class FakeGenerationApp:
    def __init__(self):
        self.requests = []

    async def __call__(self, _scope, receive, send):
        self.requests.append(json.loads((await receive())["body"]))
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b'{"choices":[],"usage":{"completion_tokens":0}}'})


def make_service(tmp_path, app=None, *, deadline=120):
    return local_model.LocalModelPolicy(app or FakeGenerationApp(), Path("/synthetic-no-model"),
                                       tmp_path / "events.jsonl", 0, 4000, 42,
                                       request_timeout_seconds=deadline)


@pytest.mark.parametrize("reference", [
    "https://example.invalid/image.png", "http://127.0.0.1/image.png",
    "/tmp/local-image.png", "file:///tmp/local-image.png",
])
def test_remote_and_path_images_reject_before_admission(tmp_path, reference):
    app = FakeGenerationApp()
    service = make_service(tmp_path, app)
    content = [{"type": "image_url", "image_url": {"url": reference}}]
    assert asyncio.run(invoke(service, payload(content))) == 400
    assert service.request_count == 0
    assert app.requests == []
    assert not service.events_path.exists()


@pytest.mark.parametrize("block", [
    {"type": "input_video", "video_url": "https://example.invalid/video.mp4"},
    {"type": "video_url", "video_url": {"url": "https://example.invalid/video.mp4"}},
    {"type": "input_audio", "input_audio": {"data": "AAAA", "format": "wav"}},
    {"type": "input_image", "image_url": "https://example.invalid/image.png"},
])
def test_other_media_types_do_not_reach_native_loader(tmp_path, block):
    service = make_service(tmp_path)
    assert asyncio.run(invoke(service, payload([block]))) == 400
    assert service.request_count == 0


@pytest.mark.parametrize("reference", [
    "data:image/png;base64,%%%%", "data:image/png;base64,AAAA",
    "data:image/png;base64,", "data:image/svg+xml;base64,PHN2Zy8+",
])
def test_invalid_base64_or_non_image_data_rejects_before_admission(tmp_path, reference):
    service = make_service(tmp_path)
    content = [{"type": "image_url", "image_url": {"url": reference}}]
    assert asyncio.run(invoke(service, payload(content))) == 400
    assert service.request_count == 0


def test_declared_image_mime_must_match_actual_format(tmp_path):
    service = make_service(tmp_path)
    content = [{"type": "image_url", "image_url": {"url": image_uri("PNG", declared_format="jpeg")}}]
    assert asyncio.run(invoke(service, payload(content))) == 400
    assert service.request_count == 0


@pytest.mark.parametrize("image_format", ["PNG", "JPEG"])
def test_valid_production_image_preserves_messages_and_disables_compaction(tmp_path, image_format):
    app = FakeGenerationApp()
    service = make_service(tmp_path, app)
    content = [{"type": "image_url", "image_url": {"url": image_uri(image_format)}},
               {"type": "text", "text": "  Preserve this original input.\n"}]
    request = payload(content)
    assert asyncio.run(invoke(service, request)) == 200
    forwarded = app.requests[0]
    assert forwarded["messages"] == request["messages"]
    assert forwarded["context_management"] == []
    assert forwarded["temperature"] == 0.0
    assert forwarded["seed"] == 0
    assert forwarded["stream"] is False
    assert forwarded["enable_thinking"] is False
    assert forwarded["model"] == "/synthetic-no-model"
    assert service.capabilities()["automatic_compaction"] is False


@pytest.mark.parametrize("parameters", [
    {"max_tokens": 4001}, {"temperature": 0.7}, {"seed": 1}, {"stream": True},
    {"enable_thinking": True}, {"context_management": None},
    {"context_management": [{"type": "compaction"}]},
])
def test_generation_policy_overrides_reject_before_dispatch(tmp_path, parameters):
    service = make_service(tmp_path)
    assert asyncio.run(invoke(service, payload(**parameters))) == 400
    assert service.request_count == 0


def test_all_42_admissions_persist_across_service_restart(tmp_path):
    first = make_service(tmp_path)

    async def consume(service, count):
        for _ in range(count):
            assert await invoke(service, payload()) == 200

    asyncio.run(consume(first, 41))
    restarted = make_service(tmp_path)
    assert restarted.request_count == 41
    asyncio.run(consume(restarted, 1))
    exhausted = make_service(tmp_path)
    assert exhausted.request_count == 42
    assert asyncio.run(invoke(exhausted, payload())) == 429
    events = [json.loads(line) for line in exhausted.events_path.read_text().splitlines()]
    admissions = [event for event in events if event["event"] == "admitted"]
    assert [event["request_number"] for event in admissions] == list(range(1, 43))


def test_two_request_bodies_cannot_both_enter_generation(tmp_path):
    async def scenario():
        body_gate, app_gate, app_entered = asyncio.Event(), asyncio.Event(), asyncio.Event()
        received = []
        calls = []

        async def blocked_app(scope, receive, send):
            calls.append(True)
            app_entered.set()
            await app_gate.wait()
            await FakeGenerationApp()(scope, receive, send)

        service = make_service(tmp_path, blocked_app)
        tasks = [asyncio.create_task(invoke(service, payload(), body_gate=body_gate, received=received))
                 for _ in range(2)]
        await asyncio.sleep(0)
        assert len(received) == 2
        body_gate.set()
        await asyncio.wait_for(app_entered.wait(), 1)
        await asyncio.sleep(0)
        app_gate.set()
        statuses = await asyncio.gather(*tasks)
        assert sorted(statuses) == [200, 409]
        assert service.request_count == 1
        assert len(calls) == 1

    asyncio.run(scenario())


@pytest.mark.parametrize("interruption", ["deadline", "handler_error"])
def test_isolated_service_fail_stops_and_preserves_unknown_admission(tmp_path, interruption):
    # The fake native worker is a long-running thread: cancelling its awaiting
    # coroutine would leave it alive. A real process exit must terminate it.
    script = r'''
import asyncio, json, sys, time
from pathlib import Path
from unittest.mock import patch
from scripts import serve_quality_model as local_model
events, interruption = Path(sys.argv[1]), sys.argv[2]
async def app(scope, receive, send):
    await receive()
    if interruption == "handler_error":
        raise RuntimeError("synthetic interrupted request")
    await asyncio.to_thread(time.sleep, 60)
async def main():
    with patch("importlib.metadata.version", return_value="no-inference-test"):
        service = local_model.LocalModelPolicy(app, Path("/synthetic-no-model"), events, 0, 4000, 42,
                                               request_timeout_seconds=0.05)
    body = json.dumps({"model":local_model.MODEL_ID,"messages":[{"role":"user","content":"stub"}],"max_tokens":1}).encode()
    async def receive():
        return {"type":"http.request","body":body,"more_body":False}
    async def send(event):
        pass
    await service({"type":"http","method":"POST","path":"/v1/chat/completions","headers":[]},receive,send)
asyncio.run(main())
raise AssertionError("interrupted isolated service survived")
'''
    events_path = tmp_path / "events.jsonl"
    process = subprocess.run([sys.executable, "-c", script, str(events_path), interruption],
                             cwd=ROOT, capture_output=True, text=True, timeout=5)
    assert process.returncode == 124, process.stderr
    events = [json.loads(line) for line in events_path.read_text().splitlines()]
    assert [event["event"] for event in events] == ["admitted", "terminated"]
    assert events[1]["reason"] == {"deadline": "request_deadline_exceeded",
                                  "handler_error": "request_handler_interrupted"}[interruption]
    assert events[1]["action"] == "process_exit_no_retry"
    assert make_service(tmp_path).request_count == 1
