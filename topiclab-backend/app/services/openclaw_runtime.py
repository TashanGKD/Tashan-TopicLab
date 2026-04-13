"""OpenClaw identity, points, and audit helpers."""

from __future__ import annotations

import hashlib
import json
import secrets
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from app.storage.database.postgres_client import get_db_session

AGENT_STATUS_ACTIVE = "active"
AGENT_STATUS_SUSPENDED = "suspended"
AGENT_STATUS_ARCHIVED = "archived"
KEY_STATUS_ACTIVE = "active"
KEY_STATUS_REVOKED = "revoked"

POINT_RULES = {
    "topic.created": 1,
    "post.created": 1,
    "topic.liked.received": 5,
    "post.liked.received": 2,
    "topic.favorited.received": 3,
    "source.favorited.received": 2,
    "discussion.completed": 2,
    "moderation.removed_spam": -10,
    "skill_publish": 12,
    "skill_version_publish": 4,
    "skill_review_create": 3,
    "skill_review_helpful_received": 1,
    "skill_wish_create": 2,
    "skill_download_spend": -5,
    "skill_referral_reward": 5,
}


def _to_iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return value.isoformat()


def _json_dumps(value: Any) -> str:
    return json.dumps(value or {}, ensure_ascii=False)


def _json_loads(value: Any, default: Any):
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return default


def _slugify_handle_seed(value: str) -> str:
    cleaned = []
    prev_sep = False
    for ch in (value or "").strip().lower():
        if ch.isalnum() or ch == "_":
            cleaned.append(ch)
            prev_sep = False
        elif not prev_sep:
            cleaned.append("_")
            prev_sep = True
    result = "".join(cleaned).strip("_")
    return (result or "openclaw")[:32]


def _default_agent_display_name(username: str | None, phone: str | None) -> str:
    base = (username or phone or "openclaw").strip()
    return f"{base}'s openclaw"


def _build_agent_handle(username: str | None, phone: str | None) -> str:
    raw_seed = (username or "").strip()
    if raw_seed:
        seed = _slugify_handle_seed(raw_seed)
    else:
        seed = f"openclaw_{(phone or 'anon')[-4:]}"
    return f"{seed}_openclaw"[:50]


def _build_agent_summary(row) -> dict[str, Any]:
    return {
        "id": int(row.id),
        "agent_uid": row.agent_uid,
        "display_name": row.display_name,
        "handle": row.handle,
        "skill_token": getattr(row, "skill_token", None),
        "status": row.status,
        "bound_user_id": int(row.bound_user_id) if row.bound_user_id is not None else None,
        "is_primary": bool(row.is_primary),
        "profile_json": _json_loads(getattr(row, "profile_json", None), {}),
        "created_at": _to_iso(row.created_at),
        "updated_at": _to_iso(row.updated_at),
        "last_seen_at": _to_iso(getattr(row, "last_seen_at", None)),
    }


def _build_wallet_summary(row) -> dict[str, Any]:
    return {
        "balance": int(row.balance or 0),
        "lifetime_earned": int(row.lifetime_earned or 0),
        "lifetime_spent": int(row.lifetime_spent or 0),
        "updated_at": _to_iso(row.updated_at),
    }


def _generate_agent_uid() -> str:
    return f"oc_{secrets.token_hex(8)}"


def _generate_skill_token() -> str:
    return f"tlos_{secrets.token_urlsafe(9).rstrip('=')}"


def ensure_primary_openclaw_agent(
    user_id: int,
    *,
    username: str | None = None,
    phone: str | None = None,
    session=None,
) -> dict[str, Any]:
    owns_session = session is None
    if owns_session:
        ctx = get_db_session()
        session = ctx.__enter__()
    try:
        row = session.execute(
            text(
                """
                SELECT *
                FROM openclaw_agents
                WHERE bound_user_id = :user_id AND is_primary = TRUE
                ORDER BY id ASC
                LIMIT 1
                """
            ),
            {"user_id": user_id},
        ).fetchone()
        now = datetime.now(timezone.utc)
        if row is None:
            display_name = _default_agent_display_name(username, phone)
            handle = _build_agent_handle(username, phone)
            inserted = session.execute(
                text(
                    """
                    INSERT INTO openclaw_agents (
                        agent_uid, display_name, handle, status, bound_user_id, is_primary, skill_token, profile_json, created_at, updated_at, last_seen_at
                    ) VALUES (
                        :agent_uid, :display_name, :handle, :status, :bound_user_id, TRUE, :skill_token, :profile_json, :created_at, :updated_at, NULL
                    )
                    RETURNING *
                    """
                ),
                {
                    "agent_uid": _generate_agent_uid(),
                    "display_name": display_name,
                    "handle": handle,
                    "status": AGENT_STATUS_ACTIVE,
                    "bound_user_id": user_id,
                    "skill_token": _generate_skill_token(),
                    "profile_json": _json_dumps({}),
                    "created_at": now,
                    "updated_at": now,
                },
            ).fetchone()
            session.execute(
                text(
                    """
                    INSERT INTO openclaw_wallets (
                        openclaw_agent_id, balance, lifetime_earned, lifetime_spent, updated_at
                    ) VALUES (
                        :openclaw_agent_id, 0, 0, 0, :updated_at
                    )
                    ON CONFLICT (openclaw_agent_id) DO NOTHING
                    """
                ),
                {"openclaw_agent_id": inserted.id, "updated_at": now},
            )
            row = inserted
        elif not getattr(row, "skill_token", None):
            session.execute(
                text(
                    """
                    UPDATE openclaw_agents
                    SET skill_token = :skill_token,
                        updated_at = :updated_at
                    WHERE id = :id
                    """
                ),
                {"id": row.id, "skill_token": _generate_skill_token(), "updated_at": now},
            )
            row = session.execute(
                text("SELECT * FROM openclaw_agents WHERE id = :id"),
                {"id": row.id},
            ).fetchone()
        return _build_agent_summary(row)
    finally:
        if owns_session:
            ctx.__exit__(None, None, None)


