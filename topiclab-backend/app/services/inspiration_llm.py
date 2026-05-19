"""Shared LLM client for Inspiration Co-Creation demand processing."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import httpx


class InspirationLLMNotConfigured(RuntimeError):
    """Raised when the dedicated inspiration LLM env vars are incomplete."""


class InspirationLLMRequestError(RuntimeError):
    """Raised when the inspiration LLM request fails or returns an invalid body."""


@dataclass(frozen=True)
class InspirationLLMConfig:
    chat_completions_url: str
    api_key: str
    model: str
    timeout_seconds: float = 45.0

    @classmethod
    def from_env(cls) -> "InspirationLLMConfig":
        url = os.getenv("INSPIRATION_LLM_CHAT_COMPLETIONS_URL", "").strip()
        api_key = os.getenv("INSPIRATION_LLM_API_KEY", "").strip()
        model = os.getenv("INSPIRATION_LLM_MODEL", "").strip()
        timeout_raw = os.getenv("INSPIRATION_LLM_TIMEOUT_SECONDS", "45").strip()
        if not url or not api_key or not model:
            raise InspirationLLMNotConfigured(
                "INSPIRATION_LLM_CHAT_COMPLETIONS_URL, INSPIRATION_LLM_API_KEY, and INSPIRATION_LLM_MODEL are required"
            )
        try:
            timeout_seconds = float(timeout_raw)
        except ValueError:
            timeout_seconds = 45.0
        return cls(chat_completions_url=url, api_key=api_key, model=model, timeout_seconds=max(timeout_seconds, 1.0))


async def request_inspiration_llm(
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.2,
    extra_payload: dict[str, Any] | None = None,
    config: InspirationLLMConfig | None = None,
    client: httpx.AsyncClient | None = None,
) -> str:
    """Send one Inspiration demand LLM request through the dedicated chat-completions API."""

    resolved = config or InspirationLLMConfig.from_env()
    request_payload: dict[str, Any] = {
        "model": resolved.model,
        "messages": messages,
        "temperature": temperature,
    }
    if extra_payload:
        request_payload.update(extra_payload)

    async def _post(active_client: httpx.AsyncClient) -> httpx.Response:
        return await active_client.post(
            resolved.chat_completions_url,
            headers={"Authorization": f"Bearer {resolved.api_key}", "Content-Type": "application/json"},
            json=request_payload,
        )

    try:
        if client is None:
            async with httpx.AsyncClient(timeout=resolved.timeout_seconds) as active_client:
                response = await _post(active_client)
        else:
            response = await _post(client)
        response.raise_for_status()
        data = response.json()
        content = data["choices"][0]["message"]["content"]
    except InspirationLLMNotConfigured:
        raise
    except Exception as exc:
        raise InspirationLLMRequestError("Inspiration LLM request failed") from exc

    if not isinstance(content, str):
        raise InspirationLLMRequestError("Inspiration LLM response content is not a string")
    return content
