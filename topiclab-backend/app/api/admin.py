"""Admin panel APIs with isolated password-based authentication."""

from __future__ import annotations

import json
import logging
import os
import secrets
import threading
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.api.auth import JWT_ALGORITHM, JWT_SECRET, security
from app.services.openclaw_runtime import (
    admin_adjust_points,
    get_openclaw_agent_by_uid,
    list_openclaw_agents,
    list_openclaw_events,
    list_openclaw_point_ledger,
    restore_openclaw_agent,
    suspend_openclaw_agent,
)
from app.services.twin_runtime import list_admin_observations
from app.storage.database.postgres_client import ensure_site_feedback_schema, get_db_session

router = APIRouter(prefix="/admin", tags=["admin"])

logger = logging.getLogger(__name__)
_ADMIN_PANEL_SCHEMA_READY = False
_ADMIN_PANEL_SCHEMA_LOCK = threading.Lock()
_SCENE_CATEGORY_MAP = {
    "research": "forum.research",
    "request": "forum.request",
    "product": "forum.product",
    "app": "forum.app",
    "arcade": "forum.arcade",
}
_OBSERVABILITY_TIMEZONE = ZoneInfo(os.getenv("ADMIN_OBSERVABILITY_TIMEZONE", "Asia/Shanghai"))
_ACTION_CATEGORY_ORDER = [
    "auth_identity",
    "content_creation",
    "interaction",
    "discussion",
    "skill_hub",
    "feedback",
    "observation",
    "admin_ops",
    "other",
]
_ACTION_CATEGORY_LABELS = {
    "auth_identity": "认证与身份",
    "content_creation": "内容生产",
    "interaction": "互动反馈",
    "discussion": "讨论推进",
    "skill_hub": "Skill Hub",
    "feedback": "反馈上报",
    "observation": "画像观察",
    "admin_ops": "后台运维",
    "other": "其他",
}


def _coerce_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _extract_token_usage(result: Any) -> dict[str, int]:
    if not isinstance(result, dict):
        return {
            "input_tokens_estimated": 0,
            "output_tokens_estimated": 0,
            "total_tokens_estimated": 0,
        }
    token_usage = result.get("token_usage")
    if not isinstance(token_usage, dict):
        return {
            "input_tokens_estimated": 0,
            "output_tokens_estimated": 0,
            "total_tokens_estimated": 0,
        }
    input_tokens = _coerce_int(token_usage.get("input_tokens_estimated"))
    output_tokens = _coerce_int(token_usage.get("output_tokens_estimated"))
    total_tokens = _coerce_int(token_usage.get("total_tokens_estimated"))
    if total_tokens <= 0:
        total_tokens = input_tokens + output_tokens
    return {
        "input_tokens_estimated": input_tokens,
        "output_tokens_estimated": output_tokens,
        "total_tokens_estimated": total_tokens,
    }


def _get_admin_panel_password() -> str:
    configured = (os.getenv("ADMIN_PANEL_PASSWORD") or "").strip()
    if configured:
        return configured
    raise RuntimeError("ADMIN_PANEL_PASSWORD is not configured")


