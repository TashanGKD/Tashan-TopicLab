"""TopicLab CLI manifest, policy, and help endpoints for OpenClaw."""

from __future__ import annotations

from hashlib import sha256
from pathlib import Path
import time
from typing import Any, Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel

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
OPENCLAW_SKILL_MODULES: dict[str, str] = {}


class OpenClawCLIHelpRequest(BaseModel):
    request: str
    scene: Optional[str] = None
    topic: Optional[str] = None
    context: Optional[dict[str, Any]] = None
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

    username = user.get("username") or user.get("phone") or f"user-{user.get('sub')}"
    agent_uid = user.get("agent_uid") or "unknown"
    instance_name = user.get("openclaw_display_name") or "openclaw"
    skill_entry_key = skill_access_key or raw_key
    skill_entry_kind = "bind key" if skill_entry_key and skill_entry_key.startswith("tlos_") else "runtime key"
    lines = base.splitlines()
    if not lines:
        return base

    insert_block = [
        "",
        "## 当前实例",
        "",
        f"- OpenClaw instance：`{instance_name}`",
        f"- Instance UID：`{agent_uid}`",
        f"- 关联用户上下文：`{username}`",
        f"- 当前 Runtime Key（业务请求 Bearer）：`{raw_key}`",
        f"- Skill 入口（当前携带的是 {skill_entry_kind}）：`{_build_openclaw_skill_path(skill_entry_key)}`",
        "- 默认优先使用 topiclab-cli，不要手写 TopicLab HTTP 协议细节。",
        "- 若你不确定下一步怎么做，先用 `topiclab help ask ... --json` 并刷新最新 skill。",
        "",
    ]
    if user and user.get("is_guest"):
        insert_block.extend(
            [
                "## 临时账号升级",
                "",
                "- 当前绑定的是他山世界临时账号。你可以先直接稳定使用当前 TopicLab CLI 与同一份本地持久化状态。",
                "- 建议尽快升级绑定正式账号，以便获得网页登录和跨设备管理能力。",
                "- 这不是被动说明。你应主动把下面的登录或注册链接发给用户，并说明访问后会自动把当前临时账号与正式账号打通。",
                *([f"- 还没有账号：`{claim_register_url}`"] if claim_register_url else []),
                *([f"- 已有账号直接认领：`{claim_login_url}`"] if claim_login_url else []),
                "",
            ]
        )
    return "\n".join([lines[0], *insert_block, *lines[1:]]) + ("\n" if not base.endswith("\n") else "")


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
    resolved_user = verify_access_token(bearer_token) if bearer_token else None
    skill_access_key = bearer_token if bearer_token else None
    skill_path = _build_openclaw_skill_path(skill_access_key) if skill_access_key else "/api/v1/openclaw/skill.md"
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
    return {
        "ok": True,
        "help_source": "website_skill",
        "mode": "reload_skill",
        "answer": "Default TopicLab help is to refresh the latest website skill first, then continue with topiclab-cli using the refreshed instructions.",
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
            "Retry the task with topiclab-cli after the skill refresh.",
            "If the task is still unclear, call topiclab help ask again with the new error or context.",
        ],
        "skill_markdown": skill_markdown,
    }
