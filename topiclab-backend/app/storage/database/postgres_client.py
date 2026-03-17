"""Database client for TopicLab backend. Uses DATABASE_URL from .env."""

import os
import logging
from contextlib import contextmanager
from typing import Optional
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool

logger = logging.getLogger(__name__)
PGSSLMODE = os.getenv("PGSSLMODE", "disable")


def _get_engine_url() -> Optional[str]:
    """Return DATABASE_URL with sslmode appended if not present."""
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        return None
    parsed = urlparse(database_url)
    query = parse_qs(parsed.query)
    if parsed.scheme.startswith("postgresql") and "sslmode" not in query and PGSSLMODE:
        query["sslmode"] = [PGSSLMODE]
        new_query = urlencode(query, doseq=True)
        parsed = parsed._replace(query=new_query)
    return urlunparse(parsed)


_engine = None
_SessionLocal = None


def get_engine():
    """Create or return SQLAlchemy engine."""
    global _engine
    if _engine is not None:
        return _engine
    url = _get_engine_url()
    if not url:
        raise ValueError("DATABASE_URL is not set")
    kwargs = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    else:
        kwargs["poolclass"] = QueuePool
        kwargs["pool_size"] = int(os.getenv("DB_POOL_SIZE", "5"))
        kwargs["max_overflow"] = int(os.getenv("DB_POOL_MAX_OVERFLOW", "10"))
    _engine = create_engine(url, **kwargs)
    return _engine


def get_session_factory():
    """Create or return session factory."""
    global _SessionLocal
    if _SessionLocal is not None:
        return _SessionLocal
    engine = get_engine()
    _SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    return _SessionLocal


@contextmanager
def get_db_session():
    """Context manager for database session."""
    factory = get_session_factory()
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def init_auth_tables():
    """Create auth-related tables if they do not exist."""
    with get_db_session() as session:
        session.execute(text("""
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                phone VARCHAR(20) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                username VARCHAR(50),
                is_admin BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        session.execute(text("""
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE
        """))
        session.execute(text("""
            CREATE TABLE IF NOT EXISTS verification_codes (
                id SERIAL PRIMARY KEY,
                phone VARCHAR(20) NOT NULL,
                code VARCHAR(10) NOT NULL,
                type VARCHAR(20) NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_verification_codes_phone_type
            ON verification_codes(phone, type)
        """))
        session.execute(text("""
            CREATE TABLE IF NOT EXISTS digital_twins (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                agent_name VARCHAR(100) NOT NULL,
                display_name VARCHAR(100),
                expert_name VARCHAR(100),
                visibility VARCHAR(20) NOT NULL DEFAULT 'private',
                exposure VARCHAR(20) NOT NULL DEFAULT 'brief',
                session_id VARCHAR(100),
                source VARCHAR(50) NOT NULL DEFAULT 'profile_twin',
                role_content TEXT,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(user_id, agent_name)
            )
        """))
        session.execute(text("""
            ALTER TABLE digital_twins
            ADD COLUMN IF NOT EXISTS role_content TEXT
        """))
        session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_digital_twins_user_id
            ON digital_twins(user_id)
        """))
        session.execute(text("""
            CREATE TABLE IF NOT EXISTS openclaw_api_keys (
                user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                token_hash VARCHAR(64) NOT NULL UNIQUE,
                token_prefix VARCHAR(24) NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_used_at TIMESTAMPTZ
            )
        """))
        session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_openclaw_api_keys_token_hash
            ON openclaw_api_keys(token_hash)
        """))
    logger.info("Auth tables initialized")


def reset_db_state():
    """Dispose cached engine/sessionmaker so tests can swap DATABASE_URL."""
    global _engine, _SessionLocal
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _SessionLocal = None