def get_openclaw_agent_by_uid(agent_uid: str) -> dict[str, Any] | None:
    with get_db_session() as session:
        row = session.execute(
            text("SELECT * FROM openclaw_agents WHERE agent_uid = :agent_uid"),
            {"agent_uid": agent_uid},
        ).fetchone()
    if not row:
        return None
    return _build_agent_summary(row)


def get_openclaw_agent_by_id(agent_id: int) -> dict[str, Any] | None:
    with get_db_session() as session:
        row = session.execute(
            text("SELECT * FROM openclaw_agents WHERE id = :agent_id"),
            {"agent_id": agent_id},
        ).fetchone()
    if not row:
        return None
    return _build_agent_summary(row)


def get_primary_openclaw_agent_for_user(user_id: int) -> dict[str, Any] | None:
    with get_db_session() as session:
        row = session.execute(
            text(
                """
                SELECT *
                FROM openclaw_agents
                WHERE bound_user_id = :user_id AND is_primary = TRUE
                LIMIT 1
                """
            ),
            {"user_id": user_id},
        ).fetchone()
    if not row:
        return None
    return _build_agent_summary(row)


def get_openclaw_agent_by_skill_token(skill_token: str) -> dict[str, Any] | None:
    with get_db_session() as session:
        row = session.execute(
            text("SELECT * FROM openclaw_agents WHERE skill_token = :skill_token LIMIT 1"),
            {"skill_token": skill_token},
        ).fetchone()
    if not row:
        return None
    return _build_agent_summary(row)


def get_wallet_by_agent_id(agent_id: int) -> dict[str, Any]:
    with get_db_session() as session:
        row = session.execute(
            text(
                """
                INSERT INTO openclaw_wallets (openclaw_agent_id, balance, lifetime_earned, lifetime_spent, updated_at)
                VALUES (:openclaw_agent_id, 0, 0, 0, :updated_at)
                ON CONFLICT (openclaw_agent_id) DO NOTHING
                """
            ),
            {"openclaw_agent_id": agent_id, "updated_at": datetime.now(timezone.utc)},
        )
        _ = row
        wallet = session.execute(
            text("SELECT * FROM openclaw_wallets WHERE openclaw_agent_id = :agent_id"),
            {"agent_id": agent_id},
        ).fetchone()
    return _build_wallet_summary(wallet)


def get_wallet_by_agent_uid(agent_uid: str) -> dict[str, Any] | None:
    agent = get_openclaw_agent_by_uid(agent_uid)
    if not agent:
        return None
    return get_wallet_by_agent_id(int(agent["id"]))


def get_openclaw_key_record(user_id: int) -> dict[str, Any] | None:
    agent = get_primary_openclaw_agent_for_user(user_id)
    if not agent:
        return None
    with get_db_session() as session:
        row = session.execute(
            text(
                """
                SELECT id, token_prefix, created_at, last_used_at
                FROM openclaw_api_keys
                WHERE bound_user_id = :user_id
                  AND openclaw_agent_id = :openclaw_agent_id
                  AND status = :status
                ORDER BY id DESC
                LIMIT 1
                """
            ),
            {
                "user_id": user_id,
                "openclaw_agent_id": int(agent["id"]),
                "status": KEY_STATUS_ACTIVE,
            },
        ).fetchone()
    if not row:
        return None
    return {
        "key_id": int(row.id),
        "masked_key": row.token_prefix,
        "created_at": _to_iso(row.created_at),
        "last_used_at": _to_iso(row.last_used_at),
        "agent_uid": agent["agent_uid"],
        "openclaw_agent": {
            "agent_uid": agent["agent_uid"],
            "display_name": agent["display_name"],
            "handle": agent["handle"],
            "status": agent["status"],
        },
    }


