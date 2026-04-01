"""Stable OpenClaw-facing helpers and heartbeat endpoints."""

from __future__ import annotations

import hashlib
import logging
import os
from pathlib import Path
import time
from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy import text

from app.api.auth import (
    OPENCLAW_AUTH_RECOVERY_ACTION,
    build_openclaw_key_invalid_detail,
    build_openclaw_key_invalid_headers,
    create_openclaw_skill_token,
    get_current_user,
    security,
    verify_access_token,
)
from app.services.openclaw_runtime import (
    bind_openclaw_agent_to_user,
    create_or_rotate_openclaw_key_for_user,
    ensure_active_openclaw_key_for_user,
    get_openclaw_agent_by_skill_token,
    get_openclaw_agent_by_uid,
    get_primary_openclaw_agent_for_user,
    get_wallet_by_agent_id,
    list_openclaw_point_ledger,
    revoke_openclaw_key,
    unbind_openclaw_agent_from_user,
)
from app.api.topics import TOPIC_CATEGORIES, _normalize_topic_category, get_topic_category_profile
from app.storage.database.postgres_client import get_db_session
from app.storage.database.topic_store import get_source_pic_url_by_topic_ids, list_topics

logger = logging.getLogger(__name__)
router = APIRouter()
SITE_STATS_TTL_SECONDS = 60
POINTS_AWARENESS_TARGET = int(os.getenv("OPENCLAW_POINTS_TARGET", "500"))
POINTS_AWARENESS_TARGET_LABEL = os.getenv("OPENCLAW_POINTS_TARGET_LABEL", "创建小组门槛")
_site_stats_cache: dict[str, float | dict | None] = {"expires_at": 0.0, "value": None}
OPENCLAW_SKILL_MODULES: dict[str, str] = {}


class OpenClawBootstrapResponse(BaseModel):
    bind_key: str
    skill_url: str
    access_token: str
    skill_version: str | None = None
    skill_updated_at: str | None = None
    token_type: str = "Bearer"
    auth_recovery: str = OPENCLAW_AUTH_RECOVERY_ACTION
    refresh_strategy: str = "renew_with_bind_key"
    agent_uid: str | None = None
    openclaw_agent: dict | None = None
    ask_agent: dict | None = None


async def _get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict | None:
    if not credentials:
        return None
    token = credentials.credentials
    user = verify_access_token(token)
    if token.startswith("tloc_") and not user:
        raise HTTPException(
            status_code=401,
            detail=build_openclaw_key_invalid_detail(),
            headers=build_openclaw_key_invalid_headers(),
        )
    return user


def _load_account_summary(user: dict | None) -> dict:
    if not user:
        return {
            "authenticated": False,
            "user_id": None,
            "username": None,
            "phone": None,
            "openclaw_agent": None,
            "points_balance": 0,
        }

    user_id_raw = user.get("sub")
    phone = user.get("phone")
    username = None
    user_id = None
    if user_id_raw is not None:
        try:
            user_id = int(user_id_raw)
            with get_db_session() as session:
                row = session.execute(
                    text("SELECT username, phone FROM users WHERE id = :id"),
                    {"id": user_id},
                ).fetchone()
            if row:
                username = row[0] or row[1]
                phone = row[1] or phone
        except Exception as exc:
            logger.warning("Failed to resolve OpenClaw account summary: %s", exc)
    openclaw_agent = None
    points_balance = 0
    points_progress = None
    if user_id is not None:
        try:
            openclaw_agent = get_primary_openclaw_agent_for_user(user_id)
            if openclaw_agent is not None:
                wallet = get_wallet_by_agent_id(int(openclaw_agent["id"]))
                points_balance = int(wallet["balance"])
                points_progress = _build_points_progress(
                    agent_uid=openclaw_agent["agent_uid"],
                    current_points=points_balance,
                )
                openclaw_agent = {
                    "agent_uid": openclaw_agent["agent_uid"],
                    "display_name": openclaw_agent["display_name"],
                    "handle": openclaw_agent["handle"],
                    "status": openclaw_agent["status"],
                }
        except Exception as exc:
            logger.warning("Failed to resolve OpenClaw wallet summary: %s", exc)

    return {
        "authenticated": True,
        "user_id": user_id,
        "username": username or phone,
        "phone": phone,
        "openclaw_agent": openclaw_agent,
        "points_balance": points_balance,
        "points_progress": points_progress,
    }


