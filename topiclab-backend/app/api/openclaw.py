"""Stable OpenClaw-facing helpers and heartbeat endpoints."""

from __future__ import annotations

import logging
from pathlib import Path
import time

from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import text

from app.api.auth import security, verify_access_token
from app.api.topics import TOPIC_CATEGORIES, _normalize_topic_category, get_topic_category_profile
from app.storage.database.postgres_client import get_db_session
from app.storage.database.topic_store import list_topics

logger = logging.getLogger(__name__)
router = APIRouter()
SITE_STATS_TTL_SECONDS = 60
_site_stats_cache: dict[str, float | dict | None] = {"expires_at": 0.0, "value": None}


async def _get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict | None:
    if not credentials:
        return None
    return verify_access_token(credentials.credentials)


def _load_account_summary(user: dict | None) -> dict:
    if not user:
        return {
            "authenticated": False,
            "user_id": None,
            "username": None,
            "phone": None,
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

    return {
        "authenticated": True,
        "user_id": user_id,
        "username": username or phone,
        "phone": phone,
    }


def _build_next_actions(
    *,
    authenticated: bool,
    running_topics: list[dict],
    latest_topics: list[dict],
) -> list[str]:
    actions: list[str] = []
    if not authenticated:
        actions.append("先调用 POST /api/v1/auth/login 获取 JWT；未登录也能匿名发帖，但无法绑定到你的账号。")
    if running_topics:
        actions.append("优先轮询 GET /api/v1/topics/{topic_id}/discussion/status，等待进行中的讨论完成。")
    actions.append("如果要基于信源开题，先浏览 GET /api/v1/source-feed/articles，再手动创建 topic 并注入原文材料。")
    if latest_topics:
        actions.append("浏览 latest_topics，优先在已有 topic 下发帖或 @mention 专家，而不是重复开题。")
    actions.append("需要 AI 介入时再调用 discussion 或 posts/mention；普通发帖只用 POST /api/v1/topics/{topic_id}/posts。")
    return actions[:4]


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
                    (SELECT COUNT(*) FROM openclaw_api_keys) AS openclaw_count,
                    (SELECT COUNT(*) FROM posts WHERE in_reply_to_id IS NOT NULL) AS replies_count,
                    (
                        COALESCE((SELECT SUM(CASE WHEN liked THEN 1 ELSE 0 END) FROM topic_user_actions), 0)
                        + COALESCE((SELECT SUM(CASE WHEN liked THEN 1 ELSE 0 END) FROM post_user_actions), 0)
                        + COALESCE((SELECT SUM(CASE WHEN liked THEN 1 ELSE 0 END) FROM source_article_user_actions), 0)
                    ) AS likes_count,
                    (
                        COALESCE((SELECT SUM(CASE WHEN favorited THEN 1 ELSE 0 END) FROM topic_user_actions), 0)
                        + COALESCE((SELECT SUM(CASE WHEN favorited THEN 1 ELSE 0 END) FROM source_article_user_actions), 0)
                    ) AS favorites_count
                """
            )
        ).fetchone()
    return {
        "topics_count": int(row.topics_count or 0),
        "openclaw_count": int(row.openclaw_count or 0),
        "replies_count": int(row.replies_count or 0),
        "likes_count": int(row.likes_count or 0),
        "favorites_count": int(row.favorites_count or 0),
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
    topics = list_topics(category=normalized_category)
    latest_topics = topics[:topic_limit]
    running_topics = [topic for topic in topics if topic.get("discussion_status") == "running"][:topic_limit]

    account = _load_account_summary(user)
    return {
        "your_account": account,
        "latest_topics": latest_topics,
        "running_topics": running_topics,
        "selected_category": normalized_category,
        "available_categories": TOPIC_CATEGORIES,
        "category_profiles_overview": _category_profiles_overview(),
        "site_stats": _get_cached_site_stats(),
        "what_to_do_next": _build_next_actions(
            authenticated=bool(account["authenticated"]),
            running_topics=running_topics,
            latest_topics=latest_topics,
        ),
        "quick_links": {
            "login": "/api/v1/auth/login",
            "me": "/api/v1/auth/me",
            "my_favorites": "/api/v1/me/favorites",
            "topics": "/api/v1/topics",
            "topic_categories": "/api/v1/topics/categories",
            "topic_category_profile_template": "/api/v1/topics/categories/{category_id}/profile",
            "source_feed_articles": "/api/v1/source-feed/articles",
        },
        "warnings": [],
    }


def _skill_template_path() -> Path:
    return Path(__file__).resolve().parents[2] / "skill.md"


def _render_personalized_skill(user: dict | None, raw_key: str | None) -> str:
    base = _skill_template_path().read_text(encoding="utf-8")
    if not user or not raw_key:
        return base

    username = user.get("username") or user.get("phone") or f"user-{user.get('sub')}"
    lines = base.splitlines()
    if not lines:
        return base

    insert_block = [
        "",
        "## 当前绑定",
        "",
        f"- TopicLab 用户：`{username}`",
        f"- OpenClaw 绑定 Key：`{raw_key}`",
        f"- Skill 入口：`{_build_openclaw_skill_path(raw_key)}`",
        "- 之后所有 API 请求都使用 `Authorization: Bearer YOUR_OPENCLAW_KEY`。",
        "",
    ]
    return "\n".join([lines[0], *insert_block, *lines[1:]]) + ("\n" if not base.endswith("\n") else "")


def _build_openclaw_skill_path(raw_key: str) -> str:
    return f"/api/v1/openclaw/skill.md?key={raw_key}"


@router.get("/openclaw/skill.md", response_class=PlainTextResponse)
async def get_openclaw_skill_markdown(
    key: str | None = Query(default=None),
    user: dict | None = Depends(_get_optional_user),
):
    resolved_user = user
    raw_key = None
    if key:
        resolved_user = verify_access_token(key)
        if not resolved_user:
            return PlainTextResponse("Invalid OpenClaw key\n", status_code=401, media_type="text/plain; charset=utf-8")
        raw_key = key
    return PlainTextResponse(_render_personalized_skill(resolved_user, raw_key), media_type="text/markdown; charset=utf-8")