def ensure_active_openclaw_key_for_user(
    user_id: int,
    *,
    username: str | None = None,
    phone: str | None = None,
) -> dict[str, Any]:
    with get_db_session() as session:
        agent = ensure_primary_openclaw_agent(user_id, username=username, phone=phone, session=session)
        row = session.execute(
            text(
                """
                SELECT id, token_value, token_prefix, created_at, last_used_at
                FROM openclaw_api_keys
                WHERE bound_user_id = :user_id
                  AND openclaw_agent_id = :openclaw_agent_id
                  AND status = :status
                ORDER BY id DESC
                LIMIT 1
                """
            ),
            {
                "user_id": user_id,
                "openclaw_agent_id": int(agent["id"]),
                "status": KEY_STATUS_ACTIVE,
            },
        ).fetchone()
        if row and row.token_value:
            return {
                "has_key": True,
                "key_id": int(row.id),
                "key": row.token_value,
                "masked_key": row.token_prefix,
                "created_at": _to_iso(row.created_at),
                "last_used_at": _to_iso(row.last_used_at),
                "agent_uid": agent["agent_uid"],
                "openclaw_agent": {
                    "agent_uid": agent["agent_uid"],
                    "display_name": agent["display_name"],
                    "handle": agent["handle"],
                    "status": agent["status"],
                },
            }
    return create_or_rotate_openclaw_key_for_user(user_id, username=username, phone=phone)


def create_or_rotate_openclaw_key_for_user(
    user_id: int,
    *,
    username: str | None = None,
    phone: str | None = None,
) -> dict[str, Any]:
    raw_key = f"tloc_{secrets.token_urlsafe(24)}"
    token_hash = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()
    token_prefix = f"{raw_key[:12]}..."
    now = datetime.now(timezone.utc)
    with get_db_session() as session:
        agent = ensure_primary_openclaw_agent(user_id, username=username, phone=phone, session=session)
        session.execute(
            text(
                """
                UPDATE openclaw_api_keys
                SET status = :revoked_status,
                    revoked_at = :revoked_at,
                    revoked_reason = :revoked_reason,
                    updated_at = :updated_at
                WHERE openclaw_agent_id = :openclaw_agent_id
                  AND status = :active_status
                """
            ),
            {
                "openclaw_agent_id": int(agent["id"]),
                "revoked_status": KEY_STATUS_REVOKED,
                "revoked_at": now,
                "revoked_reason": "rotated",
                "updated_at": now,
                "active_status": KEY_STATUS_ACTIVE,
            },
        )
        row = session.execute(
            text(
                """
                INSERT INTO openclaw_api_keys (
                    openclaw_agent_id,
                    bound_user_id,
                    token_value,
                    token_hash,
                    token_prefix,
                    status,
                    created_at,
                    updated_at,
                    last_used_at,
                    expires_at,
                    revoked_at,
                    revoked_reason,
                    rotated_from_key_id
                ) VALUES (
                    :openclaw_agent_id,
                    :bound_user_id,
                    :token_value,
                    :token_hash,
                    :token_prefix,
                    :status,
                    :created_at,
                    :updated_at,
                    NULL,
                    NULL,
                    NULL,
                    NULL,
                    NULL
                )
                RETURNING id
                """
            ),
            {
                "openclaw_agent_id": int(agent["id"]),
                "bound_user_id": user_id,
                "token_value": raw_key,
                "token_hash": token_hash,
                "token_prefix": token_prefix,
                "status": KEY_STATUS_ACTIVE,
                "created_at": now,
                "updated_at": now,
            },
        ).fetchone()
        record = record_activity_event(
            openclaw_agent_id=int(agent["id"]),
            bound_user_id=user_id,
            event_type="auth.key_created",
            action_name="create_openclaw_key",
            target_type="openclaw_key",
            target_id=str(row.id),
            success=True,
            status_code=200,
            payload={"agent_uid": agent["agent_uid"]},
            result={"key_id": int(row.id)},
            session=session,
        )
    return {
        "has_key": True,
        "key_id": int(row.id),
        "key": raw_key,
        "masked_key": token_prefix,
        "created_at": now.isoformat(),
        "last_used_at": None,
        "agent_uid": agent["agent_uid"],
        "openclaw_agent": {
            "agent_uid": agent["agent_uid"],
            "display_name": agent["display_name"],
            "handle": agent["handle"],
            "status": agent["status"],
        },
        "event_id": record["id"],
    }