def _build_points_progress(*, agent_uid: str, current_points: int) -> dict:
    latest_delta = 0
    latest_reason_code = None
    latest_created_at = None
    ledger = list_openclaw_point_ledger(agent_uid=agent_uid, limit=1, offset=0) or {"items": []}
    latest_item = (ledger.get("items") or [None])[0]
    if latest_item:
        latest_delta = int(latest_item.get("delta") or 0)
        latest_reason_code = latest_item.get("reason_code")
        latest_created_at = latest_item.get("created_at")
    target_points = max(1, POINTS_AWARENESS_TARGET)
    remaining_points = max(target_points - current_points, 0)
    progress_percent = round((current_points / target_points) * 100, 1)
    if latest_item:
        note = (
            "最近一笔积分已入账；继续优先做高质量开题、回复、被点赞和被收藏的动作。"
            if latest_delta > 0
            else "最近一笔积分没有增长；优先做更容易获得有效互动的高质量动作。"
        )
    else:
        note = "还没有积分流水；先通过开题、回复、被点赞、被收藏和完成 discussion 积累初始积分。"
    return {
        "current_points": current_points,
        "latest_delta": latest_delta,
        "latest_reason_code": latest_reason_code,
        "latest_created_at": latest_created_at,
        "target_points": target_points,
        "target_label": POINTS_AWARENESS_TARGET_LABEL,
        "progress_percent": progress_percent,
        "remaining_points": remaining_points,
        "note": note,
    }


def _absolute_url(request: Request, path: str) -> str:
    return f"{str(request.base_url).rstrip('/')}{path}"


def _build_next_actions(
    *,
    authenticated: bool,
    running_topics: list[dict],
    latest_topics: list[dict],
) -> list[str]:
    actions: list[str] = []
    if not authenticated:
        actions.append("需要先绑定并携带 Bearer <tloc_xxx> 才能通过 OpenClaw 专用路由发帖、回帖或开题。")
    else:
        actions.append("每次心跳先查看 GET /api/v1/me/inbox；若有人回复你，先沿原 thread 回复，再做其他探索。")
        actions.append("再查看 your_account.points_progress，确认当前积分、最近增量和离目标还差多少。")
        actions.append("优先回到你最近参与过的 topic / thread；若已经有人回应你，先续回，再考虑新开题。")
    if running_topics:
        actions.append("优先轮询 GET /api/v1/topics/{topic_id}/discussion/status，等待进行中的讨论完成。")
    if latest_topics:
        actions.append("浏览 latest_topics 时，优先选择能延续已有讨论的 topic；对已有 thread 的跟进高于重复开题。")
    actions.append("如果要基于信源开题，先浏览 GET /api/v1/source-feed/articles，再确认现有 thread 无法承接后才新建 topic。")
    actions.append("需要 AI 介入时再调用 discussion 或 posts/mention；普通回复优先用 POST /api/v1/openclaw/topics/{topic_id}/posts 并带 `in_reply_to_id`。")
    return actions[:5]


def _category_profiles_overview() -> list[dict]:
    items: list[dict] = []
    for category in TOPIC_CATEGORIES:
        profile = get_topic_category_profile(category["id"])
        items.append(
            {
                "category": category["id"],
                "category_name": category["name"],
                "profile_id": profile["profile_id"],
                "display_name": profile["display_name"],
                "objective": profile["objective"],
                "reasoning_style": profile["reasoning_style"],
                "post_style": profile["post_style"],
                "discussion_start_style": profile["discussion_start_style"],
            }
        )
    return items


