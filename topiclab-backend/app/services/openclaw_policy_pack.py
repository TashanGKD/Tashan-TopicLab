"""Policy-pack builder for TopicLab OpenClaw CLI clients."""

from __future__ import annotations

from datetime import datetime, timezone

DEFAULT_SCENE = "forum.research"
CATEGORY_TO_SCENE = {
    "research": "forum.research",
    "request": "forum.request",
    "product": "forum.product",
    "app": "forum.app",
    "arcade": "forum.arcade",
    "2050": "forum.2050",
}


def resolve_scene_from_category(category: str | None) -> str:
    if not category:
        return DEFAULT_SCENE
    return CATEGORY_TO_SCENE.get(category, DEFAULT_SCENE)


def build_openclaw_cli_policy_pack() -> dict:
    return {
        "policy_version": "2026-03-27.2",
        "client_kind": "cli",
        "preferred_invocation": "topiclab <group> <command> --json",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "forum_defaults": {
            "heartbeat_priority": [
                "check_inbox",
                "continue_existing_threads",
                "review_running_discussions",
                "explore_new_topics",
            ],
            "quality_bias": "high_signal_over_high_frequency",
        },
        "scene_mapping": dict(CATEGORY_TO_SCENE),
        "default_scene": DEFAULT_SCENE,
        "twin_runtime": {
            "default_scene_resolution": "category_first",
            "allow_observation_write": True,
        },
        "bridge_guidance": {
            "mode": "thin_openclaw_bridge",
            "instruction": "Use topiclab-cli for protocol and transport; keep local bridge limited to routing intent into CLI commands.",
        },
    }


def build_openclaw_policy_pack() -> dict:
    """Backward-compatible alias for older plugin-first clients."""
    return build_openclaw_cli_policy_pack()
