"""image_generation 里的纯函数：_is_flux_model / _is_transient。"""
import httpx
import pytest

from agents.image_generation import _is_flux_model, _is_transient


class TestIsFluxModel:
    @pytest.mark.parametrize(
        "model_id",
        ["flux-schnell", "flux-dev", "FLUX-pro", "models/flux-1.1", "schnell"],
    )
    def test_flux_variants(self, model_id):
        assert _is_flux_model(model_id) is True

    @pytest.mark.parametrize(
        "model_id",
        ["dall-e-3", "gpt-image-2", "stable-diffusion", ""],
    )
    def test_non_flux(self, model_id):
        assert _is_flux_model(model_id) is False


class TestIsTransient:
    def test_connect_error_is_transient(self):
        err = httpx.ConnectError("connection refused")
        assert _is_transient(err) is True

    def test_read_timeout_is_transient(self):
        err = httpx.ReadTimeout("timed out")
        assert _is_transient(err) is True

    def test_5xx_status_error_is_transient(self):
        # 构造 502 错误
        req = httpx.Request("GET", "http://x")
        resp = httpx.Response(502, request=req)
        err = httpx.HTTPStatusError("bad gateway", request=req, response=resp)
        assert _is_transient(err) is True

    def test_4xx_status_error_not_transient(self):
        req = httpx.Request("GET", "http://x")
        resp = httpx.Response(401, request=req)
        err = httpx.HTTPStatusError("unauthorized", request=req, response=resp)
        assert _is_transient(err) is False

    def test_value_error_not_transient(self):
        assert _is_transient(ValueError("bad input")) is False

    def test_unknown_connect_named_class_is_transient(self):
        # 模拟 OpenAI SDK 的 APIConnectionError
        class APIConnectionError(Exception):
            pass

        assert _is_transient(APIConnectionError("...")) is True

    def test_unknown_timeout_named_class_is_transient(self):
        class APITimeoutError(Exception):
            pass

        assert _is_transient(APITimeoutError("...")) is True


async def test_durable_single_attempt_disables_agent_retry_and_secret_logging(monkeypatch, capsys):
    from unittest.mock import AsyncMock

    from agents.base import ImgGenConfig
    from agents.image_generation import ImageGenerationAgent

    agent = ImageGenerationAgent(ImgGenConfig("http://localhost/v1", "synthetic-image-secret", "image"))
    call = AsyncMock(side_effect=httpx.ReadTimeout("response echoed synthetic-image-secret"))
    monkeypatch.setattr(agent, "_generate_openai", call)
    with pytest.raises(httpx.ReadTimeout):
        await agent.generate("One plate", "proj_test", "node_test", use_cache=False, single_attempt=True)
    assert call.await_count == 1
    assert "synthetic-image-secret" not in capsys.readouterr().err


async def test_durable_flux_does_not_fallback_on_parameter_rejection(monkeypatch):
    from agents.base import ImgGenConfig
    from agents.image_generation import ImageGenerationAgent

    original = httpx.AsyncClient
    calls = []

    def provider(request):
        calls.append(request)
        return httpx.Response(400, json={"error": "unsupported response_format"})

    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(provider)))
    agent = ImageGenerationAgent(ImgGenConfig("http://localhost/v1", "synthetic", "flux-test"))
    with pytest.raises(httpx.HTTPStatusError):
        await agent.generate("One plate", "proj_test", "node_test", use_cache=False, single_attempt=True)
    assert len(calls) == 1


async def test_durable_sdk_disables_its_own_retries(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, Mock

    import openai

    from agents import image_generation
    from agents.base import ImgGenConfig
    from agents.image_generation import ImageGenerationAgent

    client = SimpleNamespace(images=SimpleNamespace(generate=AsyncMock(return_value=SimpleNamespace(
        data=[SimpleNamespace(url="http://localhost/result.png", b64_json=None)],
    ))))
    manager = AsyncMock()
    manager.__aenter__.return_value = client
    constructor = Mock(return_value=manager)
    monkeypatch.setattr(openai, "AsyncOpenAI", constructor)
    monkeypatch.setattr(image_generation, "download_and_save", AsyncMock(return_value="/uploads/test/result.png"))
    agent = ImageGenerationAgent(ImgGenConfig("http://localhost/v1", "synthetic", "image"))
    assert await agent._generate_openai("Prompt", "proj_test", "image.png", single_attempt=True) == "/uploads/test/result.png"
    assert constructor.call_args.kwargs["max_retries"] == 0
    manager.__aexit__.assert_awaited_once()
