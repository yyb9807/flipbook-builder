"""Explicit transport tests: no public network, database, or model credentials."""
import asyncio
import copy
from datetime import UTC, datetime, timedelta
from email.utils import format_datetime
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from fastapi import FastAPI

import source_retrieval as module
from routers import sources
from source_retrieval import SourceRetrievalError, WikipediaSources, plain_text


def page(**overrides):
    result = {
        "id": 200167, "key": "Water_cycle", "title": "Water cycle",
        "latest": {"id": 1368240581, "timestamp": "2026-08-07T22:11:22Z"},
        "license": {"url": "https://creativecommons.org/licenses/by-sa/4.0/deed.en", "title": "CC BY-SA 4.0"},
        "html": "<p>Water evaporates.</p><p>Condensation forms droplets.</p>",
    }
    result.update(overrides)
    return result


def search(**overrides):
    result = {"pages": [{"id": 200167, "key": "Water_cycle", "title": "Water cycle",
                           "excerpt": '<span class="searchmatch">Water</span> moves &amp; changes state.',
                           "thumbnail": {"url": "http://127.0.0.1/private"}}]}
    result.update(overrides)
    return result


async def test_search_fixed_contract_and_no_credentials(monkeypatch):
    requests = []
    monkeypatch.setenv("LLM_API_KEY", "not-a-source-credential")
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:1")
    monkeypatch.setenv("WIKIPEDIA_BASE_URL", "http://127.0.0.1/private")

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json=search())

    result = await WikipediaSources(transport=httpx.MockTransport(handler)).search("  water cycle  ", "en")
    request = requests[0]
    assert request.method == "GET" and request.url.scheme == "https" and request.url.host == "en.wikipedia.org"
    assert request.url.path == "/w/rest.php/v1/search/page"
    assert dict(request.url.params) == {"q": "water cycle", "limit": "5"}
    assert "github.com/yyb9807/flipbook-builder" in request.headers["User-Agent"]
    assert "authorization" not in request.headers and "cookie" not in request.headers
    assert result["provider"] == "wikipedia" and result["query"] == "water cycle"
    assert result["candidates"] == [{"key": "Water_cycle", "page_id": 200167, "title": "Water cycle",
                                      "snippet": "Water moves & changes state.",
                                      "url": "https://en.wikipedia.org/wiki/Water_cycle"}]
    assert datetime.fromisoformat(result["retrieved_at"]).tzinfo is not None


async def test_single_page_response_fixes_version_license_and_preserves_paragraphs():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json=page())

    result = await WikipediaSources(transport=httpx.MockTransport(handler)).page("Water_cycle", "en")
    reference = result["reference"]
    assert len(requests) == 1 and requests[0].url.path == "/w/rest.php/v1/page/Water_cycle/with_html"
    assert reference["id"] == "ref_en_200167_1368240581"
    assert reference["source_revision"] == "1368240581"
    assert reference["source_provider"] == "wikipedia" and reference["source_language"] == "en"
    assert reference["excerpt"] == "Water evaporates.\n\nCondensation forms droplets."
    parsed = urlsplit(reference["url"])
    assert parsed.hostname == "en.wikipedia.org"
    assert parse_qs(parsed.query) == {"title": ["Water_cycle"], "oldid": ["1368240581"]}
    assert reference["license_url"] == "https://creativecommons.org/licenses/by-sa/4.0/deed.en"
    assert len(reference["snapshot_sha256"]) == 64
    assert result["truncated"] is False


async def test_key_is_encoded_cannot_add_query_fragment_or_change_origin():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json=page())

    await WikipediaSources(transport=httpx.MockTransport(handler)).page("AC/DC?x=1#h%2f", "zh")
    assert requests[0].url.host == "zh.wikipedia.org"
    assert requests[0].url.raw_path == b"/w/rest.php/v1/page/AC%2FDC%3Fx%3D1%23h%252f/with_html"
    assert not requests[0].url.query and not requests[0].url.fragment


