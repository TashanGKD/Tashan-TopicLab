"""Database-backed Agent Space storage for TopicLab."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from app.storage.database.postgres_client import get_db_session


class AgentSpaceNotFoundError(KeyError):
    """Requested Agent Space resource does not exist."""


class AgentSpacePermissionError(PermissionError):
    """Caller is not allowed to perform the requested action."""


class AgentSpaceConflictError(ValueError):
    """Requested action conflicts with current Agent Space state."""


ALLOWED_SUBSPACE_POLICIES = {"private", "allowlist"}
ALLOWED_DOCUMENT_FORMATS = {"markdown", "text"}
ALLOWED_ACCESS_REQUEST_STATUSES = {"pending", "approved", "denied", "cancelled"}
ALLOWED_FRIEND_REQUEST_STATUSES = {"pending", "approved", "denied", "cancelled"}
ALLOWED_ACL_PERMISSIONS = {"read"}
ALLOWED_AGENT_INBOX_MESSAGE_TYPES = {
    "space_access_request",
    "space_access_approved",
    "space_access_denied",
    "friend_request",
    "friend_request_approved",
    "friend_request_denied",
}


def _is_sqlite_session(session) -> bool:
    return session.bind.dialect.name == "sqlite"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    return str(uuid.uuid4())


def _to_iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _json_loads(value: Any, default: Any):
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8")
    try:
        return json.loads(value)
    except Exception:
        return default


def _json_dumps(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False)


def _friend_pair(agent_a_id: int, agent_b_id: int) -> tuple[int, int]:
    if agent_a_id == agent_b_id:
        raise AgentSpaceConflictError("friendship_self_not_allowed")
    return (
        (agent_a_id, agent_b_id)
        if agent_a_id < agent_b_id
        else (agent_b_id, agent_a_id)
    )


def _row_value(row, key: str, default: Any = None) -> Any:
    if isinstance(row, dict):
        return row.get(key, default)
    mapping = getattr(row, "_mapping", None)
    if mapping is not None and key in mapping:
        return mapping[key]
    return getattr(row, key, default)


def _space_summary_from_row(row) -> dict[str, Any]:
    payload = {
        "id": _row_value(row, "id"),
        "owner_openclaw_agent_id": int(_row_value(row, "owner_openclaw_agent_id")),
        "owner_agent_uid": _row_value(row, "owner_agent_uid"),
        "owner_display_name": _row_value(row, "owner_display_name"),
        "owner_handle": _row_value(row, "owner_handle"),
        "display_name": _row_value(row, "display_name"),
        "summary": _row_value(row, "summary") or "",
        "is_discoverable": bool(_row_value(row, "is_discoverable")),
        "created_at": _to_iso(_row_value(row, "created_at")),
        "updated_at": _to_iso(_row_value(row, "updated_at")),
    }
    viewer_context = _row_value(row, "viewer_context")
    if viewer_context:
        payload["viewer_context"] = viewer_context
    requestable_subspaces = _row_value(row, "requestable_subspaces")
    if requestable_subspaces is not None:
        payload["requestable_subspaces"] = requestable_subspaces
    return payload


def _subspace_summary_from_row(row) -> dict[str, Any]:
    payload = {
        "id": _row_value(row, "id"),
        "space_id": _row_value(row, "space_id"),
        "slug": _row_value(row, "slug"),
        "name": _row_value(row, "name"),
        "description": _row_value(row, "description") or "",
        "default_policy": _row_value(row, "default_policy"),
        "is_requestable": bool(_row_value(row, "is_requestable")),
        "space_display_name": _row_value(row, "space_display_name"),
        "owner_openclaw_agent_id": int(_row_value(row, "owner_openclaw_agent_id")),
        "owner_agent_uid": _row_value(row, "owner_agent_uid"),
        "owner_display_name": _row_value(row, "owner_display_name"),
        "owner_handle": _row_value(row, "owner_handle"),
        "created_at": _to_iso(_row_value(row, "created_at")),
        "updated_at": _to_iso(_row_value(row, "updated_at")),
    }
    document_count = _row_value(row, "document_count")
    if document_count is not None:
        payload["document_count"] = int(document_count or 0)
    pending_request_count = _row_value(row, "pending_request_count")
    if pending_request_count is not None:
        payload["pending_request_count"] = int(pending_request_count or 0)

    viewer_has_read_access = _row_value(row, "viewer_has_read_access")
    viewer_has_pending_request = _row_value(row, "viewer_has_pending_request")
    viewer_pending_request_id = _row_value(row, "viewer_pending_request_id")
    viewer_granted_at = _row_value(row, "viewer_granted_at")
    viewer_granted_by_openclaw_agent_id = _row_value(
        row,
        "viewer_granted_by_openclaw_agent_id",
    )
    if (
        viewer_has_read_access is not None
        or viewer_has_pending_request is not None
        or viewer_pending_request_id is not None
        or viewer_granted_at is not None
        or viewer_granted_by_openclaw_agent_id is not None
    ):
        payload["viewer_context"] = {
            "has_read_access": bool(viewer_has_read_access),
            "has_pending_request": bool(viewer_has_pending_request),
            "pending_request_id": viewer_pending_request_id,
            "granted_at": _to_iso(viewer_granted_at),
            "granted_by_openclaw_agent_id": (
                int(viewer_granted_by_openclaw_agent_id)
                if viewer_granted_by_openclaw_agent_id is not None
                else None
            ),
        }

    granted_at = _row_value(row, "granted_at")
    granted_by_openclaw_agent_id = _row_value(row, "granted_by_openclaw_agent_id")
    if granted_at is not None or granted_by_openclaw_agent_id is not None:
        payload["access"] = {
            "permission": "read",
            "granted_at": _to_iso(granted_at),
            "granted_by_openclaw_agent_id": (
                int(granted_by_openclaw_agent_id)
                if granted_by_openclaw_agent_id is not None
                else None
            ),
        }
    return payload


def _list_directory_subspaces_for_space_session(
    session,
    *,
    space_id: str,
    viewer_openclaw_agent_id: int,
) -> list[dict[str, Any]]:
    rows = session.execute(
        text(
            """
            SELECT
                ss.id,
                ss.space_id,
                ss.slug,
                ss.name,
                ss.description,
                ss.default_policy,
                ss.is_requestable,
                ss.created_at,
                ss.updated_at,
                s.display_name AS space_display_name,
                s.owner_openclaw_agent_id,
                s.owner_agent_uid,
                a.display_name AS owner_display_name,
                a.handle AS owner_handle,
                (
                    SELECT COUNT(*)
                    FROM agent_space_documents AS d
                    WHERE d.subspace_id = ss.id
                ) AS document_count,
                (
                    SELECT COUNT(*)
                    FROM agent_space_access_requests AS r
                    WHERE r.target_subspace_id = ss.id
                      AND r.status = 'pending'
                ) AS pending_request_count,
                CASE
                    WHEN s.owner_openclaw_agent_id = :viewer_openclaw_agent_id THEN 1
                    WHEN EXISTS (
                        SELECT 1
                        FROM agent_space_acl_entries AS acl
                        WHERE acl.subspace_id = ss.id
                          AND acl.grantee_openclaw_agent_id = :viewer_openclaw_agent_id
                          AND acl.permission = 'read'
                    ) THEN 1
                    ELSE 0
                END AS viewer_has_read_access,
                CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM agent_space_access_requests AS r
                        WHERE r.target_subspace_id = ss.id
                          AND r.requester_openclaw_agent_id = :viewer_openclaw_agent_id
                          AND r.status = 'pending'
                    ) THEN 1
                    ELSE 0
                END AS viewer_has_pending_request,
                (
                    SELECT r.id
                    FROM agent_space_access_requests AS r
                    WHERE r.target_subspace_id = ss.id
                      AND r.requester_openclaw_agent_id = :viewer_openclaw_agent_id
                      AND r.status = 'pending'
                    ORDER BY r.created_at DESC, r.id DESC
                    LIMIT 1
                ) AS viewer_pending_request_id,
                (
                    SELECT acl.created_at
                    FROM agent_space_acl_entries AS acl
                    WHERE acl.subspace_id = ss.id
                      AND acl.grantee_openclaw_agent_id = :viewer_openclaw_agent_id
                      AND acl.permission = 'read'
                    ORDER BY acl.created_at DESC, acl.id DESC
                    LIMIT 1
                ) AS viewer_granted_at,
                (
                    SELECT acl.granted_by_openclaw_agent_id
                    FROM agent_space_acl_entries AS acl
                    WHERE acl.subspace_id = ss.id
                      AND acl.grantee_openclaw_agent_id = :viewer_openclaw_agent_id
                      AND acl.permission = 'read'
                    ORDER BY acl.created_at DESC, acl.id DESC
                    LIMIT 1
                ) AS viewer_granted_by_openclaw_agent_id
            FROM agent_subspaces AS ss
            JOIN agent_spaces AS s
              ON s.id = ss.space_id
            JOIN openclaw_agents AS a
              ON a.id = s.owner_openclaw_agent_id
            WHERE ss.space_id = :space_id
              AND (
                ss.is_requestable = TRUE
                OR s.owner_openclaw_agent_id = :viewer_openclaw_agent_id
                OR EXISTS (
                    SELECT 1
                    FROM agent_space_acl_entries AS acl
                    WHERE acl.subspace_id = ss.id
                      AND acl.grantee_openclaw_agent_id = :viewer_openclaw_agent_id
                      AND acl.permission = 'read'
                )
              )
            ORDER BY
                CASE WHEN s.owner_openclaw_agent_id = :viewer_openclaw_agent_id THEN 0 ELSE 1 END ASC,
                ss.updated_at DESC,
                ss.id DESC
            """
        ),
        {
            "space_id": space_id,
            "viewer_openclaw_agent_id": viewer_openclaw_agent_id,
        },
    ).fetchall()
    return [_subspace_summary_from_row(row) for row in rows]


def _document_summary_from_row(row) -> dict[str, Any]:
    return {
        "id": row.id,
        "subspace_id": row.subspace_id,
        "title": row.title,
        "content_format": row.content_format,
        "source_uri": row.source_uri,
        "metadata": _json_loads(row.metadata_json, {}),
        "created_at": _to_iso(row.created_at),
        "updated_at": _to_iso(row.updated_at),
        "subspace": {
            "id": row.subspace_id,
            "slug": row.subspace_slug,
            "name": row.subspace_name,
            "space_id": row.space_id,
            "space_display_name": row.space_display_name,
        },
        "owner": {
            "openclaw_agent_id": int(row.owner_openclaw_agent_id),
            "agent_uid": row.owner_agent_uid,
            "display_name": row.owner_display_name,
            "handle": row.owner_handle,
        },
        "author_openclaw_agent_id": int(row.author_openclaw_agent_id),
    }


def _document_detail_from_row(row) -> dict[str, Any]:
    payload = _document_summary_from_row(row)
    payload["body_text"] = row.body_text
    return payload


def _access_request_summary_from_row(row) -> dict[str, Any]:
    return {
        "id": row.id,
        "target_subspace_id": row.target_subspace_id,
        "request_message": row.request_message or "",
        "status": row.status,
        "created_at": _to_iso(row.created_at),
        "resolved_at": _to_iso(row.resolved_at),
        "requester": {
            "openclaw_agent_id": int(row.requester_openclaw_agent_id),
            "agent_uid": row.requester_agent_uid,
            "display_name": row.requester_display_name,
            "handle": row.requester_handle,
        },
        "owner": {
            "openclaw_agent_id": int(row.owner_openclaw_agent_id),
            "agent_uid": row.owner_agent_uid,
            "display_name": row.owner_display_name,
            "handle": row.owner_handle,
        },
        "subspace": {
            "id": row.target_subspace_id,
            "slug": row.subspace_slug,
            "name": row.subspace_name,
            "space_id": row.space_id,
            "space_display_name": row.space_display_name,
        },
        "resolved_by_openclaw_agent_id": (
            int(row.resolved_by_openclaw_agent_id)
            if row.resolved_by_openclaw_agent_id is not None
            else None
        ),
    }


def _friend_request_summary_from_row(row) -> dict[str, Any]:
    return {
        "id": row.id,
        "request_message": row.request_message or "",
        "status": row.status,
        "created_at": _to_iso(row.created_at),
        "resolved_at": _to_iso(row.resolved_at),
        "requester": {
            "openclaw_agent_id": int(row.requester_openclaw_agent_id),
            "agent_uid": row.requester_agent_uid,
            "display_name": row.requester_display_name,
            "handle": row.requester_handle,
        },
        "recipient": {
            "openclaw_agent_id": int(row.recipient_openclaw_agent_id),
            "agent_uid": row.recipient_agent_uid,
            "display_name": row.recipient_display_name,
            "handle": row.recipient_handle,
        },
        "resolved_by_openclaw_agent_id": (
            int(row.resolved_by_openclaw_agent_id)
            if row.resolved_by_openclaw_agent_id is not None
            else None
        ),
    }


def _friend_summary_from_row(row) -> dict[str, Any]:
    return {
        "friendship_id": row.friendship_id,
        "created_at": _to_iso(row.created_at),
        "friend": {
            "openclaw_agent_id": int(row.friend_openclaw_agent_id),
            "agent_uid": row.friend_agent_uid,
            "display_name": row.friend_display_name,
            "handle": row.friend_handle,
        },
    }


def _agent_inbox_item_from_row(row) -> dict[str, Any]:
    return {
        "id": row.id,
        "message_type": row.message_type,
        "is_read": bool(row.is_read),
        "created_at": _to_iso(row.created_at),
        "read_at": _to_iso(row.read_at),
        "actor": {
            "openclaw_agent_id": int(row.actor_openclaw_agent_id),
            "agent_uid": row.actor_agent_uid,
            "display_name": row.actor_display_name,
            "handle": row.actor_handle,
        },
        "request": {
            "id": row.request_id,
            "status": row.request_status,
            "request_message": row.request_message or "",
            "created_at": _to_iso(row.request_created_at),
            "resolved_at": _to_iso(row.request_resolved_at),
            "target_subspace_id": row.target_subspace_id,
            "subspace_slug": row.subspace_slug,
            "subspace_name": row.subspace_name,
            "space_id": row.space_id,
            "space_display_name": row.space_display_name,
            "requester_openclaw_agent_id": int(row.requester_openclaw_agent_id),
            "owner_openclaw_agent_id": int(row.owner_openclaw_agent_id),
        },
    }


def _friend_inbox_item_from_row(row) -> dict[str, Any]:
    return {
        "id": row.id,
        "message_type": row.message_type,
        "is_read": bool(row.is_read),
        "created_at": _to_iso(row.created_at),
        "read_at": _to_iso(row.read_at),
        "actor": {
            "openclaw_agent_id": int(row.actor_openclaw_agent_id),
            "agent_uid": row.actor_agent_uid,
            "display_name": row.actor_display_name,
            "handle": row.actor_handle,
        },
        "friend_request": {
            "id": row.friend_request_id,
            "status": row.friend_request_status,
            "request_message": row.request_message or "",
            "created_at": _to_iso(row.friend_request_created_at),
            "resolved_at": _to_iso(row.friend_request_resolved_at),
            "requester_openclaw_agent_id": int(row.requester_openclaw_agent_id),
            "recipient_openclaw_agent_id": int(row.recipient_openclaw_agent_id),
        },
    }


def _get_openclaw_agent_row(session, *, openclaw_agent_id: int):
    row = session.execute(
        text(
            """
            SELECT id, agent_uid, display_name, handle, status
            FROM openclaw_agents
            WHERE id = :openclaw_agent_id
            LIMIT 1
            """
        ),
        {"openclaw_agent_id": openclaw_agent_id},
    ).fetchone()
    if not row:
        raise AgentSpaceNotFoundError("openclaw_agent_not_found")
    return row


def _get_openclaw_agent_row_by_uid(session, *, agent_uid: str):
    row = session.execute(
        text(
            """
            SELECT id, agent_uid, display_name, handle, status
            FROM openclaw_agents
            WHERE agent_uid = :agent_uid
            LIMIT 1
            """
        ),
        {"agent_uid": agent_uid},
    ).fetchone()
    if not row:
        raise AgentSpaceNotFoundError("openclaw_agent_not_found")
    return row


def _are_friends_session(
    session,
    *,
    openclaw_agent_id: int,
    other_openclaw_agent_id: int,
) -> bool:
    low_id, high_id = _friend_pair(openclaw_agent_id, other_openclaw_agent_id)
    row = session.execute(
        text(
            """
            SELECT id
            FROM agent_space_friendships
            WHERE agent_low_openclaw_agent_id = :low_id
              AND agent_high_openclaw_agent_id = :high_id
            LIMIT 1
            """
        ),
        {"low_id": low_id, "high_id": high_id},
    ).fetchone()
    return bool(row)

def _get_root_space_row(session, *, openclaw_agent_id: int):
    return session.execute(
        text(
            """
            SELECT
                s.id,
                s.owner_openclaw_agent_id,
                s.owner_agent_uid,
                a.display_name AS owner_display_name,
                a.handle AS owner_handle,
                s.display_name,
                s.summary,
                s.is_discoverable,
                s.created_at,
                s.updated_at
            FROM agent_spaces AS s
            JOIN openclaw_agents AS a
              ON a.id = s.owner_openclaw_agent_id
            WHERE s.owner_openclaw_agent_id = :openclaw_agent_id
            LIMIT 1
            """
        ),
        {"openclaw_agent_id": openclaw_agent_id},
    ).fetchone()


def _ensure_agent_root_space_session(session, *, openclaw_agent_id: int):
    row = _get_root_space_row(session, openclaw_agent_id=openclaw_agent_id)
    if row:
        return row
    agent = _get_openclaw_agent_row(session, openclaw_agent_id=openclaw_agent_id)
    if agent.status != "active":
        raise AgentSpacePermissionError("openclaw_agent_inactive")
    now = _utc_now()
    display_name = f"{agent.display_name} Space"
    summary = f"{agent.display_name} 的 Agent Space"
    space_id = _new_id()
    session.execute(
        text(
            """
            INSERT INTO agent_spaces (
                id,
                owner_openclaw_agent_id,
                owner_agent_uid,
                display_name,
                summary,
                is_discoverable,
                created_at,
                updated_at
            ) VALUES (
                :id,
                :owner_openclaw_agent_id,
                :owner_agent_uid,
                :display_name,
                :summary,
                TRUE,
                :created_at,
                :updated_at
            )
            """
        ),
        {
            "id": space_id,
            "owner_openclaw_agent_id": int(agent.id),
            "owner_agent_uid": agent.agent_uid,
            "display_name": display_name,
            "summary": summary,
            "created_at": now,
            "updated_at": now,
        },
    )
    row = _get_root_space_row(session, openclaw_agent_id=openclaw_agent_id)
    if not row:
        raise AgentSpaceConflictError("root_space_create_failed")
    return row


def _get_subspace_row(session, *, subspace_id: str):
    row = session.execute(
        text(
            """
            SELECT
                ss.id,
                ss.space_id,
                ss.slug,
                ss.name,
                ss.description,
                ss.default_policy,
                ss.is_requestable,
                ss.created_at,
                ss.updated_at,
                s.display_name AS space_display_name,
                s.owner_openclaw_agent_id,
                s.owner_agent_uid,
                a.display_name AS owner_display_name,
                a.handle AS owner_handle
            FROM agent_subspaces AS ss
            JOIN agent_spaces AS s
              ON s.id = ss.space_id
            JOIN openclaw_agents AS a
              ON a.id = s.owner_openclaw_agent_id
            WHERE ss.id = :subspace_id
            LIMIT 1
            """
        ),
        {"subspace_id": subspace_id},
    ).fetchone()
    if not row:
        raise AgentSpaceNotFoundError("subspace_not_found")
    return row


def _assert_subspace_owner(session, *, subspace_id: str, openclaw_agent_id: int):
    row = _get_subspace_row(session, subspace_id=subspace_id)
    if int(row.owner_openclaw_agent_id) != openclaw_agent_id:
        raise AgentSpacePermissionError("subspace_owner_required")
    return row


def _can_read_subspace_session(session, *, subspace_id: str, viewer_openclaw_agent_id: int) -> bool:
    row = session.execute(
        text(
            """
            SELECT
                CASE
                    WHEN s.owner_openclaw_agent_id = :viewer_openclaw_agent_id THEN 1
                    WHEN EXISTS (
                        SELECT 1
                        FROM agent_space_acl_entries AS acl
                        WHERE acl.subspace_id = ss.id
                          AND acl.grantee_openclaw_agent_id = :viewer_openclaw_agent_id
                          AND acl.permission = 'read'
                    ) THEN 1
                    ELSE 0
                END AS can_read
            FROM agent_subspaces AS ss
            JOIN agent_spaces AS s
              ON s.id = ss.space_id
            WHERE ss.id = :subspace_id
            LIMIT 1
            """
        ),
        {
            "subspace_id": subspace_id,
            "viewer_openclaw_agent_id": viewer_openclaw_agent_id,
        },
    ).fetchone()
    if not row:
        raise AgentSpaceNotFoundError("subspace_not_found")
    return bool(row.can_read)


def _list_owned_subspaces_session(session, *, openclaw_agent_id: int) -> list[dict[str, Any]]:
    rows = session.execute(
        text(
            """
            SELECT
                ss.id,
                ss.space_id,
                ss.slug,
                ss.name,
                ss.description,
                ss.default_policy,
                ss.is_requestable,
                ss.created_at,
                ss.updated_at,
                s.display_name AS space_display_name,
                s.owner_openclaw_agent_id,
                s.owner_agent_uid,
                a.display_name AS owner_display_name,
                a.handle AS owner_handle,
                (
                    SELECT COUNT(*)
                    FROM agent_space_documents AS d
                    WHERE d.subspace_id = ss.id
                ) AS document_count,
                (
                    SELECT COUNT(*)
                    FROM agent_space_access_requests AS r
                    WHERE r.target_subspace_id = ss.id
                      AND r.status = 'pending'
                ) AS pending_request_count
            FROM agent_subspaces AS ss
            JOIN agent_spaces AS s
              ON s.id = ss.space_id
            JOIN openclaw_agents AS a
              ON a.id = s.owner_openclaw_agent_id
            WHERE s.owner_openclaw_agent_id = :openclaw_agent_id
            ORDER BY ss.created_at ASC, ss.id ASC
            """
        ),
        {"openclaw_agent_id": openclaw_agent_id},
    ).fetchall()
    return [_subspace_summary_from_row(row) for row in rows]


def _list_accessible_subspaces_session(session, *, openclaw_agent_id: int) -> list[dict[str, Any]]:
    rows = session.execute(
        text(
            """
            SELECT
                ss.id,
                ss.space_id,
                ss.slug,
                ss.name,
                ss.description,
                ss.default_policy,
                ss.is_requestable,
                ss.created_at,
                ss.updated_at,
                s.display_name AS space_display_name,
                s.owner_openclaw_agent_id,
                s.owner_agent_uid,
                a.display_name AS owner_display_name,
                a.handle AS owner_handle,
                (
                    SELECT COUNT(*)
                    FROM agent_space_documents AS d
                    WHERE d.subspace_id = ss.id
                ) AS document_count,
                acl.created_at AS granted_at,
                acl.granted_by_openclaw_agent_id
            FROM agent_space_acl_entries AS acl
            JOIN agent_subspaces AS ss
              ON ss.id = acl.subspace_id
            JOIN agent_spaces AS s
              ON s.id = ss.space_id
            JOIN openclaw_agents AS a
              ON a.id = s.owner_openclaw_agent_id
            WHERE acl.grantee_openclaw_agent_id = :openclaw_agent_id
              AND acl.permission = 'read'
            ORDER BY acl.created_at DESC, ss.id DESC
            """
        ),
        {"openclaw_agent_id": openclaw_agent_id},
    ).fetchall()
    return [_subspace_summary_from_row(row) for row in rows]


def init_agent_space_tables() -> None:
    with get_db_session() as session:
        is_sqlite = _is_sqlite_session(session)
        now_type = "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP" if is_sqlite else "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
        optional_time_type = "TEXT" if is_sqlite else "TIMESTAMPTZ"
        statements = [
            f"""
            CREATE TABLE IF NOT EXISTS agent_spaces (
                id VARCHAR(36) PRIMARY KEY,
                owner_openclaw_agent_id INTEGER NOT NULL UNIQUE REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                owner_agent_uid VARCHAR(32) NOT NULL UNIQUE,
                display_name VARCHAR(255) NOT NULL,
                summary TEXT NOT NULL DEFAULT '',
                is_discoverable BOOLEAN NOT NULL DEFAULT TRUE,
                created_at {now_type},
                updated_at {now_type}
            )
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_agent_spaces_discoverable
            ON agent_spaces(is_discoverable, updated_at DESC)
            """,
            f"""
            CREATE TABLE IF NOT EXISTS agent_subspaces (
                id VARCHAR(36) PRIMARY KEY,
                space_id VARCHAR(36) NOT NULL REFERENCES agent_spaces(id) ON DELETE CASCADE,
                slug VARCHAR(100) NOT NULL,
                name VARCHAR(255) NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                default_policy VARCHAR(32) NOT NULL DEFAULT 'allowlist',
                is_requestable BOOLEAN NOT NULL DEFAULT TRUE,
                created_at {now_type},
                updated_at {now_type},
                UNIQUE(space_id, slug)
            )
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_agent_subspaces_space
            ON agent_subspaces(space_id, updated_at DESC)
            """,
            f"""
            CREATE TABLE IF NOT EXISTS agent_space_documents (
                id VARCHAR(36) PRIMARY KEY,
                subspace_id VARCHAR(36) NOT NULL REFERENCES agent_subspaces(id) ON DELETE CASCADE,
                author_openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                title VARCHAR(255) NOT NULL,
                content_format VARCHAR(32) NOT NULL,
                body_text TEXT NOT NULL,
                source_uri TEXT,
                metadata_json TEXT,
                created_at {now_type},
                updated_at {now_type}
            )
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_agent_space_documents_subspace
            ON agent_space_documents(subspace_id, updated_at DESC)
            """,
            f"""
            CREATE TABLE IF NOT EXISTS agent_space_acl_entries (
                id VARCHAR(36) PRIMARY KEY,
                subspace_id VARCHAR(36) NOT NULL REFERENCES agent_subspaces(id) ON DELETE CASCADE,
                grantee_openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                permission VARCHAR(32) NOT NULL DEFAULT 'read',
                granted_by_openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                created_at {now_type},
                UNIQUE(subspace_id, grantee_openclaw_agent_id, permission)
            )
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_agent_space_acl_grantee
            ON agent_space_acl_entries(grantee_openclaw_agent_id, permission)
            """,
            f"""
            CREATE TABLE IF NOT EXISTS agent_space_access_requests (
                id VARCHAR(36) PRIMARY KEY,
                target_subspace_id VARCHAR(36) NOT NULL REFERENCES agent_subspaces(id) ON DELETE CASCADE,
                requester_openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                owner_openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                request_message TEXT NOT NULL DEFAULT '',
                status VARCHAR(32) NOT NULL DEFAULT 'pending',
                resolved_by_openclaw_agent_id INTEGER REFERENCES openclaw_agents(id) ON DELETE SET NULL,
                resolved_at """ + optional_time_type + """,
                created_at """ + now_type + """
            )
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_agent_space_access_requests_owner_status
            ON agent_space_access_requests(owner_openclaw_agent_id, status, created_at DESC)
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_agent_space_access_requests_requester_status
            ON agent_space_access_requests(requester_openclaw_agent_id, status, created_at DESC)
            """,
            f"""
            CREATE TABLE IF NOT EXISTS agent_space_friend_requests (
                id VARCHAR(36) PRIMARY KEY,
                requester_openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                recipient_openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                request_message TEXT NOT NULL DEFAULT '',
                status VARCHAR(32) NOT NULL DEFAULT 'pending',
                resolved_by_openclaw_agent_id INTEGER REFERENCES openclaw_agents(id) ON DELETE SET NULL,
                resolved_at """ + optional_time_type + """,
                created_at """ + now_type + """
            )
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_agent_space_friend_requests_requester_status
            ON agent_space_friend_requests(requester_openclaw_agent_id, status, created_at DESC)
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_agent_space_friend_requests_recipient_status
            ON agent_space_friend_requests(recipient_openclaw_agent_id, status, created_at DESC)
            """,
            f"""
            CREATE TABLE IF NOT EXISTS agent_space_friendships (
                id VARCHAR(36) PRIMARY KEY,
                agent_low_openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                agent_high_openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                created_from_request_id VARCHAR(36) REFERENCES agent_space_friend_requests(id) ON DELETE SET NULL,
                created_at {now_type},
                UNIQUE(agent_low_openclaw_agent_id, agent_high_openclaw_agent_id)
            )
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_agent_space_friendships_low
            ON agent_space_friendships(agent_low_openclaw_agent_id, created_at DESC)
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_agent_space_friendships_high
            ON agent_space_friendships(agent_high_openclaw_agent_id, created_at DESC)
            """,
            f"""
            CREATE TABLE IF NOT EXISTS openclaw_agent_inbox_messages (
                id VARCHAR(36) PRIMARY KEY,
                recipient_openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                message_type VARCHAR(64) NOT NULL,
                request_id VARCHAR(36) NOT NULL REFERENCES agent_space_access_requests(id) ON DELETE CASCADE,
                actor_openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                is_read BOOLEAN NOT NULL DEFAULT FALSE,
                created_at {now_type},
                read_at """ + optional_time_type + """,
                UNIQUE(message_type, request_id, recipient_openclaw_agent_id)
            )
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_openclaw_agent_inbox_messages_recipient
            ON openclaw_agent_inbox_messages(recipient_openclaw_agent_id, is_read, created_at DESC)
            """,
            f"""
            CREATE TABLE IF NOT EXISTS openclaw_agent_friend_inbox_messages (
                id VARCHAR(36) PRIMARY KEY,
                recipient_openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                message_type VARCHAR(64) NOT NULL,
                friend_request_id VARCHAR(36) NOT NULL REFERENCES agent_space_friend_requests(id) ON DELETE CASCADE,
                actor_openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                is_read BOOLEAN NOT NULL DEFAULT FALSE,
                created_at {now_type},
                read_at """ + optional_time_type + """,
                UNIQUE(message_type, friend_request_id, recipient_openclaw_agent_id)
            )
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_openclaw_agent_friend_inbox_messages_recipient
            ON openclaw_agent_friend_inbox_messages(recipient_openclaw_agent_id, is_read, created_at DESC)
            """,
        ]
        for statement in statements:
            session.execute(text(statement))


def ensure_agent_root_space(*, openclaw_agent_id: int) -> dict[str, Any]:
    with get_db_session() as session:
        row = _ensure_agent_root_space_session(session, openclaw_agent_id=openclaw_agent_id)
        return _space_summary_from_row(row)


def _list_agent_friends_session(session, *, openclaw_agent_id: int) -> list[dict[str, Any]]:
    rows = session.execute(
        text(
            """
            SELECT
                f.id AS friendship_id,
                f.created_at,
                CASE
                    WHEN f.agent_low_openclaw_agent_id = :openclaw_agent_id THEN high.id
                    ELSE low.id
                END AS friend_openclaw_agent_id,
                CASE
                    WHEN f.agent_low_openclaw_agent_id = :openclaw_agent_id THEN high.agent_uid
                    ELSE low.agent_uid
                END AS friend_agent_uid,
                CASE
                    WHEN f.agent_low_openclaw_agent_id = :openclaw_agent_id THEN high.display_name
                    ELSE low.display_name
                END AS friend_display_name,
                CASE
                    WHEN f.agent_low_openclaw_agent_id = :openclaw_agent_id THEN high.handle
                    ELSE low.handle
                END AS friend_handle
            FROM agent_space_friendships AS f
            JOIN openclaw_agents AS low
              ON low.id = f.agent_low_openclaw_agent_id
            JOIN openclaw_agents AS high
              ON high.id = f.agent_high_openclaw_agent_id
            WHERE f.agent_low_openclaw_agent_id = :openclaw_agent_id
               OR f.agent_high_openclaw_agent_id = :openclaw_agent_id
            ORDER BY f.created_at DESC, f.id DESC
            """
        ),
        {"openclaw_agent_id": openclaw_agent_id},
    ).fetchall()
    return [_friend_summary_from_row(row) for row in rows]


def get_agent_space_me_payload(*, openclaw_agent_id: int) -> dict[str, Any]:
    with get_db_session() as session:
        agent = _get_openclaw_agent_row(session, openclaw_agent_id=openclaw_agent_id)
        root_row = _ensure_agent_root_space_session(session, openclaw_agent_id=openclaw_agent_id)
        return {
            "agent": {
                "openclaw_agent_id": int(agent.id),
                "agent_uid": agent.agent_uid,
                "display_name": agent.display_name,
                "handle": agent.handle,
                "status": agent.status,
            },
            "root_space": _space_summary_from_row(root_row),
            "owned_subspaces": _list_owned_subspaces_session(session, openclaw_agent_id=openclaw_agent_id),
            "accessible_subspaces": _list_accessible_subspaces_session(session, openclaw_agent_id=openclaw_agent_id),
            "friends": _list_agent_friends_session(session, openclaw_agent_id=openclaw_agent_id),
        }


def list_agent_subspaces(*, openclaw_agent_id: int) -> dict[str, Any]:
    with get_db_session() as session:
        root_row = _ensure_agent_root_space_session(session, openclaw_agent_id=openclaw_agent_id)
        return {
            "root_space": _space_summary_from_row(root_row),
            "owned_subspaces": _list_owned_subspaces_session(session, openclaw_agent_id=openclaw_agent_id),
            "accessible_subspaces": _list_accessible_subspaces_session(session, openclaw_agent_id=openclaw_agent_id),
            "friends": _list_agent_friends_session(session, openclaw_agent_id=openclaw_agent_id),
        }


def create_agent_subspace(
    *,
    owner_openclaw_agent_id: int,
    slug: str,
    name: str,
    description: str = "",
    default_policy: str = "allowlist",
    is_requestable: bool = True,
) -> dict[str, Any]:
    if default_policy not in ALLOWED_SUBSPACE_POLICIES:
        raise AgentSpaceConflictError("invalid_default_policy")
    with get_db_session() as session:
        root_row = _ensure_agent_root_space_session(session, openclaw_agent_id=owner_openclaw_agent_id)
        existing = session.execute(
            text(
                """
                SELECT id
                FROM agent_subspaces
                WHERE space_id = :space_id AND slug = :slug
                LIMIT 1
                """
            ),
            {"space_id": root_row.id, "slug": slug},
        ).fetchone()
        if existing:
            raise AgentSpaceConflictError("subspace_slug_exists")
        now = _utc_now()
        subspace_id = _new_id()
        session.execute(
            text(
                """
                INSERT INTO agent_subspaces (
                    id,
                    space_id,
                    slug,
                    name,
                    description,
                    default_policy,
                    is_requestable,
                    created_at,
                    updated_at
                ) VALUES (
                    :id,
                    :space_id,
                    :slug,
                    :name,
                    :description,
                    :default_policy,
                    :is_requestable,
                    :created_at,
                    :updated_at
                )
                """
            ),
            {
                "id": subspace_id,
                "space_id": root_row.id,
                "slug": slug,
                "name": name,
                "description": description,
                "default_policy": default_policy,
                "is_requestable": is_requestable,
                "created_at": now,
                "updated_at": now,
            },
        )
        row = _get_subspace_row(session, subspace_id=subspace_id)
        return _subspace_summary_from_row(row)


def _list_subspace_acl_entries_session(
    session,
    *,
    subspace_id: str,
) -> list[dict[str, Any]]:
    rows = session.execute(
        text(
            """
            SELECT
                acl.id,
                acl.subspace_id,
                acl.permission,
                acl.created_at AS granted_at,
                acl.granted_by_openclaw_agent_id,
                grantee.id AS grantee_openclaw_agent_id,
                grantee.agent_uid AS grantee_agent_uid,
                grantee.display_name AS grantee_display_name,
                grantee.handle AS grantee_handle
            FROM agent_space_acl_entries AS acl
            JOIN openclaw_agents AS grantee
              ON grantee.id = acl.grantee_openclaw_agent_id
            WHERE acl.subspace_id = :subspace_id
              AND acl.permission = 'read'
            ORDER BY acl.created_at DESC, acl.id DESC
            """
        ),
        {"subspace_id": subspace_id},
    ).fetchall()
    return [
        {
            "id": row.id,
            "permission": row.permission,
            "granted_at": _to_iso(row.granted_at),
            "granted_by_openclaw_agent_id": int(row.granted_by_openclaw_agent_id),
            "grantee": {
                "openclaw_agent_id": int(row.grantee_openclaw_agent_id),
                "agent_uid": row.grantee_agent_uid,
                "display_name": row.grantee_display_name,
                "handle": row.grantee_handle,
            },
        }
        for row in rows
    ]


def list_agent_subspace_acl_entries(
    *,
    owner_openclaw_agent_id: int,
    subspace_id: str,
) -> dict[str, Any]:
    with get_db_session() as session:
        subspace = _assert_subspace_owner(
            session,
            subspace_id=subspace_id,
            openclaw_agent_id=owner_openclaw_agent_id,
        )
        return {
            "subspace": _subspace_summary_from_row(subspace),
            "items": _list_subspace_acl_entries_session(session, subspace_id=subspace_id),
        }


def grant_agent_subspace_access(
    *,
    owner_openclaw_agent_id: int,
    subspace_id: str,
    grantee_agent_uid: str,
) -> dict[str, Any]:
    with get_db_session() as session:
        _assert_subspace_owner(
            session,
            subspace_id=subspace_id,
            openclaw_agent_id=owner_openclaw_agent_id,
        )
        grantee = _get_openclaw_agent_row_by_uid(session, agent_uid=grantee_agent_uid)
        if int(grantee.id) == owner_openclaw_agent_id:
            raise AgentSpaceConflictError("owner_already_controls_subspace")
        if grantee.status != "active":
            raise AgentSpacePermissionError("grantee_openclaw_agent_inactive")
        if not _are_friends_session(
            session,
            openclaw_agent_id=owner_openclaw_agent_id,
            other_openclaw_agent_id=int(grantee.id),
        ):
            raise AgentSpacePermissionError("friendship_required_for_direct_grant")
        now = _utc_now()
        session.execute(
            text(
                """
                INSERT INTO agent_space_acl_entries (
                    id,
                    subspace_id,
                    grantee_openclaw_agent_id,
                    permission,
                    granted_by_openclaw_agent_id,
                    created_at
                ) VALUES (
                    :id,
                    :subspace_id,
                    :grantee_openclaw_agent_id,
                    'read',
                    :granted_by_openclaw_agent_id,
                    :created_at
                )
                ON CONFLICT (subspace_id, grantee_openclaw_agent_id, permission)
                DO UPDATE SET
                    granted_by_openclaw_agent_id = EXCLUDED.granted_by_openclaw_agent_id,
                    created_at = EXCLUDED.created_at
                """
            ),
            {
                "id": _new_id(),
                "subspace_id": subspace_id,
                "grantee_openclaw_agent_id": int(grantee.id),
                "granted_by_openclaw_agent_id": owner_openclaw_agent_id,
                "created_at": now,
            },
        )
        items = _list_subspace_acl_entries_session(session, subspace_id=subspace_id)
        grant = next(
            item
            for item in items
            if item["grantee"]["agent_uid"] == grantee_agent_uid
        )
        return {"grant": grant}


def revoke_agent_subspace_access(
    *,
    owner_openclaw_agent_id: int,
    subspace_id: str,
    grantee_openclaw_agent_id: int,
) -> bool:
    with get_db_session() as session:
        _assert_subspace_owner(
            session,
            subspace_id=subspace_id,
            openclaw_agent_id=owner_openclaw_agent_id,
        )
        deleted = session.execute(
            text(
                """
                DELETE FROM agent_space_acl_entries
                WHERE subspace_id = :subspace_id
                  AND grantee_openclaw_agent_id = :grantee_openclaw_agent_id
                  AND permission = 'read'
                """
            ),
            {
                "subspace_id": subspace_id,
                "grantee_openclaw_agent_id": grantee_openclaw_agent_id,
            },
        )
    return bool(deleted.rowcount)


def create_agent_space_document(
    *,
    owner_openclaw_agent_id: int,
    subspace_id: str,
    title: str,
    content_format: str,
    body_text: str,
    source_uri: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if content_format not in ALLOWED_DOCUMENT_FORMATS:
        raise AgentSpaceConflictError("invalid_document_format")
    with get_db_session() as session:
        subspace = _assert_subspace_owner(
            session,
            subspace_id=subspace_id,
            openclaw_agent_id=owner_openclaw_agent_id,
        )
        now = _utc_now()
        document_id = _new_id()
        session.execute(
            text(
                """
                INSERT INTO agent_space_documents (
                    id,
                    subspace_id,
                    author_openclaw_agent_id,
                    title,
                    content_format,
                    body_text,
                    source_uri,
                    metadata_json,
                    created_at,
                    updated_at
                ) VALUES (
                    :id,
                    :subspace_id,
                    :author_openclaw_agent_id,
                    :title,
                    :content_format,
                    :body_text,
                    :source_uri,
                    :metadata_json,
                    :created_at,
                    :updated_at
                )
                """
            ),
            {
                "id": document_id,
                "subspace_id": subspace_id,
                "author_openclaw_agent_id": owner_openclaw_agent_id,
                "title": title,
                "content_format": content_format,
                "body_text": body_text,
                "source_uri": source_uri,
                "metadata_json": _json_dumps(metadata or {}),
                "created_at": now,
                "updated_at": now,
            },
        )
        row = session.execute(
            text(
                """
                SELECT
                    d.id,
                    d.subspace_id,
                    d.author_openclaw_agent_id,
                    d.title,
                    d.content_format,
                    d.body_text,
                    d.source_uri,
                    d.metadata_json,
                    d.created_at,
                    d.updated_at,
                    ss.slug AS subspace_slug,
                    ss.name AS subspace_name,
                    s.id AS space_id,
                    s.display_name AS space_display_name,
                    s.owner_openclaw_agent_id,
                    s.owner_agent_uid,
                    a.display_name AS owner_display_name,
                    a.handle AS owner_handle
                FROM agent_space_documents AS d
                JOIN agent_subspaces AS ss
                  ON ss.id = d.subspace_id
                JOIN agent_spaces AS s
                  ON s.id = ss.space_id
                JOIN openclaw_agents AS a
                  ON a.id = s.owner_openclaw_agent_id
                WHERE d.id = :document_id
                LIMIT 1
                """
            ),
            {"document_id": document_id},
        ).fetchone()
        if not row:
            raise AgentSpaceConflictError("document_create_failed")
        return _document_detail_from_row(row)


def list_agent_space_documents(
    *,
    subspace_id: str,
    viewer_openclaw_agent_id: int,
) -> dict[str, Any]:
    with get_db_session() as session:
        subspace_row = _get_subspace_row(session, subspace_id=subspace_id)
        if not _can_read_subspace_session(
            session,
            subspace_id=subspace_id,
            viewer_openclaw_agent_id=viewer_openclaw_agent_id,
        ):
            raise AgentSpacePermissionError("subspace_read_forbidden")
        rows = session.execute(
            text(
                """
                SELECT
                    d.id,
                    d.subspace_id,
                    d.author_openclaw_agent_id,
                    d.title,
                    d.content_format,
                    d.body_text,
                    d.source_uri,
                    d.metadata_json,
                    d.created_at,
                    d.updated_at,
                    ss.slug AS subspace_slug,
                    ss.name AS subspace_name,
                    s.id AS space_id,
                    s.display_name AS space_display_name,
                    s.owner_openclaw_agent_id,
                    s.owner_agent_uid,
                    a.display_name AS owner_display_name,
                    a.handle AS owner_handle
                FROM agent_space_documents AS d
                JOIN agent_subspaces AS ss
                  ON ss.id = d.subspace_id
                JOIN agent_spaces AS s
                  ON s.id = ss.space_id
                JOIN openclaw_agents AS a
                  ON a.id = s.owner_openclaw_agent_id
                WHERE d.subspace_id = :subspace_id
                ORDER BY d.updated_at DESC, d.id DESC
                """
            ),
            {"subspace_id": subspace_id},
        ).fetchall()
        return {
            "subspace": _subspace_summary_from_row(subspace_row),
            "items": [_document_summary_from_row(row) for row in rows],
        }


def get_agent_space_document(
    *,
    document_id: str,
    viewer_openclaw_agent_id: int,
) -> dict[str, Any]:
    with get_db_session() as session:
        row = session.execute(
            text(
                """
                SELECT
                    d.id,
                    d.subspace_id,
                    d.author_openclaw_agent_id,
                    d.title,
                    d.content_format,
                    d.body_text,
                    d.source_uri,
                    d.metadata_json,
                    d.created_at,
                    d.updated_at,
                    ss.slug AS subspace_slug,
                    ss.name AS subspace_name,
                    s.id AS space_id,
                    s.display_name AS space_display_name,
                    s.owner_openclaw_agent_id,
                    s.owner_agent_uid,
                    a.display_name AS owner_display_name,
                    a.handle AS owner_handle
                FROM agent_space_documents AS d
                JOIN agent_subspaces AS ss
                  ON ss.id = d.subspace_id
                JOIN agent_spaces AS s
                  ON s.id = ss.space_id
                JOIN openclaw_agents AS a
                  ON a.id = s.owner_openclaw_agent_id
                WHERE d.id = :document_id
                LIMIT 1
                """
            ),
            {"document_id": document_id},
        ).fetchone()
        if not row:
            raise AgentSpaceNotFoundError("document_not_found")
        if not _can_read_subspace_session(
            session,
            subspace_id=row.subspace_id,
            viewer_openclaw_agent_id=viewer_openclaw_agent_id,
        ):
            raise AgentSpacePermissionError("document_read_forbidden")
        return _document_detail_from_row(row)


def list_agent_space_directory(
    *,
    viewer_openclaw_agent_id: int,
    q: str | None = None,
    limit: int = 20,
) -> dict[str, Any]:
    page_limit = max(1, min(limit, 100))
    search = (q or "").strip().lower()
    with get_db_session() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    s.id,
                    s.owner_openclaw_agent_id,
                    s.owner_agent_uid,
                    a.display_name AS owner_display_name,
                    a.handle AS owner_handle,
                    s.display_name,
                    s.summary,
                    s.is_discoverable,
                    s.created_at,
                    s.updated_at
                FROM agent_spaces AS s
                JOIN openclaw_agents AS a
                  ON a.id = s.owner_openclaw_agent_id
                WHERE s.is_discoverable = TRUE
                  AND a.status = 'active'
                  AND (
                    :search = ''
                    OR LOWER(a.display_name) LIKE :like_search
                    OR LOWER(a.handle) LIKE :like_search
                    OR LOWER(s.display_name) LIKE :like_search
                    OR LOWER(s.summary) LIKE :like_search
                  )
                ORDER BY s.updated_at DESC, s.id DESC
                LIMIT :limit
                """
            ),
            {
                "search": search,
                "like_search": f"%{search}%",
                "limit": page_limit,
            },
        ).fetchall()
        items = []
        for row in rows:
            requestable_subspaces = _list_directory_subspaces_for_space_session(
                session,
                space_id=row.id,
                viewer_openclaw_agent_id=viewer_openclaw_agent_id,
            )
            is_self = int(row.owner_openclaw_agent_id) == viewer_openclaw_agent_id
            items.append(
                _space_summary_from_row(
                    {
                        **dict(row._mapping),
                        "requestable_subspaces": requestable_subspaces,
                        "viewer_context": {
                            "is_self": is_self,
                            "is_friend": (
                                False
                                if is_self
                                else _are_friends_session(
                                    session,
                                    openclaw_agent_id=viewer_openclaw_agent_id,
                                    other_openclaw_agent_id=int(row.owner_openclaw_agent_id),
                                )
                            ),
                            "accessible_subspace_count": sum(
                                1
                                for subspace in requestable_subspaces
                                if subspace.get("viewer_context", {}).get("has_read_access")
                            ),
                            "pending_request_count": sum(
                                1
                                for subspace in requestable_subspaces
                                if subspace.get("viewer_context", {}).get("has_pending_request")
                            ),
                        },
                    }
                )
            )
        return {"items": items, "next_cursor": None}


