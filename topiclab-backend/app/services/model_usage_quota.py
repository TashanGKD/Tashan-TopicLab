"""Database-backed admission control for SkillHub model-backed operations."""

from __future__ import annotations

import hashlib
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from threading import Lock

from fastapi import HTTPException
from sqlalchemy import text

from app.storage.database.postgres_client import get_db_session


LIMITS: dict[str, tuple[int, int, int]] = {
    # operation: (short-window seconds, short-window requests, rolling-day requests)
    "science_finder": (60, 10, 200),
    "critic_evaluation": (600, 2, 5),
}

_memory_usage: dict[tuple[int, str], list[datetime]] = defaultdict(list)
_memory_usage_lock = Lock()


def _advisory_lock_id(user_id: int, operation: str) -> int:
    digest = hashlib.sha256(f"{user_id}:{operation}".encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") & ((1 << 63) - 1)


def _consume_in_memory_usage(
    user_id: int,
    operation: str,
    *,
    now: datetime,
    window_seconds: int,
    window_limit: int,
    day_limit: int,
) -> None:
    """Apply the same quota contract for local development without a database."""

    key = (user_id, operation)
    window_start = now - timedelta(seconds=window_seconds)
    day_start = now - timedelta(days=1)
    with _memory_usage_lock:
        recent = [created_at for created_at in _memory_usage[key] if created_at >= day_start]
        if sum(created_at >= window_start for created_at in recent) >= window_limit:
            raise HTTPException(
                status_code=429,
                detail="请求过于频繁，请稍后再试",
                headers={"Retry-After": str(window_seconds)},
            )
        if len(recent) >= day_limit:
            raise HTTPException(
                status_code=429,
                detail="今日模型调用额度已用完",
                headers={"Retry-After": "3600"},
            )
        recent.append(now)
        _memory_usage[key] = recent


def consume_model_usage(user_id: int, operation: str) -> None:
    """Atomically reserve one model-backed request or raise HTTP 429."""

    if operation not in LIMITS:
        raise ValueError(f"unknown model operation: {operation}")
    if user_id <= 0:
        raise HTTPException(status_code=401, detail="未登录")

    window_seconds, window_limit, day_limit = LIMITS[operation]
    now = datetime.now(timezone.utc)
    if not os.getenv("DATABASE_URL", "").strip():
        _consume_in_memory_usage(
            user_id,
            operation,
            now=now,
            window_seconds=window_seconds,
            window_limit=window_limit,
            day_limit=day_limit,
        )
        return

    window_start = now - timedelta(seconds=window_seconds)
    day_start = now - timedelta(days=1)
    params = {
        "user_id": user_id,
        "operation": operation,
        "window_start": window_start,
        "day_start": day_start,
        "now": now,
    }

    with get_db_session() as session:
        bind = session.get_bind()
        if bind.dialect.name == "postgresql":
            session.execute(
                text("SELECT pg_advisory_xact_lock(:lock_id)"),
                {"lock_id": _advisory_lock_id(user_id, operation)},
            )
        short_count = int(
            session.execute(
                text(
                    """
                    SELECT COUNT(*) FROM skill_hub_model_usage
                    WHERE user_id = :user_id AND operation = :operation
                      AND created_at >= :window_start
                    """
                ),
                params,
            ).scalar_one()
        )
        day_count = int(
            session.execute(
                text(
                    """
                    SELECT COUNT(*) FROM skill_hub_model_usage
                    WHERE user_id = :user_id AND operation = :operation
                      AND created_at >= :day_start
                    """
                ),
                params,
            ).scalar_one()
        )
        if short_count >= window_limit:
            raise HTTPException(
                status_code=429,
                detail="请求过于频繁，请稍后再试",
                headers={"Retry-After": str(window_seconds)},
            )
        if day_count >= day_limit:
            raise HTTPException(
                status_code=429,
                detail="今日模型调用额度已用完",
                headers={"Retry-After": "3600"},
            )
        session.execute(
            text(
                """
                INSERT INTO skill_hub_model_usage (user_id, operation, created_at)
                VALUES (:user_id, :operation, :now)
                """
            ),
            params,
        )
        session.execute(
            text("DELETE FROM skill_hub_model_usage WHERE created_at < :cutoff"),
            {"cutoff": now - timedelta(days=7)},
        )