@pytest.mark.parametrize("key", ["", " ", "https://127.0.0.1/private", "//localhost", "..", ".", "a/../b", "x\x00y", "x" * 513])
async def test_invalid_key_never_reaches_upstream(key):
    service = WikipediaSources(transport=httpx.MockTransport(lambda request: pytest.fail("network")))
    with pytest.raises(SourceRetrievalError) as exc:
        await service.page(key)
    assert exc.value.status_code == 422


@pytest.mark.parametrize("query", ["", " ", "a\x00b", "a\nb", "x" * 201])
async def test_invalid_query_never_reaches_upstream(query):
    service = WikipediaSources(transport=httpx.MockTransport(lambda request: pytest.fail("network")))
    with pytest.raises(SourceRetrievalError) as exc:
        await service.search(query)
    assert exc.value.code == "source_invalid_query"


async def test_invalid_language_never_reaches_upstream():
    service = WikipediaSources(transport=httpx.MockTransport(lambda request: pytest.fail("network")))
    with pytest.raises(SourceRetrievalError) as exc:
        await service.search("x", "localhost")
    assert exc.value.status_code == 422


def test_html_removes_resources_scripts_hidden_furniture_and_preserves_text():
    raw = '''<html><head><title>Ignore</title><style>secret</style></head><body>
    <nav>Navigation</nav><table><tr><td>Infobox</td></tr></table>
    <p>A <b>meaningful</b> paragraph &amp; <a href="http://127.0.0.1/">source</a>.<sup class="reference">[1]</sup></p>
    <script>fetch('http://localhost/secret')</script><iframe src="file:///etc/passwd">bad</iframe>
    <div aria-hidden="true">Hidden</div><div hidden>Also hidden</div>
    <div class="hatnote">Disambiguation</div><figure>Caption<img src="http://localhost/"></figure>
    <p>Second paragraph.<br>New line.</p><div class="reflist">References</div></body></html>'''
    assert plain_text(raw) == "A meaningful paragraph & source.\n\nSecond paragraph.\n\nNew line."


@pytest.mark.parametrize("html,expected", [
    ("<p>The distance is 10<sup>6</sup> metres.</p>", "The distance is 10^(6) metres."),
    ("<p>An area of 4 m<sup>2</sup>.</p>", "An area of 4 m^(2)."),
    ("<p>H<sub>2</sub>O changes state.</p>", "H_(2)O changes state."),
    ("<p>x<sup>a + b</sup></p>", "x^(a + b)"),
    ('<p>10<sup>6</sup><sup class="mw-ref reference">[2]</sup> metres</p>', "10^(6) metres"),
    ('<p>Energy <math alttext="E=mc^{2}"><mi>duplicate</mi></math> is conserved.</p>', "Energy E=mc^{2} is conserved."),
    ('<p>Area <img class="mwe-math-fallback-image-inline" alt="A=4m^{2}" src="http://127.0.0.1/"> remains.</p>', "Area A=4m^{2} remains."),
])
def test_scientific_superscripts_subscripts_and_formula_alternatives_keep_meaning(html, expected):
    assert plain_text(html) == expected


def test_math_alternative_and_fallback_are_not_duplicated_in_one_formula_container():
    html = ('<p><span class="mwe-math-element"><math alttext="E=mc^{2}"><mi>wrong</mi></math>'
            '<img class="mwe-math-fallback-image-inline" alt="E=mc^{2}" src="http://127.0.0.1/">'
            '</span> and <span class="mwe-math-element"><math alttext="E=mc^{2}"></math></span></p>')
    assert plain_text(html) == "E=mc^{2} and E=mc^{2}"


@pytest.mark.parametrize("html", ["<div>" * 130 + "x", "<br>" * 50001])
def test_html_complexity_is_bounded(html):
    with pytest.raises(SourceRetrievalError) as exc:
        plain_text(html)
    assert exc.value.code == "source_invalid_response"


async def test_excerpt_length_truncation_and_no_image_request():
    count = 0

    def handler(request):
        nonlocal count
        count += 1
        return httpx.Response(200, json=page(html='<p>' + '水' * 3100 + '</p><img src="http://127.0.0.1/">'))

    result = await WikipediaSources(transport=httpx.MockTransport(handler)).page("水循环")
    assert count == 1 and result["truncated"] is True
    assert len(result["reference"]["excerpt"]) == 3000