def list_agent_friends(*, openclaw_agent_id: int) -> dict[str, Any]:
    with get_db_session() as session:
        return {"items": _list_agent_friends_session(session, openclaw_agent_id=openclaw_agent_id)}


def create_agent_friend_request(
    *,
    requester_openclaw_agent_id: int,
    recipient_agent_uid: str,
    message: str = "",
) -> dict[str, Any]:
    with get_db_session() as session:
        requester = _get_openclaw_agent_row(
            session,
            openclaw_agent_id=requester_openclaw_agent_id,
        )
        recipient = _get_openclaw_agent_row_by_uid(
            session,
            agent_uid=recipient_agent_uid,
        )
        if int(requester.id) == int(recipient.id):
            raise AgentSpaceConflictError("friendship_self_not_allowed")
        if recipient.status != "active":
            raise AgentSpacePermissionError("recipient_openclaw_agent_inactive")
        if _are_friends_session(
            session,
            openclaw_agent_id=requester_openclaw_agent_id,
            other_openclaw_agent_id=int(recipient.id),
        ):
            raise AgentSpaceConflictError("friendship_already_exists")
        pending = session.execute(
            text(
                """
                SELECT id
                FROM agent_space_friend_requests
                WHERE (
                    (
                        requester_openclaw_agent_id = :requester_openclaw_agent_id
                        AND recipient_openclaw_agent_id = :recipient_openclaw_agent_id
                    ) OR (
                        requester_openclaw_agent_id = :recipient_openclaw_agent_id
                        AND recipient_openclaw_agent_id = :requester_openclaw_agent_id
                    )
                )
                  AND status = 'pending'
                LIMIT 1
                """
            ),
            {
                "requester_openclaw_agent_id": requester_openclaw_agent_id,
                "recipient_openclaw_agent_id": int(recipient.id),
            },
        ).fetchone()
        if pending:
            raise AgentSpaceConflictError("pending_friend_request_exists")
        now = _utc_now()
        friend_request_id = _new_id()
        session.execute(
            text(
                """
                INSERT INTO agent_space_friend_requests (
                    id,
                    requester_openclaw_agent_id,
                    recipient_openclaw_agent_id,
                    request_message,
                    status,
                    created_at
                ) VALUES (
                    :id,
                    :requester_openclaw_agent_id,
                    :recipient_openclaw_agent_id,
                    :request_message,
                    'pending',
                    :created_at
                )
                """
            ),
            {
                "id": friend_request_id,
                "requester_openclaw_agent_id": requester_openclaw_agent_id,
                "recipient_openclaw_agent_id": int(recipient.id),
                "request_message": message,
                "created_at": now,
            },
        )
        session.execute(
            text(
                """
                INSERT INTO openclaw_agent_friend_inbox_messages (
                    id,
                    recipient_openclaw_agent_id,
                    message_type,
                    friend_request_id,
                    actor_openclaw_agent_id,
                    is_read,
                    created_at
                ) VALUES (
                    :id,
                    :recipient_openclaw_agent_id,
                    'friend_request',
                    :friend_request_id,
                    :actor_openclaw_agent_id,
                    FALSE,
                    :created_at
                )
                """
            ),
            {
                "id": _new_id(),
                "recipient_openclaw_agent_id": int(recipient.id),
                "friend_request_id": friend_request_id,
                "actor_openclaw_agent_id": requester_openclaw_agent_id,
                "created_at": now,
            },
        )
        row = session.execute(
            text(
                """
                SELECT
                    r.id,
                    r.request_message,
                    r.status,
                    r.created_at,
                    r.resolved_at,
                    r.requester_openclaw_agent_id,
                    r.recipient_openclaw_agent_id,
                    r.resolved_by_openclaw_agent_id,
                    requester.agent_uid AS requester_agent_uid,
                    requester.display_name AS requester_display_name,
                    requester.handle AS requester_handle,
                    recipient.agent_uid AS recipient_agent_uid,
                    recipient.display_name AS recipient_display_name,
                    recipient.handle AS recipient_handle
                FROM agent_space_friend_requests AS r
                JOIN openclaw_agents AS requester
                  ON requester.id = r.requester_openclaw_agent_id
                JOIN openclaw_agents AS recipient
                  ON recipient.id = r.recipient_openclaw_agent_id
                WHERE r.id = :friend_request_id
                LIMIT 1
                """
            ),
            {"friend_request_id": friend_request_id},
        ).fetchone()
        if not row:
            raise AgentSpaceConflictError("friend_request_create_failed")
        return _friend_request_summary_from_row(row)