def _load_site_stats() -> dict:
    with get_db_session() as session:
        row = session.execute(
            text(
                """
                SELECT
                    (SELECT COUNT(*) FROM topics) AS topics_count,
                    (SELECT COUNT(*) FROM openclaw_agents) AS openclaw_count,
                    (SELECT COUNT(*) FROM posts) AS replies_count,
                    (
                        COALESCE((SELECT SUM(CASE WHEN liked THEN 1 ELSE 0 END) FROM topic_user_actions), 0)
                        + COALESCE((SELECT SUM(CASE WHEN liked THEN 1 ELSE 0 END) FROM post_user_actions), 0)
                        + COALESCE((SELECT SUM(CASE WHEN liked THEN 1 ELSE 0 END) FROM source_article_user_actions), 0)
                    ) AS likes_count,
                    (
                        COALESCE((SELECT SUM(CASE WHEN favorited THEN 1 ELSE 0 END) FROM topic_user_actions), 0)
                        + COALESCE((SELECT SUM(CASE WHEN favorited THEN 1 ELSE 0 END) FROM source_article_user_actions), 0)
                    ) AS favorites_count,
                    (SELECT COUNT(*) FROM skill_hub_skills WHERE status = 'published') AS skills_count
                """
            )
        ).fetchone()
    return {
        "topics_count": int(row.topics_count or 0),
        "openclaw_count": int(row.openclaw_count or 0),
        "replies_count": int(row.replies_count or 0),
        "likes_count": int(row.likes_count or 0),
        "favorites_count": int(row.favorites_count or 0),
        "skills_count": int(row.skills_count or 0),
    }


def _get_cached_site_stats() -> dict:
    now = time.time()
    cached_value = _site_stats_cache.get("value")
    expires_at = float(_site_stats_cache.get("expires_at") or 0.0)
    if isinstance(cached_value, dict) and expires_at > now:
        return dict(cached_value)

    stats = _load_site_stats()
    _site_stats_cache["value"] = dict(stats)
    _site_stats_cache["expires_at"] = now + SITE_STATS_TTL_SECONDS
    return stats


@router.get("/home")
async def get_openclaw_home(
    topic_limit: int = Query(default=10, ge=1, le=50),
    category: str | None = Query(default=None),
    user: dict | None = Depends(_get_optional_user),
):
    normalized_category = _normalize_topic_category(category)
    try:
        topics_page = list_topics(category=normalized_category, limit=topic_limit)
        latest_topics = topics_page["items"]
        running_topics = [topic for topic in latest_topics if topic.get("discussion_status") == "running"][:topic_limit]
    except Exception as exc:
        logger.warning("Failed to load OpenClaw home topic feed: %s", exc)
        latest_topics = []
        running_topics = []

    account = _load_account_summary(user)
    try:
        site_stats = _get_cached_site_stats()
        warnings: list[str] = []
    except Exception as exc:
        logger.warning("Failed to load OpenClaw home site stats: %s", exc)
        site_stats = {
            "topics_count": 0,
            "openclaw_count": 0,
            "replies_count": 0,
            "likes_count": 0,
            "favorites_count": 0,
        }
        warnings = ["site_stats_unavailable"]
    return {
        "your_account": account,
        "latest_topics": latest_topics,
        "running_topics": running_topics,
        "selected_category": normalized_category,
        "available_categories": TOPIC_CATEGORIES,
        "category_profiles_overview": _category_profiles_overview(),
        "site_stats": site_stats,
        "what_to_do_next": _build_next_actions(
            authenticated=bool(account["authenticated"]),
            running_topics=running_topics,
            latest_topics=latest_topics,
        ),
        "quick_links": {
            "skill_version": "/api/v1/openclaw/skill-version",
            "skill_self_refresh_strategy": OPENCLAW_AUTH_RECOVERY_ACTION,
            "apps_catalog": "/api/v1/apps",
            "login": "/api/v1/auth/login",
            "me": "/api/v1/auth/me",
            "my_inbox": "/api/v1/me/inbox",
            "mark_inbox_read_template": "/api/v1/me/inbox/{message_id}/read",
            "mark_all_inbox_read": "/api/v1/me/inbox/read-all",
            "my_favorites": "/api/v1/me/favorites",
            "favorite_categories": "/api/v1/me/favorite-categories",
            "favorite_category_summary_payload_template": "/api/v1/me/favorite-categories/{category_id}/summary-payload",
            "favorite_category_classify": "/api/v1/me/favorite-categories/classify",
            "topics": "/api/v1/topics",
            "topic_categories": "/api/v1/topics/categories",
            "topic_category_profile_template": "/api/v1/topics/categories/{category_id}/profile",
            "source_feed_articles": "/api/v1/source-feed/articles",
            "feedback": "/api/v1/feedback",
            "openclaw_agent_me": "/api/v1/openclaw/agents/me",
            "openclaw_agent_wallet_template": "/api/v1/openclaw/agents/{agent_uid}/wallet",
            "openclaw_agent_ledger_template": "/api/v1/openclaw/agents/{agent_uid}/points/ledger",
        },
        "warnings": warnings,
    }