async def test_public_reference_title_limit_keeps_complete_canonical_url():
    source = page(title="a" * 250, key="a" * 250)
    result = await WikipediaSources(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=source))).page("long-title")
    assert len(result["reference"]["title"]) == 200
    assert parse_qs(urlsplit(result["reference"]["url"]).query)["title"] == ["a" * 250]


async def test_cache_copies_expires_and_separates_language_query(monkeypatch):
    calls, now = [], [100.0]
    monkeypatch.setattr(module.time, "monotonic", lambda: now[0])

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=search())

    service = WikipediaSources(transport=httpx.MockTransport(handler))
    original = await service.search("water", "en")
    expected = copy.deepcopy(original)
    original["candidates"][0]["title"] = "mutated"
    cached = await service.search("water", "en")
    assert cached == expected and len(calls) == 1
    cached["candidates"].clear()
    assert (await service.search("water", "en")) == expected
    await service.search("water", "zh")
    await service.search("rain", "en")
    assert len(calls) == 3
    now[0] += module.CACHE_TTL_SECONDS + 1
    await service.search("water", "en")
    assert len(calls) == 4


async def test_cache_size_bounded():
    service = WikipediaSources(transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"pages": []})))
    for index in range(module.MAX_CACHE_ENTRIES + 3):
        await service.search(f"query {index}")
    assert len(service._cache) == module.MAX_CACHE_ENTRIES
    assert ("search", "zh", "query 0") not in service._cache


@pytest.mark.parametrize("status,header,expected", [(429, "13", 13), (503, None, 5), (429, "nonsense", 5), (429, "-1", 5)])
async def test_rate_limit_no_automatic_retry_respects_cooldown(monkeypatch, status, header, expected):
    calls, now = [], [100.0]
    monkeypatch.setattr(module.time, "monotonic", lambda: now[0])

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(status, headers={"Retry-After": header} if header else {})
        return httpx.Response(200, json={"pages": []})

    service = WikipediaSources(transport=httpx.MockTransport(handler))
    for query in ["water", "rain"]:
        with pytest.raises(SourceRetrievalError) as exc:
            await service.search(query)
        assert exc.value.code == "source_rate_limited" and exc.value.retry_after == expected
    assert len(calls) == 1
    now[0] += expected + 1
    assert (await service.search("water"))["candidates"] == []
    assert len(calls) == 2


def test_retry_after_date():
    header = format_datetime(datetime.now(UTC) + timedelta(seconds=45), usegmt=True)
    assert 43 <= module._retry_seconds(header) <= 45


def test_long_retry_after_is_not_shortened():
    assert module._retry_seconds("172800") == 172800


async def test_concurrent_rate_limits_never_shorten_an_existing_cooldown(monkeypatch):
    calls, now = [], [100.0]
    monkeypatch.setattr(module.time, "monotonic", lambda: now[0])
    both_in_flight, release_short_response = asyncio.Event(), asyncio.Event()

    async def handler(request):
        query = request.url.params["q"]
        calls.append(query)
        if query == "long":
            await both_in_flight.wait()
            return httpx.Response(429, headers={"Retry-After": "120"})
        if query == "short":
            both_in_flight.set()
            await release_short_response.wait()
            return httpx.Response(503, headers={"Retry-After": "5"})
        return httpx.Response(200, json={"pages": []})

    service = WikipediaSources(transport=httpx.MockTransport(handler))
    long_request = asyncio.create_task(service.search("long"))
    short_request = asyncio.create_task(service.search("short"))
    try:
        with pytest.raises(SourceRetrievalError) as long_error:
            await long_request
        assert long_error.value.retry_after == 120 and calls == ["long", "short"]
        now[0] = 101.0
        release_short_response.set()
        with pytest.raises(SourceRetrievalError) as short_error:
            await short_request
        assert short_error.value.retry_after == 5
        # The later short response must not let another request through after
        # its 5 seconds while the first response's 120-second limit is active.
        now[0] = 107.0
        with pytest.raises(SourceRetrievalError) as remaining:
            await service.search("still blocked")
        assert remaining.value.code == "source_rate_limited" and remaining.value.retry_after == 113
        assert calls == ["long", "short"]
        now[0] = 220.0
        assert (await service.search("after cooldown"))["candidates"] == []
        assert calls == ["long", "short", "after cooldown"]
    finally:
        for task in (long_request, short_request):
            if not task.done():
                task.cancel()
        await asyncio.gather(long_request, short_request, return_exceptions=True)


