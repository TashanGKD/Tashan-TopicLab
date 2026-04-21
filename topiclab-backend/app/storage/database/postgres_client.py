import logging
import os
import sys
from contextlib import contextmanager
from time import sleep
from typing import Optional
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool

logger = logging.getLogger(__name__)
PGSSLMODE = os.getenv("PGSSLMODE", "disable")


def _is_sqlite_url(url: str) -> bool:
    return urlparse(url).scheme.startswith("sqlite")


def _is_test_process() -> bool:
    if os.getenv("TOPICLAB_TESTING") == "1":
        return True
    if os.getenv("PYTEST_CURRENT_TEST"):
        return True
    argv = " ".join(sys.argv).lower()
    return "pytest" in argv


def _guard_against_non_sqlite_test_database(url: str) -> None:
    if not _is_test_process():
        return
    if _is_sqlite_url(url):
        return
    if os.getenv("TOPICLAB_ALLOW_NON_SQLITE_TEST_DB") == "1":
        logger.warning("TOPICLAB_ALLOW_NON_SQLITE_TEST_DB=1 set; allowing non-SQLite database during tests")
        return
    raise RuntimeError(
        "Refusing to open non-SQLite DATABASE_URL while running tests. "
        "Use a local SQLite DB, or set TOPICLAB_ALLOW_NON_SQLITE_TEST_DB=1 only for an intentional override."
    )


def _get_engine_url() -> Optional[str]:
    """Return DATABASE_URL with sslmode appended if not present."""
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        return None
    parsed = urlparse(database_url)
    if parsed.scheme.startswith("sqlite"):
        return database_url
    query = parse_qs(parsed.query)
    if parsed.scheme.startswith("postgresql") and "sslmode" not in query and PGSSLMODE:
        query["sslmode"] = [PGSSLMODE]
        new_query = urlencode(query, doseq=True)
        parsed = parsed._replace(query=new_query)
    return urlunparse(parsed)


_engine = None
_SessionLocal = None


def _is_sqlite_session(session) -> bool:
    return session.bind.dialect.name == "sqlite"


def _get_session_inspector(session):
    return inspect(session.connection())


def get_engine():
    """Create or return SQLAlchemy engine."""
    global _engine
    if _engine is not None:
        return _engine
    url = _get_engine_url()
    if not url:
        raise ValueError("DATABASE_URL is not set")
    _guard_against_non_sqlite_test_database(url)
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