def verify_openclaw_api_key(token: str, *, route: str | None = None) -> dict[str, Any] | None:
    if not token.startswith("tloc_"):
        return None
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc)
    with get_db_session() as session:
        row = session.execute(
            text(
                """
                SELECT
                    k.id AS key_id,
                    k.bound_user_id,
                    k.openclaw_agent_id,
                    k.status AS key_status,
                    k.expires_at,
                    a.agent_uid,
                    a.display_name,
                    a.handle,
                    a.status AS agent_status,
                    u.id AS user_id,
                    u.phone,
                    u.username,
                    u.is_admin,
                    u.is_guest,
                    u.guest_claim_token
                FROM openclaw_api_keys k
                JOIN openclaw_agents a ON a.id = k.openclaw_agent_id
                LEFT JOIN users u ON u.id = k.bound_user_id
                WHERE k.token_hash = :token_hash
                LIMIT 1
                """
            ),
            {"token_hash": token_hash},
        ).fetchone()
        if not row:
            return None
        if row.key_status != KEY_STATUS_ACTIVE:
            return None
        if row.agent_status != AGENT_STATUS_ACTIVE:
            return None
        expires_at = row.expires_at
        if expires_at is not None:
            dt = expires_at if isinstance(expires_at, datetime) else datetime.fromisoformat(str(expires_at))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if dt.astimezone(timezone.utc) <= now:
                return None
        session.execute(
            text(
                """
                UPDATE openclaw_api_keys
                SET last_used_at = :last_used_at,
                    updated_at = :updated_at
                WHERE id = :id
                """
            ),
            {"id": row.key_id, "last_used_at": now, "updated_at": now},
        )
        session.execute(
            text(
                """
                UPDATE openclaw_agents
                SET last_seen_at = :last_seen_at,
                    updated_at = :updated_at
                WHERE id = :id
                """
            ),
            {"id": row.openclaw_agent_id, "last_seen_at": now, "updated_at": now},
        )
        record_activity_event(
            openclaw_agent_id=int(row.openclaw_agent_id),
            bound_user_id=int(row.bound_user_id) if row.bound_user_id is not None else None,
            event_type="auth.key_used",
            action_name="verify_openclaw_key",
            target_type="openclaw_key",
            target_id=str(row.key_id),
            route=route,
            success=True,
            status_code=200,
            payload={},
            result={},
            session=session,
        )
    return {
        "sub": str(row.user_id),
        "phone": row.phone,
        "username": row.username,
        "auth_type": "openclaw_key",
        "openclaw_agent_id": int(row.openclaw_agent_id),
        "agent_uid": row.agent_uid,
        "openclaw_display_name": row.display_name,
        "openclaw_handle": row.handle,
        "bound_user_id": int(row.bound_user_id) if row.bound_user_id is not None else None,
        "is_admin": bool(row.is_admin),
        "is_guest": bool(row.is_guest),
        "guest_claim_token": row.guest_claim_token,
    }


def revoke_openclaw_key(*, agent_uid: str, key_id: int, actor_user_id: int) -> bool:
    with get_db_session() as session:
        agent = session.execute(
            text(
                """
                SELECT id, bound_user_id
                FROM openclaw_agents
                WHERE agent_uid = :agent_uid
                LIMIT 1
                """
            ),
            {"agent_uid": agent_uid},
        ).fetchone()
        if not agent or int(agent.bound_user_id or 0) != actor_user_id:
            return False
        row = session.execute(
            text(
                """
                UPDATE openclaw_api_keys
                SET status = :status,
                    revoked_at = :revoked_at,
                    revoked_reason = :revoked_reason,
                    updated_at = :updated_at
                WHERE id = :key_id
                  AND openclaw_agent_id = :openclaw_agent_id
                  AND status = :active_status
                RETURNING id
                """
            ),
            {
                "status": KEY_STATUS_REVOKED,
                "revoked_at": datetime.now(timezone.utc),
                "revoked_reason": "user_revoked",
                "updated_at": datetime.now(timezone.utc),
                "key_id": key_id,
                "openclaw_agent_id": int(agent.id),
                "active_status": KEY_STATUS_ACTIVE,
            },
        ).fetchone()
        if not row:
            return False
        record_activity_event(
            openclaw_agent_id=int(agent.id),
            bound_user_id=actor_user_id,
            event_type="auth.key_revoked",
            action_name="revoke_openclaw_key",
            target_type="openclaw_key",
            target_id=str(key_id),
            success=True,
            status_code=200,
            payload={},
            result={},
            session=session,
        )
    return True


def bind_openclaw_agent_to_user(*, agent_uid: str, user_id: int) -> dict[str, Any] | None:
    now = datetime.now(timezone.utc)
    with get_db_session() as session:
        session.execute(
            text(
                """
                UPDATE openclaw_agents
                SET is_primary = FALSE,
                    updated_at = :updated_at
                WHERE bound_user_id = :user_id
                  AND agent_uid <> :agent_uid
                  AND is_primary = TRUE
                """
            ),
            {"agent_uid": agent_uid, "user_id": user_id, "updated_at": now},
        )
        row = session.execute(
            text(
                """
                UPDATE openclaw_agents
                SET bound_user_id = :user_id,
                    is_primary = TRUE,
                    updated_at = :updated_at
                WHERE agent_uid = :agent_uid
                  AND (bound_user_id IS NULL OR bound_user_id = :user_id)
                RETURNING *
                """
            ),
            {"agent_uid": agent_uid, "user_id": user_id, "updated_at": now},
        ).fetchone()
        if not row:
            return None
        record_activity_event(
            openclaw_agent_id=int(row.id),
            bound_user_id=user_id,
            event_type="binding.user_bound",
            action_name="bind_openclaw_agent",
            target_type="openclaw_agent",
            target_id=row.agent_uid,
            success=True,
            status_code=200,
            payload={},
            result={},
            session=session,
        )
    return _build_agent_summary(row)


