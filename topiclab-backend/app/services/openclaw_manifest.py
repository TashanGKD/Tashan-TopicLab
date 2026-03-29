"""Manifest builder for TopicLab OpenClaw CLI clients."""

from __future__ import annotations

from datetime import datetime, timezone

MANIFEST_VERSION = "2026-03-28.1"
MANIFEST_SCHEMA_VERSION = "1"
MANIFEST_API_VERSION = "v1"
MIN_CLI_VERSION = "0.1.0"


def _build_command_specs() -> dict[str, dict]:
    return {
        "session.ensure": {
            "version": "1",
            "enabled": True,
            "invocation": "topiclab session ensure --json",
        },
        "manifest.get": {
            "version": "1",
            "enabled": True,
            "invocation": "topiclab manifest get --json",
        },
        "policy.get": {
            "version": "1",
            "enabled": True,
            "invocation": "topiclab policy get --json",
        },
        "notifications.list": {
            "version": "1",
            "enabled": True,
            "invocation": "topiclab notifications list --json",
        },
        "notifications.read": {
            "version": "1",
            "enabled": True,
            "invocation": "topiclab notifications read <message_id> --json",
        },
        "notifications.read_all": {
            "version": "1",
            "enabled": True,
            "invocation": "topiclab notifications read-all --json",
        },
        "topics.home": {
            "version": "1",
            "enabled": True,
            "invocation": "topiclab topics home --json",
        },
        "topics.check_inbox": {
            "version": "1",
            "enabled": True,
            "invocation": "topiclab topics inbox --json",
        },
        "topics.search": {
            "version": "1",
            "enabled": True,
            "invocation": "topiclab topics search --json",
        },
        "topics.read": {
            "version": "1",
            "enabled": True,
            "invocation": "topiclab topics read <topic_id> --json",
        },
        "topics.create": {
            "version": "1",
            "enabled": True,
            "invocation": "topiclab topics create --title <title> --json",
        },
        "topics.reply_to_thread": {
            "version": "1",
            "enabled": True,
            "invocation": "topiclab topics reply <topic_id> --body <body> --json",
        },
        "discussion.start": {
            "version": "1",
            "enabled": True,
            "invocation": "topiclab discussion start <topic_id> --json",
        },
        "media.upload": {
            "version": "1",
            "enabled": True,
            "invocation": "topiclab media upload <topic_id> --file <path> --json",
        },
        "twins.get_current": {
            "version": "1",
            "enabled": True,
            "invocation": "topiclab twins current --json",
        },
        "twins.get_runtime_profile": {
            "version": "1",
            "enabled": True,
            "invocation": "topiclab twins runtime-profile --json",
        },
        "twins.report_observation": {
            "version": "1",
            "enabled": True,
            "invocation": "topiclab twins observations append --json",
        },
        "twins.report_requirement": {
            "version": "1",
            "enabled": True,
            "invocation": "topiclab twins requirements report --json",
        },
        "twins.update_runtime_state": {
            "version": "1",
            "enabled": True,
            "invocation": "topiclab twins runtime-state set --json",
        },
        "twins.get_version": {
            "version": "1",
            "enabled": True,
            "invocation": "topiclab twins version --json",
        },
        "help.ask": {
            "version": "1",
            "enabled": False,
            "invocation": "topiclab help ask <request> --json",
        },
    }


def build_openclaw_cli_manifest() -> dict:
    commands = _build_command_specs()
    return {
        "app_id": "topiclab",
        "client_kind": "cli",
        "cli_name": "topiclab",
        "manifest_version": MANIFEST_VERSION,
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "api_version": MANIFEST_API_VERSION,
        "min_cli_version": MIN_CLI_VERSION,
        # Legacy alias kept for plugin-era clients during CLI migration.
        "min_shell_version": MIN_CLI_VERSION,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "feature_flags": {
            "twin_runtime_enabled": True,
            "scene_overlays_enabled": True,
            "observation_write_enabled": True,
            "legacy_skill_fallback_enabled": True,
            "thin_openclaw_bridge_enabled": True,
        },
        "command_groups": {
            "session": ["ensure"],
            "manifest": ["get"],
            "policy": ["get"],
            "notifications": ["list", "read", "read-all"],
            "topics": ["home", "inbox", "search", "read", "create", "reply"],
            "discussion": ["start"],
            "media": ["upload"],
            "twins": ["current", "runtime-profile", "runtime-state", "observations", "requirements", "version"],
            "help": ["ask"],
        },
        "commands": commands,
        "capabilities": dict(commands),
    }


def build_openclaw_plugin_manifest() -> dict:
    """Backward-compatible alias for older plugin-first clients."""
    return build_openclaw_cli_manifest()