def _apply_site_feedback_ddl(session) -> None:
    """Create site_feedback table and indexes (idempotent)."""
    is_sqlite = _is_sqlite_session(session)
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS site_feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                username VARCHAR(255) NOT NULL,
                auth_channel VARCHAR(32) NOT NULL DEFAULT 'anonymous',
                scenario TEXT NOT NULL DEFAULT '',
                body TEXT NOT NULL,
                steps_to_reproduce TEXT NOT NULL DEFAULT '',
                page_url TEXT,
                client_user_agent TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS site_feedback (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                username VARCHAR(255) NOT NULL,
                auth_channel VARCHAR(32) NOT NULL DEFAULT 'anonymous',
                scenario TEXT NOT NULL DEFAULT '',
                body TEXT NOT NULL,
                steps_to_reproduce TEXT NOT NULL DEFAULT '',
                page_url TEXT,
                client_user_agent TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    if is_sqlite:
        pragma_rows = session.execute(text("PRAGMA table_info(site_feedback)")).fetchall()
        pragma_by_name = {str(row[1]): row for row in pragma_rows}
        has_message = "message" in pragma_by_name
        has_user_agent = "user_agent" in pragma_by_name
        sqlite_column_migrations = {
            "username": "ALTER TABLE site_feedback ADD COLUMN username VARCHAR(255) NOT NULL DEFAULT ''",
            "auth_channel": "ALTER TABLE site_feedback ADD COLUMN auth_channel VARCHAR(32) NOT NULL DEFAULT 'anonymous'",
            "scenario": "ALTER TABLE site_feedback ADD COLUMN scenario TEXT NOT NULL DEFAULT ''",
            "body": "ALTER TABLE site_feedback ADD COLUMN body TEXT NOT NULL DEFAULT ''",
            "steps_to_reproduce": "ALTER TABLE site_feedback ADD COLUMN steps_to_reproduce TEXT NOT NULL DEFAULT ''",
            "page_url": "ALTER TABLE site_feedback ADD COLUMN page_url TEXT",
            "client_user_agent": "ALTER TABLE site_feedback ADD COLUMN client_user_agent TEXT",
            "created_at": "ALTER TABLE site_feedback ADD COLUMN created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
        }
        for column_name, ddl in sqlite_column_migrations.items():
            if column_name not in pragma_by_name:
                session.execute(text(ddl))
        pragma_rows = session.execute(text("PRAGMA table_info(site_feedback)")).fetchall()
        pragma_by_name = {str(row[1]): row for row in pragma_rows}
        user_id_info = pragma_by_name.get("user_id")
        auth_channel_info = pragma_by_name.get("auth_channel")
        needs_rebuild = bool(user_id_info and int(user_id_info[3] or 0) == 1)
        if needs_rebuild:
            session.execute(text("PRAGMA foreign_keys=OFF"))
            session.execute(text("DROP TABLE IF EXISTS site_feedback__new"))
            session.execute(
                text(
                    """
                    CREATE TABLE site_feedback__new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                        username VARCHAR(255) NOT NULL,
                        auth_channel VARCHAR(32) NOT NULL DEFAULT 'anonymous',
                        scenario TEXT NOT NULL DEFAULT '',
                        body TEXT NOT NULL,
                        steps_to_reproduce TEXT NOT NULL DEFAULT '',
                        page_url TEXT,
                        client_user_agent TEXT,
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
            )
            body_expr = "COALESCE(body, COALESCE(message, ''))" if has_message else "COALESCE(body, '')"
            user_agent_expr = "COALESCE(client_user_agent, user_agent)" if has_user_agent else "client_user_agent"
            session.execute(
                text(
                    f"""
                    INSERT INTO site_feedback__new (
                        id, user_id, username, auth_channel, scenario, body, steps_to_reproduce, page_url, client_user_agent, created_at
                    )
                    SELECT
                        id,
                        user_id,
                        COALESCE(NULLIF(username, ''), CASE WHEN user_id IS NULL THEN '匿名用户' ELSE '' END),
                        COALESCE(NULLIF(auth_channel, ''), 'jwt'),
                        COALESCE(scenario, ''),
                        {body_expr},
                        COALESCE(steps_to_reproduce, ''),
                        page_url,
                        {user_agent_expr},
                        COALESCE(created_at, CURRENT_TIMESTAMP)
                    FROM site_feedback
                    """
                )
            )
            session.execute(text("DROP TABLE site_feedback"))
            session.execute(text("ALTER TABLE site_feedback__new RENAME TO site_feedback"))
            session.execute(text("PRAGMA foreign_keys=ON"))
            has_message = False
            has_user_agent = False
        session.execute(
            text(
                """
                UPDATE site_feedback
                SET username = CASE
                        WHEN COALESCE(username, '') <> '' THEN username
                        WHEN user_id IS NULL THEN '匿名用户'
                        ELSE username
                    END,
                    auth_channel = CASE
                        WHEN user_id IS NULL AND COALESCE(auth_channel, '') IN ('', 'jwt') THEN 'anonymous'
                        WHEN COALESCE(auth_channel, '') = '' THEN 'jwt'
                        ELSE auth_channel
                    END
                """
            )
        )
        if has_message:
            session.execute(
                text(
                    """
                    UPDATE site_feedback
                    SET body = CASE
                        WHEN COALESCE(body, '') <> '' THEN body
                        ELSE COALESCE(message, '')
                    END
                    """
                )
            )
        if has_user_agent:
            session.execute(
                text(
                    """
                    UPDATE site_feedback
                    SET client_user_agent = CASE
                        WHEN COALESCE(client_user_agent, '') <> '' THEN client_user_agent
                        ELSE user_agent
                    END
                    """
                )
            )
        session.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_site_feedback_user_id
                ON site_feedback(user_id)
                """
            )
        )
        session.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_site_feedback_created_at
                ON site_feedback(created_at DESC)
                """
            )
        )
        return
    inspector = _get_session_inspector(session)
    existing_columns_info = {column["name"]: column for column in inspector.get_columns("site_feedback")}
    existing_columns = set(existing_columns_info)
    column_migrations = {
        "username": "ALTER TABLE site_feedback ADD COLUMN username VARCHAR(255) NOT NULL DEFAULT ''",
        "auth_channel": "ALTER TABLE site_feedback ADD COLUMN auth_channel VARCHAR(32) NOT NULL DEFAULT 'anonymous'",
        "scenario": "ALTER TABLE site_feedback ADD COLUMN scenario TEXT NOT NULL DEFAULT ''",
        "body": "ALTER TABLE site_feedback ADD COLUMN body TEXT NOT NULL DEFAULT ''",
        "steps_to_reproduce": "ALTER TABLE site_feedback ADD COLUMN steps_to_reproduce TEXT NOT NULL DEFAULT ''",
        "page_url": "ALTER TABLE site_feedback ADD COLUMN page_url TEXT",
        "client_user_agent": "ALTER TABLE site_feedback ADD COLUMN client_user_agent TEXT",
        "created_at": (
            "ALTER TABLE site_feedback ADD COLUMN created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP"
            if is_sqlite
            else "ALTER TABLE site_feedback ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP"
        ),
    }
    for column_name, ddl in column_migrations.items():
        if column_name not in existing_columns:
            session.execute(text(ddl))
    user_id_column = existing_columns_info.get("user_id")
    if user_id_column and not user_id_column.get("nullable", True):
        session.execute(text("ALTER TABLE site_feedback ALTER COLUMN user_id DROP NOT NULL"))
    id_column = existing_columns_info.get("id")
    id_default = str(id_column.get("default") or "") if id_column else ""
    if id_column and "nextval" not in id_default:
        session.execute(text("CREATE SEQUENCE IF NOT EXISTS site_feedback_id_seq"))
        session.execute(text("ALTER SEQUENCE site_feedback_id_seq OWNED BY site_feedback.id"))
        session.execute(
            text(
                """
                SELECT setval(
                    'site_feedback_id_seq',
                    COALESCE((SELECT MAX(id) FROM site_feedback), 0) + 1,
                    false
                )
                """
            )
        )
        session.execute(
            text(
                """
                ALTER TABLE site_feedback
                ALTER COLUMN id SET DEFAULT nextval('site_feedback_id_seq')
                """
            )
        )
    auth_channel_column = existing_columns_info.get("auth_channel")
    auth_channel_default = str(auth_channel_column.get("default") or "") if auth_channel_column else ""
    if auth_channel_column and "jwt" in auth_channel_default and "anonymous" not in auth_channel_default:
        session.execute(
            text(
                """
                ALTER TABLE site_feedback
                ALTER COLUMN auth_channel SET DEFAULT 'anonymous'
                """
            )
        )
    if "message" in existing_columns:
        session.execute(
            text(
                """
                UPDATE site_feedback
                SET body = CASE
                    WHEN COALESCE(body, '') <> '' THEN body
                    ELSE COALESCE(message, '')
                END
                """
            )
        )
        message_column = existing_columns_info.get("message")
        message_default = str(message_column.get("default") or "") if message_column else ""
        if message_column and "''" not in message_default:
            session.execute(
                text(
                    """
                    ALTER TABLE site_feedback
                    ALTER COLUMN message SET DEFAULT ''
                    """
                )
            )
    if "user_agent" in existing_columns:
        session.execute(
            text(
                """
                UPDATE site_feedback
                SET client_user_agent = CASE
                    WHEN COALESCE(client_user_agent, '') <> '' THEN client_user_agent
                    ELSE user_agent
                END
                """
            )
        )
    session.execute(
        text(
            """
            UPDATE site_feedback
            SET username = CASE
                    WHEN COALESCE(username, '') <> '' THEN username
                    WHEN user_id IS NULL THEN '匿名用户'
                    ELSE username
                END,
                auth_channel = CASE
                    WHEN user_id IS NULL AND COALESCE(auth_channel, '') IN ('', 'jwt') THEN 'anonymous'
                    WHEN COALESCE(auth_channel, '') = '' THEN 'jwt'
                    ELSE auth_channel
                END
            """
        )
    )
    session.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_site_feedback_user_id
            ON site_feedback(user_id)
            """
        )
    )
    session.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_site_feedback_created_at
            ON site_feedback(created_at DESC)
            """
        )
    )


def _apply_twin_runtime_ddl(session) -> None:
    """Create twin runtime tables and indexes (idempotent)."""
    is_sqlite = _is_sqlite_session(session)
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS twin_core (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                twin_id VARCHAR(64) NOT NULL UNIQUE,
                owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                source_agent_name VARCHAR(100),
                display_name VARCHAR(100) NOT NULL,
                expert_name VARCHAR(100),
                visibility VARCHAR(20) NOT NULL DEFAULT 'private',
                exposure VARCHAR(20) NOT NULL DEFAULT 'brief',
                base_profile_json TEXT NOT NULL DEFAULT '{}',
                base_profile_markdown TEXT,
                version INTEGER NOT NULL DEFAULT 1,
                is_active BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS twin_core (
                id SERIAL PRIMARY KEY,
                twin_id VARCHAR(64) NOT NULL UNIQUE,
                owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                source_agent_name VARCHAR(100),
                display_name VARCHAR(100) NOT NULL,
                expert_name VARCHAR(100),
                visibility VARCHAR(20) NOT NULL DEFAULT 'private',
                exposure VARCHAR(20) NOT NULL DEFAULT 'brief',
                base_profile_json TEXT NOT NULL DEFAULT '{}',
                base_profile_markdown TEXT,
                version INTEGER NOT NULL DEFAULT 1,
                is_active BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    session.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_twin_core_owner_user_id
            ON twin_core(owner_user_id)
            """
        )
    )
    session.execute(
        text(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_twin_core_active_per_user
            ON twin_core(owner_user_id)
            WHERE is_active = TRUE
            """
        )
    )
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS twin_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                snapshot_id VARCHAR(64) NOT NULL UNIQUE,
                twin_id VARCHAR(64) NOT NULL REFERENCES twin_core(twin_id) ON DELETE CASCADE,
                source VARCHAR(50) NOT NULL DEFAULT 'profile_twin',
                source_agent_name VARCHAR(100),
                profile_markdown TEXT NOT NULL,
                profile_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS twin_snapshots (
                id SERIAL PRIMARY KEY,
                snapshot_id VARCHAR(64) NOT NULL UNIQUE,
                twin_id VARCHAR(64) NOT NULL REFERENCES twin_core(twin_id) ON DELETE CASCADE,
                source VARCHAR(50) NOT NULL DEFAULT 'profile_twin',
                source_agent_name VARCHAR(100),
                profile_markdown TEXT NOT NULL,
                profile_json TEXT NOT NULL DEFAULT '{}',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    session.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_twin_snapshots_twin_id_created_at
            ON twin_snapshots(twin_id, created_at DESC)
            """
        )
    )
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS twin_scene_overlays (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                overlay_id VARCHAR(64) NOT NULL UNIQUE,
                twin_id VARCHAR(64) NOT NULL REFERENCES twin_core(twin_id) ON DELETE CASCADE,
                scene_name VARCHAR(64) NOT NULL,
                overlay_json TEXT NOT NULL DEFAULT '{}',
                overlay_markdown TEXT,
                version INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(twin_id, scene_name)
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS twin_scene_overlays (
                id SERIAL PRIMARY KEY,
                overlay_id VARCHAR(64) NOT NULL UNIQUE,
                twin_id VARCHAR(64) NOT NULL REFERENCES twin_core(twin_id) ON DELETE CASCADE,
                scene_name VARCHAR(64) NOT NULL,
                overlay_json TEXT NOT NULL DEFAULT '{}',
                overlay_markdown TEXT,
                version INTEGER NOT NULL DEFAULT 1,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(twin_id, scene_name)
            )
            """
        )
    )
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS twin_runtime_states (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                twin_id VARCHAR(64) NOT NULL REFERENCES twin_core(twin_id) ON DELETE CASCADE,
                instance_id VARCHAR(64) NOT NULL,
                active_scene VARCHAR(64),
                current_focus_json TEXT NOT NULL DEFAULT '{}',
                recent_threads_json TEXT NOT NULL DEFAULT '[]',
                recent_style_shift_json TEXT NOT NULL DEFAULT '{}',
                version INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(twin_id, instance_id)
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS twin_runtime_states (
                id SERIAL PRIMARY KEY,
                twin_id VARCHAR(64) NOT NULL REFERENCES twin_core(twin_id) ON DELETE CASCADE,
                instance_id VARCHAR(64) NOT NULL,
                active_scene VARCHAR(64),
                current_focus_json TEXT NOT NULL DEFAULT '{}',
                recent_threads_json TEXT NOT NULL DEFAULT '[]',
                recent_style_shift_json TEXT NOT NULL DEFAULT '{}',
                version INTEGER NOT NULL DEFAULT 1,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(twin_id, instance_id)
            )
            """
        )
    )
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS twin_observations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                observation_id VARCHAR(64) NOT NULL UNIQUE,
                twin_id VARCHAR(64) NOT NULL REFERENCES twin_core(twin_id) ON DELETE CASCADE,
                instance_id VARCHAR(64) NOT NULL,
                source VARCHAR(64) NOT NULL DEFAULT 'topiclab_cli',
                observation_type VARCHAR(64) NOT NULL,
                confidence REAL,
                payload_json TEXT NOT NULL DEFAULT '{}',
                merge_status VARCHAR(32) NOT NULL DEFAULT 'pending_review',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS twin_observations (
                id SERIAL PRIMARY KEY,
                observation_id VARCHAR(64) NOT NULL UNIQUE,
                twin_id VARCHAR(64) NOT NULL REFERENCES twin_core(twin_id) ON DELETE CASCADE,
                instance_id VARCHAR(64) NOT NULL,
                source VARCHAR(64) NOT NULL DEFAULT 'topiclab_cli',
                observation_type VARCHAR(64) NOT NULL,
                confidence DOUBLE PRECISION,
                payload_json TEXT NOT NULL DEFAULT '{}',
                merge_status VARCHAR(32) NOT NULL DEFAULT 'pending_review',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    session.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_twin_observations_twin_id_created_at
            ON twin_observations(twin_id, created_at DESC)
            """
        )
    )
    session.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_twin_observations_created_at
            ON twin_observations(created_at DESC)
            """
        )
    )
    session.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_twin_observations_merge_status
            ON twin_observations(merge_status)
            """
        )
    )
    if not is_sqlite:
        session.execute(
            text(
                """
                ALTER TABLE twin_observations
                ALTER COLUMN source SET DEFAULT 'topiclab_cli'
                """
            )
        )


def _create_openclaw_api_keys_v2(session) -> None:
    is_sqlite = _is_sqlite_session(session)
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS openclaw_api_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                bound_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                token_value TEXT,
                token_hash VARCHAR(64) NOT NULL UNIQUE,
                token_prefix VARCHAR(24) NOT NULL,
                status VARCHAR(32) NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_used_at TEXT,
                expires_at TEXT,
                revoked_at TEXT,
                revoked_reason TEXT,
                rotated_from_key_id INTEGER
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS openclaw_api_keys (
                id SERIAL PRIMARY KEY,
                openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                bound_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                token_value TEXT,
                token_hash VARCHAR(64) NOT NULL UNIQUE,
                token_prefix VARCHAR(24) NOT NULL,
                status VARCHAR(32) NOT NULL DEFAULT 'active',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_used_at TIMESTAMPTZ,
                expires_at TIMESTAMPTZ,
                revoked_at TIMESTAMPTZ,
                revoked_reason TEXT,
                rotated_from_key_id INTEGER
            )
            """
        )
    )
    session.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_openclaw_api_keys_token_hash
            ON openclaw_api_keys(token_hash)
            """
        )
    )
    session.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_openclaw_api_keys_agent_status
            ON openclaw_api_keys(openclaw_agent_id, status)
            """
        )
    )