def unbind_openclaw_agent_from_user(*, agent_uid: str, user_id: int) -> dict[str, Any] | None:
    now = datetime.now(timezone.utc)
    with get_db_session() as session:
        row = session.execute(
            text(
                """
                UPDATE openclaw_agents
                SET bound_user_id = NULL,
                    is_primary = FALSE,
                    updated_at = :updated_at
                WHERE agent_uid = :agent_uid
                  AND bound_user_id = :user_id
                RETURNING *
                """
            ),
            {"agent_uid": agent_uid, "user_id": user_id, "updated_at": now},
        ).fetchone()
        if not row:
            return None
        session.execute(
            text(
                """
                UPDATE openclaw_api_keys
                SET status = :status,
                    revoked_at = :revoked_at,
                    revoked_reason = :revoked_reason,
                    updated_at = :updated_at
                WHERE openclaw_agent_id = :agent_id
                  AND status = :active_status
                """
            ),
            {
                "status": KEY_STATUS_REVOKED,
                "revoked_at": now,
                "revoked_reason": "agent_unbound",
                "updated_at": now,
                "agent_id": int(row.id),
                "active_status": KEY_STATUS_ACTIVE,
            },
        )
        record_activity_event(
            openclaw_agent_id=int(row.id),
            bound_user_id=user_id,
            event_type="binding.user_unbound",
            action_name="unbind_openclaw_agent",
            target_type="openclaw_agent",
            target_id=row.agent_uid,
            success=True,
            status_code=200,
            payload={},
            result={},
            session=session,
        )
    return _build_agent_summary(row)


def record_activity_event(
    *,
    openclaw_agent_id: int | None,
    bound_user_id: int | None,
    event_type: str,
    action_name: str,
    target_type: str | None = None,
    target_id: str | None = None,
    session_id: str | None = None,
    request_id: str | None = None,
    http_method: str | None = None,
    route: str | None = None,
    success: bool,
    status_code: int | None,
    error_code: str | None = None,
    payload: dict[str, Any] | None = None,
    result: dict[str, Any] | None = None,
    client_ip: str | None = None,
    user_agent: str | None = None,
    session=None,
) -> dict[str, Any]:
    owns_session = session is None
    if owns_session:
        ctx = get_db_session()
        session = ctx.__enter__()
    try:
        row = session.execute(
            text(
                """
                INSERT INTO openclaw_activity_events (
                    event_uid,
                    openclaw_agent_id,
                    bound_user_id,
                    session_id,
                    request_id,
                    event_type,
                    action_name,
                    target_type,
                    target_id,
                    http_method,
                    route,
                    success,
                    status_code,
                    error_code,
                    payload_json,
                    result_json,
                    client_ip_hash,
                    user_agent,
                    created_at
                ) VALUES (
                    :event_uid,
                    :openclaw_agent_id,
                    :bound_user_id,
                    :session_id,
                    :request_id,
                    :event_type,
                    :action_name,
                    :target_type,
                    :target_id,
                    :http_method,
                    :route,
                    :success,
                    :status_code,
                    :error_code,
                    :payload_json,
                    :result_json,
                    :client_ip_hash,
                    :user_agent,
                    :created_at
                )
                RETURNING id, event_uid, created_at
                """
            ),
            {
                "event_uid": f"oce_{secrets.token_hex(12)}",
                "openclaw_agent_id": openclaw_agent_id,
                "bound_user_id": bound_user_id,
                "session_id": session_id,
                "request_id": request_id,
                "event_type": event_type,
                "action_name": action_name,
                "target_type": target_type,
                "target_id": target_id,
                "http_method": http_method,
                "route": route,
                "success": bool(success),
                "status_code": status_code,
                "error_code": error_code,
                "payload_json": _json_dumps(payload),
                "result_json": _json_dumps(result),
                "client_ip_hash": hashlib.sha256((client_ip or "").encode("utf-8")).hexdigest() if client_ip else None,
                "user_agent": (user_agent or "")[:512] or None,
                "created_at": datetime.now(timezone.utc),
            },
        ).fetchone()
        return {"id": int(row.id), "event_uid": row.event_uid, "created_at": _to_iso(row.created_at)}
    finally:
        if owns_session:
            ctx.__exit__(None, None, None)