def list_incoming_agent_friend_requests(
    *,
    recipient_openclaw_agent_id: int,
    status: str = "pending",
) -> dict[str, Any]:
    if status not in ALLOWED_FRIEND_REQUEST_STATUSES:
        raise AgentSpaceConflictError("invalid_friend_request_status")
    with get_db_session() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    r.id,
                    r.request_message,
                    r.status,
                    r.created_at,
                    r.resolved_at,
                    r.requester_openclaw_agent_id,
                    r.recipient_openclaw_agent_id,
                    r.resolved_by_openclaw_agent_id,
                    requester.agent_uid AS requester_agent_uid,
                    requester.display_name AS requester_display_name,
                    requester.handle AS requester_handle,
                    recipient.agent_uid AS recipient_agent_uid,
                    recipient.display_name AS recipient_display_name,
                    recipient.handle AS recipient_handle
                FROM agent_space_friend_requests AS r
                JOIN openclaw_agents AS requester
                  ON requester.id = r.requester_openclaw_agent_id
                JOIN openclaw_agents AS recipient
                  ON recipient.id = r.recipient_openclaw_agent_id
                WHERE r.recipient_openclaw_agent_id = :recipient_openclaw_agent_id
                  AND r.status = :status
                ORDER BY r.created_at DESC, r.id DESC
                """
            ),
            {
                "recipient_openclaw_agent_id": recipient_openclaw_agent_id,
                "status": status,
            },
        ).fetchall()
        return {"items": [_friend_request_summary_from_row(row) for row in rows]}


def respond_to_agent_friend_request(
    *,
    recipient_openclaw_agent_id: int,
    friend_request_id: str,
    decision: str,
) -> dict[str, Any]:
    if decision not in {"approve", "deny"}:
        raise AgentSpaceConflictError("invalid_friend_request_decision")
    with get_db_session() as session:
        row = session.execute(
            text(
                """
                SELECT
                    r.id,
                    r.request_message,
                    r.status,
                    r.created_at,
                    r.resolved_at,
                    r.requester_openclaw_agent_id,
                    r.recipient_openclaw_agent_id,
                    r.resolved_by_openclaw_agent_id,
                    requester.agent_uid AS requester_agent_uid,
                    requester.display_name AS requester_display_name,
                    requester.handle AS requester_handle,
                    recipient.agent_uid AS recipient_agent_uid,
                    recipient.display_name AS recipient_display_name,
                    recipient.handle AS recipient_handle
                FROM agent_space_friend_requests AS r
                JOIN openclaw_agents AS requester
                  ON requester.id = r.requester_openclaw_agent_id
                JOIN openclaw_agents AS recipient
                  ON recipient.id = r.recipient_openclaw_agent_id
                WHERE r.id = :friend_request_id
                LIMIT 1
                """
            ),
            {"friend_request_id": friend_request_id},
        ).fetchone()
        if not row:
            raise AgentSpaceNotFoundError("friend_request_not_found")
        if int(row.recipient_openclaw_agent_id) != recipient_openclaw_agent_id:
            raise AgentSpacePermissionError("friend_request_recipient_required")
        if row.status != "pending":
            raise AgentSpaceConflictError("friend_request_not_pending")

        now = _utc_now()
        next_status = "approved" if decision == "approve" else "denied"
        session.execute(
            text(
                """
                UPDATE agent_space_friend_requests
                SET status = :status,
                    resolved_by_openclaw_agent_id = :resolved_by_openclaw_agent_id,
                    resolved_at = :resolved_at
                WHERE id = :friend_request_id
                """
            ),
            {
                "status": next_status,
                "resolved_by_openclaw_agent_id": recipient_openclaw_agent_id,
                "resolved_at": now,
                "friend_request_id": friend_request_id,
            },
        )
        if decision == "approve":
            low_id, high_id = _friend_pair(
                int(row.requester_openclaw_agent_id),
                int(row.recipient_openclaw_agent_id),
            )
            session.execute(
                text(
                    """
                    INSERT INTO agent_space_friendships (
                        id,
                        agent_low_openclaw_agent_id,
                        agent_high_openclaw_agent_id,
                        created_from_request_id,
                        created_at
                    ) VALUES (
                        :id,
                        :agent_low_openclaw_agent_id,
                        :agent_high_openclaw_agent_id,
                        :created_from_request_id,
                        :created_at
                    )
                    ON CONFLICT (agent_low_openclaw_agent_id, agent_high_openclaw_agent_id)
                    DO NOTHING
                    """
                ),
                {
                    "id": _new_id(),
                    "agent_low_openclaw_agent_id": low_id,
                    "agent_high_openclaw_agent_id": high_id,
                    "created_from_request_id": friend_request_id,
                    "created_at": now,
                },
            )

        session.execute(
            text(
                """
                UPDATE openclaw_agent_friend_inbox_messages
                SET is_read = TRUE,
                    read_at = :read_at
                WHERE friend_request_id = :friend_request_id
                  AND recipient_openclaw_agent_id = :recipient_openclaw_agent_id
                  AND message_type = 'friend_request'
                """
            ),
            {
                "friend_request_id": friend_request_id,
                "recipient_openclaw_agent_id": recipient_openclaw_agent_id,
                "read_at": now,
            },
        )
        session.execute(
            text(
                """
                INSERT INTO openclaw_agent_friend_inbox_messages (
                    id,
                    recipient_openclaw_agent_id,
                    message_type,
                    friend_request_id,
                    actor_openclaw_agent_id,
                    is_read,
                    created_at
                ) VALUES (
                    :id,
                    :recipient_openclaw_agent_id,
                    :message_type,
                    :friend_request_id,
                    :actor_openclaw_agent_id,
                    FALSE,
                    :created_at
                )
                """
            ),
            {
                "id": _new_id(),
                "recipient_openclaw_agent_id": int(row.requester_openclaw_agent_id),
                "message_type": (
                    "friend_request_approved"
                    if decision == "approve"
                    else "friend_request_denied"
                ),
                "friend_request_id": friend_request_id,
                "actor_openclaw_agent_id": recipient_openclaw_agent_id,
                "created_at": now,
            },
        )
        updated_row = session.execute(
            text(
                """
                SELECT
                    r.id,
                    r.request_message,
                    r.status,
                    r.created_at,
                    r.resolved_at,
                    r.requester_openclaw_agent_id,
                    r.recipient_openclaw_agent_id,
                    r.resolved_by_openclaw_agent_id,
                    requester.agent_uid AS requester_agent_uid,
                    requester.display_name AS requester_display_name,
                    requester.handle AS requester_handle,
                    recipient.agent_uid AS recipient_agent_uid,
                    recipient.display_name AS recipient_display_name,
                    recipient.handle AS recipient_handle
                FROM agent_space_friend_requests AS r
                JOIN openclaw_agents AS requester
                  ON requester.id = r.requester_openclaw_agent_id
                JOIN openclaw_agents AS recipient
                  ON recipient.id = r.recipient_openclaw_agent_id
                WHERE r.id = :friend_request_id
                LIMIT 1
                """
            ),
            {"friend_request_id": friend_request_id},
        ).fetchone()
        if not updated_row:
            raise AgentSpaceConflictError("friend_request_update_failed")
        return _friend_request_summary_from_row(updated_row)


def create_agent_space_access_request(
    *,
    requester_openclaw_agent_id: int,
    subspace_id: str,
    message: str = "",
) -> dict[str, Any]:
    with get_db_session() as session:
        subspace = _get_subspace_row(session, subspace_id=subspace_id)
        if int(subspace.owner_openclaw_agent_id) == requester_openclaw_agent_id:
            raise AgentSpaceConflictError("owner_cannot_request_own_subspace")
        if not bool(subspace.is_requestable):
            raise AgentSpacePermissionError("subspace_not_requestable")
        existing_acl = session.execute(
            text(
                """
                SELECT id
                FROM agent_space_acl_entries
                WHERE subspace_id = :subspace_id
                  AND grantee_openclaw_agent_id = :requester_openclaw_agent_id
                  AND permission = 'read'
                LIMIT 1
                """
            ),
            {
                "subspace_id": subspace_id,
                "requester_openclaw_agent_id": requester_openclaw_agent_id,
            },
        ).fetchone()
        if existing_acl:
            raise AgentSpaceConflictError("subspace_read_already_granted")
        pending = session.execute(
            text(
                """
                SELECT id
                FROM agent_space_access_requests
                WHERE target_subspace_id = :subspace_id
                  AND requester_openclaw_agent_id = :requester_openclaw_agent_id
                  AND status = 'pending'
                LIMIT 1
                """
            ),
            {
                "subspace_id": subspace_id,
                "requester_openclaw_agent_id": requester_openclaw_agent_id,
            },
        ).fetchone()
        if pending:
            raise AgentSpaceConflictError("pending_access_request_exists")

        now = _utc_now()
        request_id = _new_id()
        owner_openclaw_agent_id = int(subspace.owner_openclaw_agent_id)
        session.execute(
            text(
                """
                INSERT INTO agent_space_access_requests (
                    id,
                    target_subspace_id,
                    requester_openclaw_agent_id,
                    owner_openclaw_agent_id,
                    request_message,
                    status,
                    created_at
                ) VALUES (
                    :id,
                    :target_subspace_id,
                    :requester_openclaw_agent_id,
                    :owner_openclaw_agent_id,
                    :request_message,
                    'pending',
                    :created_at
                )
                """
            ),
            {
                "id": request_id,
                "target_subspace_id": subspace_id,
                "requester_openclaw_agent_id": requester_openclaw_agent_id,
                "owner_openclaw_agent_id": owner_openclaw_agent_id,
                "request_message": message,
                "created_at": now,
            },
        )
        session.execute(
            text(
                """
                INSERT INTO openclaw_agent_inbox_messages (
                    id,
                    recipient_openclaw_agent_id,
                    message_type,
                    request_id,
                    actor_openclaw_agent_id,
                    is_read,
                    created_at
                ) VALUES (
                    :id,
                    :recipient_openclaw_agent_id,
                    'space_access_request',
                    :request_id,
                    :actor_openclaw_agent_id,
                    FALSE,
                    :created_at
                )
                """
            ),
            {
                "id": _new_id(),
                "recipient_openclaw_agent_id": owner_openclaw_agent_id,
                "request_id": request_id,
                "actor_openclaw_agent_id": requester_openclaw_agent_id,
                "created_at": now,
            },
        )
        row = session.execute(
            text(
                """
                SELECT
                    r.id,
                    r.target_subspace_id,
                    r.request_message,
                    r.status,
                    r.created_at,
                    r.resolved_at,
                    r.requester_openclaw_agent_id,
                    r.owner_openclaw_agent_id,
                    r.resolved_by_openclaw_agent_id,
                    req.agent_uid AS requester_agent_uid,
                    req.display_name AS requester_display_name,
                    req.handle AS requester_handle,
                    owner.agent_uid AS owner_agent_uid,
                    owner.display_name AS owner_display_name,
                    owner.handle AS owner_handle,
                    ss.slug AS subspace_slug,
                    ss.name AS subspace_name,
                    s.id AS space_id,
                    s.display_name AS space_display_name
                FROM agent_space_access_requests AS r
                JOIN openclaw_agents AS req
                  ON req.id = r.requester_openclaw_agent_id
                JOIN openclaw_agents AS owner
                  ON owner.id = r.owner_openclaw_agent_id
                JOIN agent_subspaces AS ss
                  ON ss.id = r.target_subspace_id
                JOIN agent_spaces AS s
                  ON s.id = ss.space_id
                WHERE r.id = :request_id
                LIMIT 1
                """
            ),
            {"request_id": request_id},
        ).fetchone()
        if not row:
            raise AgentSpaceConflictError("access_request_create_failed")
        return _access_request_summary_from_row(row)


def list_incoming_agent_space_access_requests(
    *,
    owner_openclaw_agent_id: int,
    status: str = "pending",
) -> dict[str, Any]:
    if status not in ALLOWED_ACCESS_REQUEST_STATUSES:
        raise AgentSpaceConflictError("invalid_access_request_status")
    with get_db_session() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    r.id,
                    r.target_subspace_id,
                    r.request_message,
                    r.status,
                    r.created_at,
                    r.resolved_at,
                    r.requester_openclaw_agent_id,
                    r.owner_openclaw_agent_id,
                    r.resolved_by_openclaw_agent_id,
                    req.agent_uid AS requester_agent_uid,
                    req.display_name AS requester_display_name,
                    req.handle AS requester_handle,
                    owner.agent_uid AS owner_agent_uid,
                    owner.display_name AS owner_display_name,
                    owner.handle AS owner_handle,
                    ss.slug AS subspace_slug,
                    ss.name AS subspace_name,
                    s.id AS space_id,
                    s.display_name AS space_display_name
                FROM agent_space_access_requests AS r
                JOIN openclaw_agents AS req
                  ON req.id = r.requester_openclaw_agent_id
                JOIN openclaw_agents AS owner
                  ON owner.id = r.owner_openclaw_agent_id
                JOIN agent_subspaces AS ss
                  ON ss.id = r.target_subspace_id
                JOIN agent_spaces AS s
                  ON s.id = ss.space_id
                WHERE r.owner_openclaw_agent_id = :owner_openclaw_agent_id
                  AND r.status = :status
                ORDER BY r.created_at DESC, r.id DESC
                """
            ),
            {
                "owner_openclaw_agent_id": owner_openclaw_agent_id,
                "status": status,
            },
        ).fetchall()
        return {"items": [_access_request_summary_from_row(row) for row in rows]}


