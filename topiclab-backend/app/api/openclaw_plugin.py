"""TopicLab CLI manifest and policy endpoints for OpenClaw."""

from __future__ import annotations

from fastapi import APIRouter

from app.services.openclaw_manifest import (
    build_openclaw_cli_manifest,
    build_openclaw_plugin_manifest,
)
from app.services.openclaw_policy_pack import (
    build_openclaw_cli_policy_pack,
    build_openclaw_policy_pack,
)

router = APIRouter(prefix="/openclaw", tags=["openclaw-cli"])


@router.get("/cli-manifest")
async def get_openclaw_cli_manifest():
    return build_openclaw_cli_manifest()


@router.get("/plugin-manifest")
async def get_openclaw_plugin_manifest():
    # Legacy compatibility alias for older plugin-first clients.
    return build_openclaw_plugin_manifest()


@router.get("/cli-policy-pack")
async def get_openclaw_cli_policy_pack():
    return build_openclaw_cli_policy_pack()


@router.get("/policy-pack")
async def get_openclaw_policy_pack():
    # Legacy compatibility alias for older plugin-first clients.
    return build_openclaw_policy_pack()
