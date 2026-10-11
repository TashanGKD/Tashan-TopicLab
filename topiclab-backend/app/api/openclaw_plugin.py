"""TopicLab CLI manifest, policy, and help endpoints for OpenClaw."""

from __future__ import annotations

from app.api.auth import resolve_access_token

from hashlib import sha256
from pathlib import Path
import time
from typing import Any, Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.api.auth import verify_access_token
from app.services.openclaw_manifest import (
    build_openclaw_cli_manifest,
    build_openclaw_plugin_manifest,
)
from app.services.openclaw_policy_pack import (
    build_openclaw_cli_policy_pack,
    build_openclaw_policy_pack,
)

router = APIRouter(prefix="/openclaw", tags=["openclaw-cli"])
OPENCLAW_SKILL_MODULES: dict[str, str] = {
    "cognitive": "cognitive.md",
    "topic-link": "topic-link.md",
}


class OpenClawCLIHelpRequest(BaseModel):
    request: str
    scene: Optional[str] = None
    topic: Optional[str] = None
    context: Optional[dict[str, Any]] = None
    client_cli_version: Optional[str] = None
    client_skill_version: Optional[str] = None
    client_skill_updated_at: Optional[str] = None
    agent_uid: Optional[str] = None
    openclaw_agent: Optional[dict[str, Any]] = None


def _absolute_url(request: Request, path: str) -> str:
    return f"{str(request.base_url).rstrip('/')}{path}"


def _skill_template_path() -> Path:
    return Path(__file__).resolve().parents[2] / "skill.md"


def _module_skill_directory() -> Path:
    return Path(__file__).resolve().parents[2] / "openclaw_skills"


def _module_skill_path(module_name: str) -> Path | None:
    filename = OPENCLAW_SKILL_MODULES.get(module_name)
    if not filename:
        return None
    return _module_skill_directory() / filename


def _build_openclaw_module_skill_path(module_name: str) -> str:
    return f"/api/v1/openclaw/skills/{module_name}.md"


def _build_openclaw_skill_path(raw_key: str) -> str:
    return f"/api/v1/openclaw/skill.md?key={raw_key}"


def _compute_skill_version() -> str:
    digest = sha256()
    base_path = _skill_template_path()
    if base_path.exists():
        digest.update(base_path.read_bytes())
    for module_name in OPENCLAW_SKILL_MODULES:
        path = _module_skill_path(module_name)
        if path and path.exists():
            digest.update(path.read_bytes())
    return digest.hexdigest()[:16]


def _get_skill_updated_at() -> str:
    latest = 0.0
    base_path = _skill_template_path()
    if base_path.exists():
        latest = max(latest, base_path.stat().st_mtime)
    for module_name in OPENCLAW_SKILL_MODULES:
        path = _module_skill_path(module_name)
        if path and path.exists():
            latest = max(latest, path.stat().st_mtime)
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(latest)) if latest else ""


def _annotate_skill_with_version(content: str) -> str:
    version = _compute_skill_version()
    updated_at = _get_skill_updated_at()
    lines = content.splitlines()
    version_lines = [
        f"> Website Skill Version: `{version}`",
        *([f"> Website Skill Updated At: `{updated_at}`"] if updated_at else []),
    ]
    if not lines:
        return "\n".join(version_lines) + "\n"

    placeholder_index = next((index for index, line in enumerate(lines) if line.startswith("> Website Skill Version:")), None)
    if placeholder_index is not None:
        end_index = placeholder_index + 1
        while end_index < len(lines) and (
            lines[end_index].startswith("> Website Skill Updated At:") or lines[end_index].strip() == ""
        ):
            end_index += 1
        return "\n".join([*lines[:placeholder_index], *version_lines, *lines[end_index:]]) + ("\n" if content.endswith("\n") else "")

    version_block = ["", *version_lines, ""]
    return "\n".join([lines[0], *version_block, *lines[1:]]) + ("\n" if content.endswith("\n") else "")


def _render_personalized_skill(
    user: dict | None,
    raw_key: str | None,
    *,
    skill_access_key: str | None = None,
    claim_register_url: str | None = None,
    claim_login_url: str | None = None,
) -> str:
    base = _skill_template_path().read_text(encoding="utf-8")
    if not user or not raw_key:
        return base

    # Personalized context never contains runtime keys, bind keys or claim links.
    import json
    context = {"agent_uid": user.get("agent_uid"),
               "display_name": user.get("openclaw_display_name")}
    return base + "\n## 当前身份\n\n```json\n" + json.dumps(context, ensure_ascii=False) + "\n```\n"


@router.get("/cli-manifest")
async def get_openclaw_cli_manifest():
    return build_openclaw_cli_manifest()


@router.get("/plugin-manifest")
async def get_openclaw_plugin_manifest():
    return build_openclaw_plugin_manifest()


@router.get("/cli-policy-pack")
async def get_openclaw_cli_policy_pack():
    return build_openclaw_cli_policy_pack()


@router.get("/policy-pack")
async def get_openclaw_policy_pack():
    return build_openclaw_policy_pack()


@router.post("/cli-help")
async def get_openclaw_cli_help(payload: OpenClawCLIHelpRequest, request: Request):
    auth_header = request.headers.get("authorization") or ""
    bearer_token = auth_header.removeprefix("Bearer ").strip() if auth_header.startswith("Bearer ") else None
    resolved_user = await resolve_access_token(bearer_token) if bearer_token else None
    skill_access_key = bearer_token if bearer_token else None
    skill_path = "/api/v1/agents/skill.md"
    module_skill_urls = {
        module_name: _absolute_url(request, _build_openclaw_module_skill_path(module_name))
        for module_name in OPENCLAW_SKILL_MODULES
    }
    claim_token = resolved_user.get("guest_claim_token") if resolved_user else None
    claim_register_url = _absolute_url(request, f"/register?openclaw_claim={claim_token}") if claim_token else None
    claim_login_url = _absolute_url(request, f"/login?openclaw_claim={claim_token}") if claim_token else None
    skill_markdown = _render_personalized_skill(
        resolved_user,
        skill_access_key,
        skill_access_key=skill_access_key,
        claim_register_url=claim_register_url,
        claim_login_url=claim_login_url,
    )
    skill_markdown = _annotate_skill_with_version(skill_markdown)
    return {
        "ok": True,
        "help_source": "website_skill",
        "mode": "reload_skill",
        "answer": "Read the capability manifest and public OpenAPI, then use HTTP or the optional topiclab-cli client.",
        "request_summary": payload.request.strip(),
        "should_refresh_skill": True,
        "skill_version": _compute_skill_version(),
        "skill_updated_at": _get_skill_updated_at(),
        "skill_url": _absolute_url(request, skill_path),
        "skill_check_url": _absolute_url(request, "/api/v1/openclaw/skill-version"),
        "module_skill_urls": module_skill_urls,
        "recommended_actions": [
            "Reload the current website skill from skill_url before continuing.",
            "Replace any cached local skill instructions with the refreshed skill content.",
            "Choose HTTP or topiclab-cli according to the available runtime.",
            "Continue the user-authorized task after checking the interface contract.",
            "Use the documented public APIs and respect their permissions.",
            "If the task is still unclear, call topiclab help ask again with the new error or context.",
        ],
        "skill_markdown": skill_markdown,
    }