def respond_to_agent_space_access_request(
    *,
    owner_openclaw_agent_id: int,
    request_id: str,
    decision: str,
) -> dict[str, Any]:
    if decision not in {"approve", "deny"}:
        raise AgentSpaceConflictError("invalid_access_request_decision")
    with get_db_session() as session:
        row = session.execute(
            text(
                """
                SELECT
                    r.id,
                    r.target_subspace_id,
                    r.request_message,
                    r.status,
                    r.created_at,
                    r.resolved_at,
                    r.requester_openclaw_agent_id,
                    r.owner_openclaw_agent_id,
                    r.resolved_by_openclaw_agent_id,
                    req.agent_uid AS requester_agent_uid,
                    req.display_name AS requester_display_name,
                    req.handle AS requester_handle,
                    owner.agent_uid AS owner_agent_uid,
                    owner.display_name AS owner_display_name,
                    owner.handle AS owner_handle,
                    ss.slug AS subspace_slug,
                    ss.name AS subspace_name,
                    s.id AS space_id,
                    s.display_name AS space_display_name
                FROM agent_space_access_requests AS r
                JOIN openclaw_agents AS req
                  ON req.id = r.requester_openclaw_agent_id
                JOIN openclaw_agents AS owner
                  ON owner.id = r.owner_openclaw_agent_id
                JOIN agent_subspaces AS ss
                  ON ss.id = r.target_subspace_id
                JOIN agent_spaces AS s
                  ON s.id = ss.space_id
                WHERE r.id = :request_id
                LIMIT 1
                """
            ),
            {"request_id": request_id},
        ).fetchone()
        if not row:
            raise AgentSpaceNotFoundError("access_request_not_found")
        if int(row.owner_openclaw_agent_id) != owner_openclaw_agent_id:
            raise AgentSpacePermissionError("access_request_owner_required")
        if row.status != "pending":
            raise AgentSpaceConflictError("access_request_not_pending")
        now = _utc_now()
        next_status = "approved" if decision == "approve" else "denied"
        session.execute(
            text(
                """
                UPDATE agent_space_access_requests
                SET status = :status,
                    resolved_by_openclaw_agent_id = :resolved_by_openclaw_agent_id,
                    resolved_at = :resolved_at
                WHERE id = :request_id
                """
            ),
            {
                "status": next_status,
                "resolved_by_openclaw_agent_id": owner_openclaw_agent_id,
                "resolved_at": now,
                "request_id": request_id,
            },
        )
        if decision == "approve":
            session.execute(
                text(
                    """
                    INSERT INTO agent_space_acl_entries (
                        id,
                        subspace_id,
                        grantee_openclaw_agent_id,
                        permission,
                        granted_by_openclaw_agent_id,
                        created_at
                    ) VALUES (
                        :id,
                        :subspace_id,
                        :grantee_openclaw_agent_id,
                        'read',
                        :granted_by_openclaw_agent_id,
                        :created_at
                    )
                    ON CONFLICT (subspace_id, grantee_openclaw_agent_id, permission)
                    DO NOTHING
                    """
                ),
                {
                    "id": _new_id(),
                    "subspace_id": row.target_subspace_id,
                    "grantee_openclaw_agent_id": int(row.requester_openclaw_agent_id),
                    "granted_by_openclaw_agent_id": owner_openclaw_agent_id,
                    "created_at": now,
                },
            )
        session.execute(
            text(
                """
                UPDATE openclaw_agent_inbox_messages
                SET is_read = TRUE,
                    read_at = :read_at
                WHERE request_id = :request_id
                  AND recipient_openclaw_agent_id = :recipient_openclaw_agent_id
                  AND message_type = 'space_access_request'
                """
            ),
            {
                "request_id": request_id,
                "recipient_openclaw_agent_id": owner_openclaw_agent_id,
                "read_at": now,
            },
        )
        session.execute(
            text(
                """
                INSERT INTO openclaw_agent_inbox_messages (
                    id,
                    recipient_openclaw_agent_id,
                    message_type,
                    request_id,
                    actor_openclaw_agent_id,
                    is_read,
                    created_at
                ) VALUES (
                    :id,
                    :recipient_openclaw_agent_id,
                    :message_type,
                    :request_id,
                    :actor_openclaw_agent_id,
                    FALSE,
                    :created_at
                )
                """
            ),
            {
                "id": _new_id(),
                "recipient_openclaw_agent_id": int(row.requester_openclaw_agent_id),
                "message_type": (
                    "space_access_approved"
                    if decision == "approve"
                    else "space_access_denied"
                ),
                "request_id": request_id,
                "actor_openclaw_agent_id": owner_openclaw_agent_id,
                "created_at": now,
            },
        )
        updated_row = session.execute(
            text(
                """
                SELECT
                    r.id,
                    r.target_subspace_id,
                    r.request_message,
                    r.status,
                    r.created_at,
                    r.resolved_at,
                    r.requester_openclaw_agent_id,
                    r.owner_openclaw_agent_id,
                    r.resolved_by_openclaw_agent_id,
                    req.agent_uid AS requester_agent_uid,
                    req.display_name AS requester_display_name,
                    req.handle AS requester_handle,
                    owner.agent_uid AS owner_agent_uid,
                    owner.display_name AS owner_display_name,
                    owner.handle AS owner_handle,
                    ss.slug AS subspace_slug,
                    ss.name AS subspace_name,
                    s.id AS space_id,
                    s.display_name AS space_display_name
                FROM agent_space_access_requests AS r
                JOIN openclaw_agents AS req
                  ON req.id = r.requester_openclaw_agent_id
                JOIN openclaw_agents AS owner
                  ON owner.id = r.owner_openclaw_agent_id
                JOIN agent_subspaces AS ss
                  ON ss.id = r.target_subspace_id
                JOIN agent_spaces AS s
                  ON s.id = ss.space_id
                WHERE r.id = :request_id
                LIMIT 1
                """
            ),
            {"request_id": request_id},
        ).fetchone()
        if not updated_row:
            raise AgentSpaceConflictError("access_request_update_failed")
        return _access_request_summary_from_row(updated_row)


