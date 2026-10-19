"""Small, model-independent Wikipedia adapter with author-saved source metadata.

Only the two built-in HTTPS origins are contacted. Retrieved HTML is never served,
rendered, or followed; callers receive an attributed plain-text excerpt instead.
"""
import asyncio
import copy
import json
import math
import re
import time
from collections import OrderedDict
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from typing import Literal
from urllib.parse import quote, urlencode, urlsplit

import httpx

from content_metadata import ContentReference

Language = Literal["zh", "en"]
USER_AGENT = "FlipbookBuilder/1.0 (https://github.com/yyb9807/flipbook-builder)"
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_EXCERPT_CHARS = 3000
CACHE_TTL_SECONDS = 300
MAX_CACHE_ENTRIES = 64
TOTAL_TIMEOUT_SECONDS = 20
_ORIGINS = {"zh": "https://zh.wikipedia.org", "en": "https://en.wikipedia.org"}


class SourceRetrievalError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 502, retry_after: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.retry_after = retry_after


def _invalid_response() -> SourceRetrievalError:
    return SourceRetrievalError("source_invalid_response", "来源返回了无法读取的内容，请稍后重试。")


@dataclass
class _HtmlFrame:
    tag: str
    dropped: bool
    math_container: bool = False
    formula_seen: bool = False


class _PlainText(HTMLParser):
    _DROP = {
        "script", "style", "head", "table", "nav", "footer", "header", "aside", "figure",
        "svg", "math", "noscript", "form", "button", "iframe", "object", "embed", "audio",
        "video", "picture",
    }
    _VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
    _BLOCK = {"p", "div", "section", "article", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "br", "hr"}
    _DROP_CLASSES = {"hatnote", "navbox", "infobox", "metadata", "reflist", "references", "reference", "toc", "mw-editsection", "noprint", "shortdescription"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._stack: list[_HtmlFrame] = []
        self._parts: list[str] = []
        self._tags = 0

    def handle_starttag(self, tag, attrs):
        self._tags += 1
        if self._tags > 50000 or len(self._stack) >= 128:
            raise _invalid_response()
        inherited = self._stack[-1].dropped if self._stack else False
        attributes = dict(attrs)
        classes = set((attributes.get("class") or "").split())
        hidden = "hidden" in attributes or attributes.get("aria-hidden") == "true"
        drop = inherited or tag in self._DROP or bool(classes & self._DROP_CLASSES) or hidden
        mathematical_image = tag == "img" and any(name.startswith("mwe-math-fallback") for name in classes)
        alternative = attributes.get("alttext") if tag == "math" else attributes.get("alt")
        if not inherited and not hidden and alternative and (tag == "math" or mathematical_image):
            # Keep supplied formula alternatives, without reading image URLs or
            # synthesizing a mathematical interpretation from complex markup.
            container = next((frame for frame in reversed(self._stack) if frame.math_container), None)
            if container is None or not container.formula_seen:
                self._parts.append(" " + re.sub(r"[\x00-\x1f\x7f]", " ", alternative) + " ")
                if container:
                    container.formula_seen = True
        if not drop and tag in self._BLOCK:
            self._parts.append("\n\n")
        if not drop and tag in {"sup", "sub"}:
            self._parts.append("^(" if tag == "sup" else "_(")
        if tag not in self._VOID:
            self._stack.append(_HtmlFrame(tag, drop, "mwe-math-element" in classes))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self._VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self._stack) - 1, -1, -1):
            if self._stack[index].tag == tag:
                drop = self._stack[index].dropped
                del self._stack[index:]
                if not drop and tag in self._BLOCK:
                    self._parts.append("\n\n")
                if not drop and tag in {"sup", "sub"}:
                    self._parts.append(")")
                break

    def handle_data(self, data):
        if not self._stack or not self._stack[-1].dropped:
            self._parts.append(data)

    def text(self) -> str:
        raw = "".join(self._parts).replace("\x00", "")
        paragraphs = [re.sub(r"\s+", " ", paragraph).strip() for paragraph in raw.split("\n\n")]
        return "\n\n".join(paragraph for paragraph in paragraphs if paragraph)


def plain_text(html: str) -> str:
    parser = _PlainText()
    try:
        parser.feed(html)
        parser.close()
        return parser.text()
    except SourceRetrievalError:
        raise
    except (ValueError, RecursionError) as error:
        raise _invalid_response() from error