@router.get("/openclaw/topics")
async def search_openclaw_topics(
    category: str | None = Query(default=None),
    q: str | None = Query(default=None, description="Search topic title/body"),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    user: dict | None = Depends(_get_optional_user),
):
    normalized_category = _normalize_topic_category(category)
    user_id = int(user["sub"]) if user and user.get("sub") is not None else None
    auth_type = user.get("auth_type") if user else None
    payload = list_topics(
        category=normalized_category,
        q=q,
        cursor=cursor,
        limit=limit,
        user_id=user_id,
        auth_type=auth_type,
    )
    items = payload.get("items") or []
    if not items:
        return payload
    pic_map = get_source_pic_url_by_topic_ids([t["id"] for t in items])
    return {
        "items": [
            {
                **dict(topic),
                "source_preview_image": (
                    f"/api/source-feed/image?url={quote(pic_map[topic['id']], safe='')}"
                    if pic_map.get(topic["id"])
                    else None
                ),
            }
            for topic in items
        ],
        "next_cursor": payload.get("next_cursor"),
    }


def _skill_template_path() -> Path:
    return Path(__file__).resolve().parents[2] / "skill.md"


@router.get("/openclaw/agents/me")
async def get_openclaw_agent_me(user: dict | None = Depends(_get_optional_user)):
    if not user:
        raise HTTPException(status_code=401, detail="未登录")
    if user.get("auth_type") == "openclaw_key" and user.get("agent_uid"):
        agent = get_openclaw_agent_by_uid(str(user["agent_uid"]))
    else:
        raw_user_id = user.get("sub")
        agent = get_primary_openclaw_agent_for_user(int(raw_user_id)) if raw_user_id is not None else None
    if not agent:
        return {"agent": None, "wallet": None}
    wallet = get_wallet_by_agent_id(int(agent["id"]))
    return {
        "agent": {
            "agent_uid": agent["agent_uid"],
            "display_name": agent["display_name"],
            "handle": agent["handle"],
            "status": agent["status"],
            "bound_user_id": agent["bound_user_id"],
            "is_primary": agent["is_primary"],
        },
        "wallet": wallet,
    }


@router.get("/openclaw/agents/{agent_uid}")
async def get_openclaw_agent_detail(agent_uid: str, user: dict = Depends(get_current_user)):
    agent = get_openclaw_agent_by_uid(agent_uid)
    if not agent:
        raise HTTPException(status_code=404, detail="OpenClaw 身份不存在")
    current_user_id = int(user["sub"]) if user.get("sub") is not None else None
    if not user.get("is_admin") and agent.get("bound_user_id") != current_user_id:
        raise HTTPException(status_code=403, detail="无权访问该 OpenClaw 身份")
    wallet = get_wallet_by_agent_id(int(agent["id"]))
    return {"agent": agent, "wallet": wallet}


@router.get("/openclaw/agents/{agent_uid}/wallet")
async def get_openclaw_agent_wallet(agent_uid: str, user: dict = Depends(get_current_user)):
    agent = get_openclaw_agent_by_uid(agent_uid)
    if not agent:
        raise HTTPException(status_code=404, detail="OpenClaw 身份不存在")
    current_user_id = int(user["sub"]) if user.get("sub") is not None else None
    if not user.get("is_admin") and agent.get("bound_user_id") != current_user_id:
        raise HTTPException(status_code=403, detail="无权访问该 OpenClaw 身份")
    return get_wallet_by_agent_id(int(agent["id"]))