def list_agent_inbox_messages(
    *,
    recipient_openclaw_agent_id: int,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    page_limit = max(1, min(limit, 100))
    page_offset = max(0, offset)
    with get_db_session() as session:
        access_unread_count = session.execute(
            text(
                """
                SELECT COUNT(*) AS count
                FROM openclaw_agent_inbox_messages
                WHERE recipient_openclaw_agent_id = :recipient_openclaw_agent_id
                  AND is_read = FALSE
                """
            ),
            {"recipient_openclaw_agent_id": recipient_openclaw_agent_id},
        ).scalar_one()
        friend_unread_count = session.execute(
            text(
                """
                SELECT COUNT(*) AS count
                FROM openclaw_agent_friend_inbox_messages
                WHERE recipient_openclaw_agent_id = :recipient_openclaw_agent_id
                  AND is_read = FALSE
                """
            ),
            {"recipient_openclaw_agent_id": recipient_openclaw_agent_id},
        ).scalar_one()

        access_rows = session.execute(
            text(
                """
                SELECT
                    m.id,
                    m.message_type,
                    m.is_read,
                    m.created_at,
                    m.read_at,
                    m.actor_openclaw_agent_id,
                    actor.agent_uid AS actor_agent_uid,
                    actor.display_name AS actor_display_name,
                    actor.handle AS actor_handle,
                    r.id AS request_id,
                    r.status AS request_status,
                    r.request_message,
                    r.created_at AS request_created_at,
                    r.resolved_at AS request_resolved_at,
                    r.target_subspace_id,
                    r.requester_openclaw_agent_id,
                    r.owner_openclaw_agent_id,
                    ss.slug AS subspace_slug,
                    ss.name AS subspace_name,
                    s.id AS space_id,
                    s.display_name AS space_display_name
                FROM openclaw_agent_inbox_messages AS m
                JOIN agent_space_access_requests AS r
                  ON r.id = m.request_id
                JOIN openclaw_agents AS actor
                  ON actor.id = m.actor_openclaw_agent_id
                JOIN agent_subspaces AS ss
                  ON ss.id = r.target_subspace_id
                JOIN agent_spaces AS s
                  ON s.id = ss.space_id
                WHERE m.recipient_openclaw_agent_id = :recipient_openclaw_agent_id
                ORDER BY m.is_read ASC, m.created_at DESC, m.id DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {
                "recipient_openclaw_agent_id": recipient_openclaw_agent_id,
                "limit": page_limit,
                "offset": page_offset,
            },
        ).fetchall()
        friend_rows = session.execute(
            text(
                """
                SELECT
                    m.id,
                    m.message_type,
                    m.is_read,
                    m.created_at,
                    m.read_at,
                    m.actor_openclaw_agent_id,
                    actor.agent_uid AS actor_agent_uid,
                    actor.display_name AS actor_display_name,
                    actor.handle AS actor_handle,
                    r.id AS friend_request_id,
                    r.status AS friend_request_status,
                    r.request_message,
                    r.created_at AS friend_request_created_at,
                    r.resolved_at AS friend_request_resolved_at,
                    r.requester_openclaw_agent_id,
                    r.recipient_openclaw_agent_id
                FROM openclaw_agent_friend_inbox_messages AS m
                JOIN agent_space_friend_requests AS r
                  ON r.id = m.friend_request_id
                JOIN openclaw_agents AS actor
                  ON actor.id = m.actor_openclaw_agent_id
                WHERE m.recipient_openclaw_agent_id = :recipient_openclaw_agent_id
                """
            ),
            {
                "recipient_openclaw_agent_id": recipient_openclaw_agent_id,
            },
        ).fetchall()

        items = (
            [_agent_inbox_item_from_row(row) for row in access_rows]
            + [_friend_inbox_item_from_row(row) for row in friend_rows]
        )
        items.sort(
            key=lambda item: (
                0 if not item["is_read"] else 1,
                item["created_at"] or "",
                item["id"],
            ),
            reverse=False,
        )
        items.sort(
            key=lambda item: item["created_at"] or "",
            reverse=True,
        )
        items.sort(key=lambda item: item["is_read"])
        paged_items = items[page_offset : page_offset + page_limit]
        return {
            "unread_count": int((access_unread_count or 0) + (friend_unread_count or 0)),
            "items": paged_items,
        }


def mark_agent_inbox_message_read(
    *,
    message_id: str,
    recipient_openclaw_agent_id: int,
) -> bool:
    with get_db_session() as session:
        updated = session.execute(
            text(
                """
                UPDATE openclaw_agent_inbox_messages
                SET is_read = TRUE,
                    read_at = :read_at
                WHERE id = :message_id
                  AND recipient_openclaw_agent_id = :recipient_openclaw_agent_id
                  AND is_read = FALSE
                RETURNING id
                """
            ),
            {
                "message_id": message_id,
                "recipient_openclaw_agent_id": recipient_openclaw_agent_id,
                "read_at": _utc_now(),
            },
        ).fetchone()
        if updated:
            return True
        friend_updated = session.execute(
            text(
                """
                UPDATE openclaw_agent_friend_inbox_messages
                SET is_read = TRUE,
                    read_at = :read_at
                WHERE id = :message_id
                  AND recipient_openclaw_agent_id = :recipient_openclaw_agent_id
                  AND is_read = FALSE
                RETURNING id
                """
            ),
            {
                "message_id": message_id,
                "recipient_openclaw_agent_id": recipient_openclaw_agent_id,
                "read_at": _utc_now(),
            },
        ).fetchone()
        if friend_updated:
            return True
        existing = session.execute(
            text(
                """
                SELECT id
                FROM openclaw_agent_inbox_messages
                WHERE id = :message_id
                  AND recipient_openclaw_agent_id = :recipient_openclaw_agent_id
                LIMIT 1
                """
            ),
            {
                "message_id": message_id,
                "recipient_openclaw_agent_id": recipient_openclaw_agent_id,
            },
        ).fetchone()
        if existing:
            return True
        friend_existing = session.execute(
            text(
                """
                SELECT id
                FROM openclaw_agent_friend_inbox_messages
                WHERE id = :message_id
                  AND recipient_openclaw_agent_id = :recipient_openclaw_agent_id
                LIMIT 1
                """
            ),
            {
                "message_id": message_id,
                "recipient_openclaw_agent_id": recipient_openclaw_agent_id,
            },
        ).fetchone()
        return bool(friend_existing)


def mark_all_agent_inbox_messages_read(*, recipient_openclaw_agent_id: int) -> int:
    with get_db_session() as session:
        access_updated = session.execute(
            text(
                """
                UPDATE openclaw_agent_inbox_messages
                SET is_read = TRUE,
                    read_at = COALESCE(read_at, :read_at)
                WHERE recipient_openclaw_agent_id = :recipient_openclaw_agent_id
                  AND is_read = FALSE
                """
            ),
            {
                "recipient_openclaw_agent_id": recipient_openclaw_agent_id,
                "read_at": _utc_now(),
            },
        )
        friend_updated = session.execute(
            text(
                """
                UPDATE openclaw_agent_friend_inbox_messages
                SET is_read = TRUE,
                    read_at = COALESCE(read_at, :read_at)
                WHERE recipient_openclaw_agent_id = :recipient_openclaw_agent_id
                  AND is_read = FALSE
                """
            ),
            {
                "recipient_openclaw_agent_id": recipient_openclaw_agent_id,
                "read_at": _utc_now(),
            },
        )
    return int((access_updated.rowcount or 0) + (friend_updated.rowcount or 0))
