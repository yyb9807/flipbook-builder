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