def apply_points_delta(
    *,
    openclaw_agent_id: int,
    delta: int,
    reason_code: str,
    target_type: str | None = None,
    target_id: str | None = None,
    related_event_id: int | None = None,
    operator_type: str = "system",
    metadata: dict[str, Any] | None = None,
    session=None,
) -> dict[str, Any]:
    owns_session = session is None
    if owns_session:
        ctx = get_db_session()
        session = ctx.__enter__()
    try:
        now = datetime.now(timezone.utc)
        session.execute(
            text(
                """
                INSERT INTO openclaw_wallets (openclaw_agent_id, balance, lifetime_earned, lifetime_spent, updated_at)
                VALUES (:agent_id, 0, 0, 0, :updated_at)
                ON CONFLICT (openclaw_agent_id) DO NOTHING
                """
            ),
            {"agent_id": openclaw_agent_id, "updated_at": now},
        )
        if related_event_id is not None:
            existing = session.execute(
                text(
                    """
                    SELECT id, delta, balance_after, created_at
                    FROM openclaw_point_ledger
                    WHERE openclaw_agent_id = :agent_id
                      AND reason_code = :reason_code
                      AND related_event_id = :related_event_id
                    LIMIT 1
                    """
                ),
                {
                    "agent_id": openclaw_agent_id,
                    "reason_code": reason_code,
                    "related_event_id": related_event_id,
                },
            ).fetchone()
            if existing is not None:
                return {
                    "id": int(existing.id),
                    "delta": int(existing.delta),
                    "balance_after": int(existing.balance_after),
                    "created_at": _to_iso(existing.created_at),
                    "duplicate": True,
                }
        wallet = session.execute(
            text("SELECT balance, lifetime_earned, lifetime_spent FROM openclaw_wallets WHERE openclaw_agent_id = :agent_id"),
            {"agent_id": openclaw_agent_id},
        ).fetchone()
        current_balance = int(wallet.balance or 0)
        next_balance = current_balance + int(delta)
        if next_balance < 0:
            next_balance = 0
        lifetime_earned = int(wallet.lifetime_earned or 0) + (int(delta) if int(delta) > 0 else 0)
        lifetime_spent = int(wallet.lifetime_spent or 0) + (abs(int(delta)) if int(delta) < 0 else 0)
        session.execute(
            text(
                """
                UPDATE openclaw_wallets
                SET balance = :balance,
                    lifetime_earned = :lifetime_earned,
                    lifetime_spent = :lifetime_spent,
                    updated_at = :updated_at
                WHERE openclaw_agent_id = :agent_id
                """
            ),
            {
                "agent_id": openclaw_agent_id,
                "balance": next_balance,
                "lifetime_earned": lifetime_earned,
                "lifetime_spent": lifetime_spent,
                "updated_at": now,
            },
        )
        row = session.execute(
            text(
                """
                INSERT INTO openclaw_point_ledger (
                    openclaw_agent_id,
                    delta,
                    balance_after,
                    reason_code,
                    target_type,
                    target_id,
                    related_event_id,
                    operator_type,
                    metadata_json,
                    created_at
                ) VALUES (
                    :openclaw_agent_id,
                    :delta,
                    :balance_after,
                    :reason_code,
                    :target_type,
                    :target_id,
                    :related_event_id,
                    :operator_type,
                    :metadata_json,
                    :created_at
                )
                RETURNING id, created_at
                """
            ),
            {
                "openclaw_agent_id": openclaw_agent_id,
                "delta": int(delta),
                "balance_after": next_balance,
                "reason_code": reason_code,
                "target_type": target_type,
                "target_id": target_id,
                "related_event_id": related_event_id,
                "operator_type": operator_type,
                "metadata_json": _json_dumps(metadata),
                "created_at": now,
            },
        ).fetchone()
        return {
            "id": int(row.id),
            "delta": int(delta),
            "balance_after": next_balance,
            "created_at": _to_iso(row.created_at),
            "duplicate": False,
        }
    finally:
        if owns_session:
            ctx.__exit__(None, None, None)


def apply_rule_points(
    *,
    openclaw_agent_id: int | None,
    reason_code: str,
    related_event_id: int | None,
    target_type: str | None = None,
    target_id: str | None = None,
    metadata: dict[str, Any] | None = None,
    session=None,
) -> dict[str, Any] | None:
    if openclaw_agent_id is None:
        return None
    delta = POINT_RULES.get(reason_code)
    if delta is None:
        return None
    return apply_points_delta(
        openclaw_agent_id=openclaw_agent_id,
        delta=delta,
        reason_code=reason_code,
        target_type=target_type,
        target_id=target_id,
        related_event_id=related_event_id,
        operator_type="system",
        metadata=metadata,
        session=session,
    )


