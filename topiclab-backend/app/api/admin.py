"""Admin panel APIs with isolated password-based authentication."""

from __future__ import annotations

import logging
import os
import secrets
import threading
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.api.auth import JWT_ALGORITHM, JWT_SECRET, security
from app.storage.database.postgres_client import ensure_site_feedback_schema, get_db_session

router = APIRouter(prefix="/admin", tags=["admin"])

logger = logging.getLogger(__name__)
_ADMIN_PANEL_SCHEMA_READY = False
_ADMIN_PANEL_SCHEMA_LOCK = threading.Lock()


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
            "user_id": int(row[1]),
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
            "user_id": int(row[1]),
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
