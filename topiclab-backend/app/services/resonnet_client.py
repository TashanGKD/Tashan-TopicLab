"""HTTP client for Resonnet executor and workspace-backed topic config APIs."""

from __future__ import annotations

import os
from typing import Any
from urllib.parse import urljoin

from app.services.http_client import get_shared_async_client


def get_resonnet_base_url() -> str:
    raw = os.getenv("RESONNET_BASE_URL", "").strip()
    if raw:
        return raw.rstrip("/")
    return "http://backend:8000"


async def request_json(method: str, path: str, *, json_body: dict | None = None, headers: dict | None = None,
                       params: dict | None = None, timeout: float = 600.0) -> Any:
    url = urljoin(f"{get_resonnet_base_url()}/", path.lstrip("/"))
    client = get_shared_async_client("resonnet")
    response = await client.request(
        method.upper(),
        url,
        json=json_body,
        headers=headers,
        params=params,
        timeout=timeout,
    )
    response.raise_for_status()
    if not response.content:
        return None
    return response.json()


async def request_bytes(method: str, path: str, *, headers: dict | None = None, params: dict | None = None,
                        timeout: float = 120.0) -> tuple[bytes, str | None]:
    url = urljoin(f"{get_resonnet_base_url()}/", path.lstrip("/"))
    client = get_shared_async_client("resonnet")
    response = await client.request(
        method.upper(),
        url,
        headers=headers,
        params=params,
        timeout=timeout,
    )
    response.raise_for_status()
    return response.content, response.headers.get("content-type")
