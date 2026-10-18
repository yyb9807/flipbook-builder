"""Public, bounded authorship metadata. References are author supplied, not verified."""
from __future__ import annotations

import ipaddress
import json
import unicodedata
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def safe_reference_url(value: str) -> str:
    """Accept only absolute HTTP(S) links without credentials or parser ambiguity."""
    if not value or len(value) > 2000:
        raise ValueError("参考链接长度应为 1 至 2000 个字符")
    if any(char == "\\" or char.isspace() or unicodedata.category(char).startswith("C") for char in value):
        raise ValueError("参考链接不能包含空白、控制字符或反斜杠")
    try:
        parsed = urlsplit(value)
        host = parsed.hostname
        if (parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc or not host
                or parsed.username is not None or parsed.password is not None):
            raise ValueError
        port = parsed.port
        if port is not None and not 1 <= port <= 65535:
            raise ValueError
        if ":" in host:
            ipaddress.IPv6Address(host)
        else:
            ascii_host = host.encode("idna").decode("ascii")
            if len(ascii_host) > 253:
                raise ValueError
            labels = ascii_host.rstrip(".").split(".")
            if any(not label or len(label) > 63 or label.startswith("-") or label.endswith("-")
                   or any(not (c.isascii() and (c.isalnum() or c == "-")) for c in label) for label in labels):
                raise ValueError
    except (ValueError, UnicodeError) as exc:
        raise ValueError("请填写不含账号密码的完整 http(s) 参考链接") from exc
    return value


class ContentProvenance(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["ai"]
    input_kind: Literal["text", "image", "parent_page", "page"]
    model: str = Field(min_length=1, max_length=200)

    @field_validator("model")
    @classmethod
    def nonempty_model(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("模型名称不能为空")
        return value


class ContentReference(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=200)
    url: str | None = Field(default=None, max_length=2000)
    note: str | None = Field(default=None, max_length=1000)

    @field_validator("id", "title")
    @classmethod
    def nonempty_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("参考资料 id 和标题不能为空")
        return value

    @field_validator("url")
    @classmethod
    def valid_url(cls, value: str | None) -> str | None:
        return safe_reference_url(value) if value else None


class ContentMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    version: int = Field(ge=1, le=1)
    provenance: ContentProvenance | None = None
    references: list[ContentReference] = Field(default_factory=list, max_length=12)
    review_status: Literal["unreviewed", "reviewed"] = "unreviewed"

    @model_validator(mode="after")
    def unique_reference_ids(self):
        if len({reference.id for reference in self.references}) != len(self.references):
            raise ValueError("参考资料 id 不能重复")
        return self


def public_content_metadata(value: object) -> dict | None:
    """Allowlist read/export metadata, including rows created by older imports."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            return None
    if not isinstance(value, dict):
        return None
    # Ignore unrelated/imported fields rather than exporting opaque request data.
    selected = {key: value[key] for key in ("version", "provenance", "references", "review_status") if key in value}
    provenance = selected.get("provenance")
    if isinstance(provenance, dict):
        selected["provenance"] = {key: provenance[key] for key in ("kind", "input_kind", "model") if key in provenance}
    references = selected.get("references")
    if isinstance(references, list):
        selected["references"] = [{key: reference[key] for key in ("id", "title", "url", "note") if key in reference}
                                  if isinstance(reference, dict) else reference for reference in references]
    try:
        return ContentMetadata.model_validate(selected).model_dump(exclude_none=True)
    except ValueError:
        return None


def ai_content_metadata(input_kind: Literal["text", "image", "parent_page", "page"], model: str) -> dict:
    return ContentMetadata(version=1, provenance=ContentProvenance(kind="ai", input_kind=input_kind, model=model),
                           references=[], review_status="unreviewed").model_dump(exclude_none=True)