def _apply_openclaw_identity_ddl(session) -> None:
    is_sqlite = _is_sqlite_session(session)
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS openclaw_agents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_uid VARCHAR(32) NOT NULL UNIQUE,
                display_name VARCHAR(255) NOT NULL,
                handle VARCHAR(50) NOT NULL UNIQUE,
                status VARCHAR(32) NOT NULL DEFAULT 'active',
                bound_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                is_primary BOOLEAN NOT NULL DEFAULT FALSE,
                skill_token VARCHAR(32) UNIQUE,
                profile_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_seen_at TEXT
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS openclaw_agents (
                id SERIAL PRIMARY KEY,
                agent_uid VARCHAR(32) NOT NULL UNIQUE,
                display_name VARCHAR(255) NOT NULL,
                handle VARCHAR(50) NOT NULL UNIQUE,
                status VARCHAR(32) NOT NULL DEFAULT 'active',
                bound_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                is_primary BOOLEAN NOT NULL DEFAULT FALSE,
                skill_token VARCHAR(32) UNIQUE,
                profile_json TEXT NOT NULL DEFAULT '{}',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_seen_at TIMESTAMPTZ
            )
            """
        )
    )
    session.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_openclaw_agents_bound_user
            ON openclaw_agents(bound_user_id, is_primary)
            """
        )
    )
    session.execute(
        text(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_openclaw_agents_primary_per_user
            ON openclaw_agents(bound_user_id)
            WHERE is_primary = TRUE AND bound_user_id IS NOT NULL
            """
        )
    )
    inspector = _get_session_inspector(session)
    existing_columns = {column["name"] for column in inspector.get_columns("openclaw_agents")}
    if "skill_token" not in existing_columns:
        session.execute(text("ALTER TABLE openclaw_agents ADD COLUMN skill_token VARCHAR(32)"))
    session.execute(
        text(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_openclaw_agents_skill_token
            ON openclaw_agents(skill_token)
            """
        )
    )
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS openclaw_wallets (
                openclaw_agent_id INTEGER PRIMARY KEY REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                balance INTEGER NOT NULL DEFAULT 0,
                lifetime_earned INTEGER NOT NULL DEFAULT 0,
                lifetime_spent INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS openclaw_wallets (
                openclaw_agent_id INTEGER PRIMARY KEY REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                balance INTEGER NOT NULL DEFAULT 0,
                lifetime_earned INTEGER NOT NULL DEFAULT 0,
                lifetime_spent INTEGER NOT NULL DEFAULT 0,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS openclaw_activity_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_uid VARCHAR(32) NOT NULL UNIQUE,
                openclaw_agent_id INTEGER REFERENCES openclaw_agents(id) ON DELETE SET NULL,
                bound_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                session_id VARCHAR(64),
                request_id VARCHAR(128),
                event_type VARCHAR(64) NOT NULL,
                action_name VARCHAR(128) NOT NULL,
                target_type VARCHAR(64),
                target_id VARCHAR(255),
                http_method VARCHAR(16),
                route VARCHAR(255),
                success BOOLEAN NOT NULL DEFAULT FALSE,
                status_code INTEGER,
                error_code VARCHAR(64),
                payload_json TEXT NOT NULL DEFAULT '{}',
                result_json TEXT NOT NULL DEFAULT '{}',
                client_ip_hash VARCHAR(64),
                user_agent TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS openclaw_activity_events (
                id SERIAL PRIMARY KEY,
                event_uid VARCHAR(32) NOT NULL UNIQUE,
                openclaw_agent_id INTEGER REFERENCES openclaw_agents(id) ON DELETE SET NULL,
                bound_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                session_id VARCHAR(64),
                request_id VARCHAR(128),
                event_type VARCHAR(64) NOT NULL,
                action_name VARCHAR(128) NOT NULL,
                target_type VARCHAR(64),
                target_id VARCHAR(255),
                http_method VARCHAR(16),
                route VARCHAR(255),
                success BOOLEAN NOT NULL DEFAULT FALSE,
                status_code INTEGER,
                error_code VARCHAR(64),
                payload_json TEXT NOT NULL DEFAULT '{}',
                result_json TEXT NOT NULL DEFAULT '{}',
                client_ip_hash VARCHAR(64),
                user_agent TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    session.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_openclaw_activity_events_agent_created
            ON openclaw_activity_events(openclaw_agent_id, created_at DESC)
            """
        )
    )
    session.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_openclaw_activity_events_created_at
            ON openclaw_activity_events(created_at DESC)
            """
        )
    )
    session.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_openclaw_activity_events_event_type
            ON openclaw_activity_events(event_type, created_at DESC)
            """
        )
    )
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS openclaw_point_ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                delta INTEGER NOT NULL,
                balance_after INTEGER NOT NULL,
                reason_code VARCHAR(64) NOT NULL,
                target_type VARCHAR(64),
                target_id VARCHAR(255),
                related_event_id INTEGER REFERENCES openclaw_activity_events(id) ON DELETE SET NULL,
                operator_type VARCHAR(32) NOT NULL DEFAULT 'system',
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS openclaw_point_ledger (
                id SERIAL PRIMARY KEY,
                openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                delta INTEGER NOT NULL,
                balance_after INTEGER NOT NULL,
                reason_code VARCHAR(64) NOT NULL,
                target_type VARCHAR(64),
                target_id VARCHAR(255),
                related_event_id INTEGER REFERENCES openclaw_activity_events(id) ON DELETE SET NULL,
                operator_type VARCHAR(32) NOT NULL DEFAULT 'system',
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    session.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_openclaw_point_ledger_agent_created
            ON openclaw_point_ledger(openclaw_agent_id, created_at DESC)
            """
        )
    )
    session.execute(
        text(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_openclaw_point_ledger_event_reason
            ON openclaw_point_ledger(openclaw_agent_id, reason_code, related_event_id)
            """
        )
    )

    inspector = _get_session_inspector(session)
    if inspector.has_table("openclaw_api_keys"):
        columns = {column["name"] for column in inspector.get_columns("openclaw_api_keys")}
        is_legacy = "openclaw_agent_id" not in columns or "id" not in columns
        if is_legacy:
            legacy_rows = session.execute(
                text(
                    """
                    SELECT user_id, token_hash, token_prefix, created_at, updated_at, last_used_at
                    FROM openclaw_api_keys
                    """
                )
            ).fetchall()
            session.execute(text("ALTER TABLE openclaw_api_keys RENAME TO openclaw_api_keys_legacy"))
            _create_openclaw_api_keys_v2(session)
            from app.services.openclaw_runtime import ensure_primary_openclaw_agent

            for row in legacy_rows:
                user_row = session.execute(
                    text("SELECT username, phone FROM users WHERE id = :id"),
                    {"id": row.user_id},
                ).fetchone()
                username = user_row[0] if user_row else None
                phone = user_row[1] if user_row else None
                agent = ensure_primary_openclaw_agent(int(row.user_id), username=username, phone=phone, session=session)
                session.execute(
                    text(
                        """
                        INSERT INTO openclaw_api_keys (
                            openclaw_agent_id,
                            bound_user_id,
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
                            :token_hash,
                            :token_prefix,
                            'active',
                            :created_at,
                            :updated_at,
                            :last_used_at,
                            NULL,
                            NULL,
                            NULL,
                            NULL
                        )
                        """
                    ),
                    {
                        "openclaw_agent_id": int(agent["id"]),
                        "bound_user_id": int(row.user_id),
                        "token_hash": row.token_hash,
                        "token_prefix": row.token_prefix,
                        "created_at": row.created_at,
                        "updated_at": row.updated_at,
                        "last_used_at": row.last_used_at,
                    },
                )
            session.execute(text("DROP TABLE IF EXISTS openclaw_api_keys_legacy"))
        else:
            column_migrations = {
                "bound_user_id": "ALTER TABLE openclaw_api_keys ADD COLUMN bound_user_id INTEGER",
                "token_value": "ALTER TABLE openclaw_api_keys ADD COLUMN token_value TEXT",
                "status": "ALTER TABLE openclaw_api_keys ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'active'",
                "expires_at": "ALTER TABLE openclaw_api_keys ADD COLUMN expires_at TEXT" if is_sqlite else "ALTER TABLE openclaw_api_keys ADD COLUMN expires_at TIMESTAMPTZ",
                "revoked_at": "ALTER TABLE openclaw_api_keys ADD COLUMN revoked_at TEXT" if is_sqlite else "ALTER TABLE openclaw_api_keys ADD COLUMN revoked_at TIMESTAMPTZ",
                "revoked_reason": "ALTER TABLE openclaw_api_keys ADD COLUMN revoked_reason TEXT",
                "rotated_from_key_id": "ALTER TABLE openclaw_api_keys ADD COLUMN rotated_from_key_id INTEGER",
            }
            for column_name, ddl in column_migrations.items():
                if column_name not in columns:
                    session.execute(text(ddl))
            session.execute(
                text(
                    """
                    UPDATE openclaw_api_keys
                    SET bound_user_id = COALESCE(bound_user_id, (
                        SELECT bound_user_id FROM openclaw_agents WHERE id = openclaw_api_keys.openclaw_agent_id
                    ))
                    """
                )
            )
            _create_openclaw_api_keys_v2(session)
    else:
        _create_openclaw_api_keys_v2(session)


def _apply_skill_hub_ddl(session) -> None:
    is_sqlite = _is_sqlite_session(session)
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS skill_hub_skills (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                slug VARCHAR(128) NOT NULL UNIQUE,
                name VARCHAR(255) NOT NULL,
                tagline VARCHAR(255),
                summary TEXT NOT NULL,
                description TEXT NOT NULL,
                category_key VARCHAR(32) NOT NULL,
                category_name VARCHAR(128) NOT NULL,
                cluster_key VARCHAR(32) NOT NULL,
                cluster_name VARCHAR(128) NOT NULL,
                tags_json TEXT NOT NULL DEFAULT '[]',
                capabilities_json TEXT NOT NULL DEFAULT '[]',
                framework VARCHAR(64) NOT NULL DEFAULT 'openclaw',
                compatibility_level VARCHAR(32) NOT NULL DEFAULT 'metadata',
                pricing_status VARCHAR(32) NOT NULL DEFAULT 'free',
                price_points INTEGER NOT NULL DEFAULT 0,
                license VARCHAR(64),
                source_url TEXT,
                source_name VARCHAR(255),
                docs_url TEXT,
                install_command TEXT,
                latest_version VARCHAR(64),
                openclaw_ready BOOLEAN NOT NULL DEFAULT FALSE,
                featured BOOLEAN NOT NULL DEFAULT FALSE,
                hero_note TEXT,
                status VARCHAR(32) NOT NULL DEFAULT 'published',
                author_openclaw_agent_id INTEGER REFERENCES openclaw_agents(id) ON DELETE SET NULL,
                total_reviews INTEGER NOT NULL DEFAULT 0,
                avg_rating REAL NOT NULL DEFAULT 0,
                total_favorites INTEGER NOT NULL DEFAULT 0,
                total_downloads INTEGER NOT NULL DEFAULT 0,
                weekly_downloads INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS skill_hub_skills (
                id SERIAL PRIMARY KEY,
                slug VARCHAR(128) NOT NULL UNIQUE,
                name VARCHAR(255) NOT NULL,
                tagline VARCHAR(255),
                summary TEXT NOT NULL,
                description TEXT NOT NULL,
                category_key VARCHAR(32) NOT NULL,
                category_name VARCHAR(128) NOT NULL,
                cluster_key VARCHAR(32) NOT NULL,
                cluster_name VARCHAR(128) NOT NULL,
                tags_json TEXT NOT NULL DEFAULT '[]',
                capabilities_json TEXT NOT NULL DEFAULT '[]',
                framework VARCHAR(64) NOT NULL DEFAULT 'openclaw',
                compatibility_level VARCHAR(32) NOT NULL DEFAULT 'metadata',
                pricing_status VARCHAR(32) NOT NULL DEFAULT 'free',
                price_points INTEGER NOT NULL DEFAULT 0,
                license VARCHAR(64),
                source_url TEXT,
                source_name VARCHAR(255),
                docs_url TEXT,
                install_command TEXT,
                latest_version VARCHAR(64),
                openclaw_ready BOOLEAN NOT NULL DEFAULT FALSE,
                featured BOOLEAN NOT NULL DEFAULT FALSE,
                hero_note TEXT,
                status VARCHAR(32) NOT NULL DEFAULT 'published',
                author_openclaw_agent_id INTEGER REFERENCES openclaw_agents(id) ON DELETE SET NULL,
                total_reviews INTEGER NOT NULL DEFAULT 0,
                avg_rating DOUBLE PRECISION NOT NULL DEFAULT 0,
                total_favorites INTEGER NOT NULL DEFAULT 0,
                total_downloads INTEGER NOT NULL DEFAULT 0,
                weekly_downloads INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    session.execute(text("CREATE INDEX IF NOT EXISTS idx_skill_hub_skills_cluster ON skill_hub_skills(cluster_key, total_downloads DESC)"))
    session.execute(text("CREATE INDEX IF NOT EXISTS idx_skill_hub_skills_category ON skill_hub_skills(category_key, published_at DESC)"))
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS skill_hub_skill_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                skill_id INTEGER NOT NULL REFERENCES skill_hub_skills(id) ON DELETE CASCADE,
                version VARCHAR(64) NOT NULL,
                changelog TEXT,
                content_markdown TEXT NOT NULL DEFAULT '',
                artifact_filename TEXT,
                artifact_path TEXT,
                artifact_content_type TEXT,
                artifact_size INTEGER NOT NULL DEFAULT 0,
                install_command TEXT,
                manifest_json TEXT NOT NULL DEFAULT '{}',
                is_latest BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                uploaded_by_openclaw_agent_id INTEGER REFERENCES openclaw_agents(id) ON DELETE SET NULL
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS skill_hub_skill_versions (
                id SERIAL PRIMARY KEY,
                skill_id INTEGER NOT NULL REFERENCES skill_hub_skills(id) ON DELETE CASCADE,
                version VARCHAR(64) NOT NULL,
                changelog TEXT,
                content_markdown TEXT NOT NULL DEFAULT '',
                artifact_filename TEXT,
                artifact_path TEXT,
                artifact_content_type TEXT,
                artifact_size INTEGER NOT NULL DEFAULT 0,
                install_command TEXT,
                manifest_json TEXT NOT NULL DEFAULT '{}',
                is_latest BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                uploaded_by_openclaw_agent_id INTEGER REFERENCES openclaw_agents(id) ON DELETE SET NULL
            )
            """
        )
    )
    inspector = _get_session_inspector(session)
    version_columns = {column["name"] for column in inspector.get_columns("skill_hub_skill_versions")}
    if "content_markdown" not in version_columns:
        session.execute(
            text(
                "ALTER TABLE skill_hub_skill_versions ADD COLUMN content_markdown TEXT NOT NULL DEFAULT ''"
            )
        )
    session.execute(text("CREATE INDEX IF NOT EXISTS idx_skill_hub_versions_skill_created ON skill_hub_skill_versions(skill_id, created_at DESC)"))
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS skill_hub_reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                skill_id INTEGER NOT NULL REFERENCES skill_hub_skills(id) ON DELETE CASCADE,
                author_openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                rating INTEGER NOT NULL,
                title VARCHAR(255),
                content TEXT NOT NULL,
                model VARCHAR(128),
                dimensions_json TEXT NOT NULL DEFAULT '{}',
                pros_json TEXT NOT NULL DEFAULT '[]',
                cons_json TEXT NOT NULL DEFAULT '[]',
                helpful_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(skill_id, author_openclaw_agent_id)
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS skill_hub_reviews (
                id SERIAL PRIMARY KEY,
                skill_id INTEGER NOT NULL REFERENCES skill_hub_skills(id) ON DELETE CASCADE,
                author_openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                rating INTEGER NOT NULL,
                title VARCHAR(255),
                content TEXT NOT NULL,
                model VARCHAR(128),
                dimensions_json TEXT NOT NULL DEFAULT '{}',
                pros_json TEXT NOT NULL DEFAULT '[]',
                cons_json TEXT NOT NULL DEFAULT '[]',
                helpful_count INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(skill_id, author_openclaw_agent_id)
            )
            """
        )
    )
    session.execute(text("CREATE INDEX IF NOT EXISTS idx_skill_hub_reviews_skill_created ON skill_hub_reviews(skill_id, created_at DESC)"))
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS skill_hub_review_votes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                review_id INTEGER NOT NULL REFERENCES skill_hub_reviews(id) ON DELETE CASCADE,
                voter_openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(review_id, voter_openclaw_agent_id)
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS skill_hub_review_votes (
                id SERIAL PRIMARY KEY,
                review_id INTEGER NOT NULL REFERENCES skill_hub_reviews(id) ON DELETE CASCADE,
                voter_openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(review_id, voter_openclaw_agent_id)
            )
            """
        )
    )
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS skill_hub_favorites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                skill_id INTEGER NOT NULL REFERENCES skill_hub_skills(id) ON DELETE CASCADE,
                openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(skill_id, openclaw_agent_id)
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS skill_hub_favorites (
                id SERIAL PRIMARY KEY,
                skill_id INTEGER NOT NULL REFERENCES skill_hub_skills(id) ON DELETE CASCADE,
                openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(skill_id, openclaw_agent_id)
            )
            """
        )
    )
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS skill_hub_downloads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                skill_id INTEGER NOT NULL REFERENCES skill_hub_skills(id) ON DELETE CASCADE,
                version_id INTEGER REFERENCES skill_hub_skill_versions(id) ON DELETE SET NULL,
                openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                referrer VARCHAR(255),
                points_spent INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS skill_hub_downloads (
                id SERIAL PRIMARY KEY,
                skill_id INTEGER NOT NULL REFERENCES skill_hub_skills(id) ON DELETE CASCADE,
                version_id INTEGER REFERENCES skill_hub_skill_versions(id) ON DELETE SET NULL,
                openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                referrer VARCHAR(255),
                points_spent INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    session.execute(text("CREATE INDEX IF NOT EXISTS idx_skill_hub_downloads_skill_created ON skill_hub_downloads(skill_id, created_at DESC)"))
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS skill_hub_wishes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title VARCHAR(255) NOT NULL,
                content TEXT NOT NULL,
                category_key VARCHAR(32),
                status VARCHAR(32) NOT NULL DEFAULT 'open',
                votes_count INTEGER NOT NULL DEFAULT 0,
                author_openclaw_agent_id INTEGER REFERENCES openclaw_agents(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS skill_hub_wishes (
                id SERIAL PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                content TEXT NOT NULL,
                category_key VARCHAR(32),
                status VARCHAR(32) NOT NULL DEFAULT 'open',
                votes_count INTEGER NOT NULL DEFAULT 0,
                author_openclaw_agent_id INTEGER REFERENCES openclaw_agents(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS skill_hub_wish_votes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                wish_id INTEGER NOT NULL REFERENCES skill_hub_wishes(id) ON DELETE CASCADE,
                voter_openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(wish_id, voter_openclaw_agent_id)
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS skill_hub_wish_votes (
                id SERIAL PRIMARY KEY,
                wish_id INTEGER NOT NULL REFERENCES skill_hub_wishes(id) ON DELETE CASCADE,
                voter_openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(wish_id, voter_openclaw_agent_id)
            )
            """
        )
    )
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS skill_hub_collections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                slug VARCHAR(128) NOT NULL UNIQUE,
                title VARCHAR(255) NOT NULL,
                description TEXT NOT NULL,
                accent VARCHAR(32) NOT NULL DEFAULT 'mist',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS skill_hub_collections (
                id SERIAL PRIMARY KEY,
                slug VARCHAR(128) NOT NULL UNIQUE,
                title VARCHAR(255) NOT NULL,
                description TEXT NOT NULL,
                accent VARCHAR(32) NOT NULL DEFAULT 'mist',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS skill_hub_collection_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                collection_id INTEGER NOT NULL REFERENCES skill_hub_collections(id) ON DELETE CASCADE,
                skill_id INTEGER NOT NULL REFERENCES skill_hub_skills(id) ON DELETE CASCADE,
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(collection_id, skill_id)
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS skill_hub_collection_items (
                id SERIAL PRIMARY KEY,
                collection_id INTEGER NOT NULL REFERENCES skill_hub_collections(id) ON DELETE CASCADE,
                skill_id INTEGER NOT NULL REFERENCES skill_hub_skills(id) ON DELETE CASCADE,
                position INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(collection_id, skill_id)
            )
            """
        )
    )
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS skill_hub_task_defs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_key VARCHAR(64) NOT NULL UNIQUE,
                title VARCHAR(255) NOT NULL,
                description TEXT NOT NULL,
                reason_code VARCHAR(64) NOT NULL,
                points_reward INTEGER NOT NULL DEFAULT 0,
                daily_limit INTEGER NOT NULL DEFAULT 1,
                goal_count INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS skill_hub_task_defs (
                id SERIAL PRIMARY KEY,
                task_key VARCHAR(64) NOT NULL UNIQUE,
                title VARCHAR(255) NOT NULL,
                description TEXT NOT NULL,
                reason_code VARCHAR(64) NOT NULL,
                points_reward INTEGER NOT NULL DEFAULT 0,
                daily_limit INTEGER NOT NULL DEFAULT 1,
                goal_count INTEGER NOT NULL DEFAULT 1,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS skill_hub_task_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_def_id INTEGER NOT NULL REFERENCES skill_hub_task_defs(id) ON DELETE CASCADE,
                openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                target_id VARCHAR(255),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS skill_hub_task_events (
                id SERIAL PRIMARY KEY,
                task_def_id INTEGER NOT NULL REFERENCES skill_hub_task_defs(id) ON DELETE CASCADE,
                openclaw_agent_id INTEGER NOT NULL REFERENCES openclaw_agents(id) ON DELETE CASCADE,
                target_id VARCHAR(255),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    session.execute(text("CREATE INDEX IF NOT EXISTS idx_skill_hub_task_events_agent_created ON skill_hub_task_events(openclaw_agent_id, created_at DESC)"))


def ensure_site_feedback_schema() -> None:
    """Ensure feedback table exists (e.g. after deploy before next full init_auth_tables)."""
    with get_db_session() as session:
        _apply_site_feedback_ddl(session)
    logger.info("site_feedback schema ensured")


def _is_retryable_init_error(exc: Exception) -> bool:
    """Return whether auth DDL init should retry after a transient database lock issue."""
    if isinstance(exc, DBAPIError):
        message = str(exc.orig).lower()
    else:
        message = str(exc).lower()
    return "deadlock detected" in message or "could not obtain lock on relation" in message


def _apply_oauth_ddl(session) -> None:
    """Create OAuth state/account tables and indexes (idempotent)."""
    is_sqlite = _is_sqlite_session(session)
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS oauth_states (
                state VARCHAR(128) PRIMARY KEY,
                provider VARCHAR(32) NOT NULL,
                redirect_uri TEXT NOT NULL,
                next_path TEXT,
                claim_token VARCHAR(128),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                expires_at TEXT NOT NULL
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS oauth_states (
                state VARCHAR(128) PRIMARY KEY,
                provider VARCHAR(32) NOT NULL,
                redirect_uri TEXT NOT NULL,
                next_path TEXT,
                claim_token VARCHAR(128),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                expires_at TIMESTAMPTZ NOT NULL
            )
            """
        )
    )
    session.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_oauth_states_provider_expires
            ON oauth_states(provider, expires_at)
            """
        )
    )
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS oauth_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                provider VARCHAR(32) NOT NULL,
                provider_user_id VARCHAR(100) NOT NULL,
                nickname VARCHAR(255),
                avatar_url TEXT,
                email VARCHAR(255),
                phone VARCHAR(32),
                access_token TEXT,
                refresh_token TEXT,
                scope TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(provider, provider_user_id)
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS oauth_accounts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                provider VARCHAR(32) NOT NULL,
                provider_user_id VARCHAR(100) NOT NULL,
                nickname VARCHAR(255),
                avatar_url TEXT,
                email VARCHAR(255),
                phone VARCHAR(32),
                access_token TEXT,
                refresh_token TEXT,
                scope TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(provider, provider_user_id)
            )
            """
        )
    )
    session.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user_id
            ON oauth_accounts(user_id)
            """
        )
    )


def _init_auth_tables_once() -> None:
    """Create auth-related tables if they do not exist."""
    with get_db_session() as session:
        is_sqlite = _is_sqlite_session(session)
        session.execute(text(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone VARCHAR(20) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                username VARCHAR(50),
                handle VARCHAR(50) NOT NULL UNIQUE,
                is_admin BOOLEAN NOT NULL DEFAULT FALSE,
                is_guest BOOLEAN NOT NULL DEFAULT FALSE,
                guest_claim_token VARCHAR(128),
                guest_claimed_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                phone VARCHAR(20) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                username VARCHAR(50),
                handle VARCHAR(50) NOT NULL UNIQUE,
                is_admin BOOLEAN NOT NULL DEFAULT FALSE,
                is_guest BOOLEAN NOT NULL DEFAULT FALSE,
                guest_claim_token VARCHAR(128),
                guest_claimed_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        ))
        inspector = _get_session_inspector(session)
        user_columns = {column["name"] for column in inspector.get_columns("users")}
        if "is_admin" not in user_columns:
            session.execute(text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE"))
        if "handle" not in user_columns:
            session.execute(text("ALTER TABLE users ADD COLUMN handle VARCHAR(50)"))
        if "is_guest" not in user_columns:
            session.execute(text("ALTER TABLE users ADD COLUMN is_guest BOOLEAN NOT NULL DEFAULT FALSE"))
        if "guest_claim_token" not in user_columns:
            session.execute(text("ALTER TABLE users ADD COLUMN guest_claim_token VARCHAR(128)"))
        if "guest_claimed_at" not in user_columns:
            session.execute(
                text(
                    "ALTER TABLE users ADD COLUMN guest_claimed_at TEXT"
                    if is_sqlite
                    else "ALTER TABLE users ADD COLUMN guest_claimed_at TIMESTAMPTZ"
                )
            )
        session.execute(text("""
            UPDATE users
            SET handle = 'user_' || id
            WHERE handle IS NULL OR handle = ''
        """))
        session.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS users_handle_unique
            ON users(handle)
        """))
        session.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS users_guest_claim_token_unique
            ON users(guest_claim_token)
        """))
        session.execute(text(
            """
            CREATE TABLE IF NOT EXISTS verification_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone VARCHAR(20) NOT NULL,
                code VARCHAR(10) NOT NULL,
                type VARCHAR(20) NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS verification_codes (
                id SERIAL PRIMARY KEY,
                phone VARCHAR(20) NOT NULL,
                code VARCHAR(10) NOT NULL,
                type VARCHAR(20) NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        ))
        session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_verification_codes_phone_type
            ON verification_codes(phone, type)
        """))
        _apply_oauth_ddl(session)
        session.execute(text(
            """
            CREATE TABLE IF NOT EXISTS digital_twins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                agent_name VARCHAR(100) NOT NULL,
                display_name VARCHAR(100),
                expert_name VARCHAR(100),
                visibility VARCHAR(20) NOT NULL DEFAULT 'private',
                exposure VARCHAR(20) NOT NULL DEFAULT 'brief',
                session_id VARCHAR(100),
                source VARCHAR(50) NOT NULL DEFAULT 'profile_twin',
                role_content TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, agent_name)
            )
            """
            if is_sqlite
            else
            """
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
            """
        ))
        if not is_sqlite:
            inspector = _get_session_inspector(session)
            digital_twin_columns = {column["name"] for column in inspector.get_columns("digital_twins")}
            if "role_content" not in digital_twin_columns:
                session.execute(text("ALTER TABLE digital_twins ADD COLUMN role_content TEXT"))
        session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_digital_twins_user_id
            ON digital_twins(user_id)
        """))
        _apply_twin_runtime_ddl(session)
        _apply_openclaw_identity_ddl(session)
        _apply_skill_hub_ddl(session)
        _apply_site_feedback_ddl(session)
        from app.services.skill_hub import ensure_skill_hub_seed_data
        ensure_skill_hub_seed_data(session)


def init_auth_tables():
    """Create auth-related tables if they do not exist."""
    max_attempts = 3
    for attempt in range(1, max_attempts + 1):
        try:
            _init_auth_tables_once()
            logger.info("Auth tables initialized")
            return
        except Exception as exc:
            if attempt >= max_attempts or not _is_retryable_init_error(exc):
                raise
            logger.warning(
                "Auth tables init hit transient DDL lock issue (attempt %s/%s): %s",
                attempt,
                max_attempts,
                exc,
            )
            sleep(0.5 * attempt)


def reset_db_state():
    """Dispose cached engine/sessionmaker so tests can swap DATABASE_URL."""
    global _engine, _SessionLocal
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _SessionLocal = None
