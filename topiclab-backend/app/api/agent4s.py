"""Read-only Agent4S publication data shared with tashanhomepage."""

from __future__ import annotations

import os
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from fastapi import APIRouter, HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.pool import NullPool

router = APIRouter(prefix="/agent4s", tags=["agent4s"])


def _shared_database_url() -> str:
    return (os.getenv("TASHAN_HOMEPAGE_DATABASE_URL") or os.getenv("DATABASE_URL") or "").strip()


def _engine_url() -> str:
    url = _shared_database_url()
    if not url:
        raise HTTPException(status_code=503, detail="Agent4S database is not configured")

    parsed = urlparse(url)
    if parsed.scheme.startswith("postgresql"):
        query = parse_qs(parsed.query)
        if "sslmode" not in query:
            query["sslmode"] = [os.getenv("TASHAN_HOMEPAGE_PGSSLMODE", os.getenv("PGSSLMODE", "disable"))]
            parsed = parsed._replace(query=urlencode(query, doseq=True))
    return urlunparse(parsed)


def _create_engine():
    url = _engine_url()
    if url.startswith("sqlite"):
        return create_engine(url, poolclass=NullPool, connect_args={"check_same_thread": False})

    return create_engine(
        url,
        poolclass=NullPool,
        connect_args={"connect_timeout": int(os.getenv("TASHAN_HOMEPAGE_DB_CONNECT_TIMEOUT", "5"))},
    )


@router.get("/wechat-articles")
def list_agent4s_wechat_articles():
    engine = None
    try:
        engine = _create_engine()
        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    """
                    SELECT
                        id,
                        album_id,
                        msgid,
                        title,
                        cover_url,
                        link,
                        read_count,
                        like_count,
                        share_count,
                        published_at,
                        sort_order,
                        is_hidden
                    FROM agent4s_wechat_articles
                    WHERE COALESCE(is_hidden, FALSE) = FALSE
                    ORDER BY published_at DESC NULLS LAST, id DESC
                    """
                )
            ).mappings().all()
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Agent4S database is unavailable") from exc
    finally:
        if engine is not None:
            engine.dispose()

    return {
        "articles": [
            {
                "id": row["id"],
                "album_id": row["album_id"],
                "msgid": row["msgid"],
                "title": row["title"],
                "cover_url": row["cover_url"],
                "link": row["link"],
                "read_count": row["read_count"],
                "like_count": row["like_count"],
                "share_count": row["share_count"],
                "published_at": (
                    row["published_at"].isoformat()
                    if hasattr(row["published_at"], "isoformat")
                    else row["published_at"]
                ),
                "sort_order": row["sort_order"],
                "is_hidden": row["is_hidden"],
            }
            for row in rows
        ],
        "source": "tashanhomepage",
    }