def _text(value: object, *, maximum: int = 512) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise _invalid_response()
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise _invalid_response()
    return value.strip()


def _identifier(value: object) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not 0 < value < 10**15:
        raise _invalid_response()
    return value


def _timestamp(value: object) -> str:
    raw = _text(value, maximum=40)
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("missing timezone")
    except ValueError as error:
        raise _invalid_response() from error
    return raw


def _key(value: str) -> str:
    result = value.strip()
    if (not result or len(result) > 512 or "://" in result or result.startswith("//")
            or any(part in {".", ".."} for part in result.split("/"))
            or any(ord(char) < 32 or ord(char) == 127 for char in result)):
        raise SourceRetrievalError("source_invalid_key", "请选择有效的百科条目。", 422)
    return result


def _retry_seconds(value: str | None) -> int:
    if value:
        try:
            seconds = float(value)
            if math.isfinite(seconds) and seconds >= 0:
                return max(1, math.ceil(seconds))
        except ValueError:
            pass
        try:
            date = parsedate_to_datetime(value)
            if date.tzinfo:
                seconds = (date - datetime.now(UTC)).total_seconds()
                return max(1, math.ceil(seconds))
        except (ValueError, TypeError, OverflowError):
            pass
    return 5


class WikipediaSources:
    """Transport injection is for tests; URLs and credentials are never configurable."""

    def __init__(self, *, transport: httpx.AsyncBaseTransport | None = None):
        self._transport = transport
        self._semaphore = asyncio.Semaphore(2)
        self._cache: OrderedDict[tuple, tuple[float, dict]] = OrderedDict()
        self._retry_until = 0.0

    def _cached(self, key: tuple) -> dict | None:
        entry = self._cache.get(key)
        if entry is None:
            return None
        if entry[0] <= time.monotonic():
            del self._cache[key]
            return None
        self._cache.move_to_end(key)
        return copy.deepcopy(entry[1])

    def _remember(self, key: tuple, value: dict) -> dict:
        self._cache[key] = (time.monotonic() + CACHE_TTL_SECONDS, copy.deepcopy(value))
        self._cache.move_to_end(key)
        while len(self._cache) > MAX_CACHE_ENTRIES:
            self._cache.popitem(last=False)
        return value

    def _cooldown(self):
        remaining = math.ceil(self._retry_until - time.monotonic())
        if remaining > 0:
            raise SourceRetrievalError("source_rate_limited", "百科来源暂时繁忙，请稍后重试。", 429, remaining)

    async def _request(self, language: Language, path: str, params: dict | None = None) -> dict:
        if language not in _ORIGINS:
            raise SourceRetrievalError("source_invalid_language", "来源语言仅支持中文或英文。", 422)
        self._cooldown()
        try:
            # The deadline includes waiting for a provider slot as well as I/O.
            async with asyncio.timeout(TOTAL_TIMEOUT_SECONDS), self._semaphore:
                self._cooldown()
                async with httpx.AsyncClient(
                    transport=self._transport, trust_env=False, follow_redirects=False,
                    timeout=httpx.Timeout(15, connect=5),
                    headers={"User-Agent": USER_AGENT, "Accept": "application/json", "Accept-Encoding": "identity"},
                ) as client:
                    async with client.stream("GET", _ORIGINS[language] + "/w/rest.php/v1/" + path, params=params) as response:
                        if response.status_code in {429, 503}:
                            retry_after = _retry_seconds(response.headers.get("Retry-After"))
                            self._retry_until = max(self._retry_until, time.monotonic() + retry_after)
                            raise SourceRetrievalError("source_rate_limited", "百科来源暂时繁忙，请稍后重试。", 429, retry_after)
                        if response.status_code == 404:
                            raise SourceRetrievalError("source_not_found", "该来源条目已不存在，请重新检索。", 404)
                        if response.status_code != 200:
                            raise SourceRetrievalError("source_unavailable", "暂时无法连接百科来源，请稍后重试。", 502)
                        if response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
                            raise _invalid_response()
                        # Avoid allocating a decompressed bomb before the streaming limit can run.
                        if response.headers.get("Content-Encoding", "identity").strip().lower() != "identity":
                            raise _invalid_response()
                        length = response.headers.get("Content-Length", "")
                        if length.isdecimal() and int(length) > MAX_RESPONSE_BYTES:
                            raise SourceRetrievalError("source_too_large", "来源正文过大，请选择其他条目。", 502)
                        body = bytearray()
                        async for chunk in response.aiter_bytes():
                            if len(body) + len(chunk) > MAX_RESPONSE_BYTES:
                                raise SourceRetrievalError("source_too_large", "来源正文过大，请选择其他条目。", 502)
                            body.extend(chunk)
                data = json.loads(body)
                if not isinstance(data, dict):
                    raise _invalid_response()
                return data
        except (httpx.TimeoutException, TimeoutError) as error:
            raise SourceRetrievalError("source_timeout", "百科来源响应超时，请稍后重试。", 504) from error
        except httpx.HTTPError as error:
            raise SourceRetrievalError("source_unavailable", "暂时无法连接百科来源，请稍后重试。", 502) from error
        except (ValueError, UnicodeDecodeError, RecursionError) as error:
            raise _invalid_response() from error

    async def search(self, query: str, language: Language = "zh") -> dict:
        query = query.strip()
        if not query or len(query) > 200 or any(ord(char) < 32 or ord(char) == 127 for char in query):
            raise SourceRetrievalError("source_invalid_query", "请输入 1 至 200 字的检索词。", 422)
        cache_key = ("search", language, query)
        cached = self._cached(cache_key)
        if cached is not None:
            return cached
        data = await self._request(language, "search/page", {"q": query, "limit": 5})
        if not isinstance(data.get("pages"), list) or len(data["pages"]) > 5:
            raise _invalid_response()
        candidates = []
        for page in data["pages"]:
            if not isinstance(page, dict):
                raise _invalid_response()
            key = _key(_text(page.get("key")))
            excerpt = page.get("excerpt")
            if excerpt is not None and not isinstance(excerpt, str):
                raise _invalid_response()
            candidates.append({
                "key": key, "page_id": _identifier(page.get("id")), "title": _text(page.get("title")),
                "snippet": plain_text(excerpt or "")[:600],
                "url": _ORIGINS[language] + "/wiki/" + quote(key, safe=""),
            })
        return self._remember(cache_key, {
            "provider": "wikipedia", "language": language, "query": query,
            "retrieved_at": datetime.now(UTC).isoformat(), "candidates": candidates,
        })

    async def page(self, key: str, language: Language = "zh") -> dict:
        key = _key(key)
        cache_key = ("page", language, key)
        cached = self._cached(cache_key)
        if cached is not None:
            return cached
        data = await self._request(language, "page/" + quote(key, safe="") + "/with_html")
        page_id = _identifier(data.get("id"))
        page_key = _key(_text(data.get("key")))
        title = _text(data.get("title"))
        latest, license_info, html = data.get("latest"), data.get("license"), data.get("html")
        if not isinstance(latest, dict) or not isinstance(license_info, dict) or not isinstance(html, str):
            raise _invalid_response()
        revision = _identifier(latest.get("id"))
        _timestamp(latest.get("timestamp"))
        license_url = _text(license_info.get("url"))
        if license_url.startswith("//"):
            license_url = "https:" + license_url
        try:
            parsed = urlsplit(license_url)
            valid_license = (parsed.scheme == "https"
                             and parsed.hostname in {"creativecommons.org", "www.creativecommons.org"}
                             and parsed.username is None and parsed.password is None
                             and parsed.port in {None, 443})
        except ValueError as error:
            raise _invalid_response() from error
        if not valid_license:
            raise _invalid_response()
        text = plain_text(html)
        if not text:
            raise SourceRetrievalError("source_empty_content", "该条目没有可引用的正文，请选择其他来源。", 502)
        try:
            reference = ContentReference.model_validate({
                "id": f"ref_{language}_{page_id}_{revision}", "title": title[:200],
                "url": _ORIGINS[language] + "/w/index.php?" + urlencode({"title": page_key, "oldid": revision}),
                "excerpt": text[:MAX_EXCERPT_CHARS], "source_revision": str(revision),
                "retrieved_at": datetime.now(UTC).isoformat(), "source_provider": "wikipedia",
                "source_language": language, "license_title": _text(license_info.get("title"), maximum=200),
                "license_url": license_url,
            }).model_dump(exclude_none=True)
        except ValueError as error:
            raise _invalid_response() from error
        return self._remember(cache_key, {
            "reference": reference,
            "truncated": len(text) > MAX_EXCERPT_CHARS,
        })
