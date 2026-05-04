import asyncio
import base64
import time

import httpx

from agents.base import ImgGenConfig, _log
from storage import cache_image, cache_key, download_and_save, save_bytes, serve_from_cache


def _is_flux_model(model: str) -> bool:
    m = model.lower()
    return "flux" in m or "schnell" in m or "dev" in m and "flux" in m


def _is_transient(err: Exception) -> bool:
    """判断是否为可重试的瞬时错误（连接抖动 / 超时 / 5xx 网关错误）。
    422、400 这种参数错误不重试，避免徒劳。"""
    if isinstance(err, (httpx.ConnectError, httpx.ReadError, httpx.WriteError,
                        httpx.RemoteProtocolError, httpx.ConnectTimeout,
                        httpx.ReadTimeout, httpx.PoolTimeout)):
        return True
    if isinstance(err, httpx.HTTPStatusError):
        return err.response.status_code >= 500
    # OpenAI SDK 的网络错误也走这里（基于 httpx）
    name = type(err).__name__
    if "Connect" in name or "Timeout" in name or "RemoteProtocol" in name:
        return True
    return False


class ImageGenerationAgent:
    def __init__(self, config: ImgGenConfig):
        self.config = config

    MAX_RETRIES = 2  # 瞬时错误最多重试 2 次（共尝试 3 次）

    async def generate(self, prompt: str, project_id: str, node_id: str) -> str:
        """生成图片，返回可访问的 URL 路径。瞬时错误（连接断 / 超时 / 5xx）自动重试。
        相同 (model, prompt) 命中缓存时复用磁盘文件，不打 API。"""
        filename = f"{node_id}.png"
        # 双保险：所有图片生成都强制追加 DK 图鉴风格反向约束。
        SAFEGUARD = " This is a knowledge plate, NOT a single illustration."
        if SAFEGUARD.strip() not in prompt:
            prompt = prompt.rstrip() + SAFEGUARD
        kind = "flux" if _is_flux_model(self.config.model) else "openai"

        # ── 缓存命中检查 ──
        ckey = cache_key(self.config.model, prompt)
        cached_url = await serve_from_cache(ckey, project_id, filename)
        if cached_url:
            _log(f"⇠ IMG cache HIT model={self.config.model} key={ckey[:12]}…")
            return cached_url

        last_err: Exception | None = None
        for attempt in range(self.MAX_RETRIES + 1):
            attempt_label = "" if attempt == 0 else f" retry={attempt}"
            _log(f"⇢ IMG call model={self.config.model} kind={kind} prompt={len(prompt)}chars{attempt_label}")
            t0 = time.time()
            try:
                if kind == "flux":
                    result = await self._generate_flux(prompt, project_id, filename)
                else:
                    result = await self._generate_openai(prompt, project_id, filename)
                _log(f"⇠ IMG done model={self.config.model} took={time.time() - t0:.1f}s{attempt_label}")
                # 缓存到 img_cache（下次相同 prompt 直接复用）
                await cache_image(ckey, result)
                return result
            except Exception as e:
                elapsed = time.time() - t0
                transient = _is_transient(e)
                _log(
                    f"✕ IMG fail model={self.config.model} took={elapsed:.1f}s "
                    f"err={type(e).__name__}: {str(e)[:200]} "
                    f"transient={transient}{attempt_label}"
                )
                last_err = e
                if not transient or attempt == self.MAX_RETRIES:
                    raise
                # 指数退避：2s → 5s
                backoff = 2 + attempt * 3
                _log(f"  · waiting {backoff}s before retry…")
                await asyncio.sleep(backoff)
        # 理论不会到这里
        if last_err:
            raise last_err
        raise RuntimeError("image generation failed without error")

    async def _generate_openai(self, prompt: str, project_id: str, filename: str) -> str:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(
            api_key=self.config.api_key,
            base_url=self.config.base_url,
            timeout=300.0,
        )
        response = await client.images.generate(
            model=self.config.model,
            prompt=prompt,
            n=1,
            size="1024x1024",
        )
        item = response.data[0]
        if item.url:
            return await download_and_save(item.url, project_id, filename)
        if item.b64_json:
            return await save_bytes(project_id, filename, base64.b64decode(item.b64_json))
        raise ValueError("图片生成接口未返回 url 或 b64_json")

    async def _generate_flux(self, prompt: str, project_id: str, filename: str) -> str:
        """调用 OpenAI-compatible 接口生成 Flux 图片"""
        url = self.config.base_url.rstrip("/") + "/images/generations"
        payload = {
            "model": self.config.model,
            "prompt": prompt,
            "n": 1,
            "size": "1360x768",
            "response_format": "b64_json",
        }
        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=300) as client:
            r = await client.post(url, json=payload, headers=headers)

            # 有些中转对 Flux 不支持 response_format，降级重试
            if r.status_code in (400, 422):
                payload.pop("response_format", None)
                r = await client.post(url, json=payload, headers=headers)

            r.raise_for_status()
            data = r.json()

        item = data["data"][0]

        if item.get("b64_json"):
            return await save_bytes(project_id, filename, base64.b64decode(item["b64_json"]))
        if item.get("url"):
            return await download_and_save(item["url"], project_id, filename)

        raise ValueError("Flux 接口未返回 b64_json 或 url")