def list_openclaw_agents(*, q: str | None = None, status: str | None = None, limit: int = 20, offset: int = 0) -> dict[str, Any]:
    clean_q = (q or "").strip().lower()
    like_q = f"%{clean_q}%"
    safe_limit = max(1, min(limit, 100))
    safe_offset = max(0, offset)
    filters = [
        """
        WHERE (
            :q = ''
            OR LOWER(COALESCE(a.agent_uid, '')) LIKE :like_q
            OR LOWER(COALESCE(a.display_name, '')) LIKE :like_q
            OR LOWER(COALESCE(a.handle, '')) LIKE :like_q
            OR LOWER(COALESCE(u.username, '')) LIKE :like_q
            OR LOWER(COALESCE(u.phone, '')) LIKE :like_q
        )
        """
    ]
    params: dict[str, Any] = {"q": clean_q, "like_q": like_q, "limit": safe_limit, "offset": safe_offset}
    if status:
        filters.append("AND a.status = :status")
        params["status"] = status
    where_sql = "\n".join(filters)
    with get_db_session() as session:
        total = int(
            session.execute(
                text(
                    f"""
                    SELECT COUNT(*)
                    FROM openclaw_agents a
                    LEFT JOIN users u ON u.id = a.bound_user_id
                    {where_sql}
                    """
                ),
                params,
            ).scalar_one()
        )
        rows = session.execute(
            text(
                f"""
                SELECT
                    a.*,
                    u.username,
                    u.phone,
                    COALESCE(w.balance, 0) AS balance
                FROM openclaw_agents a
                LEFT JOIN users u ON u.id = a.bound_user_id
                LEFT JOIN openclaw_wallets w ON w.openclaw_agent_id = a.id
                {where_sql}
                ORDER BY a.updated_at DESC, a.id DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            params,
        ).fetchall()
    return {
        "items": [
            {
                **_build_agent_summary(row),
                "username": getattr(row, "username", None),
                "phone": getattr(row, "phone", None),
                "points_balance": int(getattr(row, "balance", 0) or 0),
            }
            for row in rows
        ],
        "total": total,
        "limit": safe_limit,
        "offset": safe_offset,
    }


def list_openclaw_events(
    *,
    agent_uid: str | None = None,
    event_type: str | None = None,
    q: str | None = None,
    bound_user_id: int | None = None,
    openclaw_agent_id: int | None = None,
    limit: int = 20,
    offset: int = 0,
) -> dict[str, Any]:
    safe_limit = max(1, min(limit, 100))
    safe_offset = max(0, offset)
    filters = ["WHERE 1=1"]
    params: dict[str, Any] = {"limit": safe_limit, "offset": safe_offset}
    if agent_uid:
        filters.append("AND a.agent_uid = :agent_uid")
        params["agent_uid"] = agent_uid
    if bound_user_id is not None:
        filters.append("AND COALESCE(e.bound_user_id, a.bound_user_id) = :bound_user_id")
        params["bound_user_id"] = int(bound_user_id)
    if openclaw_agent_id is not None:
        filters.append("AND e.openclaw_agent_id = :openclaw_agent_id")
        params["openclaw_agent_id"] = int(openclaw_agent_id)
    if event_type:
        filters.append("AND e.event_type = :event_type")
        params["event_type"] = event_type
    normalized_q = (q or "").strip()
    if normalized_q:
        like_value = f"%{normalized_q.lower()}%"
        q_clauses = [
            "LOWER(COALESCE(a.agent_uid, '')) LIKE :q",
            "LOWER(COALESCE(a.display_name, '')) LIKE :q",
            "LOWER(COALESCE(u.username, '')) LIKE :q",
            "LOWER(COALESCE(u.phone, '')) LIKE :q",
            "LOWER(COALESCE(e.event_type, '')) LIKE :q",
            "LOWER(COALESCE(e.action_name, '')) LIKE :q",
            "LOWER(COALESCE(e.route, '')) LIKE :q",
            "LOWER(COALESCE(e.request_id, '')) LIKE :q",
            "LOWER(COALESCE(e.target_id, '')) LIKE :q",
        ]
        params["q"] = like_value
        if normalized_q.isdigit():
            params["q_user_id"] = int(normalized_q)
            params["q_openclaw_agent_id"] = int(normalized_q)
            params["q_event_id"] = int(normalized_q)
            q_clauses.extend(
                [
                    "COALESCE(e.bound_user_id, a.bound_user_id) = :q_user_id",
                    "e.openclaw_agent_id = :q_openclaw_agent_id",
                    "e.id = :q_event_id",
                ]
            )
        filters.append(f"AND ({' OR '.join(q_clauses)})")
    where_sql = "\n".join(filters)
    with get_db_session() as session:
        total = int(
            session.execute(
                text(
                    f"""
                    SELECT COUNT(*)
                    FROM openclaw_activity_events e
                    LEFT JOIN openclaw_agents a ON a.id = e.openclaw_agent_id
                    LEFT JOIN users u ON u.id = COALESCE(e.bound_user_id, a.bound_user_id)
                    {where_sql}
                    """
                ),
                params,
            ).scalar_one()
        )
        rows = session.execute(
            text(
                f"""
                SELECT
                    e.*,
                    a.agent_uid,
                    a.display_name,
                    COALESCE(e.bound_user_id, a.bound_user_id) AS resolved_user_id,
                    u.username,
                    u.phone
                FROM openclaw_activity_events e
                LEFT JOIN openclaw_agents a ON a.id = e.openclaw_agent_id
                LEFT JOIN users u ON u.id = COALESCE(e.bound_user_id, a.bound_user_id)
                {where_sql}
                ORDER BY e.created_at DESC, e.id DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            params,
        ).fetchall()
    items = []
    for row in rows:
        items.append(
            {
                "id": int(row.id),
                "event_uid": row.event_uid,
                "openclaw_agent_id": int(row.openclaw_agent_id) if row.openclaw_agent_id is not None else None,
                "agent_uid": getattr(row, "agent_uid", None),
                "display_name": getattr(row, "display_name", None),
                "bound_user_id": int(row.bound_user_id) if row.bound_user_id is not None else None,
                "resolved_user_id": int(getattr(row, "resolved_user_id", None)) if getattr(row, "resolved_user_id", None) is not None else None,
                "username": getattr(row, "username", None),
                "phone": getattr(row, "phone", None),
                "session_id": row.session_id,
                "request_id": row.request_id,
                "event_type": row.event_type,
                "action_name": row.action_name,
                "target_type": row.target_type,
                "target_id": row.target_id,
                "http_method": row.http_method,
                "route": row.route,
                "success": bool(row.success),
                "status_code": row.status_code,
                "error_code": row.error_code,
                "payload": _json_loads(row.payload_json, {}),
                "result": _json_loads(row.result_json, {}),
                "created_at": _to_iso(row.created_at),
            }
        )
    return {"items": items, "total": total, "limit": safe_limit, "offset": safe_offset}


def list_openclaw_point_ledger(
    *,
    agent_uid: str,
    limit: int = 20,
    offset: int = 0,
) -> dict[str, Any] | None:
    agent = get_openclaw_agent_by_uid(agent_uid)
    if not agent:
        return None
    safe_limit = max(1, min(limit, 100))
    safe_offset = max(0, offset)
    with get_db_session() as session:
        total = int(
            session.execute(
                text("SELECT COUNT(*) FROM openclaw_point_ledger WHERE openclaw_agent_id = :agent_id"),
                {"agent_id": int(agent["id"])},
            ).scalar_one()
        )
        rows = session.execute(
            text(
                """
                SELECT *
                FROM openclaw_point_ledger
                WHERE openclaw_agent_id = :agent_id
                ORDER BY created_at DESC, id DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {"agent_id": int(agent["id"]), "limit": safe_limit, "offset": safe_offset},
        ).fetchall()
    return {
        "items": [
            {
                "id": int(row.id),
                "delta": int(row.delta or 0),
                "balance_after": int(row.balance_after or 0),
                "reason_code": row.reason_code,
                "target_type": row.target_type,
                "target_id": row.target_id,
                "related_event_id": int(row.related_event_id) if row.related_event_id is not None else None,
                "operator_type": row.operator_type,
                "metadata": _json_loads(row.metadata_json, {}),
                "created_at": _to_iso(row.created_at),
            }
            for row in rows
        ],
        "total": total,
        "limit": safe_limit,
        "offset": safe_offset,
    }


def suspend_openclaw_agent(*, agent_uid: str, reason: str = "") -> dict[str, Any] | None:
    now = datetime.now(timezone.utc)
    with get_db_session() as session:
        row = session.execute(
            text(
                """
                UPDATE openclaw_agents
                SET status = :status,
                    updated_at = :updated_at
                WHERE agent_uid = :agent_uid
                RETURNING *
                """
            ),
            {"status": AGENT_STATUS_SUSPENDED, "updated_at": now, "agent_uid": agent_uid},
        ).fetchone()
        if not row:
            return None
        session.execute(
            text(
                """
                UPDATE openclaw_api_keys
                SET status = :status,
                    revoked_at = :revoked_at,
                    revoked_reason = :revoked_reason,
                    updated_at = :updated_at
                WHERE openclaw_agent_id = :agent_id
                  AND status = :active_status
                """
            ),
            {
                "status": KEY_STATUS_REVOKED,
                "revoked_at": now,
                "revoked_reason": reason or "agent_suspended",
                "updated_at": now,
                "agent_id": int(row.id),
                "active_status": KEY_STATUS_ACTIVE,
            },
        )
        event = record_activity_event(
            openclaw_agent_id=int(row.id),
            bound_user_id=int(row.bound_user_id) if row.bound_user_id is not None else None,
            event_type="admin.agent_suspended",
            action_name="suspend_openclaw_agent",
            target_type="openclaw_agent",
            target_id=agent_uid,
            success=True,
            status_code=200,
            payload={"reason": reason},
            result={},
            session=session,
        )
    return {"agent": _build_agent_summary(row), "event": event}


def restore_openclaw_agent(*, agent_uid: str) -> dict[str, Any] | None:
    now = datetime.now(timezone.utc)
    with get_db_session() as session:
        row = session.execute(
            text(
                """
                UPDATE openclaw_agents
                SET status = :status,
                    updated_at = :updated_at
                WHERE agent_uid = :agent_uid
                RETURNING *
                """
            ),
            {"status": AGENT_STATUS_ACTIVE, "updated_at": now, "agent_uid": agent_uid},
        ).fetchone()
        if not row:
            return None
        event = record_activity_event(
            openclaw_agent_id=int(row.id),
            bound_user_id=int(row.bound_user_id) if row.bound_user_id is not None else None,
            event_type="admin.agent_restored",
            action_name="restore_openclaw_agent",
            target_type="openclaw_agent",
            target_id=agent_uid,
            success=True,
            status_code=200,
            payload={},
            result={},
            session=session,
        )
    return {"agent": _build_agent_summary(row), "event": event}


def admin_adjust_points(
    *,
    agent_uid: str,
    delta: int,
    note: str = "",
) -> dict[str, Any] | None:
    agent = get_openclaw_agent_by_uid(agent_uid)
    if not agent:
        return None
    with get_db_session() as session:
        event = record_activity_event(
            openclaw_agent_id=int(agent["id"]),
            bound_user_id=agent["bound_user_id"],
            event_type="admin.points_adjusted",
            action_name="admin_adjust_points",
            target_type="openclaw_agent",
            target_id=agent_uid,
            success=True,
            status_code=200,
            payload={"delta": delta, "note": note},
            result={},
            session=session,
        )
        ledger = apply_points_delta(
            openclaw_agent_id=int(agent["id"]),
            delta=int(delta),
            reason_code="admin.adjust",
            target_type="openclaw_agent",
            target_id=agent_uid,
            related_event_id=int(event["id"]),
            operator_type="admin_panel",
            metadata={"note": note},
            session=session,
        )
    return {"agent": agent, "event": event, "ledger": ledger, "wallet": get_wallet_by_agent_id(int(agent["id"]))}
