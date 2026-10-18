"""Security boundary regressions. No database, real credentials, or network calls."""
import io
import json
import zipfile
from html.parser import HTMLParser
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException
from PIL import Image, PngImagePlugin

import storage
from agents.base import BaseLLMAgent, LLMConfig, get_imggen_config, get_llm_config
from routers import projects
from tests.helpers import request_with


def image_bytes(fmt="PNG", size=(12, 8)):
    out = io.BytesIO()
    image = Image.new("RGB", size, (20, 70, 120))
    image.save(out, format=fmt)
    return out.getvalue()


@pytest.mark.parametrize("prefix,env_prefix,factory,default_url", [
    ("llm", "LLM", get_llm_config, "https://api.anthropic.com"),
    ("imggen", "IMG_GEN", get_imggen_config, "https://api.openai.com/v1"),
])
def test_client_config_never_inherits_deployment_credentials(monkeypatch, prefix, env_prefix, factory, default_url):
    monkeypatch.setenv(f"{env_prefix}_BASE_URL", "https://deployment.invalid/v1")
    monkeypatch.setenv(f"{env_prefix}_API_KEY", "fake-deployment-secret")
    monkeypatch.setenv(f"{env_prefix}_MODEL", "deployment-model")
    deployment = factory(request_with())
    assert deployment.api_key == "fake-deployment-secret"
    assert deployment.base_url == "https://deployment.invalid/v1"
    custom = factory(request_with({f"x-{prefix}-base-url": "https://untrusted.invalid/v1"}))
    assert custom.api_key == ""
    assert custom.model != "deployment-model"
    own_key = factory(request_with({f"x-{prefix}-api-key": "fake-browser-key"}))
    assert own_key.api_key == "fake-browser-key"
    assert own_key.base_url == default_url
    assert factory(request_with({f"x-{prefix}-api-key": ""})).api_key == ""


@pytest.mark.parametrize("url", [
    "file:///etc/passwd", "ftp://example.org", "https://user:pass@example.org/v1",
    "https://example.org/v1?key=oops", "https://example.org/#fragment", "https://", "https://bad host/",
])
def test_provider_rejects_unsafe_url_shapes(url):
    with pytest.raises(HTTPException) as exc:
        get_llm_config(request_with({"x-llm-base-url": url}))
    assert exc.value.status_code == 400


async def test_url_override_cannot_forward_server_key(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "fake-server-key")
    agent = BaseLLMAgent(get_llm_config(request_with({"x-llm-base-url": "https://untrusted.invalid/v1"})))
    network = AsyncMock()
    monkeypatch.setattr(agent, "_call_openai_compat", network)
    with pytest.raises(HTTPException):
        await agent.call([{"role": "user", "content": "ping"}])
    network.assert_not_called()


async def test_openai_vision_contract_converts_internal_blocks(monkeypatch):
    captured = []

    def handler(request):
        captured.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

    real_client = httpx.AsyncClient
    monkeypatch.setattr("agents.base.httpx.AsyncClient", lambda **kwargs: real_client(
        **kwargs, transport=httpx.MockTransport(handler)
    ))
    messages = [{"role": "user", "content": [
        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "aW1hZ2U="}},
        {"type": "text", "text": "Describe this"},
    ]}]
    result = await BaseLLMAgent(LLMConfig("https://provider.invalid/v1", "fake-key", "vision")).call(messages)
    assert result == "ok"
    assert captured[0]["messages"][0]["content"][0] == {
        "type": "image_url", "image_url": {"url": "data:image/png;base64,aW1hZ2U="}
    }
    assert messages[0]["content"][0]["type"] == "image"  # No shared-message mutation.


@pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP"])
def test_real_images_are_reencoded_as_png(fmt):
    normalized = storage.normalize_image(image_bytes(fmt))
    with Image.open(io.BytesIO(normalized)) as image:
        assert image.format == "PNG"
        assert image.size == (12, 8)


def test_image_metadata_and_trailing_html_are_removed():
    info = PngImagePlugin.PngInfo()
    info.add_text("comment", "<script>evil()</script>")
    out = io.BytesIO()
    Image.new("RGB", (8, 8)).save(out, format="PNG", pnginfo=info)
    normalized = storage.normalize_image(out.getvalue() + b"<script>evil()</script>")
    assert b"<script>" not in normalized
    with Image.open(io.BytesIO(normalized)) as image:
        assert not image.info


@pytest.mark.parametrize("contents", [b"<!doctype html><script>evil()</script>", b"", image_bytes("GIF")])
def test_invalid_or_non_whitelisted_images_rejected(contents):
    with pytest.raises(ValueError):
        storage.normalize_image(contents)


def test_image_pixel_limit_checked_before_full_decode(monkeypatch):
    monkeypatch.setattr(storage, "MAX_IMAGE_PIXELS", 64)
    with pytest.raises(ValueError, match="尺寸"):
        storage.normalize_image(image_bytes(size=(9, 9)))


async def test_asset_paths_are_png_immutable_and_contained(monkeypatch, tmp_path):
    monkeypatch.setattr(storage, "UPLOAD_DIR", tmp_path)
    first = await storage.save_upload("proj_safe", "../../attack.html", image_bytes())
    second = await storage.save_upload("proj_safe", "../../attack.html", image_bytes())
    assert first != second
    assert first.startswith("/uploads/proj_safe/") and first.endswith(".png")
    assert storage.url_to_disk_path(first).is_file()
    assert storage.url_to_disk_path("/uploads/../../outside") is None
    with pytest.raises(ValueError):
        await storage.save_upload("../outside", "image.png", image_bytes())
    assert all(path.suffix == ".png" for path in tmp_path.rglob("*") if path.is_file())


