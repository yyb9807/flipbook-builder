"""One remote attempt per intent. No SDK retries, raw exceptions or secrets escape."""
import base64

import httpx

from agents.hotspot_localization import HotspotLocalizationAgent, sanitize_hotspots
from agents.image_generation import ImageGenerationAgent
from agents.knowledge import KnowledgeFormatError
from agents.page_generation import PageGenerationAgent
from storage import url_to_disk_path


class ProviderFailure(Exception):
    def __init__(self, code: str, message: str, unknown: bool):
        super().__init__(code)
        self.code, self.message, self.unknown = code, message, unknown


def public_failure(exc: Exception) -> ProviderFailure:
    if isinstance(exc, KnowledgeFormatError):
        return ProviderFailure("invalid_knowledge_page", "模型已返回结果，但缺少有效的知识正文；本次没有自动重试，请调整主题后重新生成", False)
    status = getattr(exc, "status_code", None)
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
    if status in {400, 401, 403, 404, 405, 413, 422, 429}:
        return ProviderFailure(f"provider_http_{status}", "模型服务拒绝请求，请检查配置、额度或模型参数", False)
    # A read timeout or 5xx does not prove the provider did not perform the work.
    return ProviderFailure("provider_outcome_unknown", "请求结果不确定，可能已经计费，请确认后继续", True)


def redact(value, secrets: list[str]):
    if isinstance(value, str):
        for secret in secrets:
            if secret:
                value = value.replace(secret, "[redacted]")
        return value
    if isinstance(value, dict):
        return {redact(k, secrets): redact(v, secrets) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(item, secrets) for item in value]
    return value


async def perform(stage: str, config, frozen: dict, child: dict, page: dict | None, image_url: str | None, project_id: str):
    settings = frozen["settings"]
    try:
        if stage == "plan":
            agent = PageGenerationAgent(config)
            agent.safe_errors = True
            result = await agent.generate(
                hotspot_label=child["label"], parent_title=frozen["title"], parent_description=child.get("context") or frozen["description"],
                visual_style=settings.get("visual_style", "encyclopedia"), language=settings.get("language", "zh"),
                selected_keywords=frozen["selected_keywords"],
                **({"content_format": "knowledge-v1"} if frozen.get("content_format") == "knowledge-v1" else {}),
            )
        elif stage == "image":
            result = await ImageGenerationAgent(config).generate(
                prompt=page.get("image_prompt") or child["label"], project_id=project_id,
                node_id=child["node_id"], single_attempt=True,
            )
        else:
            path = url_to_disk_path(image_url)
            if not path or not path.is_file():
                return []
            agent = HotspotLocalizationAgent(config)
            agent.safe_errors = True
            raw = await agent.localize(
                base64.b64encode(path.read_bytes()).decode(), page.get("sub_topics") or [], settings.get("language", "zh"),
            )
            result = sanitize_hotspots(raw.get("hotspots"), settings.get("max_hotspots_per_page", 3))
        return redact(result, [config.api_key])
    except Exception as exc:
        # Never persist an SDK exception: it can serialize request headers/body.
        failure = public_failure(exc)
        raise failure from None