@pytest.mark.parametrize("status,code", [(404, "source_not_found"), (403, "source_unavailable"), (500, "source_unavailable"), (302, "source_unavailable")])
async def test_upstream_errors_no_redirect_follow_or_body_leak(status, code):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(status, headers={"Location": "http://127.0.0.1/secret"}, text="sensitive upstream body")

    with pytest.raises(SourceRetrievalError) as exc:
        await WikipediaSources(transport=httpx.MockTransport(handler)).page("Water_cycle", "en")
    assert exc.value.code == code and "sensitive" not in str(exc.value) and len(calls) == 1


@pytest.mark.parametrize("error,code,status", [(httpx.ConnectError, "source_unavailable", 502), (httpx.ReadTimeout, "source_timeout", 504)])
async def test_transport_errors_are_actionable(error, code, status):
    def handler(request):
        raise error("private connection details", request=request)

    with pytest.raises(SourceRetrievalError) as exc:
        await WikipediaSources(transport=httpx.MockTransport(handler)).search("water")
    assert exc.value.code == code and exc.value.status_code == status and "private" not in str(exc.value)


async def test_total_deadline_covers_a_slow_response(monkeypatch):
    monkeypatch.setattr(module, "TOTAL_TIMEOUT_SECONDS", 0.001)

    async def handler(request):
        await asyncio.sleep(1)
        return httpx.Response(200, json=search())

    with pytest.raises(SourceRetrievalError) as exc:
        await WikipediaSources(transport=httpx.MockTransport(handler)).search("water")
    assert exc.value.code == "source_timeout"


async def test_total_deadline_also_covers_waiting_for_a_provider_slot(monkeypatch):
    monkeypatch.setattr(module, "TOTAL_TIMEOUT_SECONDS", 0.005)
    service = WikipediaSources(transport=httpx.MockTransport(lambda request: pytest.fail("queue never reaches network")))
    await service._semaphore.acquire()
    await service._semaphore.acquire()
    try:
        with pytest.raises(SourceRetrievalError) as exc:
            await asyncio.wait_for(service.search("queued request"), timeout=0.1)
        assert exc.value.code == "source_timeout" and exc.value.status_code == 504
    finally:
        service._semaphore.release()
        service._semaphore.release()


class ChunkedBody(httpx.AsyncByteStream):
    async def __aiter__(self):
        yield b"x" * 100
        yield b"x" * 100


@pytest.mark.parametrize("response", [
    lambda: httpx.Response(200, headers={"Content-Type": "application/json", "Content-Length": "2097153"}),
    lambda: httpx.Response(200, headers={"Content-Type": "application/json"}, stream=ChunkedBody()),
])
async def test_header_and_stream_size_limits(monkeypatch, response):
    monkeypatch.setattr(module, "MAX_RESPONSE_BYTES", 150)
    with pytest.raises(SourceRetrievalError) as exc:
        await WikipediaSources(transport=httpx.MockTransport(lambda request: response())).search("water")
    assert exc.value.code == "source_too_large"


