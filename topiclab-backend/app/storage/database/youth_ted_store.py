"""Storage helpers for the Youth TED activity landing page."""

from __future__ import annotations

import json
import os
from pathlib import Path
import copy
from threading import RLock
from time import monotonic
from typing import Any

from sqlalchemy import text

from app.storage.database.postgres_client import _is_sqlite_session, get_db_session


SEED_ACTIVITY_SLUG = "frontier-ai-discussion-2026-05"
POSTER_MIME_TYPE = "image/webp"

_SEED_POSTER_PATH = Path(__file__).resolve().parents[2] / "resources" / "youth_ted_poster.webp"

_SEED_PAYLOAD: dict[str, Any] = {
    "label": "本期活动",
    "title": "前沿 AI 进展专场讨论",
    "meta": "周三晚 20:00",
    "summary": "围绕 Agent 与 Codex 生态、Skill 系统、AI 内容工程与开源工具，快速同步最近值得追踪的变化。",
    "content": {
        "format_version": 1,
        "agenda": [
            "AI 前沿进展分享",
            "Agent4S 及他山世界最新进展同步",
            "社区案例深度讨论",
        ],
        "keywords": [
            "Agent 与 Codex 生态加速",
            "Skill 系统成为新入口",
            "AI 内容工程与 GEO",
            "开源工具与落地实战",
        ],
    },
}

_CACHE_LOCK = RLock()
_ACTIVITIES_CACHE: tuple[float, list[dict[str, Any]]] | None = None
_POSTER_CACHE: dict[str, tuple[float, tuple[bytes, str]]] = {}


def _cache_ttl_seconds() -> float:
    raw_value = os.getenv("YOUTH_TED_CACHE_TTL_SECONDS", "60")
    try:
        return max(0.0, float(raw_value))
    except ValueError:
        return 60.0


def clear_youth_ted_cache() -> None:
    """Clear Youth TED read caches after direct data updates or admin writes."""
    global _ACTIVITIES_CACHE
    with _CACHE_LOCK:
        _ACTIVITIES_CACHE = None
        _POSTER_CACHE.clear()


