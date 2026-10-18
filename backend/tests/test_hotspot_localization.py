"""Image grounding validation, safe empty results, and durable availability."""
import io
from unittest.mock import AsyncMock

import pytest
from PIL import Image

import storage
from agents.base import LLMConfig
from agents.hotspot_localization import HotspotLocalizationAgent, sanitize_hotspots
from routers import nodes
from tests.helpers import FakePool, request_with


def valid_hotspot(**updates):
    return {"label": "Visible object", "x": 0.2, "y": 0.3, "width": 0.2, "height": 0.1, **updates}


@pytest.mark.parametrize("bad", [
    {"x": -0.1}, {"y": 1}, {"width": 0}, {"height": -0.5}, {"x": 0.9, "width": 0.2},
    {"x": float("nan")}, {"height": float("inf")}, {"x": True}, {"width": "0.2"}, {"label": " "},
])
def test_bad_model_rectangles_are_rejected_without_invented_coordinates(bad):
    assert sanitize_hotspots([valid_hotspot(**bad)]) == []


@pytest.mark.parametrize("score,expected", [(None, None), (0.7, 0.7), (2, None), ("0.8", None), (True, None)])
def test_score_is_only_preserved_when_actually_valid(score, expected):
    assert sanitize_hotspots([valid_hotspot(score=score)])[0]["score"] == expected


def test_malformed_candidates_are_skipped_and_count_is_bounded():
    assert sanitize_hotspots({"label": "not a list"}) == []
    result = sanitize_hotspots([None, "wrong", {}, valid_hotspot(), valid_hotspot(label="Second")], 1)
    assert len(result) == 1 and result[0]["label"] == "Visible object"


@pytest.mark.parametrize("result", [{"hotspots": []}, {"hotspots": [valid_hotspot(x=0.99)]}, None])
async def test_localization_failure_returns_empty_not_grid(monkeypatch, tmp_path, result):
    monkeypatch.setattr(storage, "UPLOAD_DIR", tmp_path)
    output = io.BytesIO()
    Image.new("RGB", (8, 8)).save(output, format="PNG")
    url = await storage.save_upload("proj_safe", "image.png", output.getvalue())
    locator = HotspotLocalizationAgent(LLMConfig("https://provider.invalid/v1", "fake-key", "vision"))
    call = AsyncMock(return_value=result)
    if result is None:
        call.side_effect = RuntimeError("fake vision error")
    monkeypatch.setattr(locator, "localize", call)
    assert await locator.localize_asset(url, ["Object"]) == []
    call.assert_awaited_once()


async def test_localization_never_fetches_external_or_escaping_asset(monkeypatch):
    locator = HotspotLocalizationAgent(LLMConfig("https://provider.invalid/v1", "fake-key", "vision"))
    call = AsyncMock()
    monkeypatch.setattr(locator, "localize", call)
    assert await locator.localize_asset("https://external.invalid/image.png", []) == []
    assert await locator.localize_asset("/uploads/../../secret.png", []) == []
    call.assert_not_called()


async def test_no_legacy_paid_fallback_when_durable_service_unavailable():
    from fastapi import HTTPException
    pool = FakePool()
    pool.conn.fetchrow.side_effect = [{"id": "proj_safe", "settings": {}},
                                     {"id": "node_a", "depth": 0, "status": "draft"}]
    pool.conn.fetch.return_value = [{"id": "hs_a", "label": "Pending", "target_node_id": None}]
    with pytest.raises(HTTPException) as error:
        await nodes.generate_children("proj_safe", "node_a", request_with(), nodes.GenerateChildrenBody(), pool)
    assert error.value.status_code == 503
    pool.conn.execute.assert_not_called()