def _create_admin_panel_token() -> str:
    expiration = datetime.now(timezone.utc) + timedelta(hours=12)
    payload = {
        "sub": "admin-panel",
        "panel_admin": True,
        "auth_type": "admin_panel",
        "exp": expiration,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _verify_admin_panel_token(token: str) -> dict[str, Any] | None:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        return None
    if not payload.get("panel_admin"):
        return None
    return payload


async def require_admin_panel(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict[str, Any]:
    if not credentials:
        raise HTTPException(status_code=401, detail="后台未登录")
    payload = _verify_admin_panel_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="后台登录已过期")
    return payload


def _to_iso(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return value.isoformat()


def _json_loads(value: Any, default: Any):
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return default


def _parse_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            return None
        normalized = normalized.replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(normalized)
        except ValueError:
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
                try:
                    parsed = datetime.strptime(normalized, fmt)
                    break
                except ValueError:
                    parsed = None
            if parsed is None:
                return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


def _format_day_bucket(value: datetime | None, *, tz: timezone | ZoneInfo = timezone.utc) -> str | None:
    if value is None:
        return None
    return value.astimezone(tz).strftime("%Y-%m-%d")


def _build_day_start(day: datetime.date, *, tz: timezone | ZoneInfo) -> datetime:
    return datetime.combine(day, datetime.min.time(), tzinfo=tz)


def _empty_action_categories() -> dict[str, int]:
    return {category: 0 for category in _ACTION_CATEGORY_ORDER}


def _serialize_action_categories(value: dict[str, int]) -> dict[str, int]:
    return {category: int(value.get(category, 0) or 0) for category in _ACTION_CATEGORY_ORDER}


def _build_category_cards(categories: dict[str, int]) -> list[dict[str, Any]]:
    return [
        {
            "category": category,
            "label": _ACTION_CATEGORY_LABELS[category],
            "count": int(categories.get(category, 0) or 0),
        }
        for category in _ACTION_CATEGORY_ORDER
    ]


def _classify_event_category(event_type: str | None) -> str:
    normalized = (event_type or "").strip().lower()
    if not normalized:
        return "other"
    if normalized.startswith("admin."):
        return "admin_ops"
    if normalized.startswith("auth.") or normalized.startswith("binding."):
        return "auth_identity"
    if normalized.startswith("discussion."):
        return "discussion"
    if normalized.startswith("skill."):
        return "skill_hub"
    if normalized.startswith("interaction."):
        return "interaction"
    if normalized.startswith("feedback."):
        return "feedback"
    if normalized.startswith("topic.") or normalized.startswith("post.") or normalized.startswith("media."):
        return "content_creation"
    return "other"


def _ensure_daily_bucket(container: dict[str, dict[str, Any]], day_key: str) -> dict[str, Any]:
    bucket = container.get(day_key)
    if bucket is None:
        bucket = {
            "date": day_key,
            "event_count": 0,
            "failed_event_count": 0,
            "successful_event_count": 0,
            "observation_count": 0,
            "action_total": 0,
            "categories": _empty_action_categories(),
        }
        container[day_key] = bucket
    return bucket


def _touch_daily_category(bucket: dict[str, Any], category: str, *, success: bool | None = None, is_observation: bool = False) -> None:
    bucket["action_total"] += 1
    bucket["categories"][category] = int(bucket["categories"].get(category, 0) or 0) + 1
    if is_observation:
        bucket["observation_count"] += 1
        return
    bucket["event_count"] += 1
    if success is True:
        bucket["successful_event_count"] += 1
    elif success is False:
        bucket["failed_event_count"] += 1


def _finalize_daily_series(daily_map: dict[str, dict[str, Any]], ordered_days: list[str]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for day_key in ordered_days:
        current = daily_map.get(day_key)
        if current is None:
            current = _ensure_daily_bucket(daily_map, day_key)
        items.append(
            {
                "date": current["date"],
                "event_count": int(current["event_count"]),
                "failed_event_count": int(current["failed_event_count"]),
                "successful_event_count": int(current["successful_event_count"]),
                "observation_count": int(current["observation_count"]),
                "action_total": int(current["action_total"]),
                "is_active": bool(int(current["action_total"]) > 0),
                "categories": _serialize_action_categories(current["categories"]),
            }
        )
    return items


def _scene_from_category(category: str | None) -> str | None:
    normalized = (category or "").strip().lower()
    return _SCENE_CATEGORY_MAP.get(normalized)


def _infer_event_scene(
    *,
    event_type: str,
    route: str | None,
    payload: dict[str, Any],
    target_type: str | None,
    target_id: str | None,
    topic_categories: dict[str, str | None],
    post_topic_categories: dict[str, str | None],
) -> str:
    payload_scene = str(payload.get("scene") or "").strip()
    if payload_scene:
        return payload_scene

    payload_category = _scene_from_category(str(payload.get("category") or ""))
    if payload_category:
        return payload_category

    resolved_topic_category: str | None = None
    if target_type == "topic" and target_id:
        resolved_topic_category = topic_categories.get(str(target_id))
    elif target_type == "post" and target_id:
        resolved_topic_category = post_topic_categories.get(str(target_id))
    elif payload.get("topic_id") is not None:
        resolved_topic_category = topic_categories.get(str(payload.get("topic_id")))
    elif payload.get("post_id") is not None:
        resolved_topic_category = post_topic_categories.get(str(payload.get("post_id")))

    resolved_scene = _scene_from_category(resolved_topic_category)
    if resolved_scene:
        return resolved_scene

    normalized_event_type = (event_type or "").lower()
    normalized_route = (route or "").lower()

    if normalized_event_type.startswith("skill.") or "/skill-hub" in normalized_route or "/skills" in normalized_route:
        return "forum.app"
    if normalized_event_type.startswith("interaction.source_") or "/source-feed" in normalized_route:
        return "forum.research"
    if normalized_event_type.startswith("feedback."):
        return "ops.feedback"
    if normalized_event_type.startswith("auth.") or normalized_event_type.startswith("binding.") or normalized_event_type.startswith("admin."):
        return "ops.identity"
    return "unclassified"


def _build_empty_scene_bucket(scene: str) -> dict[str, Any]:
    return {
        "scene": scene,
        "event_count": 0,
        "failed_event_count": 0,
        "observation_count": 0,
        "pending_observation_count": 0,
        "active_agents": set(),
        "active_users": set(),
    }


def _finalize_count_set(value: set[int | str | None]) -> int:
    return len({item for item in value if item not in (None, "")})


def _normalized_like(query: str | None) -> tuple[str, str]:
    clean = (query or "").strip().lower()
    return clean, f"%{clean}%"


def _resolve_sort_clause(sort_by: str | None, sort_order: str | None, allowed: dict[str, str], fallback: str) -> str:
    field = allowed.get((sort_by or "").strip())
    if not field:
        return fallback
    direction = "ASC" if (sort_order or "").strip().lower() == "asc" else "DESC"
    return f"{field} {direction}"


def _ensure_admin_schema_once() -> None:
    global _ADMIN_PANEL_SCHEMA_READY
    if _ADMIN_PANEL_SCHEMA_READY:
        return
    with _ADMIN_PANEL_SCHEMA_LOCK:
        if _ADMIN_PANEL_SCHEMA_READY:
            return
        ensure_site_feedback_schema()
        with get_db_session() as session:
            session.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS admin_panel_audit_logs (
                        id SERIAL PRIMARY KEY,
                        action VARCHAR(64) NOT NULL,
                        target_type VARCHAR(64) NOT NULL,
                        target_id VARCHAR(255) NOT NULL,
                        detail TEXT NOT NULL DEFAULT '',
                        actor_label VARCHAR(128) NOT NULL DEFAULT 'admin-panel',
                        client_ip VARCHAR(128),
                        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
            )
        _ADMIN_PANEL_SCHEMA_READY = True


def _write_audit_log(
    *,
    session,
    action: str,
    target_type: str,
    target_id: str,
    detail: str,
    client_ip: str | None,
) -> None:
    session.execute(
        text(
            """
            INSERT INTO admin_panel_audit_logs (
                action, target_type, target_id, detail, actor_label, client_ip
            ) VALUES (
                :action, :target_type, :target_id, :detail, :actor_label, :client_ip
            )
            """
        ),
        {
            "action": action,
            "target_type": target_type,
            "target_id": target_id,
            "detail": detail[:4000],
            "actor_label": "admin-panel",
            "client_ip": (client_ip or "")[:128] or None,
        },
    )


class AdminLoginRequest(BaseModel):
    password: str = Field(..., min_length=1, max_length=512)


class AdminSessionResponse(BaseModel):
    token: str
    expires_in_hours: int = 12


class PagedResponse(BaseModel):
    items: list[dict[str, Any]]
    total: int
    limit: int
    offset: int


class AdminUserUpdateRequest(BaseModel):
    username: str | None = Field(default=None, max_length=50)
    handle: str | None = Field(default=None, max_length=50)
    is_admin: bool | None = None


class AdminTopicUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    body: str | None = Field(default=None, max_length=50000)
    category: str | None = Field(default=None, max_length=255)
    status: str | None = Field(default=None, max_length=32)


class AdminFeedbackUpdateRequest(BaseModel):
    scenario: str | None = Field(default=None, max_length=2000)
    body: str | None = Field(default=None, min_length=1, max_length=8000)
    steps_to_reproduce: str | None = Field(default=None, max_length=4000)
    page_url: str | None = Field(default=None, max_length=2048)


class AdminOpenClawPointsAdjustRequest(BaseModel):
    delta: int
    note: str = Field(default="", max_length=2000)


class AdminOpenClawSuspendRequest(BaseModel):
    reason: str = Field(default="", max_length=2000)


def _ensure_mutation_payload(data: dict[str, Any]) -> None:
    if not data:
        raise HTTPException(status_code=400, detail="没有可更新字段")


@router.post("/auth/login", response_model=AdminSessionResponse)
async def admin_login(req: AdminLoginRequest):
    try:
        expected = _get_admin_panel_password()
    except RuntimeError as exc:
        logger.error("Admin panel login rejected: %s", exc)
        raise HTTPException(status_code=503, detail="后台口令未配置") from exc
    if not secrets.compare_digest(req.password, expected):
        raise HTTPException(status_code=401, detail="后台口令错误")
    return AdminSessionResponse(token=_create_admin_panel_token())


@router.get("/auth/me")
async def admin_me(_: dict[str, Any] = Depends(require_admin_panel)):
    return {"ok": True, "mode": "admin_panel"}


@router.get("/users", response_model=PagedResponse)
async def list_admin_users(
    q: str | None = None,
    sort_by: str | None = None,
    sort_order: str | None = None,
    limit: int = 20,
    offset: int = 0,
    _: dict[str, Any] = Depends(require_admin_panel),
):
    _ensure_admin_schema_once()
    clean_q, like_q = _normalized_like(q)
    safe_limit = max(1, min(limit, 100))
    safe_offset = max(offset, 0)
    order_by = _resolve_sort_clause(
        sort_by,
        sort_order,
        {
            "phone": "u.phone",
            "username": "COALESCE(u.username, '')",
            "handle": "COALESCE(u.handle, '')",
            "created_at": "u.created_at",
            "topics_count": "topics_count",
            "feedback_count": "feedback_count",
        },
        "u.created_at DESC, u.id DESC",
    )
    with get_db_session() as session:
        total = int(
            session.execute(
                text(
                    """
                    SELECT COUNT(*)
                    FROM users u
                    WHERE (
                        :q = ''
                        OR LOWER(COALESCE(u.username, '')) LIKE :like_q
                        OR LOWER(COALESCE(u.handle, '')) LIKE :like_q
                        OR LOWER(COALESCE(u.phone, '')) LIKE :like_q
                    )
                    """
                ),
                {"q": clean_q, "like_q": like_q},
            ).scalar_one()
        )
        rows = session.execute(
            text(
                f"""
                SELECT
                    u.id,
                    u.phone,
                    u.username,
                    u.handle,
                    u.is_admin,
                    u.created_at,
                    (
                        SELECT COUNT(*) FROM topics t
                        WHERE t.creator_user_id = u.id
                    ) AS topics_count,
                    (
                        SELECT COUNT(*) FROM site_feedback f
                        WHERE f.user_id = u.id
                    ) AS feedback_count
                FROM users u
                WHERE (
                    :q = ''
                    OR LOWER(COALESCE(u.username, '')) LIKE :like_q
                    OR LOWER(COALESCE(u.handle, '')) LIKE :like_q
                    OR LOWER(COALESCE(u.phone, '')) LIKE :like_q
                )
                ORDER BY {order_by}, u.id DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {"q": clean_q, "like_q": like_q, "limit": safe_limit, "offset": safe_offset},
        ).fetchall()
    items = [
        {
            "id": int(row[0]),
            "phone": row[1],
            "username": row[2],
            "handle": row[3],
            "is_admin": bool(row[4]),
            "created_at": _to_iso(row[5]),
            "topics_count": int(row[6] or 0),
            "feedback_count": int(row[7] or 0),
        }
        for row in rows
    ]
    return PagedResponse(items=items, total=total, limit=safe_limit, offset=safe_offset)


@router.patch("/users/{user_id}")
async def update_admin_user(
    user_id: int,
    req: AdminUserUpdateRequest,
    x_forwarded_for: str | None = Header(default=None, alias="X-Forwarded-For"),
    _: dict[str, Any] = Depends(require_admin_panel),
):
    _ensure_admin_schema_once()
    updates: dict[str, Any] = {}
    if req.username is not None:
        updates["username"] = req.username.strip() or None
    if req.handle is not None:
        updates["handle"] = req.handle.strip()
    if req.is_admin is not None:
        updates["is_admin"] = req.is_admin
    _ensure_mutation_payload(updates)
    set_clauses = ", ".join(f"{field} = :{field}" for field in updates)
    updates["id"] = user_id
    try:
        with get_db_session() as session:
            row = session.execute(
                text(f"UPDATE users SET {set_clauses} WHERE id = :id RETURNING id, phone, username, handle, is_admin, created_at")
                ,
                updates,
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="用户不存在")
            _write_audit_log(
                session=session,
                action="update",
                target_type="user",
                target_id=str(user_id),
                detail=f"fields={','.join(sorted(k for k in updates.keys() if k != 'id'))}",
                client_ip=x_forwarded_for,
            )
    except IntegrityError as exc:
        raise HTTPException(status_code=400, detail=f"用户更新失败：{exc.orig}") from exc
    return {
        "item": {
            "id": int(row[0]),
            "phone": row[1],
            "username": row[2],
            "handle": row[3],
            "is_admin": bool(row[4]),
            "created_at": _to_iso(row[5]),
        }
    }


@router.delete("/users/{user_id}")
async def delete_admin_user(
    user_id: int,
    x_forwarded_for: str | None = Header(default=None, alias="X-Forwarded-For"),
    _: dict[str, Any] = Depends(require_admin_panel),
):
    _ensure_admin_schema_once()
    with get_db_session() as session:
        row = session.execute(
            text("SELECT username, phone FROM users WHERE id = :id"),
            {"id": user_id},
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="用户不存在")
        session.execute(
            text(
                """
                UPDATE topics
                SET creator_user_id = NULL
                WHERE creator_user_id = :id
                """
            ),
            {"id": user_id},
        )
        session.execute(
            text(
                """
                UPDATE posts
                SET owner_user_id = NULL
                WHERE owner_user_id = :id
                """
            ),
            {"id": user_id},
        )
        session.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
        _write_audit_log(
            session=session,
            action="delete",
            target_type="user",
            target_id=str(user_id),
            detail=f"username={row[0] or ''};phone={row[1] or ''}",
            client_ip=x_forwarded_for,
        )
    return {"ok": True, "user_id": user_id}


@router.get("/topics", response_model=PagedResponse)
async def list_admin_topics(
    q: str | None = None,
    sort_by: str | None = None,
    sort_order: str | None = None,
    limit: int = 20,
    offset: int = 0,
    _: dict[str, Any] = Depends(require_admin_panel),
):
    _ensure_admin_schema_once()
    clean_q, like_q = _normalized_like(q)
    safe_limit = max(1, min(limit, 100))
    safe_offset = max(offset, 0)
    order_by = _resolve_sort_clause(
        sort_by,
        sort_order,
        {
            "title": "COALESCE(t.title, '')",
            "category": "COALESCE(t.category, '')",
            "status": "t.status",
            "creator_name": "COALESCE(t.creator_name, '')",
            "posts_count": "t.posts_count",
            "created_at": "t.created_at",
            "updated_at": "t.updated_at",
        },
        "t.updated_at DESC, t.created_at DESC",
    )
    with get_db_session() as session:
        total = int(
            session.execute(
                text(
                    """
                    SELECT COUNT(*)
                    FROM topics t
                    WHERE (
                        :q = ''
                        OR LOWER(COALESCE(t.title, '')) LIKE :like_q
                        OR LOWER(COALESCE(t.body, '')) LIKE :like_q
                        OR LOWER(COALESCE(t.creator_name, '')) LIKE :like_q
                    )
                    """
                ),
                {"q": clean_q, "like_q": like_q},
            ).scalar_one()
        )
        rows = session.execute(
            text(
                f"""
                SELECT
                    id,
                    title,
                    body,
                    category,
                    status,
                    discussion_status,
                    creator_user_id,
                    creator_name,
                    posts_count,
                    likes_count,
                    favorites_count,
                    shares_count,
                    created_at,
                    updated_at
                FROM topics t
                WHERE (
                    :q = ''
                    OR LOWER(COALESCE(t.title, '')) LIKE :like_q
                    OR LOWER(COALESCE(t.body, '')) LIKE :like_q
                    OR LOWER(COALESCE(t.creator_name, '')) LIKE :like_q
                )
                ORDER BY {order_by}, t.id DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {"q": clean_q, "like_q": like_q, "limit": safe_limit, "offset": safe_offset},
        ).fetchall()
    items = [
        {
            "id": row[0],
            "title": row[1],
            "body": row[2],
            "category": row[3],
            "status": row[4],
            "discussion_status": row[5],
            "creator_user_id": row[6],
            "creator_name": row[7],
            "posts_count": int(row[8] or 0),
            "likes_count": int(row[9] or 0),
            "favorites_count": int(row[10] or 0),
            "shares_count": int(row[11] or 0),
            "created_at": _to_iso(row[12]),
            "updated_at": _to_iso(row[13]),
        }
        for row in rows
    ]
    return PagedResponse(items=items, total=total, limit=safe_limit, offset=safe_offset)


@router.patch("/topics/{topic_id}")
async def update_admin_topic(
    topic_id: str,
    req: AdminTopicUpdateRequest,
    x_forwarded_for: str | None = Header(default=None, alias="X-Forwarded-For"),
    _: dict[str, Any] = Depends(require_admin_panel),
):
    _ensure_admin_schema_once()
    updates: dict[str, Any] = {}
    if req.title is not None:
        updates["title"] = req.title.strip()
    if req.body is not None:
        updates["body"] = req.body
    if req.category is not None:
        updates["category"] = req.category.strip() or None
    if req.status is not None:
        updates["status"] = req.status.strip()
    _ensure_mutation_payload(updates)
    updates["updated_at"] = datetime.now(timezone.utc)
    updates["id"] = topic_id
    set_clauses = ", ".join(f"{field} = :{field}" for field in updates if field != "id")
    with get_db_session() as session:
        row = session.execute(
            text(
                f"""
                UPDATE topics
                SET {set_clauses}
                WHERE id = :id
                RETURNING id, title, body, category, status, discussion_status, creator_user_id, creator_name, posts_count, likes_count, favorites_count, shares_count, created_at, updated_at
                """
            ),
            updates,
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="话题不存在")
        _write_audit_log(
            session=session,
            action="update",
            target_type="topic",
            target_id=topic_id,
            detail=f"fields={','.join(sorted(k for k in updates.keys() if k not in {'id', 'updated_at'}))}",
            client_ip=x_forwarded_for,
        )
    return {
        "item": {
            "id": row[0],
            "title": row[1],
            "body": row[2],
            "category": row[3],
            "status": row[4],
            "discussion_status": row[5],
            "creator_user_id": row[6],
            "creator_name": row[7],
            "posts_count": int(row[8] or 0),
            "likes_count": int(row[9] or 0),
            "favorites_count": int(row[10] or 0),
            "shares_count": int(row[11] or 0),
            "created_at": _to_iso(row[12]),
            "updated_at": _to_iso(row[13]),
        }
    }


@router.delete("/topics/{topic_id}")
async def delete_admin_topic(
    topic_id: str,
    x_forwarded_for: str | None = Header(default=None, alias="X-Forwarded-For"),
    _: dict[str, Any] = Depends(require_admin_panel),
):
    _ensure_admin_schema_once()
    with get_db_session() as session:
        row = session.execute(
            text("SELECT title FROM topics WHERE id = :id"),
            {"id": topic_id},
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="话题不存在")
        session.execute(text("DELETE FROM topics WHERE id = :id"), {"id": topic_id})
        _write_audit_log(
            session=session,
            action="delete",
            target_type="topic",
            target_id=topic_id,
            detail=f"title={row[0] or ''}",
            client_ip=x_forwarded_for,
        )
    return {"ok": True, "topic_id": topic_id}


@router.get("/community/observability")
async def get_admin_community_observability(
    window_days: int = 14,
    _: dict[str, Any] = Depends(require_admin_panel),
):
    _ensure_admin_schema_once()
    safe_window_days = max(3, min(window_days, 30))
    now = datetime.now(timezone.utc)
    now_local = now.astimezone(_OBSERVABILITY_TIMEZONE)
    today_local = now_local.date()
    today_key = today_local.isoformat()
    today_start_local = _build_day_start(today_local, tz=_OBSERVABILITY_TIMEZONE)
    window_start_local = today_start_local - timedelta(days=safe_window_days - 1)
    recent_7d_start_local = today_start_local - timedelta(days=6)
    window_start = window_start_local.astimezone(timezone.utc)
    recent_7d_start = recent_7d_start_local.astimezone(timezone.utc)
    recent_24h_start = now - timedelta(hours=24)
    ordered_day_keys = [
        (today_local - timedelta(days=index)).isoformat()
        for index in range(safe_window_days - 1, -1, -1)
    ]

    with get_db_session() as session:
        agent_rows = session.execute(
            text(
                """
                SELECT
                    a.id,
                    a.agent_uid,
                    a.display_name,
                    a.handle,
                    a.status,
                    a.bound_user_id,
                    a.is_primary,
                    a.created_at,
                    a.updated_at,
                    a.last_seen_at,
                    COALESCE(w.balance, 0) AS balance,
                    u.username,
                    u.phone,
                    (
                        SELECT COUNT(*)
                        FROM openclaw_activity_events e
                        WHERE e.openclaw_agent_id = a.id
                    ) AS lifetime_event_count
                FROM openclaw_agents a
                LEFT JOIN openclaw_wallets w ON w.openclaw_agent_id = a.id
                LEFT JOIN users u ON u.id = a.bound_user_id
                ORDER BY a.updated_at DESC, a.id DESC
                """
            )
        ).fetchall()
        event_rows = session.execute(
            text(
                """
                SELECT
                    e.id,
                    e.event_uid,
                    e.openclaw_agent_id,
                    e.bound_user_id,
                    e.session_id,
                    e.request_id,
                    e.event_type,
                    e.action_name,
                    e.target_type,
                    e.target_id,
                    e.route,
                    e.success,
                    e.status_code,
                    e.error_code,
                    e.payload_json,
                    e.result_json,
                    e.created_at,
                    a.agent_uid,
                    a.display_name,
                    COALESCE(e.bound_user_id, a.bound_user_id) AS resolved_user_id,
                    u.username,
                    u.phone
                FROM openclaw_activity_events e
                LEFT JOIN openclaw_agents a ON a.id = e.openclaw_agent_id
                LEFT JOIN users u ON u.id = COALESCE(e.bound_user_id, a.bound_user_id)
                ORDER BY e.created_at DESC, e.id DESC
                """
            )
        ).fetchall()
        observation_rows = session.execute(
            text(
                """
                SELECT
                    o.id,
                    o.observation_id,
                    o.twin_id,
                    o.instance_id,
                    o.source,
                    o.observation_type,
                    o.confidence,
                    o.payload_json,
                    o.merge_status,
                    o.created_at,
                    t.owner_user_id,
                    t.display_name AS twin_display_name,
                    u.username,
                    u.phone
                FROM twin_observations o
                JOIN twin_core t ON t.twin_id = o.twin_id
                LEFT JOIN users u ON u.id = t.owner_user_id
                ORDER BY o.created_at DESC, o.id DESC
                """
            )
        ).fetchall()
        topic_rows = session.execute(text("SELECT id, category FROM topics")).fetchall()
        post_rows = session.execute(
            text(
                """
                SELECT p.id, t.category
                FROM posts p
                LEFT JOIN topics t ON t.id = p.topic_id
                """
            )
        ).fetchall()

    topic_categories = {str(row.id): row.category for row in topic_rows}
    post_topic_categories = {str(row.id): row.category for row in post_rows}

    trend_map: dict[str, dict[str, Any]] = {
        day_key: {
            "date": day_key,
            "event_count": 0,
            "failed_event_count": 0,
            "observation_count": 0,
            "discussion_started_count": 0,
            "discussion_completed_count": 0,
            "tokenized_request_count": 0,
            "input_tokens_estimated": 0,
            "output_tokens_estimated": 0,
            "total_tokens_estimated": 0,
            "active_agents": set(),
            "active_users": set(),
        }
        for day_key in ordered_day_keys
    }

    scene_map: dict[str, dict[str, Any]] = {}
    top_event_types: dict[str, dict[str, int | str]] = {}
    top_routes: dict[str, dict[str, int | str]] = {}
    failed_events: list[dict[str, Any]] = []
    today_active_agents: set[int] = set()
    today_active_users: set[int] = set()
    today_action_categories = _empty_action_categories()

    agent_rollups: dict[int, dict[str, Any]] = {}
    for row in agent_rows:
        last_seen_dt = _parse_datetime(row.last_seen_at)
        updated_dt = _parse_datetime(row.updated_at)
        created_dt = _parse_datetime(row.created_at)
        latest_activity_dt = last_seen_dt or updated_dt or created_dt
        agent_rollups[int(row.id)] = {
            "agent_id": int(row.id),
            "agent_uid": row.agent_uid,
            "display_name": row.display_name,
            "handle": row.handle,
            "status": row.status,
            "bound_user_id": int(row.bound_user_id) if row.bound_user_id is not None else None,
            "username": row.username,
            "phone": row.phone,
            "is_primary": bool(row.is_primary),
            "points_balance": int(row.balance or 0),
            "created_at": _to_iso(row.created_at),
            "updated_at": _to_iso(row.updated_at),
            "last_seen_at": _to_iso(row.last_seen_at),
            "latest_activity_at": _to_iso(latest_activity_dt),
            "lifetime_event_count": int(row.lifetime_event_count or 0),
            "recent_event_count": 0,
            "recent_failure_count": 0,
            "recent_observation_count": 0,
            "pending_observation_count": 0,
            "risk_score": 0,
            "risk_reasons": [],
            "inactivity_days": None,
            "is_today_active": False,
            "today_action_total": 0,
            "today_categories": _empty_action_categories(),
            "daily_actions": {},
            "tokenized_request_count": 0,
            "input_tokens_estimated": 0,
            "output_tokens_estimated": 0,
            "total_tokens_estimated": 0,
        }
    agent_uid_to_id = {rollup["agent_uid"]: agent_id for agent_id, rollup in agent_rollups.items()}

    user_rollups: dict[int, dict[str, Any]] = {}

    def ensure_user_rollup(user_id: int, *, username: str | None, phone: str | None) -> dict[str, Any]:
        current = user_rollups.get(user_id)
        if current is None:
            current = {
                "user_id": user_id,
                "username": username,
                "phone": phone,
                "agent_uids": set(),
                "agent_count": 0,
                "recent_event_count": 0,
                "recent_failure_count": 0,
                "recent_observation_count": 0,
                "pending_observation_count": 0,
                "latest_activity_at": "",
                "primary_agent_uid": None,
                "is_today_active": False,
                "today_action_total": 0,
                "today_categories": _empty_action_categories(),
                "daily_actions": {},
                "tokenized_request_count": 0,
                "input_tokens_estimated": 0,
                "output_tokens_estimated": 0,
                "total_tokens_estimated": 0,
            }
            user_rollups[user_id] = current
        else:
            if not current["username"] and username:
                current["username"] = username
            if not current["phone"] and phone:
                current["phone"] = phone
        return current

    for rollup in agent_rollups.values():
        if rollup["bound_user_id"] is None:
            continue
        current = ensure_user_rollup(
            int(rollup["bound_user_id"]),
            username=rollup["username"],
            phone=rollup["phone"],
        )
        current["agent_uids"].add(rollup["agent_uid"])
        current["agent_count"] = len(current["agent_uids"])
        if rollup["is_primary"] and not current["primary_agent_uid"]:
            current["primary_agent_uid"] = rollup["agent_uid"]
        if rollup["latest_activity_at"] and (
            not current["latest_activity_at"] or str(rollup["latest_activity_at"]) > str(current["latest_activity_at"])
        ):
            current["latest_activity_at"] = rollup["latest_activity_at"]

    active_agents_7d: set[int] = set()
    active_users_7d: set[int] = set()
    events_24h = 0
    events_24h_success = 0
    tokenized_requests_24h = 0
    input_tokens_24h = 0
    output_tokens_24h = 0
    total_tokens_24h = 0
    tokenized_requests_window = 0
    input_tokens_window = 0
    output_tokens_window = 0
    total_tokens_window = 0
    discussions_started_window = 0
    discussions_completed_window = 0
    observations_window = 0
    merged_observations_window = 0

    for row in event_rows:
        created_at = _parse_datetime(row.created_at)
        if created_at is None:
            continue

        payload = _json_loads(row.payload_json, {})
        result = _json_loads(row.result_json, {})
        token_usage = _extract_token_usage(result)
        has_token_usage = token_usage["total_tokens_estimated"] > 0
        scene = _infer_event_scene(
            event_type=row.event_type,
            route=row.route,
            payload=payload if isinstance(payload, dict) else {},
            target_type=row.target_type,
            target_id=row.target_id,
            topic_categories=topic_categories,
            post_topic_categories=post_topic_categories,
        )
        agent_id = int(row.openclaw_agent_id) if row.openclaw_agent_id is not None else None
        user_id = int(row.resolved_user_id) if row.resolved_user_id is not None else None
        success = bool(row.success)
        day_bucket = _format_day_bucket(created_at, tz=_OBSERVABILITY_TIMEZONE)
        category = _classify_event_category(row.event_type)

        if created_at >= recent_7d_start:
            if agent_id is not None:
                active_agents_7d.add(agent_id)
            if user_id is not None:
                active_users_7d.add(user_id)

        if created_at >= recent_24h_start:
            events_24h += 1
            if success:
                events_24h_success += 1
            if has_token_usage:
                tokenized_requests_24h += 1
                input_tokens_24h += token_usage["input_tokens_estimated"]
                output_tokens_24h += token_usage["output_tokens_estimated"]
                total_tokens_24h += token_usage["total_tokens_estimated"]

        if created_at >= window_start:
            if day_bucket and day_bucket in trend_map:
                trend_map[day_bucket]["event_count"] += 1
                if not success:
                    trend_map[day_bucket]["failed_event_count"] += 1
                if agent_id is not None:
                    trend_map[day_bucket]["active_agents"].add(agent_id)
                if user_id is not None:
                    trend_map[day_bucket]["active_users"].add(user_id)
                if row.event_type == "discussion.started":
                    trend_map[day_bucket]["discussion_started_count"] += 1
                if row.event_type == "discussion.completed":
                    trend_map[day_bucket]["discussion_completed_count"] += 1
                if has_token_usage:
                    trend_map[day_bucket]["tokenized_request_count"] += 1
                    trend_map[day_bucket]["input_tokens_estimated"] += token_usage["input_tokens_estimated"]
                    trend_map[day_bucket]["output_tokens_estimated"] += token_usage["output_tokens_estimated"]
                    trend_map[day_bucket]["total_tokens_estimated"] += token_usage["total_tokens_estimated"]

            if row.event_type == "discussion.started":
                discussions_started_window += 1
            if row.event_type == "discussion.completed":
                discussions_completed_window += 1
            if has_token_usage:
                tokenized_requests_window += 1
                input_tokens_window += token_usage["input_tokens_estimated"]
                output_tokens_window += token_usage["output_tokens_estimated"]
                total_tokens_window += token_usage["total_tokens_estimated"]

            scene_bucket = scene_map.setdefault(scene, _build_empty_scene_bucket(scene))
            scene_bucket["event_count"] += 1
            if not success:
                scene_bucket["failed_event_count"] += 1
            if agent_id is not None:
                scene_bucket["active_agents"].add(agent_id)
            if user_id is not None:
                scene_bucket["active_users"].add(user_id)

            event_type_bucket = top_event_types.setdefault(
                row.event_type,
                {"event_type": row.event_type, "count": 0, "success_count": 0, "failure_count": 0},
            )
            event_type_bucket["count"] += 1
            if success:
                event_type_bucket["success_count"] += 1
            else:
                event_type_bucket["failure_count"] += 1

            route_key = row.route or "[no-route]"
            route_bucket = top_routes.setdefault(
                route_key,
                {"route": route_key, "count": 0, "failure_count": 0},
            )
            route_bucket["count"] += 1
            if not success:
                route_bucket["failure_count"] += 1

            if agent_id is not None and agent_id in agent_rollups:
                agent_rollup = agent_rollups[agent_id]
                agent_rollup["recent_event_count"] += 1
                if not success:
                    agent_rollup["recent_failure_count"] += 1
                agent_day = _ensure_daily_bucket(agent_rollup["daily_actions"], day_bucket)
                _touch_daily_category(agent_day, category, success=success)
                if day_bucket == today_key:
                    today_active_agents.add(agent_id)
                    agent_rollup["is_today_active"] = True
                    agent_rollup["today_action_total"] += 1
                    agent_rollup["today_categories"][category] += 1
                    today_action_categories[category] += 1
                if has_token_usage:
                    agent_rollup["tokenized_request_count"] += 1
                    agent_rollup["input_tokens_estimated"] += token_usage["input_tokens_estimated"]
                    agent_rollup["output_tokens_estimated"] += token_usage["output_tokens_estimated"]
                    agent_rollup["total_tokens_estimated"] += token_usage["total_tokens_estimated"]

            if user_id is not None:
                user_rollup = ensure_user_rollup(user_id, username=row.username, phone=row.phone)
                user_rollup["recent_event_count"] += 1
                if not success:
                    user_rollup["recent_failure_count"] += 1
                if _to_iso(created_at) > str(user_rollup["latest_activity_at"]):
                    user_rollup["latest_activity_at"] = _to_iso(created_at)
                user_day = _ensure_daily_bucket(user_rollup["daily_actions"], day_bucket)
                _touch_daily_category(user_day, category, success=success)
                if day_bucket == today_key:
                    today_active_users.add(user_id)
                    user_rollup["is_today_active"] = True
                    user_rollup["today_action_total"] += 1
                    user_rollup["today_categories"][category] += 1
                if has_token_usage:
                    user_rollup["tokenized_request_count"] += 1
                    user_rollup["input_tokens_estimated"] += token_usage["input_tokens_estimated"]
                    user_rollup["output_tokens_estimated"] += token_usage["output_tokens_estimated"]
                    user_rollup["total_tokens_estimated"] += token_usage["total_tokens_estimated"]
                if agent_id is not None and agent_id in agent_rollups:
                    user_rollup["agent_uids"].add(agent_rollups[agent_id]["agent_uid"])
                    user_rollup["agent_count"] = len(user_rollup["agent_uids"])
                    if agent_rollups[agent_id]["is_primary"] and not user_rollup["primary_agent_uid"]:
                        user_rollup["primary_agent_uid"] = agent_rollups[agent_id]["agent_uid"]

            if not success and len(failed_events) < 12:
                failed_events.append(
                    {
                        "id": int(row.id),
                        "event_type": row.event_type,
                        "route": row.route,
                        "status_code": row.status_code,
                        "error_code": row.error_code,
                        "agent_uid": row.agent_uid,
                        "display_name": row.display_name,
                        "bound_user_id": user_id,
                        "username": row.username,
                        "created_at": _to_iso(created_at),
                    }
                )

    observations_pending_total = 0
    for row in observation_rows:
        created_at = _parse_datetime(row.created_at)
        if created_at is None:
            continue
        payload = _json_loads(row.payload_json, {})
        scene = str(payload.get("scene") or "").strip() or "unclassified"
        owner_user_id = int(row.owner_user_id)
        merge_status = str(row.merge_status or "")
        agent_rollup = agent_rollups.get(agent_uid_to_id[row.instance_id]) if row.instance_id in agent_uid_to_id else None
        day_bucket = _format_day_bucket(created_at, tz=_OBSERVABILITY_TIMEZONE)

        if merge_status == "pending_review":
            observations_pending_total += 1

        if created_at >= recent_7d_start:
            active_users_7d.add(owner_user_id)
            if agent_rollup is not None:
                active_agents_7d.add(agent_rollup["agent_id"])

        if created_at >= window_start:
            observations_window += 1
            if merge_status == "merged":
                merged_observations_window += 1

            if day_bucket and day_bucket in trend_map:
                trend_map[day_bucket]["observation_count"] += 1
                trend_map[day_bucket]["active_users"].add(owner_user_id)
                if agent_rollup is not None:
                    trend_map[day_bucket]["active_agents"].add(agent_rollup["agent_id"])

            scene_bucket = scene_map.setdefault(scene, _build_empty_scene_bucket(scene))
            scene_bucket["observation_count"] += 1
            if merge_status == "pending_review":
                scene_bucket["pending_observation_count"] += 1
            scene_bucket["active_users"].add(owner_user_id)
            if agent_rollup is not None:
                scene_bucket["active_agents"].add(agent_rollup["agent_id"])
                agent_rollup["recent_observation_count"] += 1
                if merge_status == "pending_review":
                    agent_rollup["pending_observation_count"] += 1
                agent_day = _ensure_daily_bucket(agent_rollup["daily_actions"], day_bucket)
                _touch_daily_category(agent_day, "observation", is_observation=True)
                if day_bucket == today_key:
                    today_active_agents.add(agent_rollup["agent_id"])
                    agent_rollup["is_today_active"] = True
                    agent_rollup["today_action_total"] += 1
                    agent_rollup["today_categories"]["observation"] += 1
                    today_action_categories["observation"] += 1

            user_rollup = ensure_user_rollup(owner_user_id, username=row.username, phone=row.phone)
            user_rollup["recent_observation_count"] += 1
            if merge_status == "pending_review":
                user_rollup["pending_observation_count"] += 1
            created_iso = _to_iso(created_at)
            if created_iso > str(user_rollup["latest_activity_at"]):
                user_rollup["latest_activity_at"] = created_iso
            user_day = _ensure_daily_bucket(user_rollup["daily_actions"], day_bucket)
            _touch_daily_category(user_day, "observation", is_observation=True)
            if day_bucket == today_key:
                today_active_users.add(owner_user_id)
                user_rollup["is_today_active"] = True
                user_rollup["today_action_total"] += 1
                user_rollup["today_categories"]["observation"] += 1

    for rollup in agent_rollups.values():
        latest_activity_dt = _parse_datetime(rollup["latest_activity_at"])
        inactivity_days = (now - latest_activity_dt).days if latest_activity_dt else None
        rollup["inactivity_days"] = inactivity_days

        if rollup["status"] != "active":
            rollup["risk_score"] += 1
            rollup["risk_reasons"].append(f"status={rollup['status']}")
        if rollup["recent_failure_count"] >= 3:
            rollup["risk_score"] += 3
            rollup["risk_reasons"].append(f"{rollup['recent_failure_count']} recent failures")
        elif rollup["recent_failure_count"] >= 1:
            rollup["risk_score"] += 1
            rollup["risk_reasons"].append(f"{rollup['recent_failure_count']} recent failure")
        if rollup["pending_observation_count"] >= 3:
            rollup["risk_score"] += 2
            rollup["risk_reasons"].append(f"{rollup['pending_observation_count']} pending observations")
        elif rollup["pending_observation_count"] >= 1:
            rollup["risk_score"] += 1
            rollup["risk_reasons"].append("has pending observations")
        if inactivity_days is not None and rollup["lifetime_event_count"] >= 3 and inactivity_days >= 14:
            rollup["risk_score"] += 2
            rollup["risk_reasons"].append(f"inactive for {inactivity_days} days")
        elif inactivity_days is not None and rollup["lifetime_event_count"] >= 3 and inactivity_days >= 7:
            rollup["risk_score"] += 1
            rollup["risk_reasons"].append(f"cooling down for {inactivity_days} days")
        if rollup["bound_user_id"] is None and rollup["recent_event_count"] >= 2:
            rollup["risk_score"] += 1
            rollup["risk_reasons"].append("active but unbound to a user")

        if rollup["risk_score"] >= 4:
            rollup["risk_level"] = "high"
        elif rollup["risk_score"] >= 2:
            rollup["risk_level"] = "medium"
        elif rollup["risk_score"] >= 1:
            rollup["risk_level"] = "low"
        else:
            rollup["risk_level"] = "stable"

    trends = []
    for point in trend_map.values():
        trends.append(
            {
                "date": point["date"],
                "event_count": point["event_count"],
                "failed_event_count": point["failed_event_count"],
                "observation_count": point["observation_count"],
                "discussion_started_count": point["discussion_started_count"],
                "discussion_completed_count": point["discussion_completed_count"],
                "tokenized_request_count": point["tokenized_request_count"],
                "input_tokens_estimated": point["input_tokens_estimated"],
                "output_tokens_estimated": point["output_tokens_estimated"],
                "total_tokens_estimated": point["total_tokens_estimated"],
                "active_agents": _finalize_count_set(point["active_agents"]),
                "active_users": _finalize_count_set(point["active_users"]),
            }
        )

    scenes = [
        {
            "scene": scene,
            "event_count": bucket["event_count"],
            "failed_event_count": bucket["failed_event_count"],
            "observation_count": bucket["observation_count"],
            "pending_observation_count": bucket["pending_observation_count"],
            "active_agents": _finalize_count_set(bucket["active_agents"]),
            "active_users": _finalize_count_set(bucket["active_users"]),
        }
        for scene, bucket in sorted(
            scene_map.items(),
            key=lambda item: (
                item[1]["event_count"] + item[1]["observation_count"],
                item[1]["failed_event_count"] + item[1]["pending_observation_count"],
            ),
            reverse=True,
        )
    ]

    daily_openclaw_actions = [
        {
            "agent_uid": rollup["agent_uid"],
            "display_name": rollup["display_name"],
            "handle": rollup["handle"],
            "status": rollup["status"],
            "bound_user_id": rollup["bound_user_id"],
            "username": rollup["username"],
            "phone": rollup["phone"],
            "is_today_active": bool(rollup["is_today_active"]),
            "today_action_total": int(rollup["today_action_total"]),
            "today_categories": _serialize_action_categories(rollup["today_categories"]),
            "recent_event_count": int(rollup["recent_event_count"]),
            "recent_failure_count": int(rollup["recent_failure_count"]),
            "recent_observation_count": int(rollup["recent_observation_count"]),
            "latest_activity_at": rollup["latest_activity_at"],
            "tokenized_request_count": int(rollup["tokenized_request_count"]),
            "input_tokens_estimated": int(rollup["input_tokens_estimated"]),
            "output_tokens_estimated": int(rollup["output_tokens_estimated"]),
            "total_tokens_estimated": int(rollup["total_tokens_estimated"]),
            "days": _finalize_daily_series(rollup["daily_actions"], ordered_day_keys),
        }
        for rollup in sorted(
            agent_rollups.values(),
            key=lambda item: (
                item["today_action_total"],
                item["recent_event_count"] + item["recent_observation_count"],
                item["recent_failure_count"],
                item["latest_activity_at"] or "",
            ),
            reverse=True,
        )
        if rollup["today_action_total"] > 0 or rollup["recent_event_count"] > 0 or rollup["recent_observation_count"] > 0
    ]

    daily_user_actions = [
        {
            "user_id": rollup["user_id"],
            "username": rollup["username"],
            "phone": rollup["phone"],
            "agent_count": len(rollup["agent_uids"]),
            "primary_agent_uid": rollup["primary_agent_uid"],
            "is_today_active": bool(rollup["is_today_active"]),
            "today_action_total": int(rollup["today_action_total"]),
            "today_categories": _serialize_action_categories(rollup["today_categories"]),
            "recent_event_count": int(rollup["recent_event_count"]),
            "recent_failure_count": int(rollup["recent_failure_count"]),
            "recent_observation_count": int(rollup["recent_observation_count"]),
            "latest_activity_at": rollup["latest_activity_at"],
            "tokenized_request_count": int(rollup["tokenized_request_count"]),
            "input_tokens_estimated": int(rollup["input_tokens_estimated"]),
            "output_tokens_estimated": int(rollup["output_tokens_estimated"]),
            "total_tokens_estimated": int(rollup["total_tokens_estimated"]),
            "days": _finalize_daily_series(rollup["daily_actions"], ordered_day_keys),
        }
        for rollup in sorted(
            user_rollups.values(),
            key=lambda item: (
                item["today_action_total"],
                item["recent_event_count"] + item["recent_observation_count"],
                item["recent_failure_count"],
                item["latest_activity_at"] or "",
            ),
            reverse=True,
        )
        if rollup["today_action_total"] > 0 or rollup["recent_event_count"] > 0 or rollup["recent_observation_count"] > 0
    ]

    risk_agents = [
        {
            "agent_uid": rollup["agent_uid"],
            "display_name": rollup["display_name"],
            "handle": rollup["handle"],
            "status": rollup["status"],
            "bound_user_id": rollup["bound_user_id"],
            "username": rollup["username"],
            "phone": rollup["phone"],
            "points_balance": rollup["points_balance"],
            "recent_event_count": rollup["recent_event_count"],
            "recent_failure_count": rollup["recent_failure_count"],
            "recent_observation_count": rollup["recent_observation_count"],
            "pending_observation_count": rollup["pending_observation_count"],
            "tokenized_request_count": int(rollup["tokenized_request_count"]),
            "input_tokens_estimated": int(rollup["input_tokens_estimated"]),
            "output_tokens_estimated": int(rollup["output_tokens_estimated"]),
            "total_tokens_estimated": int(rollup["total_tokens_estimated"]),
            "lifetime_event_count": rollup["lifetime_event_count"],
            "last_seen_at": rollup["last_seen_at"],
            "latest_activity_at": rollup["latest_activity_at"],
            "inactivity_days": rollup["inactivity_days"],
            "risk_level": rollup["risk_level"],
            "risk_reasons": rollup["risk_reasons"],
        }
        for rollup in sorted(
            agent_rollups.values(),
            key=lambda item: (item["risk_score"], item["recent_failure_count"], item["recent_event_count"], item["lifetime_event_count"]),
            reverse=True,
        )
        if rollup["risk_score"] > 0
    ][:10]

    active_users = [
        {
            "user_id": rollup["user_id"],
            "username": rollup["username"],
            "phone": rollup["phone"],
            "agent_count": len(rollup["agent_uids"]),
            "primary_agent_uid": rollup["primary_agent_uid"],
            "recent_event_count": rollup["recent_event_count"],
            "recent_failure_count": rollup["recent_failure_count"],
            "recent_observation_count": rollup["recent_observation_count"],
            "pending_observation_count": rollup["pending_observation_count"],
            "latest_activity_at": rollup["latest_activity_at"],
            "tokenized_request_count": int(rollup["tokenized_request_count"]),
            "input_tokens_estimated": int(rollup["input_tokens_estimated"]),
            "output_tokens_estimated": int(rollup["output_tokens_estimated"]),
            "total_tokens_estimated": int(rollup["total_tokens_estimated"]),
        }
        for rollup in sorted(
            user_rollups.values(),
            key=lambda item: (
                item["recent_event_count"] + item["recent_observation_count"],
                item["recent_failure_count"],
                item["pending_observation_count"],
            ),
            reverse=True,
        )
        if rollup["recent_event_count"] > 0 or rollup["recent_observation_count"] > 0
    ][:12]

    overview = {
        "total_agents": len(agent_rollups),
        "bound_agents": len([item for item in agent_rollups.values() if item["bound_user_id"] is not None]),
        "bound_ratio": round(
            len([item for item in agent_rollups.values() if item["bound_user_id"] is not None]) / max(len(agent_rollups), 1),
            4,
        ),
        "total_users_with_openclaw": len({item["bound_user_id"] for item in agent_rollups.values() if item["bound_user_id"] is not None}),
        "active_agents_7d": len(active_agents_7d),
        "active_users_7d": len(active_users_7d),
        "active_agents_today": len(today_active_agents),
        "active_users_today": len(today_active_users),
        "new_agents_window": len(
            [
                item
                for item in agent_rollups.values()
                if (created_at := _parse_datetime(item["created_at"])) is not None and created_at >= window_start
            ]
        ),
        "events_24h": events_24h,
        "success_rate_24h": round(events_24h_success / max(events_24h, 1), 4),
        "tokenized_requests_24h": tokenized_requests_24h,
        "input_tokens_24h": input_tokens_24h,
        "output_tokens_24h": output_tokens_24h,
        "total_tokens_24h": total_tokens_24h,
        "events_window": sum(point["event_count"] for point in trends),
        "failed_events_window": sum(point["failed_event_count"] for point in trends),
        "tokenized_requests_window": tokenized_requests_window,
        "input_tokens_window": input_tokens_window,
        "output_tokens_window": output_tokens_window,
        "total_tokens_window": total_tokens_window,
        "avg_tokens_per_request_24h": round(total_tokens_24h / max(tokenized_requests_24h, 1), 1),
        "avg_tokens_per_request_window": round(total_tokens_window / max(tokenized_requests_window, 1), 1),
        "discussions_started_window": discussions_started_window,
        "discussions_completed_window": discussions_completed_window,
        "discussion_completion_rate": round(discussions_completed_window / max(discussions_started_window, 1), 4),
        "observations_window": observations_window,
        "merged_observations_window": merged_observations_window,
        "pending_observations_total": observations_pending_total,
        "risk_agents": len([item for item in agent_rollups.values() if item["risk_level"] in {"high", "medium"}]),
    }

    return {
        "generated_at": _to_iso(now),
        "window_days": safe_window_days,
        "timezone": str(_OBSERVABILITY_TIMEZONE),
        "today_date": today_key,
        "activity_rules": {
            "openclaw": f"OpenClaw 在 {today_key}（{_OBSERVABILITY_TIMEZONE}）自然日内，至少产生 1 条动作事件或 1 条画像 observation。",
            "user": f"用户在 {today_key}（{_OBSERVABILITY_TIMEZONE}）自然日内，任一绑定 OpenClaw 产生动作事件，或该用户拥有的 Twin 收到 1 条 observation。",
        },
        "today_summary": {
            "date": today_key,
            "active_agents": len(today_active_agents),
            "active_users": len(today_active_users),
            "action_total": int(sum(today_action_categories.values())),
            "categories": _build_category_cards(today_action_categories),
        },
        "overview": overview,
        "trends": trends,
        "scenes": scenes,
        "action_category_labels": _ACTION_CATEGORY_LABELS,
        "top_event_types": [
            item
            for item in sorted(
                top_event_types.values(),
                key=lambda value: (int(value["count"]), int(value["failure_count"])),
                reverse=True,
            )[:10]
        ],
        "top_routes": [
            item
            for item in sorted(
                top_routes.values(),
                key=lambda value: (int(value["count"]), int(value["failure_count"])),
                reverse=True,
            )[:10]
        ],
        "top_token_agents": [
            {
                "agent_uid": rollup["agent_uid"],
                "display_name": rollup["display_name"],
                "handle": rollup["handle"],
                "bound_user_id": rollup["bound_user_id"],
                "username": rollup["username"],
                "phone": rollup["phone"],
                "tokenized_request_count": int(rollup["tokenized_request_count"]),
                "input_tokens_estimated": int(rollup["input_tokens_estimated"]),
                "output_tokens_estimated": int(rollup["output_tokens_estimated"]),
                "total_tokens_estimated": int(rollup["total_tokens_estimated"]),
                "avg_tokens_per_request": round(
                    int(rollup["total_tokens_estimated"]) / max(int(rollup["tokenized_request_count"]), 1),
                    1,
                ),
                "latest_activity_at": rollup["latest_activity_at"],
            }
            for rollup in sorted(
                agent_rollups.values(),
                key=lambda item: (
                    int(item["total_tokens_estimated"]),
                    int(item["tokenized_request_count"]),
                    int(item["recent_event_count"]),
                ),
                reverse=True,
            )
            if int(rollup["total_tokens_estimated"]) > 0
        ][:12],
        "risk_agents": risk_agents,
        "active_users": active_users,
        "daily_openclaw_actions": daily_openclaw_actions,
        "daily_user_actions": daily_user_actions,
        "failed_events": failed_events,
    }


@router.get("/openclaw/agents", response_model=PagedResponse)
async def list_admin_openclaw_agents(
    q: str | None = None,
    status: str | None = None,
    limit: int = 20,
    offset: int = 0,
    _: dict[str, Any] = Depends(require_admin_panel),
):
    return PagedResponse(**list_openclaw_agents(q=q, status=status, limit=limit, offset=offset))


@router.get("/openclaw/agents/{agent_uid}")
async def get_admin_openclaw_agent(
    agent_uid: str,
    _: dict[str, Any] = Depends(require_admin_panel),
):
    agent = get_openclaw_agent_by_uid(agent_uid)
    if not agent:
        raise HTTPException(status_code=404, detail="OpenClaw 身份不存在")
    return {"agent": agent}


@router.get("/openclaw/agents/{agent_uid}/events", response_model=PagedResponse)
async def get_admin_openclaw_agent_events(
    agent_uid: str,
    event_type: str | None = None,
    limit: int = 20,
    offset: int = 0,
    _: dict[str, Any] = Depends(require_admin_panel),
):
    return PagedResponse(**list_openclaw_events(agent_uid=agent_uid, event_type=event_type, limit=limit, offset=offset))


@router.get("/openclaw/agents/{agent_uid}/points/ledger", response_model=PagedResponse)
async def get_admin_openclaw_agent_points(
    agent_uid: str,
    limit: int = 20,
    offset: int = 0,
    _: dict[str, Any] = Depends(require_admin_panel),
):
    payload = list_openclaw_point_ledger(agent_uid=agent_uid, limit=limit, offset=offset)
    if payload is None:
        raise HTTPException(status_code=404, detail="OpenClaw 身份不存在")
    return PagedResponse(**payload)


@router.post("/openclaw/agents/{agent_uid}/points/adjust")
async def adjust_admin_openclaw_points(
    agent_uid: str,
    req: AdminOpenClawPointsAdjustRequest,
    x_forwarded_for: str | None = Header(default=None, alias="X-Forwarded-For"),
    _: dict[str, Any] = Depends(require_admin_panel),
):
    payload = admin_adjust_points(agent_uid=agent_uid, delta=req.delta, note=req.note)
    if payload is None:
        raise HTTPException(status_code=404, detail="OpenClaw 身份不存在")
    with get_db_session() as session:
        _write_audit_log(
            session=session,
            action="adjust_points",
            target_type="openclaw_agent",
            target_id=agent_uid,
            detail=f"delta={req.delta};note={req.note[:200]}",
            client_ip=x_forwarded_for,
        )
    return payload


@router.post("/openclaw/agents/{agent_uid}/suspend")
async def suspend_admin_openclaw_agent(
    agent_uid: str,
    req: AdminOpenClawSuspendRequest,
    x_forwarded_for: str | None = Header(default=None, alias="X-Forwarded-For"),
    _: dict[str, Any] = Depends(require_admin_panel),
):
    payload = suspend_openclaw_agent(agent_uid=agent_uid, reason=req.reason)
    if payload is None:
        raise HTTPException(status_code=404, detail="OpenClaw 身份不存在")
    with get_db_session() as session:
        _write_audit_log(
            session=session,
            action="suspend",
            target_type="openclaw_agent",
            target_id=agent_uid,
            detail=f"reason={req.reason[:200]}",
            client_ip=x_forwarded_for,
        )
    return payload


@router.post("/openclaw/agents/{agent_uid}/restore")
async def restore_admin_openclaw_agent(
    agent_uid: str,
    x_forwarded_for: str | None = Header(default=None, alias="X-Forwarded-For"),
    _: dict[str, Any] = Depends(require_admin_panel),
):
    payload = restore_openclaw_agent(agent_uid=agent_uid)
    if payload is None:
        raise HTTPException(status_code=404, detail="OpenClaw 身份不存在")
    with get_db_session() as session:
        _write_audit_log(
            session=session,
            action="restore",
            target_type="openclaw_agent",
            target_id=agent_uid,
            detail="",
            client_ip=x_forwarded_for,
        )
    return payload


@router.get("/openclaw/events", response_model=PagedResponse)
async def list_admin_openclaw_events(
    agent_uid: str | None = None,
    event_type: str | None = None,
    q: str | None = None,
    bound_user_id: int | None = None,
    openclaw_agent_id: int | None = None,
    limit: int = 20,
    offset: int = 0,
    _: dict[str, Any] = Depends(require_admin_panel),
):
    return PagedResponse(
        **list_openclaw_events(
            agent_uid=agent_uid,
            event_type=event_type,
            q=q,
            bound_user_id=bound_user_id,
            openclaw_agent_id=openclaw_agent_id,
            limit=limit,
            offset=offset,
        )
    )


@router.get("/twins/observations", response_model=PagedResponse)
async def list_admin_twin_observations(
    q: str | None = None,
    observation_type: str | None = None,
    merge_status: str | None = None,
    topic: str | None = None,
    explicitness: str | None = None,
    scope: str | None = None,
    scene: str | None = None,
    limit: int = 20,
    offset: int = 0,
    _: dict[str, Any] = Depends(require_admin_panel),
):
    return PagedResponse(
        **list_admin_observations(
            q=q,
            observation_type=observation_type,
            merge_status=merge_status,
            topic=topic,
            explicitness=explicitness,
            scope=scope,
            scene=scene,
            limit=limit,
            offset=offset,
        )
    )


@router.get("/feedback", response_model=PagedResponse)
async def list_admin_feedback(
    q: str | None = None,
    sort_by: str | None = None,
    sort_order: str | None = None,
    limit: int = 20,
    offset: int = 0,
    _: dict[str, Any] = Depends(require_admin_panel),
):
    _ensure_admin_schema_once()
    clean_q, like_q = _normalized_like(q)
    safe_limit = max(1, min(limit, 100))
    safe_offset = max(offset, 0)
    order_by = _resolve_sort_clause(
        sort_by,
        sort_order,
        {
            "id": "f.id",
            "user_id": "f.user_id",
            "username": "COALESCE(f.username, '')",
            "auth_channel": "f.auth_channel",
            "created_at": "f.created_at",
        },
        "f.created_at DESC, f.id DESC",
    )
    with get_db_session() as session:
        total = int(
            session.execute(
                text(
                    """
                    SELECT COUNT(*)
                    FROM site_feedback f
                    WHERE (
                        :q = ''
                        OR LOWER(COALESCE(f.username, '')) LIKE :like_q
                        OR LOWER(COALESCE(f.scenario, '')) LIKE :like_q
                        OR LOWER(COALESCE(f.body, '')) LIKE :like_q
                        OR LOWER(COALESCE(f.page_url, '')) LIKE :like_q
                    )
                    """
                ),
                {"q": clean_q, "like_q": like_q},
            ).scalar_one()
        )
        rows = session.execute(
            text(
                f"""
                SELECT
                    id,
                    user_id,
                    username,
                    auth_channel,
                    scenario,
                    body,
                    steps_to_reproduce,
                    page_url,
                    client_user_agent,
                    created_at
                FROM site_feedback f
                WHERE (
                    :q = ''
                    OR LOWER(COALESCE(f.username, '')) LIKE :like_q
                    OR LOWER(COALESCE(f.scenario, '')) LIKE :like_q
                    OR LOWER(COALESCE(f.body, '')) LIKE :like_q
                    OR LOWER(COALESCE(f.page_url, '')) LIKE :like_q
                )
                ORDER BY {order_by}, f.id DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {"q": clean_q, "like_q": like_q, "limit": safe_limit, "offset": safe_offset},
        ).fetchall()
    items = [
        {
            "id": int(row[0]),
            "user_id": int(row[1]) if row[1] is not None else None,
            "username": row[2],
            "auth_channel": row[3],
            "scenario": row[4],
            "body": row[5],
            "steps_to_reproduce": row[6],
            "page_url": row[7],
            "client_user_agent": row[8],
            "created_at": _to_iso(row[9]),
        }
        for row in rows
    ]
    return PagedResponse(items=items, total=total, limit=safe_limit, offset=safe_offset)


@router.patch("/feedback/{feedback_id}")
async def update_admin_feedback(
    feedback_id: int,
    req: AdminFeedbackUpdateRequest,
    x_forwarded_for: str | None = Header(default=None, alias="X-Forwarded-For"),
    _: dict[str, Any] = Depends(require_admin_panel),
):
    _ensure_admin_schema_once()
    updates: dict[str, Any] = {}
    if req.scenario is not None:
        updates["scenario"] = req.scenario
    if req.body is not None:
        updates["body"] = req.body
    if req.steps_to_reproduce is not None:
        updates["steps_to_reproduce"] = req.steps_to_reproduce
    if req.page_url is not None:
        updates["page_url"] = req.page_url.strip() or None
    _ensure_mutation_payload(updates)
    updates["id"] = feedback_id
    set_clauses = ", ".join(f"{field} = :{field}" for field in updates if field != "id")
    with get_db_session() as session:
        row = session.execute(
            text(
                f"""
                UPDATE site_feedback
                SET {set_clauses}
                WHERE id = :id
                RETURNING id, user_id, username, auth_channel, scenario, body, steps_to_reproduce, page_url, client_user_agent, created_at
                """
            ),
            updates,
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="反馈不存在")
        _write_audit_log(
            session=session,
            action="update",
            target_type="feedback",
            target_id=str(feedback_id),
            detail=f"fields={','.join(sorted(k for k in updates.keys() if k != 'id'))}",
            client_ip=x_forwarded_for,
        )
    return {
        "item": {
            "id": int(row[0]),
            "user_id": int(row[1]) if row[1] is not None else None,
            "username": row[2],
            "auth_channel": row[3],
            "scenario": row[4],
            "body": row[5],
            "steps_to_reproduce": row[6],
            "page_url": row[7],
            "client_user_agent": row[8],
            "created_at": _to_iso(row[9]),
        }
    }


@router.delete("/feedback/{feedback_id}")
async def delete_admin_feedback(
    feedback_id: int,
    x_forwarded_for: str | None = Header(default=None, alias="X-Forwarded-For"),
    _: dict[str, Any] = Depends(require_admin_panel),
):
    _ensure_admin_schema_once()
    with get_db_session() as session:
        row = session.execute(
            text("SELECT username, body FROM site_feedback WHERE id = :id"),
            {"id": feedback_id},
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="反馈不存在")
        session.execute(text("DELETE FROM site_feedback WHERE id = :id"), {"id": feedback_id})
        _write_audit_log(
            session=session,
            action="delete",
            target_type="feedback",
            target_id=str(feedback_id),
            detail=f"username={row[0] or ''};body_preview={(row[1] or '')[:120]}",
            client_ip=x_forwarded_for,
        )
    return {"ok": True, "feedback_id": feedback_id}