def _cache_is_fresh(expires_at: float) -> bool:
    return _cache_ttl_seconds() > 0 and monotonic() < expires_at


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _json_loads(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    return json.loads(value)


def _apply_youth_ted_ddl(session) -> None:
    is_sqlite = _is_sqlite_session(session)
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS youth_ted_activities (
                id TEXT PRIMARY KEY,
                slug TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL DEFAULT 'published',
                sort_order INTEGER NOT NULL DEFAULT 0,
                payload_json TEXT NOT NULL,
                poster_webp BLOB NOT NULL,
                poster_mime_type TEXT NOT NULL DEFAULT 'image/webp',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS youth_ted_activities (
                id VARCHAR(255) PRIMARY KEY,
                slug VARCHAR(255) NOT NULL UNIQUE,
                status VARCHAR(32) NOT NULL DEFAULT 'published',
                sort_order INTEGER NOT NULL DEFAULT 0,
                payload_json JSONB NOT NULL,
                poster_webp BYTEA NOT NULL,
                poster_mime_type VARCHAR(64) NOT NULL DEFAULT 'image/webp',
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    session.execute(
        text(
            "CREATE INDEX IF NOT EXISTS "
            "idx_youth_ted_activities_status_sort "
            "ON youth_ted_activities(status, sort_order)"
        )
    )


def _seed_youth_ted_activity(session) -> None:
    if not _SEED_POSTER_PATH.exists():
        raise FileNotFoundError(f"Youth TED seed poster missing: {_SEED_POSTER_PATH}")

    existing_activity = session.execute(
        text("SELECT 1 FROM youth_ted_activities LIMIT 1"),
    ).first()
    if existing_activity:
        return

    payload_json = _json_dumps(_SEED_PAYLOAD)
    poster_webp = _SEED_POSTER_PATH.read_bytes()
    is_sqlite = _is_sqlite_session(session)
    insert_sql = (
        """
        INSERT OR IGNORE INTO youth_ted_activities (
            id, slug, status, sort_order, payload_json, poster_webp, poster_mime_type
        )
        VALUES (
            :id, :slug, :status, :sort_order, :payload_json, :poster_webp, :poster_mime_type
        )
        """
        if is_sqlite
        else
        """
        INSERT INTO youth_ted_activities (
            id, slug, status, sort_order, payload_json, poster_webp, poster_mime_type
        )
        VALUES (
            :id, :slug, :status, :sort_order, CAST(:payload_json AS JSONB), :poster_webp, :poster_mime_type
        )
        ON CONFLICT (slug) DO NOTHING
        """
    )
    session.execute(
        text(insert_sql),
        {
            "id": SEED_ACTIVITY_SLUG,
            "slug": SEED_ACTIVITY_SLUG,
            "status": "published",
            "sort_order": 10,
            "payload_json": payload_json,
            "poster_webp": poster_webp,
            "poster_mime_type": POSTER_MIME_TYPE,
        },
    )


def ensure_youth_ted_schema_and_seed() -> None:
    with get_db_session() as session:
        ensure_youth_ted_schema_and_seed_for_session(session)


def ensure_youth_ted_schema_and_seed_for_session(session) -> None:
    _apply_youth_ted_ddl(session)
    _seed_youth_ted_activity(session)


def _serialize_activity(row) -> dict[str, Any]:
    payload = _json_loads(row.payload_json)
    return {
        "id": row.id,
        "slug": row.slug,
        "status": row.status,
        "sort_order": row.sort_order,
        "label": payload.get("label", ""),
        "title": payload.get("title", ""),
        "meta": payload.get("meta", ""),
        "summary": payload.get("summary", ""),
        "content": payload.get("content") or {},
        "poster_url": f"/api/v1/youth-ted/activities/{row.slug}/poster.webp",
    }


def list_youth_ted_activities() -> list[dict[str, Any]]:
    global _ACTIVITIES_CACHE
    with _CACHE_LOCK:
        if _ACTIVITIES_CACHE is not None and _cache_is_fresh(_ACTIVITIES_CACHE[0]):
            return copy.deepcopy(_ACTIVITIES_CACHE[1])

        with get_db_session() as session:
            ensure_youth_ted_schema_and_seed_for_session(session)
            rows = session.execute(
                text(
                    """
                    SELECT id, slug, status, sort_order, payload_json
                    FROM youth_ted_activities
                    WHERE status = 'published'
                      AND NOT (
                          slug = :seed_slug
                          AND EXISTS (
                              SELECT 1
                              FROM youth_ted_activities AS formal_activity
                              WHERE formal_activity.status = 'published'
                                AND formal_activity.slug != :seed_slug
                          )
                      )
                    ORDER BY sort_order ASC, created_at DESC
                    """
                ),
                {"seed_slug": SEED_ACTIVITY_SLUG},
            ).fetchall()
            activities = [_serialize_activity(row) for row in rows]

        ttl = _cache_ttl_seconds()
        if ttl > 0:
            _ACTIVITIES_CACHE = (monotonic() + ttl, copy.deepcopy(activities))
        else:
            _ACTIVITIES_CACHE = None
        return activities


def get_youth_ted_activity_poster(slug: str) -> tuple[bytes, str] | None:
    with _CACHE_LOCK:
        cached = _POSTER_CACHE.get(slug)
        if cached is not None and _cache_is_fresh(cached[0]):
            return cached[1]

        with get_db_session() as session:
            ensure_youth_ted_schema_and_seed_for_session(session)
            row = session.execute(
                text(
                    """
                    SELECT poster_webp, poster_mime_type
                    FROM youth_ted_activities
                    WHERE slug = :slug AND status = 'published'
                    LIMIT 1
                    """
                ),
                {"slug": slug},
            ).first()
            if not row:
                return None
            poster = (bytes(row.poster_webp), row.poster_mime_type or POSTER_MIME_TYPE)

        ttl = _cache_ttl_seconds()
        if ttl > 0:
            _POSTER_CACHE[slug] = (monotonic() + ttl, poster)
        else:
            _POSTER_CACHE.pop(slug, None)
        return poster
