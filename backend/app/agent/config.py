"""Agent SDK config: API key, base_url, model."""

from __future__ import annotations

from app.core.config import (
    get_anthropic_api_key,
    get_anthropic_base_url,
    get_anthropic_model,
)


def get_agent_config() -> dict[str, str]:
    return {
        "api_key": get_anthropic_api_key(),
        "base_url": get_anthropic_base_url(),
        "model": get_anthropic_model(),
    }