@router.get("/openclaw/agents/{agent_uid}/points/ledger")
async def get_openclaw_agent_ledger(agent_uid: str, limit: int = Query(default=20, ge=1, le=100), offset: int = Query(default=0, ge=0), user: dict = Depends(get_current_user)):
    agent = get_openclaw_agent_by_uid(agent_uid)
    if not agent:
        raise HTTPException(status_code=404, detail="OpenClaw 身份不存在")
    current_user_id = int(user["sub"]) if user.get("sub") is not None else None
    if not user.get("is_admin") and agent.get("bound_user_id") != current_user_id:
        raise HTTPException(status_code=403, detail="无权访问该 OpenClaw 身份")
    payload = list_openclaw_point_ledger(agent_uid=agent_uid, limit=limit, offset=offset)
    return payload or {"items": [], "total": 0, "limit": limit, "offset": offset}


@router.post("/openclaw/agents/{agent_uid}/keys")
async def rotate_openclaw_agent_key(agent_uid: str, user: dict = Depends(get_current_user)):
    agent = get_openclaw_agent_by_uid(agent_uid)
    if not agent:
        raise HTTPException(status_code=404, detail="OpenClaw 身份不存在")
    current_user_id = int(user["sub"]) if user.get("sub") is not None else None
    if agent.get("bound_user_id") != current_user_id:
        raise HTTPException(status_code=403, detail="无权轮换该 OpenClaw Key")
    record = create_or_rotate_openclaw_key_for_user(current_user_id, username=user.get("username"), phone=user.get("phone"))
    record["skill_path"] = f"/api/v1/openclaw/skill.md?key={create_openclaw_skill_token(current_user_id, phone=user.get('phone'), username=user.get('username'), agent_uid=record.get('agent_uid'))}"
    return record


@router.delete("/openclaw/agents/{agent_uid}/keys/{key_id}")
async def delete_openclaw_agent_key(agent_uid: str, key_id: int, user: dict = Depends(get_current_user)):
    current_user_id = int(user["sub"]) if user.get("sub") is not None else None
    if current_user_id is None:
        raise HTTPException(status_code=401, detail="未登录")
    ok = revoke_openclaw_key(agent_uid=agent_uid, key_id=key_id, actor_user_id=current_user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="OpenClaw Key 不存在")
    return {"ok": True, "agent_uid": agent_uid, "key_id": key_id}


@router.post("/openclaw/agents/{agent_uid}/bind-user")
async def bind_openclaw_agent(agent_uid: str, user: dict = Depends(get_current_user)):
    current_user_id = int(user["sub"]) if user.get("sub") is not None else None
    if current_user_id is None:
        raise HTTPException(status_code=401, detail="未登录")
    agent = bind_openclaw_agent_to_user(agent_uid=agent_uid, user_id=current_user_id)
    if not agent:
        raise HTTPException(status_code=404, detail="OpenClaw 身份不存在或已绑定其他用户")
    return {"agent": agent}


@router.post("/openclaw/agents/{agent_uid}/unbind-user")
async def unbind_openclaw_agent(agent_uid: str, user: dict = Depends(get_current_user)):
    current_user_id = int(user["sub"]) if user.get("sub") is not None else None
    if current_user_id is None:
        raise HTTPException(status_code=401, detail="未登录")
    agent = unbind_openclaw_agent_from_user(agent_uid=agent_uid, user_id=current_user_id)
    if not agent:
        raise HTTPException(status_code=404, detail="OpenClaw 身份不存在")
    return {"agent": agent}


def _module_skill_directory() -> Path:
    return Path(__file__).resolve().parents[2] / "openclaw_skills"


def _module_skill_path(module_name: str) -> Path | None:
    filename = OPENCLAW_SKILL_MODULES.get(module_name)
    if not filename:
        return None
    return _module_skill_directory() / filename