@pytest.mark.parametrize("response", [
    lambda: httpx.Response(200, text="not json"),
    lambda: httpx.Response(200, headers={"Content-Type": "application/json"}, content=b"{bad"),
    lambda: httpx.Response(200, json=[]), lambda: httpx.Response(200, json={"pages": "bad"}),
    lambda: httpx.Response(200, json={"pages": [{"id": True, "title": "x", "key": "x", "excerpt": "x"}]}),
    lambda: httpx.Response(200, json={"pages": [{"id": 1, "title": "x", "key": "x", "excerpt": {}}]}),
    lambda: httpx.Response(200, json={"pages": [{}] * 6}),
    lambda: httpx.Response(200, headers={"Content-Type": "application/json", "Content-Encoding": "gzip"}, stream=ChunkedBody()),
])
async def test_invalid_search_responses(response):
    with pytest.raises(SourceRetrievalError) as exc:
        await WikipediaSources(transport=httpx.MockTransport(lambda request: response())).search("water")
    assert exc.value.code == "source_invalid_response"


@pytest.mark.parametrize("overrides", [
    {"id": True}, {"latest": {}}, {"latest": {"id": 3, "timestamp": "invalid"}},
    {"latest": {"id": 3, "timestamp": "2026-01-01"}}, {"html": {}},
    {"license": {"url": "javascript:alert(1)", "title": "x"}},
    {"license": {"url": "https://creativecommons.org.evil.invalid/a", "title": "x"}},
    {"license": {"url": "https://user:pass@creativecommons.org/a", "title": "x"}},
    {"license": {"url": "https://creativecommons.org:444/a", "title": "x"}},
    {"license": {"url": "https://creativecommons.org:notaport/a", "title": "x"}},
    {"license": {"url": "https://[creativecommons.org/a", "title": "x"}},
])
async def test_invalid_page_metadata(overrides):
    service = WikipediaSources(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=page(**overrides))))
    with pytest.raises(SourceRetrievalError) as exc:
        await service.page("Water_cycle", "en")
    assert exc.value.code == "source_invalid_response"


async def test_empty_article_has_no_reference():
    service = WikipediaSources(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=page(html="<table>Only furniture</table>"))))
    with pytest.raises(SourceRetrievalError) as exc:
        await service.page("Water_cycle")
    assert exc.value.code == "source_empty_content"


async def test_bounded_upstream_concurrency():
    active = maximum = 0

    async def handler(request):
        nonlocal active, maximum
        active += 1
        maximum = max(maximum, active)
        await asyncio.sleep(0.001)
        active -= 1
        return httpx.Response(200, json={"pages": []})

    service = WikipediaSources(transport=httpx.MockTransport(handler))
    await asyncio.gather(*(service.search(f"q {index}") for index in range(8)))
    assert maximum == 2


@pytest.fixture
async def source_client():
    app = FastAPI()
    app.include_router(sources.router, prefix="/api")
    service = WikipediaSources(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=search() if "/search/" in request.url.path else page())))
    app.dependency_overrides[sources.get_source_service] = lambda: service
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client, app


async def test_router_without_model_or_database(source_client):
    client, _ = source_client
    result = await client.get("/api/sources/search", params={"q": "water", "language": "en"})
    assert result.status_code == 200 and result.headers["Cache-Control"] == "no-store"
    assert len(result.json()["candidates"]) == 1
    result = await client.get("/api/sources/page", params={"key": "Water_cycle", "language": "en"})
    assert result.status_code == 200 and result.json()["reference"]["source_revision"] == "1368240581"


@pytest.mark.parametrize("path,params", [
    ("search", {"q": ""}), ("search", {"q": "x", "language": "de"}),
    ("page", {"key": "https://127.0.0.1/"}), ("page", {"key": ""}),
])
async def test_router_validates_before_upstream(source_client, path, params):
    client, _ = source_client
    assert (await client.get(f"/api/sources/{path}", params=params)).status_code == 422


async def test_router_rate_limit_header_and_message(source_client):
    client, app = source_client
    service = WikipediaSources(transport=httpx.MockTransport(lambda request: httpx.Response(429, headers={"Retry-After": "11"}, text="upstream secret")))
    app.dependency_overrides[sources.get_source_service] = lambda: service
    result = await client.get("/api/sources/search", params={"q": "water"})
    assert result.status_code == 429 and result.headers["Retry-After"] == "11"
    assert result.json()["detail"]["code"] == "source_rate_limited" and "secret" not in result.text
