"""App configuration from environment."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

_env_path = Path(__file__).resolve().parent.parent.parent / ".env"
load_dotenv(_env_path)


def get_anthropic_api_key() -> str:
    key = os.getenv("ANTHROPIC_API_KEY", "")
    if not key:
        raise ValueError("ANTHROPIC_API_KEY 未设置，请在 .env 中配置")
    return key


def get_anthropic_base_url() -> str:
    return os.getenv("ANTHROPIC_BASE_URL", "")


def get_anthropic_model() -> str:
    return os.getenv("ANTHROPIC_MODEL", "")


def get_ai_generation_base_url() -> str:
    """Get base URL specifically for AI generation (expert/moderator mode generation).

    WARNING: Do NOT mix with ANTHROPIC_BASE_URL. These are separate systems.
    """
    url = os.getenv("AI_GENERATION_BASE_URL", "")
    if not url:
        raise ValueError("AI_GENERATION_BASE_URL 未设置，请在 .env 中配置")
    return url


def get_ai_generation_api_key() -> str:
    """Get API key for AI generation.

    WARNING: Do NOT fallback to ANTHROPIC_API_KEY. Must be explicitly set.
    """
    key = os.getenv("AI_GENERATION_API_KEY", "")
    if not key:
        raise ValueError("AI_GENERATION_API_KEY 未设置，请在 .env 中配置")
    return key


def get_ai_generation_model() -> str:
    """Get model name for AI generation.

    WARNING: Do NOT fallback to ANTHROPIC_MODEL. Must be explicitly set.
    """
    model = os.getenv("AI_GENERATION_MODEL", "")
    if not model:
        raise ValueError("AI_GENERATION_MODEL 未设置，请在 .env 中配置")
    return model


def get_workspace_base() -> Path:
    raw = os.getenv("WORKSPACE_BASE", "")
    if raw:
        return Path(raw)
    return Path(__file__).resolve().parent.parent.parent / "workspace"


# Module-level constants for easy import
WORKSPACE_BASE = get_workspace_base()

# Claude Agent SDK configuration (for roundtable orchestration)
ANTHROPIC_API_KEY = get_anthropic_api_key()
ANTHROPIC_BASE_URL = get_anthropic_base_url()
ANTHROPIC_MODEL = get_anthropic_model()

# AI Generation configuration (for expert/moderator generation via HTTP API)
# WARNING: These are completely separate from ANTHROPIC_* settings
AI_GENERATION_BASE_URL = get_ai_generation_base_url()
AI_GENERATION_API_KEY = get_ai_generation_api_key()
AI_GENERATION_MODEL = get_ai_generation_model()