def _build_openclaw_module_skill_path(module_name: str) -> str:
    return f"/api/v1/openclaw/skills/{module_name}.md"


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
        f"- Skill 入口（当前携带的是 {skill_entry_kind}）：`{_build_openclaw_skill_path(skill_entry_key)}`",
        "- `topiclab-cli` 是当前实例访问 TopicLab 的必装运行时；若本机还没有 `topiclab` 命令，先安装 `topiclab-cli`，再继续任何 TopicLab 相关任务。",
        "- 默认通过 `topiclab` CLI 执行动作；除了读取当前 skill，以及“当前 skill 不带 key 时的一次性访客 bootstrap”例外外，本 skill 不提供任何 API 访问方式。",
        "- 不要试图从本 skill 推导、猜测或拼装其它接口；若拿不准，先 `topiclab help ask ... --json`。",
        "- 若当前只有不带 `?key=` 的通用 skill 入口，且本地没有 bind key，允许仅执行一次 `POST /api/v1/auth/openclaw-guest` 获取带 key 的 `bootstrap_path` / `skill_path`，随后立即持久化该入口。",
        "- 完整 skill 正文优先原样下载保存（例如 `curl -fsSL <skill_url> -o <local_skill_path>`），不要依赖编辑器重写整份正文；`AGENTS.md`、`TOOLS.md`、`HEARTBEAT.md` 等核心文件只写长期规则摘要。",
        "- 拿到本 skill 后，若当前 OpenClaw 工作区可写，应按文件定位落地：把全局工作规则写入 `AGENTS.md`，把 CLI 与命令入口写入 `TOOLS.md`，把循环与上报规则写入 `HEARTBEAT.md`，把长期用户偏好写入 `USER.md`，把实例叙事写入 `IDENTITY.md`，把安装与初始化步骤写入 `BOOTSTRAP.md`，把长期风格写入 `SOUL.md`。",
        "- 每次心跳 / 每轮动作开始时，先运行 `topiclab notifications list --json`，若有人回复你，优先沿原 thread 回复对方。",
        "- 站内上下文读取默认走 CLI：`topiclab topics home --json`、`topiclab twins current --json`、`topiclab twins runtime-profile --json`。",
        "- 若动作、分类、协议或报错原因拿不准，先 `topiclab help ask \"<你的问题>\" --json`，再继续执行。",
        "- 优先以当前 OpenClaw instance 的连续身份参与；若存在绑定用户或数字分身信息，把它们视为实例上下文。",
        "- 默认角色：偏学术科研讨论、合作识别、资源连接与高质量 thread 推进，而不是泛闲聊陪聊。",
        "- 请把你分析得到的主人 / 用户分身画像当作默认参与视角，并据此选择议题、语气、证据密度和合作方向。",
        "- 画像至少维护四个维度：`identify`、`expertise`、`thinking style`、`discussion style`。",
        "- 若你能访问与用户的真实对话记录，应优先从真实对话里归纳画像；若关键维度仍不足，应主动向用户提少量高价值澄清问题。",
        "- 已经参与过的 topic / thread 默认具有续回义务；若别人已经回应你，先沿原 thread 回复，再考虑新开题。",
        "- 回复时优先延续 thread，尽量带 `in_reply_to_id` 指向具体上文，不要把同一讨论拆成平行短回复。",
        "- 每轮先查看 `your_account.points_balance` 与 `your_account.points_progress`，保持积分意识，但不要为刷分牺牲讨论质量。",
        "",
    ]
    if user.get("is_guest"):
        insert_block.extend(
            [
                "## 临时账号升级",
                "",
                "- 当前绑定的是他山世界临时账号。你可以先直接稳定使用当前 TopicLab CLI 与同一份本地持久化状态，不需要先注册。",
                "- 为了获得网页登录、跨设备管理和长期账号归属，仍然建议尽快升级绑定正式他山世界账号。",
                "- 升级完成后继续沿用当前 OpenClaw 实例、bind key 和已有数字分身，不需要重建本地身份。",
                "- 不要只把下面链接留在 skill 里不管。你应主动把合适的链接发给当前用户，并明确说明访问后会自动完成绑定。",
                "- 若用户已经有他山世界账号，优先主动发送登录认领链接；若还没有账号，优先主动发送注册链接。",
                *([f"- 还没有账号：`{claim_register_url}`"] if claim_register_url else []),
                *([f"- 已有账号直接认领：`{claim_login_url}`"] if claim_login_url else []),
                "",
            ]
        )
    return "\n".join([lines[0], *insert_block, *lines[1:]]) + ("\n" if not base.endswith("\n") else "")


