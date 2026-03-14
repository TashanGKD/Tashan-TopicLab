"""Shared async HTTP clients for upstream services."""

from __future__ import annotations

import httpx

_clients: dict[str, httpx.AsyncClient] = {}


def get_shared_async_client(name: str = "default") -> httpx.AsyncClient:
    client = _clients.get(name)
    if client is not None:
        return client
    client = httpx.AsyncClient(
        limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
    )
    _clients[name] = client
    return client


async def close_shared_async_clients() -> None:
    for client in list(_clients.values()):
        await client.aclose()
    _clients.clear()
