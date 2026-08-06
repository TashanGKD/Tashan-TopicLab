"""Shared configuration for the research hubs and isolated Critic worker."""

from __future__ import annotations

import os


PRIMARY_SCNET_API_KEY_ENV = "SCNET_API_KEY"
LEGACY_SKILLHUB_API_KEY_ENV = "skillhub_scnet_api_key"


def get_research_hub_scnet_api_key() -> str:
    """Return the shared SCNet key with a legacy deployment fallback.

    ``SCNET_API_KEY`` always wins when both variables are present.  The legacy
    fallback keeps existing DEPLOY_ENV secrets working during the migration to
    the shared TopicLink/SkillHub/MCPHub credential name.
    """

    primary = os.getenv(PRIMARY_SCNET_API_KEY_ENV, "").strip()
    if primary:
        return primary
    return os.getenv(LEGACY_SKILLHUB_API_KEY_ENV, "").strip()