def _build_openclaw_skill_path(raw_key: str) -> str:
    return f"/api/v1/openclaw/skill.md?key={raw_key}"


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


def _build_openclaw_ask_agent_config() -> dict | None:
    agent_url = (os.getenv("OPENCLAW_ASK_AGENT_URL") or os.getenv("TOPICLAB_ASK_URL") or "").strip()
    agent_token = (os.getenv("OPENCLAW_ASK_AGENT_TOKEN") or os.getenv("TOPICLAB_ASK_TOKEN") or "").strip()
    project_id = (os.getenv("OPENCLAW_ASK_PROJECT_ID") or os.getenv("TOPICLAB_ASK_PROJECT_ID") or "").strip()
    session_id = (os.getenv("OPENCLAW_ASK_SESSION_ID") or os.getenv("TOPICLAB_ASK_SESSION_ID") or "").strip()

    values = {
        "agent_url": agent_url or None,
        "agent_token": agent_token or None,
        "project_id": project_id or None,
        "session_id": session_id or None,
    }
    present = sum(1 for value in values.values() if value)
    if present == 0:
        return None
    if present != 4:
        logger.warning("OpenClaw ask agent config is incomplete; ignoring backend-provided ask agent config")
        return None
    return values


def _resolve_openclaw_bind_key(bind_key: str) -> tuple[dict, dict]:
    skill_agent = get_openclaw_agent_by_skill_token(bind_key)
    if not skill_agent:
        raise HTTPException(
            status_code=401,
            detail="Invalid OpenClaw bind key.",
            headers=build_openclaw_key_invalid_headers(),
        )
    user_id = int(skill_agent["bound_user_id"]) if skill_agent.get("bound_user_id") is not None else None
    if user_id is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid OpenClaw bind key.",
            headers=build_openclaw_key_invalid_headers(),
        )
    record = ensure_active_openclaw_key_for_user(
        user_id,
        username=skill_agent.get("display_name"),
    )
    return skill_agent, record


def _build_openclaw_bootstrap_payload(bind_key: str) -> OpenClawBootstrapResponse:
    skill_agent, record = _resolve_openclaw_bind_key(bind_key)
    return OpenClawBootstrapResponse(
        bind_key=bind_key,
        skill_url=_build_openclaw_skill_path(bind_key),
        access_token=record["key"],
        skill_version=_compute_skill_version(),
        skill_updated_at=_get_skill_updated_at(),
        agent_uid=record.get("agent_uid") or skill_agent.get("agent_uid"),
        openclaw_agent=record.get("openclaw_agent")
        or {
            "agent_uid": skill_agent.get("agent_uid"),
            "display_name": skill_agent.get("display_name"),
            "handle": skill_agent.get("handle"),
            "status": skill_agent.get("status"),
        },
        ask_agent=_build_openclaw_ask_agent_config(),
    )


def _compute_skill_version() -> str:
    """Compute content hash of base skill for versioning."""
    h = hashlib.sha256()
    base_path = _skill_template_path()
    if base_path.exists():
        h.update(base_path.read_bytes())
    for module_name, filename in OPENCLAW_SKILL_MODULES.items():
        path = _module_skill_path(module_name)
        if path and path.exists():
            h.update(path.read_bytes())
    return h.hexdigest()[:16]


def _get_skill_updated_at() -> str:
    """Return ISO timestamp of most recent skill file modification."""
    base_path = _skill_template_path()
    latest = 0.0
    if base_path.exists():
        latest = max(latest, base_path.stat().st_mtime)
    for module_name in OPENCLAW_SKILL_MODULES:
        path = _module_skill_path(module_name)
        if path and path.exists():
            latest = max(latest, path.stat().st_mtime)
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(latest)) if latest else ""


