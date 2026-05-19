"""Storage helpers for small site-level assets."""

from __future__ import annotations

from pathlib import Path
from threading import RLock
from time import monotonic

from sqlalchemy import text

from app.storage.database.postgres_client import _is_sqlite_session, get_db_session


WECHAT_GROUP_QR_KEY = "wechat-group-qr"
WEBP_MIME_TYPE = "image/webp"

_SEED_WECHAT_GROUP_QR_PATH = Path(__file__).resolve().parents[2] / "resources" / "wechat_group_qr.webp"
_CACHE_LOCK = RLock()
_ASSET_CACHE: dict[str, tuple[float, tuple[bytes, str]]] = {}


def _cache_ttl_seconds() -> float:
    return 60.0


def clear_site_assets_cache() -> None:
    with _CACHE_LOCK:
        _ASSET_CACHE.clear()


def _cache_is_fresh(expires_at: float) -> bool:
    return _cache_ttl_seconds() > 0 and monotonic() < expires_at


def _apply_site_assets_ddl(session) -> None:
    is_sqlite = _is_sqlite_session(session)
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS site_assets (
                key TEXT PRIMARY KEY,
                image_webp BLOB NOT NULL,
                mime_type TEXT NOT NULL DEFAULT 'image/webp',
                expires_at TEXT,
                source_filename TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS site_assets (
                key VARCHAR(128) PRIMARY KEY,
                image_webp BYTEA NOT NULL,
                mime_type VARCHAR(64) NOT NULL DEFAULT 'image/webp',
                expires_at TIMESTAMPTZ,
                source_filename TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )


def _seed_wechat_group_qr(session) -> None:
    existing = session.execute(
        text("SELECT 1 FROM site_assets WHERE key = :key LIMIT 1"),
        {"key": WECHAT_GROUP_QR_KEY},
    ).first()
    if existing:
        return
    if not _SEED_WECHAT_GROUP_QR_PATH.exists():
        return

    upsert_site_image_asset_for_session(
        session,
        key=WECHAT_GROUP_QR_KEY,
        image_webp=_SEED_WECHAT_GROUP_QR_PATH.read_bytes(),
        mime_type=WEBP_MIME_TYPE,
        expires_at=None,
        source_filename=_SEED_WECHAT_GROUP_QR_PATH.name,
    )


def ensure_site_assets_schema_and_seed() -> None:
    with get_db_session() as session:
        ensure_site_assets_schema_and_seed_for_session(session)


def ensure_site_assets_schema_and_seed_for_session(session) -> None:
    _apply_site_assets_ddl(session)
    _seed_wechat_group_qr(session)


def upsert_site_image_asset_for_session(
    session,
    *,
    key: str,
    image_webp: bytes,
    mime_type: str = WEBP_MIME_TYPE,
    expires_at: str | None = None,
    source_filename: str | None = None,
) -> None:
    if not key.strip():
        raise ValueError("asset key is required")
    if not image_webp:
        raise ValueError("image_webp is required")
    if mime_type != WEBP_MIME_TYPE:
        raise ValueError("site image assets must be image/webp")

    is_sqlite = _is_sqlite_session(session)
    session.execute(
        text(
            """
            INSERT INTO site_assets (
                key, image_webp, mime_type, expires_at, source_filename, created_at, updated_at
            )
            VALUES (
                :key, :image_webp, :mime_type, :expires_at, :source_filename, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            ON CONFLICT(key) DO UPDATE SET
                image_webp = excluded.image_webp,
                mime_type = excluded.mime_type,
                expires_at = excluded.expires_at,
                source_filename = excluded.source_filename,
                updated_at = CURRENT_TIMESTAMP
            """
            if is_sqlite
            else
            """
            INSERT INTO site_assets (
                key, image_webp, mime_type, expires_at, source_filename, created_at, updated_at
            )
            VALUES (
                :key, :image_webp, :mime_type, CAST(:expires_at AS TIMESTAMPTZ), :source_filename, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            ON CONFLICT(key) DO UPDATE SET
                image_webp = excluded.image_webp,
                mime_type = excluded.mime_type,
                expires_at = excluded.expires_at,
                source_filename = excluded.source_filename,
                updated_at = CURRENT_TIMESTAMP
            """
        ),
        {
            "key": key,
            "image_webp": image_webp,
            "mime_type": mime_type,
            "expires_at": expires_at,
            "source_filename": source_filename,
        },
    )
    clear_site_assets_cache()


def upsert_site_image_asset(
    *,
    key: str,
    image_webp: bytes,
    mime_type: str = WEBP_MIME_TYPE,
    expires_at: str | None = None,
    source_filename: str | None = None,
) -> None:
    with get_db_session() as session:
        ensure_site_assets_schema_and_seed_for_session(session)
        upsert_site_image_asset_for_session(
            session,
            key=key,
            image_webp=image_webp,
            mime_type=mime_type,
            expires_at=expires_at,
            source_filename=source_filename,
        )


def get_site_image_asset(key: str) -> tuple[bytes, str] | None:
    with _CACHE_LOCK:
        cached = _ASSET_CACHE.get(key)
        if cached is not None and _cache_is_fresh(cached[0]):
            return cached[1]

        with get_db_session() as session:
            ensure_site_assets_schema_and_seed_for_session(session)
            row = session.execute(
                text(
                    """
                    SELECT image_webp, mime_type
                    FROM site_assets
                    WHERE key = :key
                    LIMIT 1
                    """
                ),
                {"key": key},
            ).first()
            if not row:
                return None
            asset = (bytes(row.image_webp), row.mime_type or WEBP_MIME_TYPE)

        ttl = _cache_ttl_seconds()
        if ttl > 0:
            _ASSET_CACHE[key] = (monotonic() + ttl, asset)
        else:
            _ASSET_CACHE.pop(key, None)
        return asset