async def test_spoofed_mime_rejected_before_sse_and_never_saved(isolated_api, monkeypatch, tmp_path):
    client, pool = isolated_api
    pool.conn.fetchrow.return_value = {"id": "proj_safe", "settings": {}}
    monkeypatch.setattr(storage, "UPLOAD_DIR", tmp_path)
    response = await client.post("/api/projects/proj_safe/analyze", files={
        "file": ("attack.html", b"<!doctype html><script>evil()</script>", "image/png")
    })
    assert response.status_code == 400
    assert list(tmp_path.rglob("*")) == []


async def test_upload_size_limit_uses_413(isolated_api, monkeypatch):
    client, pool = isolated_api
    pool.conn.fetchrow.return_value = {"id": "proj_safe", "settings": {}}
    monkeypatch.setattr("routers.jobs.MAX_IMAGE_BYTES", 16)
    response = await client.post("/api/projects/proj_safe/analyze", files={
        "file": ("large.png", image_bytes(), "image/png")
    })
    assert response.status_code == 413


class ScriptCounter(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts = 0
        self.script_data = []
        self.in_script = False

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            self.scripts += 1
            self.in_script = True

    def handle_endtag(self, tag):
        if tag == "script":
            self.in_script = False

    def handle_data(self, data):
        if self.in_script:
            self.script_data.append(data)


async def test_zip_payload_cannot_escape_script_and_preserves_text(isolated_api, monkeypatch):
    client, _ = isolated_api
    attack = '</script><script>window.attack=1</script>&\u2028\u2029'
    monkeypatch.setattr(projects, "_load_full_project", AsyncMock(return_value={
        "name": attack, "root_node_id": "node_safe", "nodes": [{"id": "node_safe", "title": attack}],
        "hotspots": [{"id": "hs_safe", "label": attack}],
    }))
    response = await client.get("/api/projects/proj_safe/export.zip")
    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        exported = archive.read("index.html").decode()
    parser = ScriptCounter()
    parser.feed(exported)
    assert parser.scripts == 1
    script = "".join(parser.script_data)
    payload_json = script.split("const DATA = ", 1)[1].split(";\n", 1)[0]
    payload = json.loads(payload_json)
    assert payload["name"] == attack
    assert payload["nodes"][0]["title"] == attack
    assert payload["hotspots"][0]["label"] == attack


def test_cache_identity_is_provider_and_parameter_specific():
    baseline = storage.cache_key("same-model", "same-prompt", provider="https://a.invalid", parameters={"size": "square"})
    assert baseline != storage.cache_key("same-model", "same-prompt", provider="https://b.invalid", parameters={"size": "square"})
    assert baseline != storage.cache_key("same-model", "same-prompt", provider="https://a.invalid", parameters={"size": "wide"})
    assert baseline == storage.cache_key("same-model", "same-prompt", provider="https://a.invalid/", parameters={"size": "square"})


async def test_real_image_with_html_filename_is_saved_only_as_png(client, project, monkeypatch, tmp_path):
    from tests.test_durable_jobs import HEADERS, wait_job
    monkeypatch.setattr(storage, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr("jobs.page_workflows.InputAnalysisAgent.analyze_image", AsyncMock(return_value={
        "summary": "Photo", "hotspots": [{"label": "One", "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.2}],
    }))
    response = await client.post(f"/api/projects/{project}/analyze", headers=HEADERS, files={
        "file": ("attack.html", image_bytes(), "text/html")
    })
    assert response.status_code == 202
    assert (await wait_job(client, response.json()["job_id"]))["status"] == "succeeded"
    images = [path for path in tmp_path.rglob("*") if path.is_file()]
    assert len(images) == 1 and images[0].suffix == ".png"
    with Image.open(images[0]) as image:
        assert image.format == "PNG"


@pytest.mark.parametrize("chunked,expected", [(False, 413), (True, 413)])
async def test_total_request_limit_precedes_body_processing(chunked, expected):
    from fastapi import FastAPI, Request

    from request_limits import RequestBodyLimitMiddleware

    app = FastAPI()
    app.add_middleware(RequestBodyLimitMiddleware, max_bytes=16)
    processed = []

    @app.post("/consume")
    async def consume(request: Request):
        body = await request.body()
        processed.append(body)
        return {"length": len(body)}

    async def chunks():
        yield b"a" * 10
        yield b"b" * 10

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        content = chunks() if chunked else b"a" * 20
        response = await client.post("/consume", content=content)
    assert response.status_code == expected
    assert processed == []


async def test_config_probe_does_not_claim_missing_endpoint_verified(monkeypatch):
    from main import app

    real_client = httpx.AsyncClient
    requests = []

    def missing_models(request):
        requests.append(request)
        return httpx.Response(404, text="not found")

    monkeypatch.setattr("main.httpx.AsyncClient", lambda **kwargs: real_client(
        **kwargs, transport=httpx.MockTransport(missing_models)
    ))
    async with real_client(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/test-config", headers={
            "x-llm-api-key": "", "x-imggen-base-url": "https://provider.invalid/v1", "x-imggen-api-key": "fake-key",
        })
    assert response.status_code == 200
    assert response.json()["imggen"]["ok"] is False
    assert "无法验证" in response.json()["imggen"]["error"]
    assert len(requests) == 1
    assert response.headers["x-content-type-options"] == "nosniff"