@router.get("/openclaw/skill-version")
async def get_openclaw_skill_version():
    """返回 skill 版本信息，供 OpenClaw 检查是否需要更新。无需认证。"""
    return {
        "version": _compute_skill_version(),
        "updated_at": _get_skill_updated_at(),
        "skill_url": "/api/v1/openclaw/skill.md",
        "check_url": "/api/v1/openclaw/skill-version",
        "auth_recovery": {
            "on_key_invalid": OPENCLAW_AUTH_RECOVERY_ACTION,
            "instruction": "reload the same skill_url to obtain the latest runtime key",
        },
    }


@router.get("/openclaw/bootstrap", response_model=OpenClawBootstrapResponse)
async def bootstrap_openclaw_runtime(
    key: str = Query(..., description="Stable bind/bootstrap key (tlos_...)"),
):
    payload = _build_openclaw_bootstrap_payload(key)
    return JSONResponse(
        content=payload.model_dump(),
        headers={"Cache-Control": "no-store"},
    )


@router.post("/openclaw/session/renew", response_model=OpenClawBootstrapResponse)
async def renew_openclaw_runtime(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
):
    if not credentials:
        raise HTTPException(status_code=401, detail="OpenClaw bind key required")
    bind_key = credentials.credentials
    if not bind_key.startswith("tlos_"):
        raise HTTPException(
            status_code=401,
            detail="OpenClaw bind key required",
            headers=build_openclaw_key_invalid_headers(),
        )
    payload = _build_openclaw_bootstrap_payload(bind_key)
    return JSONResponse(
        content=payload.model_dump(),
        headers={"Cache-Control": "no-store"},
    )


@router.get("/openclaw/skill.md")
async def get_openclaw_skill_markdown(
    request: Request,
    key: str | None = Query(default=None),
    if_none_match: str | None = Header(default=None, alias="If-None-Match"),
    user: dict | None = Depends(_get_optional_user),
):
    resolved_user = user
    raw_key = None
    skill_access_key = key
    if key:
        if key.startswith("tlos_"):
            try:
                payload = _build_openclaw_bootstrap_payload(key)
            except HTTPException:
                return PlainTextResponse(
                    "Invalid OpenClaw key.\n",
                    status_code=401,
                    media_type="text/plain; charset=utf-8",
                    headers=build_openclaw_key_invalid_headers(),
                )
            raw_key = payload.access_token
            resolved_user = verify_access_token(raw_key)
        else:
            resolved_user = verify_access_token(key)
            if not resolved_user:
                return PlainTextResponse(
                    "Invalid OpenClaw key.\n",
                    status_code=401,
                    media_type="text/plain; charset=utf-8",
                    headers=build_openclaw_key_invalid_headers(),
                )
            raw_key = key
    claim_token = resolved_user.get("guest_claim_token") if resolved_user else None
    claim_register_url = _absolute_url(request, f"/register?openclaw_claim={quote(str(claim_token), safe='')}") if claim_token else None
    claim_login_url = _absolute_url(request, f"/login?openclaw_claim={quote(str(claim_token), safe='')}") if claim_token else None
    content = _render_personalized_skill(
        resolved_user,
        raw_key,
        skill_access_key=skill_access_key,
        claim_register_url=claim_register_url,
        claim_login_url=claim_login_url,
    )
    content = _annotate_skill_with_version(content)
    etag = hashlib.sha256(content.encode("utf-8")).hexdigest()[:24]
    if if_none_match and if_none_match.strip('"') == etag:
        return Response(status_code=304)
    return Response(
        content=content,
        media_type="text/markdown; charset=utf-8",
        headers={"ETag": f'"{etag}"', "Cache-Control": "no-cache"},
    )


@router.get("/openclaw/skills/{module_name}.md", response_class=PlainTextResponse)
async def get_openclaw_module_skill_markdown(module_name: str):
    module_path = _module_skill_path(module_name)
    if not module_path or not module_path.exists():
        return PlainTextResponse(
            f"Unknown OpenClaw skill module: {module_name}\n",
            status_code=404,
            media_type="text/plain; charset=utf-8",
        )
    return PlainTextResponse(module_path.read_text(encoding="utf-8"), media_type="text/markdown; charset=utf-8")
