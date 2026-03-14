"""Database-backed topic business storage for TopicLab."""

from __future__ import annotations

import base64
import copy
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import secrets
from hashlib import sha256
import time
import uuid

from sqlalchemy import bindparam, text

from app.storage.database.postgres_client import get_db_session


DEFAULT_TOPIC_EXPERT_NAMES = [
    "physicist",
    "biologist",
    "computer_scientist",
    "ethicist",
]

DEFAULT_TOPIC_SKILL_IDS = ["image_generation"]
READ_CACHE_TTL_SECONDS = 5.0
_read_cache: dict[tuple[object, ...], tuple[float, object]] = {}
DEFAULT_MODERATOR_MODE = {
    "mode_id": "standard",
    "num_rounds": 5,
    "custom_prompt": None,
    "skill_list": DEFAULT_TOPIC_SKILL_IDS,
    "mcp_server_ids": [],
    "model": None,
}


@dataclass
class TopicRecord:
    id: str
    session_id: str
    title: str
    body: str
    category: str | None
    status: str
    mode: str
    num_rounds: int
    expert_names: list[str]
    discussion_status: str
    created_at: str
    updated_at: str
    moderator_mode_id: str | None
    moderator_mode_name: str | None
    preview_image: str | None
    creator_user_id: int | None
    creator_name: str | None
    creator_auth_type: str | None
    posts_count: int
    likes_count: int
    favorites_count: int
    shares_count: int
    discussion_result: dict | None


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _to_iso(value) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def _json_loads(value, default):
    if value in (None, ""):
        return default
    if isinstance(value, (list, dict)):
        return value
    return json.loads(value)


def _cache_get(key: tuple[object, ...]):
    entry = _read_cache.get(key)
    if entry is None:
        return None
    expires_at, value = entry
    if expires_at <= time.time():
        _read_cache.pop(key, None)
        return None
    return copy.deepcopy(value)


def _cache_set(key: tuple[object, ...], value) -> None:
    _read_cache[key] = (time.time() + READ_CACHE_TTL_SECONDS, copy.deepcopy(value))


def _invalidate_read_cache(*, topic_id: str | None = None, invalidate_topic_lists: bool = False) -> None:
    keys_to_delete: list[tuple[object, ...]] = []
    for key in list(_read_cache.keys()):
        namespace = key[0] if key else None
        if invalidate_topic_lists and namespace == "topics":
            keys_to_delete.append(key)
            continue
        if topic_id is None:
            continue
        if namespace in {"topic", "posts", "post_replies", "post_thread", "post", "posts_all"} and len(key) > 1 and key[1] == topic_id:
            keys_to_delete.append(key)
    for key in keys_to_delete:
        _read_cache.pop(key, None)


def init_topic_tables() -> None:
    """Create topic business tables if they do not exist."""
    with get_db_session() as session:
        session.execute(text("""
            CREATE TABLE IF NOT EXISTS topics (
                id VARCHAR(36) PRIMARY KEY,
                session_id VARCHAR(36) NOT NULL,
                title VARCHAR(200) NOT NULL,
                body TEXT NOT NULL DEFAULT '',
                category VARCHAR(255),
                status VARCHAR(32) NOT NULL,
                mode VARCHAR(32) NOT NULL,
                num_rounds INTEGER NOT NULL DEFAULT 5,
                expert_names TEXT NOT NULL DEFAULT '[]',
                discussion_status VARCHAR(32) NOT NULL DEFAULT 'pending',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                moderator_mode_id VARCHAR(64),
                moderator_mode_name VARCHAR(255),
                preview_image TEXT,
                creator_user_id INTEGER,
                creator_name VARCHAR(255),
                creator_auth_type VARCHAR(64)
            )
        """))
        session.execute(text("ALTER TABLE topics ADD COLUMN IF NOT EXISTS creator_user_id INTEGER"))
        session.execute(text("ALTER TABLE topics ADD COLUMN IF NOT EXISTS creator_name VARCHAR(255)"))
        session.execute(text("ALTER TABLE topics ADD COLUMN IF NOT EXISTS creator_auth_type VARCHAR(64)"))
        session.execute(text("ALTER TABLE topics ADD COLUMN IF NOT EXISTS posts_count INTEGER NOT NULL DEFAULT 0"))
        session.execute(text("ALTER TABLE topics ADD COLUMN IF NOT EXISTS likes_count INTEGER NOT NULL DEFAULT 0"))
        session.execute(text("ALTER TABLE topics ADD COLUMN IF NOT EXISTS favorites_count INTEGER NOT NULL DEFAULT 0"))
        session.execute(text("ALTER TABLE topics ADD COLUMN IF NOT EXISTS shares_count INTEGER NOT NULL DEFAULT 0"))
        session.execute(text("""
            CREATE TABLE IF NOT EXISTS discussion_runs (
                topic_id VARCHAR(36) PRIMARY KEY REFERENCES topics(id) ON DELETE CASCADE,
                status VARCHAR(32) NOT NULL DEFAULT 'pending',
                turns_count INTEGER NOT NULL DEFAULT 0,
                cost_usd DOUBLE PRECISION,
                completed_at TIMESTAMPTZ,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                discussion_summary TEXT NOT NULL DEFAULT '',
                discussion_history TEXT NOT NULL DEFAULT ''
            )
        """))
        session.execute(text("""
            CREATE TABLE IF NOT EXISTS topic_source_article_links (
                article_id BIGINT PRIMARY KEY,
                topic_id VARCHAR(36) NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
                snapshot_title TEXT NOT NULL DEFAULT '',
                snapshot_source_feed_name TEXT NOT NULL DEFAULT '',
                snapshot_source_type TEXT NOT NULL DEFAULT '',
                snapshot_url TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_topic_source_article_links_topic_id
            ON topic_source_article_links(topic_id)
        """))
        session.execute(text("""
            CREATE TABLE IF NOT EXISTS posts (
                id VARCHAR(36) PRIMARY KEY,
                topic_id VARCHAR(36) NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
                author VARCHAR(255) NOT NULL,
                author_type VARCHAR(32) NOT NULL,
                owner_user_id INTEGER,
                owner_auth_type VARCHAR(64),
                delete_token_hash VARCHAR(64),
                expert_name VARCHAR(255),
                expert_label VARCHAR(255),
                body TEXT NOT NULL DEFAULT '',
                mentions TEXT NOT NULL DEFAULT '[]',
                in_reply_to_id VARCHAR(36),
                status VARCHAR(32) NOT NULL DEFAULT 'completed',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        session.execute(text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS owner_user_id INTEGER"))
        session.execute(text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS owner_auth_type VARCHAR(64)"))
        session.execute(text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS delete_token_hash VARCHAR(64)"))
        session.execute(text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS root_post_id VARCHAR(36)"))
        session.execute(text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS depth INTEGER NOT NULL DEFAULT 0"))
        session.execute(text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS reply_count INTEGER NOT NULL DEFAULT 0"))
        session.execute(text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS likes_count INTEGER NOT NULL DEFAULT 0"))
        session.execute(text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS shares_count INTEGER NOT NULL DEFAULT 0"))
        session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_posts_topic_created
            ON posts(topic_id, created_at)
        """))
        session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_posts_reply
            ON posts(in_reply_to_id)
        """))
        session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_posts_topic_root_created
            ON posts(topic_id, root_post_id, created_at)
        """))
        session.execute(text("""
            CREATE TABLE IF NOT EXISTS discussion_turns (
                id VARCHAR(36) PRIMARY KEY,
                topic_id VARCHAR(36) NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
                turn_key VARCHAR(255) NOT NULL,
                round_num INTEGER,
                expert_name VARCHAR(255),
                expert_label VARCHAR(255),
                body TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(topic_id, turn_key)
            )
        """))
        session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_discussion_turns_topic
            ON discussion_turns(topic_id, round_num)
        """))
        session.execute(text("""
            CREATE TABLE IF NOT EXISTS topic_experts (
                topic_id VARCHAR(36) NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
                expert_name VARCHAR(255) NOT NULL,
                expert_label VARCHAR(255) NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                source VARCHAR(64) NOT NULL DEFAULT 'preset',
                is_from_topic_creation BOOLEAN NOT NULL DEFAULT FALSE,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (topic_id, expert_name)
            )
        """))
        session.execute(text("""
            CREATE TABLE IF NOT EXISTS topic_moderator_configs (
                topic_id VARCHAR(36) PRIMARY KEY REFERENCES topics(id) ON DELETE CASCADE,
                mode_id VARCHAR(64) NOT NULL,
                num_rounds INTEGER NOT NULL DEFAULT 5,
                custom_prompt TEXT,
                skill_list TEXT NOT NULL DEFAULT '[]',
                mcp_server_ids TEXT NOT NULL DEFAULT '[]',
                model VARCHAR(255),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        session.execute(text("""
            CREATE TABLE IF NOT EXISTS topic_generated_images (
                id VARCHAR(36) PRIMARY KEY,
                topic_id VARCHAR(36) NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
                asset_path TEXT NOT NULL,
                content_type VARCHAR(64) NOT NULL DEFAULT 'image/webp',
                image_bytes BYTEA NOT NULL,
                width INTEGER,
                height INTEGER,
                byte_size INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(topic_id, asset_path)
            )
        """))
        session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_topic_generated_images_topic
            ON topic_generated_images(topic_id)
        """))
        session.execute(text("""
            CREATE TABLE IF NOT EXISTS topic_user_actions (
                topic_id VARCHAR(36) NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL,
                auth_type VARCHAR(64) NOT NULL DEFAULT 'jwt',
                liked BOOLEAN NOT NULL DEFAULT FALSE,
                favorited BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (topic_id, user_id, auth_type)
            )
        """))
        session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_topic_user_actions_topic
            ON topic_user_actions(topic_id)
        """))
        session.execute(text("""
            CREATE TABLE IF NOT EXISTS post_user_actions (
                post_id VARCHAR(36) NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
                topic_id VARCHAR(36) NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL,
                auth_type VARCHAR(64) NOT NULL DEFAULT 'jwt',
                liked BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (post_id, user_id, auth_type)
            )
        """))
        session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_post_user_actions_topic
            ON post_user_actions(topic_id, post_id)
        """))
        session.execute(text("""
            CREATE TABLE IF NOT EXISTS source_article_user_actions (
                article_id BIGINT NOT NULL,
                user_id INTEGER NOT NULL,
                auth_type VARCHAR(64) NOT NULL DEFAULT 'jwt',
                liked BOOLEAN NOT NULL DEFAULT FALSE,
                favorited BOOLEAN NOT NULL DEFAULT FALSE,
                snapshot_title TEXT NOT NULL DEFAULT '',
                snapshot_source_feed_name TEXT NOT NULL DEFAULT '',
                snapshot_source_type TEXT NOT NULL DEFAULT '',
                snapshot_url TEXT NOT NULL DEFAULT '',
                snapshot_pic_url TEXT,
                snapshot_description TEXT NOT NULL DEFAULT '',
                snapshot_publish_time TEXT NOT NULL DEFAULT '',
                snapshot_created_at TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (article_id, user_id, auth_type)
            )
        """))
        session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_source_article_user_actions_article
            ON source_article_user_actions(article_id)
        """))
        session.execute(text("""
            CREATE TABLE IF NOT EXISTS source_article_stats (
                article_id BIGINT PRIMARY KEY,
                likes_count INTEGER NOT NULL DEFAULT 0,
                favorites_count INTEGER NOT NULL DEFAULT 0,
                shares_count INTEGER NOT NULL DEFAULT 0,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        session.execute(text("""
            CREATE TABLE IF NOT EXISTS favorite_categories (
                id VARCHAR(36) PRIMARY KEY,
                user_id INTEGER NOT NULL,
                auth_type VARCHAR(64) NOT NULL DEFAULT 'jwt',
                name VARCHAR(120) NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                topics_count INTEGER NOT NULL DEFAULT 0,
                source_articles_count INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (user_id, auth_type, name)
            )
        """))
        session.execute(text("ALTER TABLE favorite_categories ADD COLUMN IF NOT EXISTS topics_count INTEGER NOT NULL DEFAULT 0"))
        session.execute(text("ALTER TABLE favorite_categories ADD COLUMN IF NOT EXISTS source_articles_count INTEGER NOT NULL DEFAULT 0"))
        session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_favorite_categories_owner
            ON favorite_categories(user_id, auth_type, updated_at DESC)
        """))
        session.execute(text("""
            CREATE TABLE IF NOT EXISTS favorite_category_items (
                id VARCHAR(36) PRIMARY KEY,
                category_id VARCHAR(36) NOT NULL REFERENCES favorite_categories(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL,
                auth_type VARCHAR(64) NOT NULL DEFAULT 'jwt',
                item_type VARCHAR(32) NOT NULL,
                item_key VARCHAR(160) NOT NULL,
                topic_id VARCHAR(36),
                article_id BIGINT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (category_id, item_key)
            )
        """))
        session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_favorite_category_items_owner
            ON favorite_category_items(user_id, auth_type, item_type, created_at DESC)
        """))
        session.execute(text("""
            CREATE TABLE IF NOT EXISTS topic_share_events (
                id VARCHAR(36) PRIMARY KEY,
                topic_id VARCHAR(36) NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
                user_id INTEGER,
                auth_type VARCHAR(64),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_topic_share_events_topic
            ON topic_share_events(topic_id)
        """))
        session.execute(text("""
            CREATE TABLE IF NOT EXISTS post_share_events (
                id VARCHAR(36) PRIMARY KEY,
                post_id VARCHAR(36) NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
                topic_id VARCHAR(36) NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
                user_id INTEGER,
                auth_type VARCHAR(64),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_post_share_events_post
            ON post_share_events(post_id)
        """))
        session.execute(text("""
            CREATE TABLE IF NOT EXISTS source_article_share_events (
                id VARCHAR(36) PRIMARY KEY,
                article_id BIGINT NOT NULL,
                user_id INTEGER,
                auth_type VARCHAR(64),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_source_article_share_events_article
            ON source_article_share_events(article_id)
        """))
        session.execute(text("""
            UPDATE topics
            SET posts_count = COALESCE(post_counts.cnt, 0)
            FROM (
                SELECT topic_id, COUNT(*) AS cnt
                FROM posts
                GROUP BY topic_id
            ) AS post_counts
            WHERE topics.id = post_counts.topic_id
        """))
        session.execute(text("UPDATE topics SET posts_count = 0 WHERE posts_count IS NULL"))
        session.execute(text("""
            UPDATE topics
            SET likes_count = COALESCE(counts.likes_count, 0),
                favorites_count = COALESCE(counts.favorites_count, 0)
            FROM (
                SELECT
                    topic_id,
                    COALESCE(SUM(CASE WHEN liked THEN 1 ELSE 0 END), 0) AS likes_count,
                    COALESCE(SUM(CASE WHEN favorited THEN 1 ELSE 0 END), 0) AS favorites_count
                FROM topic_user_actions
                GROUP BY topic_id
            ) AS counts
            WHERE topics.id = counts.topic_id
        """))
        session.execute(text("UPDATE topics SET likes_count = COALESCE(likes_count, 0), favorites_count = COALESCE(favorites_count, 0)"))
        session.execute(text("""
            UPDATE topics
            SET shares_count = COALESCE(counts.share_count, 0)
            FROM (
                SELECT topic_id, COUNT(*) AS share_count
                FROM topic_share_events
                GROUP BY topic_id
            ) AS counts
            WHERE topics.id = counts.topic_id
        """))
        session.execute(text("UPDATE topics SET shares_count = COALESCE(shares_count, 0)"))
        session.execute(text("""
            UPDATE posts
            SET root_post_id = COALESCE(roots.root_post_id, posts.id),
                depth = COALESCE(roots.depth, 0)
            FROM (
                WITH RECURSIVE thread AS (
                    SELECT id, in_reply_to_id, id AS root_post_id, 0 AS depth
                    FROM posts
                    WHERE in_reply_to_id IS NULL
                    UNION ALL
                    SELECT child.id, child.in_reply_to_id, thread.root_post_id, thread.depth + 1
                    FROM posts child
                    JOIN thread ON child.in_reply_to_id = thread.id
                )
                SELECT id, root_post_id, depth
                FROM thread
            ) AS roots
            WHERE posts.id = roots.id
        """))
        session.execute(text("""
            UPDATE posts
            SET reply_count = COALESCE(reply_counts.cnt, 0)
            FROM (
                SELECT in_reply_to_id, COUNT(*) AS cnt
                FROM posts
                WHERE in_reply_to_id IS NOT NULL
                GROUP BY in_reply_to_id
            ) AS reply_counts
            WHERE posts.id = reply_counts.in_reply_to_id
        """))
        session.execute(text("UPDATE posts SET reply_count = COALESCE(reply_count, 0), likes_count = COALESCE(likes_count, 0), shares_count = COALESCE(shares_count, 0)"))
        session.execute(text("""
            UPDATE posts
            SET likes_count = COALESCE(counts.likes_count, 0)
            FROM (
                SELECT post_id, COALESCE(SUM(CASE WHEN liked THEN 1 ELSE 0 END), 0) AS likes_count
                FROM post_user_actions
                GROUP BY post_id
            ) AS counts
            WHERE posts.id = counts.post_id
        """))
        session.execute(text("""
            UPDATE posts
            SET shares_count = COALESCE(counts.share_count, 0)
            FROM (
                SELECT post_id, COUNT(*) AS share_count
                FROM post_share_events
                GROUP BY post_id
            ) AS counts
            WHERE posts.id = counts.post_id
        """))
        session.execute(text("""
            INSERT INTO source_article_stats (article_id, likes_count, favorites_count, shares_count, updated_at)
            SELECT
                article_id,
                COALESCE(SUM(CASE WHEN liked THEN 1 ELSE 0 END), 0) AS likes_count,
                COALESCE(SUM(CASE WHEN favorited THEN 1 ELSE 0 END), 0) AS favorites_count,
                0 AS shares_count,
                NOW()
            FROM source_article_user_actions
            GROUP BY article_id
            ON CONFLICT (article_id) DO UPDATE SET
                likes_count = EXCLUDED.likes_count,
                favorites_count = EXCLUDED.favorites_count,
                updated_at = EXCLUDED.updated_at
        """))
        session.execute(text("""
            INSERT INTO source_article_stats (article_id, likes_count, favorites_count, shares_count, updated_at)
            SELECT article_id, 0, 0, COUNT(*), NOW()
            FROM source_article_share_events
            GROUP BY article_id
            ON CONFLICT (article_id) DO UPDATE SET
                shares_count = EXCLUDED.shares_count,
                updated_at = EXCLUDED.updated_at
        """))
        session.execute(text("""
            UPDATE favorite_categories
            SET topics_count = COALESCE(item_counts.topics_count, 0),
                source_articles_count = COALESCE(item_counts.source_articles_count, 0)
            FROM (
                SELECT
                    category_id,
                    COALESCE(SUM(CASE WHEN item_type = 'topic' THEN 1 ELSE 0 END), 0) AS topics_count,
                    COALESCE(SUM(CASE WHEN item_type = 'source_article' THEN 1 ELSE 0 END), 0) AS source_articles_count
                FROM favorite_category_items
                GROUP BY category_id
            ) AS item_counts
            WHERE favorite_categories.id = item_counts.category_id
        """))
        session.execute(text("""
            UPDATE favorite_categories
            SET topics_count = COALESCE(topics_count, 0),
                source_articles_count = COALESCE(source_articles_count, 0)
        """))


def _build_topic(row) -> TopicRecord:
    discussion_result = None
    if row.run_status:
        discussion_result = {
            "discussion_history": row.discussion_history or "",
            "discussion_summary": row.discussion_summary or "",
            "turns_count": row.turns_count or 0,
            "cost_usd": row.cost_usd,
            "completed_at": _to_iso(row.completed_at),
        }

    return TopicRecord(
        id=row.id,
        session_id=row.session_id,
        title=row.title,
        body=row.body or "",
        category=row.category,
        status=row.status,
        mode=row.mode,
        num_rounds=row.num_rounds,
        expert_names=_json_loads(row.expert_names, []),
        discussion_status=row.discussion_status,
        created_at=_to_iso(row.created_at),
        updated_at=_to_iso(row.updated_at),
        moderator_mode_id=row.moderator_mode_id,
        moderator_mode_name=row.moderator_mode_name,
        preview_image=row.preview_image,
        creator_user_id=row.creator_user_id,
        creator_name=row.creator_name,
        creator_auth_type=row.creator_auth_type,
        posts_count=int(getattr(row, "posts_count", 0) or 0),
        likes_count=int(getattr(row, "likes_count", 0) or 0),
        favorites_count=int(getattr(row, "favorites_count", 0) or 0),
        shares_count=int(getattr(row, "shares_count", 0) or 0),
        discussion_result=discussion_result,
    )


def create_topic(
    title: str,
    body: str = "",
    category: str | None = None,
    *,
    creator_user_id: int | None = None,
    creator_name: str | None = None,
    creator_auth_type: str | None = None,
) -> dict:
    topic_id = str(uuid.uuid4())
    now = utc_now()
    preview_image = extract_preview_image(body)
    with get_db_session() as session:
        session.execute(
            text("""
                INSERT INTO topics (
                    id, session_id, title, body, category, status, mode, num_rounds,
                    expert_names, discussion_status, created_at, updated_at,
                    moderator_mode_id, moderator_mode_name, preview_image,
                    creator_user_id, creator_name, creator_auth_type
                ) VALUES (
                    :id, :session_id, :title, :body, :category, :status, :mode, :num_rounds,
                    :expert_names, :discussion_status, :created_at, :updated_at,
                    :moderator_mode_id, :moderator_mode_name, :preview_image,
                    :creator_user_id, :creator_name, :creator_auth_type
                )
            """),
            {
                "id": topic_id,
                "session_id": topic_id,
                "title": title,
                "body": body,
                "category": category,
                "status": "open",
                "mode": "discussion",
                "num_rounds": 5,
                "expert_names": json.dumps(DEFAULT_TOPIC_EXPERT_NAMES, ensure_ascii=False),
                "discussion_status": "pending",
                "created_at": now,
                "updated_at": now,
                "moderator_mode_id": "standard",
                "moderator_mode_name": "标准圆桌",
                "preview_image": preview_image,
                "creator_user_id": creator_user_id,
                "creator_name": creator_name,
                "creator_auth_type": creator_auth_type,
            },
        )
        session.execute(
            text("""
                INSERT INTO discussion_runs (
                    topic_id, status, turns_count, updated_at, discussion_summary, discussion_history
                ) VALUES (
                    :topic_id, :status, 0, :updated_at, '', ''
                )
            """),
            {"topic_id": topic_id, "status": "pending", "updated_at": now},
        )
        replace_topic_experts(
            topic_id,
            [
                {
                    "name": name,
                    "label": name,
                    "description": "",
                    "source": "preset",
                    "is_from_topic_creation": True,
                }
                for name in DEFAULT_TOPIC_EXPERT_NAMES
            ],
            session=session,
        )
        set_topic_moderator_config(topic_id, DEFAULT_MODERATOR_MODE, session=session)
    _invalidate_read_cache(topic_id=topic_id, invalidate_topic_lists=True)
    return get_topic(topic_id)


def _topic_interaction_template() -> dict:
    return {
        "likes_count": 0,
        "shares_count": 0,
        "favorites_count": 0,
        "liked": False,
        "favorited": False,
    }


def _post_interaction_template() -> dict:
    return {
        "likes_count": 0,
        "shares_count": 0,
        "liked": False,
    }


def _source_interaction_template() -> dict:
    return {
        "likes_count": 0,
        "shares_count": 0,
        "favorites_count": 0,
        "liked": False,
        "favorited": False,
    }


def annotate_topics_with_interactions(
    topics: list[dict],
    *,
    user_id: int | None = None,
    auth_type: str | None = None,
) -> list[dict]:
    if not topics:
        return topics
    topic_ids = [item["id"] for item in topics]
    topic_map = {item["id"]: item for item in topics}
    for item in topics:
        interaction = item.get("interaction") or _topic_interaction_template()
        interaction["likes_count"] = int(interaction.get("likes_count") or item.get("likes_count") or 0)
        interaction["favorites_count"] = int(interaction.get("favorites_count") or item.get("favorites_count") or 0)
        interaction["shares_count"] = int(interaction.get("shares_count") or item.get("shares_count") or 0)
        item["interaction"] = interaction

    if user_id is not None and auth_type:
        with get_db_session() as session:
            state_rows = session.execute(
                text("""
                    SELECT topic_id, liked, favorited
                    FROM topic_user_actions
                    WHERE topic_id IN :topic_ids
                      AND user_id = :user_id
                      AND auth_type = :auth_type
                """).bindparams(bindparam("topic_ids", expanding=True)),
                {"topic_ids": topic_ids, "user_id": user_id, "auth_type": auth_type},
            ).fetchall()
        for row in state_rows:
            interaction = topic_map[row.topic_id]["interaction"]
            interaction["liked"] = bool(row.liked)
            interaction["favorited"] = bool(row.favorited)
    return topics


def annotate_posts_with_interactions(
    posts: list[dict],
    *,
    user_id: int | None = None,
    auth_type: str | None = None,
) -> list[dict]:
    if not posts:
        return posts
    post_ids = [item["id"] for item in posts]
    post_map = {item["id"]: item for item in posts}
    for item in posts:
        interaction = item.get("interaction") or _post_interaction_template()
        interaction["likes_count"] = int(interaction.get("likes_count") or item.get("likes_count") or 0)
        interaction["shares_count"] = int(interaction.get("shares_count") or item.get("shares_count") or 0)
        item["interaction"] = interaction

    if user_id is not None and auth_type:
        with get_db_session() as session:
            state_rows = session.execute(
                text("""
                    SELECT post_id, liked
                    FROM post_user_actions
                    WHERE post_id IN :post_ids
                      AND user_id = :user_id
                      AND auth_type = :auth_type
                """).bindparams(bindparam("post_ids", expanding=True)),
                {"post_ids": post_ids, "user_id": user_id, "auth_type": auth_type},
            ).fetchall()
        for row in state_rows:
            post_map[row.post_id]["interaction"]["liked"] = bool(row.liked)
    return posts


def annotate_source_articles_with_interactions(
    articles: list[dict],
    *,
    user_id: int | None = None,
    auth_type: str | None = None,
) -> list[dict]:
    if not articles:
        return articles
    article_ids = [int(item["id"]) for item in articles]
    article_map = {int(item["id"]): item for item in articles}
    for item in articles:
        item["interaction"] = item.get("interaction") or _source_interaction_template()
        item["linked_topic_id"] = item.get("linked_topic_id")
        item["linked_topic_posts_count"] = int(item.get("linked_topic_posts_count") or 0)

    with get_db_session() as session:
        aggregate_rows = session.execute(
            text("""
                SELECT
                    COALESCE(s.article_id, l.article_id) AS article_id,
                    COALESCE(s.likes_count, 0) AS likes_count,
                    COALESCE(s.favorites_count, 0) AS favorites_count,
                    COALESCE(s.shares_count, 0) AS shares_count,
                    l.topic_id,
                    COALESCE(t.posts_count, 0) AS posts_count
                FROM source_article_stats AS s
                FULL OUTER JOIN topic_source_article_links AS l
                    ON l.article_id = s.article_id
                LEFT JOIN topics AS t
                    ON t.id = l.topic_id
                WHERE COALESCE(s.article_id, l.article_id) IN :article_ids
            """).bindparams(bindparam("article_ids", expanding=True)),
            {"article_ids": article_ids},
        ).fetchall()
    for row in aggregate_rows:
        article = article_map.get(int(row.article_id))
        if article is None:
            continue
        interaction = article["interaction"]
        interaction["likes_count"] = int(row.likes_count or 0)
        interaction["favorites_count"] = int(row.favorites_count or 0)
        interaction["shares_count"] = int(row.shares_count or 0)
        if row.topic_id:
            article["linked_topic_id"] = str(row.topic_id)
            article["linked_topic_posts_count"] = int(row.posts_count or 0)

    if user_id is not None and auth_type:
        with get_db_session() as session:
            state_rows = session.execute(
                text("""
                    SELECT article_id, liked, favorited
                    FROM source_article_user_actions
                    WHERE article_id IN :article_ids
                      AND user_id = :user_id
                      AND auth_type = :auth_type
                """).bindparams(bindparam("article_ids", expanding=True)),
                {"article_ids": article_ids, "user_id": user_id, "auth_type": auth_type},
            ).fetchall()
        for row in state_rows:
            interaction = article_map[int(row.article_id)]["interaction"]
            interaction["liked"] = bool(row.liked)
            interaction["favorited"] = bool(row.favorited)
    return articles


def list_topics(
    category: str | None = None,
    *,
    cursor: str | None = None,
    limit: int = 20,
    user_id: int | None = None,
    auth_type: str | None = None,
) -> dict:
    page_limit = max(1, min(limit, 100))
    cache_key = ("topics", category or "*", cursor or "", page_limit)
    payload = _cache_get(cache_key)
    if payload is None:
        cursor_tuple = _decode_cursor(cursor)
        params: dict[str, object] = {"limit": page_limit + 1}
        cursor_clause = ""
        if category:
            params["category"] = category
        if cursor_tuple:
            params["cursor_updated_at"] = cursor_tuple[0]
            params["cursor_id"] = cursor_tuple[1]
            cursor_clause = """
              AND (
                    t.updated_at < :cursor_updated_at
                    OR (t.updated_at = :cursor_updated_at AND t.id < :cursor_id)
              )
            """
        with get_db_session() as session:
            if category:
                rows = session.execute(text(f"""
                    SELECT
                        t.*,
                        r.status AS run_status,
                        r.turns_count,
                        r.cost_usd,
                        r.completed_at,
                        r.discussion_summary,
                        r.discussion_history
                    FROM topics t
                    LEFT JOIN discussion_runs r ON r.topic_id = t.id
                    WHERE t.category = :category
                    {cursor_clause}
                    ORDER BY t.updated_at DESC, t.id DESC
                    LIMIT :limit
                """), params).fetchall()
            else:
                rows = session.execute(text(f"""
                    SELECT
                        t.*,
                        r.status AS run_status,
                        r.turns_count,
                        r.cost_usd,
                        r.completed_at,
                        r.discussion_summary,
                        r.discussion_history
                    FROM topics t
                    LEFT JOIN discussion_runs r ON r.topic_id = t.id
                    WHERE 1 = 1
                    {cursor_clause}
                    ORDER BY t.updated_at DESC, t.id DESC
                    LIMIT :limit
                """), params).fetchall()
        topics = [topic_record_to_dict(_build_topic(row), lightweight=True) for row in rows]
        has_more = len(topics) > page_limit
        topics = topics[:page_limit]
        next_cursor = None
        if has_more and topics:
            last = topics[-1]
            next_cursor = _encode_cursor(last["updated_at"], last["id"])
        payload = {"items": topics, "next_cursor": next_cursor}
        _cache_set(cache_key, payload)
    return {
        "items": annotate_topics_with_interactions(payload["items"], user_id=user_id, auth_type=auth_type),
        "next_cursor": payload["next_cursor"],
    }


def get_topic(
    topic_id: str,
    *,
    user_id: int | None = None,
    auth_type: str | None = None,
) -> dict | None:
    cache_key = ("topic", topic_id)
    topic = _cache_get(cache_key)
    if topic is None:
        with get_db_session() as session:
            row = session.execute(
                text("""
                    SELECT
                        t.*,
                        r.status AS run_status,
                        r.turns_count,
                        r.cost_usd,
                        r.completed_at,
                        r.discussion_summary,
                        r.discussion_history
                    FROM topics t
                    LEFT JOIN discussion_runs r ON r.topic_id = t.id
                    WHERE t.id = :topic_id
                """),
                {"topic_id": topic_id},
            ).fetchone()
        if not row:
            return None
        topic = topic_record_to_dict(_build_topic(row))
        _cache_set(cache_key, topic)
    annotate_topics_with_interactions([topic], user_id=user_id, auth_type=auth_type)
    return topic


def get_topic_id_by_source_article(article_id: int) -> str | None:
    with get_db_session() as session:
        row = session.execute(
            text("""
                SELECT l.topic_id
                FROM topic_source_article_links AS l
                JOIN topics AS t ON t.id = l.topic_id
                WHERE l.article_id = :article_id
            """),
            {"article_id": article_id},
        ).first()
    if not row:
        return None
    return str(row.topic_id)


def link_source_article_to_topic(
    article_id: int,
    topic_id: str,
    *,
    title: str = "",
    source_feed_name: str = "",
    source_type: str = "",
    url: str = "",
) -> str:
    now = utc_now()
    with get_db_session() as session:
        row = session.execute(
            text("""
                INSERT INTO topic_source_article_links (
                    article_id,
                    topic_id,
                    snapshot_title,
                    snapshot_source_feed_name,
                    snapshot_source_type,
                    snapshot_url,
                    created_at,
                    updated_at
                ) VALUES (
                    :article_id,
                    :topic_id,
                    :snapshot_title,
                    :snapshot_source_feed_name,
                    :snapshot_source_type,
                    :snapshot_url,
                    :created_at,
                    :updated_at
                )
                ON CONFLICT (article_id) DO UPDATE SET
                    updated_at = EXCLUDED.updated_at
                RETURNING topic_id
            """),
            {
                "article_id": article_id,
                "topic_id": topic_id,
                "snapshot_title": title,
                "snapshot_source_feed_name": source_feed_name,
                "snapshot_source_type": source_type,
                "snapshot_url": url,
                "created_at": now,
                "updated_at": now,
            },
        ).one()
    return str(row.topic_id)


def update_topic(topic_id: str, data: dict) -> dict | None:
    allowed = {
        "title",
        "body",
        "category",
        "status",
        "num_rounds",
        "expert_names",
        "moderator_mode_id",
        "moderator_mode_name",
        "preview_image",
    }
    payload = {k: v for k, v in data.items() if k in allowed}
    if not payload:
        return get_topic(topic_id)
    if "expert_names" in payload:
        payload["expert_names"] = json.dumps(payload["expert_names"], ensure_ascii=False)
    if "body" in payload and "preview_image" not in payload:
        payload["preview_image"] = extract_preview_image(payload["body"])
    payload["updated_at"] = utc_now()
    assignments = ", ".join(f"{key} = :{key}" for key in payload)
    payload["topic_id"] = topic_id
    with get_db_session() as session:
        result = session.execute(
            text(f"UPDATE topics SET {assignments} WHERE id = :topic_id"),
            payload,
        )
        if result.rowcount == 0:
            return None
    _invalidate_read_cache(topic_id=topic_id, invalidate_topic_lists=True)
    return get_topic(topic_id)


def close_topic(topic_id: str) -> dict | None:
    return update_topic(topic_id, {"status": "closed"})


def delete_topic(topic_id: str) -> bool:
    with get_db_session() as session:
        result = session.execute(
            text("DELETE FROM topics WHERE id = :topic_id"),
            {"topic_id": topic_id},
        )
    if result.rowcount:
        _invalidate_read_cache(topic_id=topic_id, invalidate_topic_lists=True)
    return bool(result.rowcount)


def set_discussion_status(topic_id: str, status: str, *, turns_count: int | None = None, cost_usd: float | None = None,
                          completed_at: str | None = None, discussion_summary: str | None = None,
                          discussion_history: str | None = None) -> dict | None:
    now = utc_now()
    with get_db_session() as session:
        topic_result = session.execute(
            text("""
                UPDATE topics
                SET discussion_status = :status, updated_at = :updated_at
                WHERE id = :topic_id
            """),
            {"topic_id": topic_id, "status": status, "updated_at": now},
        )
        if topic_result.rowcount == 0:
            return None
        session.execute(
            text("""
                INSERT INTO discussion_runs (
                    topic_id, status, turns_count, cost_usd, completed_at,
                    updated_at, discussion_summary, discussion_history
                ) VALUES (
                    :topic_id, :status, :turns_count, :cost_usd, :completed_at,
                    :updated_at, :discussion_summary, :discussion_history
                )
                ON CONFLICT (topic_id) DO UPDATE SET
                    status = EXCLUDED.status,
                    turns_count = EXCLUDED.turns_count,
                    cost_usd = EXCLUDED.cost_usd,
                    completed_at = EXCLUDED.completed_at,
                    updated_at = EXCLUDED.updated_at,
                    discussion_summary = EXCLUDED.discussion_summary,
                    discussion_history = EXCLUDED.discussion_history
            """),
            {
                "topic_id": topic_id,
                "status": status,
                "turns_count": turns_count or 0,
                "cost_usd": cost_usd,
                "completed_at": completed_at,
                "updated_at": now,
                "discussion_summary": discussion_summary or "",
                "discussion_history": discussion_history or "",
            },
        )
    _invalidate_read_cache(topic_id=topic_id, invalidate_topic_lists=True)
    return get_topic(topic_id)


def _encode_cursor(created_at: str, entity_id: str) -> str:
    payload = json.dumps({"created_at": created_at, "entity_id": entity_id}, ensure_ascii=True)
    return base64.urlsafe_b64encode(payload.encode("utf-8")).decode("ascii")


def _decode_cursor(cursor: str | None) -> tuple[str, str] | None:
    if not cursor:
        return None
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        payload = json.loads(raw)
        created_at = str(payload.get("created_at") or "")
        entity_id = str(payload.get("entity_id") or "")
        if created_at and entity_id:
            return created_at, entity_id
    except Exception:
        pass
    created_at, separator, entity_id = cursor.rpartition("|")
    if not separator:
        return None
    return created_at, entity_id


def list_all_posts(
    topic_id: str,
    *,
    user_id: int | None = None,
    auth_type: str | None = None,
) -> list[dict]:
    cache_key = ("posts_all", topic_id)
    posts = _cache_get(cache_key)
    if posts is None:
        with get_db_session() as session:
            rows = session.execute(
                text("""
                    SELECT * FROM posts
                    WHERE topic_id = :topic_id
                    ORDER BY created_at ASC, id ASC
                """),
                {"topic_id": topic_id},
            ).fetchall()
        posts = [post_row_to_dict(row) for row in rows]
        _cache_set(cache_key, posts)
    return annotate_posts_with_interactions(posts, user_id=user_id, auth_type=auth_type)


def _load_reply_previews(
    topic_id: str,
    parent_ids: list[str],
    *,
    preview_limit: int,
    user_id: int | None = None,
    auth_type: str | None = None,
) -> dict[str, list[dict]]:
    if not parent_ids or preview_limit <= 0:
        return {}
    with get_db_session() as session:
        rows = session.execute(
            text(
                """
                SELECT *
                FROM (
                    SELECT
                        p.*,
                        ROW_NUMBER() OVER (
                            PARTITION BY p.in_reply_to_id
                            ORDER BY p.created_at DESC, p.id DESC
                        ) AS row_num
                    FROM posts p
                    WHERE p.topic_id = :topic_id
                      AND p.in_reply_to_id IN :parent_ids
                ) ranked
                WHERE ranked.row_num <= :preview_limit
                ORDER BY ranked.in_reply_to_id, ranked.created_at ASC, ranked.id ASC
                """
            ).bindparams(bindparam("parent_ids", expanding=True)),
            {"topic_id": topic_id, "parent_ids": parent_ids, "preview_limit": preview_limit},
        ).fetchall()
    previews: dict[str, list[dict]] = {}
    posts = [post_row_to_dict(row) for row in rows]
    annotate_posts_with_interactions(posts, user_id=user_id, auth_type=auth_type)
    for post in posts:
        previews.setdefault(str(post["in_reply_to_id"]), []).append(post)
    return previews


def list_posts(
    topic_id: str,
    *,
    cursor: str | None = None,
    limit: int = 20,
    preview_replies: int = 0,
    user_id: int | None = None,
    auth_type: str | None = None,
) -> dict:
    cache_key = ("posts", topic_id, cursor or "", max(1, min(limit, 100)), preview_replies)
    cached = _cache_get(cache_key)
    if cached is not None:
        return {
            "items": annotate_posts_with_interactions(cached["items"], user_id=user_id, auth_type=auth_type),
            "next_cursor": cached["next_cursor"],
        }
    cursor_tuple = _decode_cursor(cursor)
    params: dict[str, object] = {
        "topic_id": topic_id,
        "limit": max(1, min(limit, 100)) + 1,
    }
    cursor_clause = ""
    if cursor_tuple:
        params["cursor_created_at"] = cursor_tuple[0]
        params["cursor_id"] = cursor_tuple[1]
        cursor_clause = """
          AND (
                created_at > :cursor_created_at
                OR (created_at = :cursor_created_at AND id > :cursor_id)
          )
        """

    with get_db_session() as session:
        rows = session.execute(
            text(
                f"""
                SELECT *
                FROM posts
                WHERE topic_id = :topic_id
                  AND in_reply_to_id IS NULL
                  {cursor_clause}
                ORDER BY created_at ASC, id ASC
                LIMIT :limit
                """
            ),
            params,
        ).fetchall()

    has_more = len(rows) > max(1, min(limit, 100))
    rows = rows[: max(1, min(limit, 100))]
    posts = [post_row_to_dict(row) for row in rows]
    annotate_posts_with_interactions(posts, user_id=user_id, auth_type=auth_type)
    previews = _load_reply_previews(
        topic_id,
        [post["id"] for post in posts],
        preview_limit=preview_replies,
        user_id=user_id,
        auth_type=auth_type,
    )
    for post in posts:
        post["latest_replies"] = previews.get(post["id"], [])
    next_cursor = None
    if has_more and posts:
        last = posts[-1]
        next_cursor = _encode_cursor(last["created_at"], last["id"])
    payload = {"items": posts, "next_cursor": next_cursor}
    _cache_set(cache_key, payload)
    return payload


def list_post_replies(
    topic_id: str,
    post_id: str,
    *,
    cursor: str | None = None,
    limit: int = 20,
    user_id: int | None = None,
    auth_type: str | None = None,
) -> dict:
    cache_key = ("post_replies", topic_id, post_id, cursor or "", max(1, min(limit, 100)))
    cached = _cache_get(cache_key)
    if cached is not None:
        return {
            "items": annotate_posts_with_interactions(cached["items"], user_id=user_id, auth_type=auth_type),
            "parent_post_id": cached["parent_post_id"],
            "next_cursor": cached["next_cursor"],
        }
    cursor_tuple = _decode_cursor(cursor)
    params: dict[str, object] = {
        "topic_id": topic_id,
        "post_id": post_id,
        "limit": max(1, min(limit, 100)) + 1,
    }
    cursor_clause = ""
    if cursor_tuple:
        params["cursor_created_at"] = cursor_tuple[0]
        params["cursor_id"] = cursor_tuple[1]
        cursor_clause = """
          AND (
                created_at > :cursor_created_at
                OR (created_at = :cursor_created_at AND id > :cursor_id)
          )
        """
    with get_db_session() as session:
        rows = session.execute(
            text(
                f"""
                SELECT *
                FROM posts
                WHERE topic_id = :topic_id
                  AND in_reply_to_id = :post_id
                  {cursor_clause}
                ORDER BY created_at ASC, id ASC
                LIMIT :limit
                """
            ),
            params,
        ).fetchall()
    has_more = len(rows) > max(1, min(limit, 100))
    rows = rows[: max(1, min(limit, 100))]
    posts = [post_row_to_dict(row) for row in rows]
    annotate_posts_with_interactions(posts, user_id=user_id, auth_type=auth_type)
    next_cursor = None
    if has_more and posts:
        last = posts[-1]
        next_cursor = _encode_cursor(last["created_at"], last["id"])
    payload = {"items": posts, "parent_post_id": post_id, "next_cursor": next_cursor}
    _cache_set(cache_key, payload)
    return payload


def get_post_thread(
    topic_id: str,
    post_id: str,
    *,
    user_id: int | None = None,
    auth_type: str | None = None,
) -> list[dict]:
    cache_key = ("post_thread", topic_id, post_id)
    posts = _cache_get(cache_key)
    if posts is None:
        with get_db_session() as session:
            rows = session.execute(
                text(
                    """
                    WITH RECURSIVE thread AS (
                        SELECT *
                        FROM posts
                        WHERE topic_id = :topic_id AND id = :post_id
                        UNION ALL
                        SELECT child.*
                        FROM posts child
                        JOIN thread parent ON child.in_reply_to_id = parent.id
                        WHERE child.topic_id = :topic_id
                    )
                    SELECT *
                    FROM thread
                    ORDER BY created_at ASC, id ASC
                    """
                ),
                {"topic_id": topic_id, "post_id": post_id},
            ).fetchall()
        posts = [post_row_to_dict(row) for row in rows]
        _cache_set(cache_key, posts)
    return annotate_posts_with_interactions(posts, user_id=user_id, auth_type=auth_type)


def get_post(
    topic_id: str,
    post_id: str,
    *,
    user_id: int | None = None,
    auth_type: str | None = None,
) -> dict | None:
    cache_key = ("post", topic_id, post_id)
    post = _cache_get(cache_key)
    if post is None:
        with get_db_session() as session:
            row = session.execute(
                text("SELECT * FROM posts WHERE topic_id = :topic_id AND id = :post_id"),
                {"topic_id": topic_id, "post_id": post_id},
            ).fetchone()
        if not row:
            return None
        post = post_row_to_dict(row)
        _cache_set(cache_key, post)
    annotate_posts_with_interactions([post], user_id=user_id, auth_type=auth_type)
    return post


def upsert_post(post: dict) -> dict:
    created_at = post.get("created_at") or utc_now().isoformat()
    with get_db_session() as session:
        existing = session.execute(
            text("SELECT 1 FROM posts WHERE id = :post_id LIMIT 1"),
            {"post_id": post["id"]},
        ).fetchone()
        session.execute(
            text("""
                INSERT INTO posts (
                    id, topic_id, author, author_type, owner_user_id, owner_auth_type, delete_token_hash, expert_name, expert_label,
                    body, mentions, in_reply_to_id, root_post_id, depth, reply_count, likes_count, shares_count, status, created_at
                ) VALUES (
                    :id, :topic_id, :author, :author_type, :owner_user_id, :owner_auth_type, :delete_token_hash, :expert_name, :expert_label,
                    :body, :mentions, :in_reply_to_id, :root_post_id, :depth, :reply_count, :likes_count, :shares_count, :status, :created_at
                )
                ON CONFLICT (id) DO UPDATE SET
                    topic_id = EXCLUDED.topic_id,
                    author = EXCLUDED.author,
                    author_type = EXCLUDED.author_type,
                    owner_user_id = EXCLUDED.owner_user_id,
                    owner_auth_type = EXCLUDED.owner_auth_type,
                    delete_token_hash = EXCLUDED.delete_token_hash,
                    expert_name = EXCLUDED.expert_name,
                    expert_label = EXCLUDED.expert_label,
                    body = EXCLUDED.body,
                    mentions = EXCLUDED.mentions,
                    in_reply_to_id = EXCLUDED.in_reply_to_id,
                    root_post_id = EXCLUDED.root_post_id,
                    depth = EXCLUDED.depth,
                    reply_count = EXCLUDED.reply_count,
                    likes_count = EXCLUDED.likes_count,
                    shares_count = EXCLUDED.shares_count,
                    status = EXCLUDED.status,
                    created_at = EXCLUDED.created_at
            """),
            {
                "id": post["id"],
                "topic_id": post["topic_id"],
                "author": post["author"],
                "author_type": post["author_type"],
                "owner_user_id": post.get("owner_user_id"),
                "owner_auth_type": post.get("owner_auth_type"),
                "delete_token_hash": post.get("delete_token_hash"),
                "expert_name": post.get("expert_name"),
                "expert_label": post.get("expert_label"),
                "body": post.get("body", ""),
                "mentions": json.dumps(post.get("mentions") or [], ensure_ascii=False),
                "in_reply_to_id": post.get("in_reply_to_id"),
                "root_post_id": post.get("root_post_id") or post["id"],
                "depth": int(post.get("depth") or 0),
                "reply_count": int(post.get("reply_count") or 0),
                "likes_count": int(post.get("likes_count") or 0),
                "shares_count": int(post.get("shares_count") or 0),
                "status": post.get("status", "completed"),
                "created_at": created_at,
            },
        )
        if existing is None:
            session.execute(
                text("""
                    UPDATE topics
                    SET posts_count = posts_count + 1,
                        updated_at = :updated_at
                    WHERE id = :topic_id
                """),
                {"topic_id": post["topic_id"], "updated_at": utc_now()},
            )
            if post.get("in_reply_to_id"):
                session.execute(
                    text("""
                        UPDATE posts
                        SET reply_count = reply_count + 1
                        WHERE id = :post_id
                    """),
                    {"post_id": post["in_reply_to_id"]},
                )
    _invalidate_read_cache(topic_id=post["topic_id"], invalidate_topic_lists=True)
    return get_post(post["topic_id"], post["id"])


def make_post(
    topic_id: str,
    author: str,
    author_type: str,
    body: str,
    *,
    expert_name: str | None = None,
    expert_label: str | None = None,
    in_reply_to_id: str | None = None,
    status: str = "completed",
    owner_user_id: int | None = None,
    owner_auth_type: str | None = None,
    delete_token_hash: str | None = None,
) -> dict:
    import re

    post_id = str(uuid.uuid4())
    return {
        "id": post_id,
        "topic_id": topic_id,
        "author": author,
        "author_type": author_type,
        "owner_user_id": owner_user_id,
        "owner_auth_type": owner_auth_type,
        "delete_token_hash": delete_token_hash,
        "expert_name": expert_name,
        "expert_label": expert_label,
        "body": body,
        "mentions": re.findall(r"@(\w+)", body or ""),
        "in_reply_to_id": in_reply_to_id,
        "root_post_id": post_id,
        "depth": 0,
        "reply_count": 0,
        "likes_count": 0,
        "shares_count": 0,
        "status": status,
        "created_at": utc_now().isoformat(),
    }


def replace_discussion_turns(topic_id: str, turns: list[dict]) -> None:
    now = utc_now()
    with get_db_session() as session:
        session.execute(text("DELETE FROM discussion_turns WHERE topic_id = :topic_id"), {"topic_id": topic_id})
        for turn in turns:
            session.execute(
                text("""
                    INSERT INTO discussion_turns (
                        id, topic_id, turn_key, round_num, expert_name, expert_label, body, created_at, updated_at
                    ) VALUES (
                        :id, :topic_id, :turn_key, :round_num, :expert_name, :expert_label, :body, :created_at, :updated_at
                    )
                """),
                {
                    "id": str(uuid.uuid4()),
                    "topic_id": topic_id,
                    "turn_key": turn["turn_key"],
                    "round_num": turn.get("round_num"),
                    "expert_name": turn.get("expert_name"),
                    "expert_label": turn.get("expert_label"),
                    "body": turn.get("body", ""),
                    "created_at": turn.get("updated_at") or now,
                    "updated_at": turn.get("updated_at") or now,
                },
            )
    _invalidate_read_cache(topic_id=topic_id)


def list_discussion_turns(topic_id: str) -> list[dict]:
    with get_db_session() as session:
        rows = session.execute(
            text("""
                SELECT turn_key, round_num, expert_name, expert_label, body, created_at, updated_at
                FROM discussion_turns
                WHERE topic_id = :topic_id
                ORDER BY round_num ASC NULLS LAST, turn_key ASC
            """),
            {"topic_id": topic_id},
        ).fetchall()
    return [
        {
            "turn_key": row.turn_key,
            "round_num": row.round_num,
            "expert_name": row.expert_name,
            "expert_label": row.expert_label,
            "body": row.body or "",
            "created_at": _to_iso(row.created_at),
            "updated_at": _to_iso(row.updated_at),
        }
        for row in rows
    ]


def replace_generated_images(topic_id: str, images: list[dict]) -> None:
    now = utc_now()
    with get_db_session() as session:
        session.execute(text("DELETE FROM topic_generated_images WHERE topic_id = :topic_id"), {"topic_id": topic_id})
        for image in images:
            session.execute(
                text("""
                    INSERT INTO topic_generated_images (
                        id, topic_id, asset_path, content_type, image_bytes,
                        width, height, byte_size, created_at, updated_at
                    ) VALUES (
                        :id, :topic_id, :asset_path, :content_type, :image_bytes,
                        :width, :height, :byte_size, :created_at, :updated_at
                    )
                """),
                {
                    "id": str(uuid.uuid4()),
                    "topic_id": topic_id,
                    "asset_path": image["asset_path"],
                    "content_type": image.get("content_type", "image/webp"),
                    "image_bytes": image["image_bytes"],
                    "width": image.get("width"),
                    "height": image.get("height"),
                    "byte_size": image.get("byte_size", len(image["image_bytes"])),
                    "created_at": now,
                    "updated_at": now,
                },
            )


def get_generated_image(topic_id: str, asset_path: str) -> dict | None:
    with get_db_session() as session:
        row = session.execute(
            text("""
                SELECT asset_path, content_type, image_bytes, width, height, byte_size, updated_at
                FROM topic_generated_images
                WHERE topic_id = :topic_id AND asset_path = :asset_path
            """),
            {"topic_id": topic_id, "asset_path": asset_path},
        ).fetchone()
    if not row:
        return None
    return {
        "asset_path": row.asset_path,
        "content_type": row.content_type,
        "image_bytes": bytes(row.image_bytes),
        "width": row.width,
        "height": row.height,
        "byte_size": row.byte_size,
        "updated_at": _to_iso(row.updated_at),
    }


def replace_topic_experts(topic_id: str, experts: list[dict], *, session=None) -> None:
    owns_session = session is None
    if owns_session:
        ctx = get_db_session()
        session = ctx.__enter__()
    try:
        session.execute(text("DELETE FROM topic_experts WHERE topic_id = :topic_id"), {"topic_id": topic_id})
        for expert in experts:
            session.execute(
                text("""
                    INSERT INTO topic_experts (
                        topic_id, expert_name, expert_label, description, source,
                        is_from_topic_creation, updated_at
                    ) VALUES (
                        :topic_id, :expert_name, :expert_label, :description, :source,
                        :is_from_topic_creation, :updated_at
                    )
                """),
                {
                    "topic_id": topic_id,
                    "expert_name": expert["name"],
                    "expert_label": expert.get("label", expert["name"]),
                    "description": expert.get("description", ""),
                    "source": expert.get("source", "preset"),
                    "is_from_topic_creation": bool(expert.get("is_from_topic_creation", False)),
                    "updated_at": utc_now(),
                },
            )
        session.execute(
            text("""
                UPDATE topics
                SET expert_names = :expert_names, updated_at = :updated_at
                WHERE id = :topic_id
            """),
            {
                "topic_id": topic_id,
                "expert_names": json.dumps([expert["name"] for expert in experts], ensure_ascii=False),
                "updated_at": utc_now(),
            },
        )
        if owns_session:
            ctx.__exit__(None, None, None)
            _invalidate_read_cache(topic_id=topic_id, invalidate_topic_lists=True)
    except Exception as exc:
        if owns_session:
            ctx.__exit__(type(exc), exc, exc.__traceback__)
        raise


def list_topic_experts(topic_id: str) -> list[dict]:
    with get_db_session() as session:
        rows = session.execute(
            text("""
                SELECT expert_name, expert_label, description, source, is_from_topic_creation
                FROM topic_experts
                WHERE topic_id = :topic_id
                ORDER BY expert_name ASC
            """),
            {"topic_id": topic_id},
        ).fetchall()
    return [
        {
            "name": row[0],
            "label": row[1],
            "description": row[2],
            "source": row[3],
            "is_from_topic_creation": bool(row[4]),
        }
        for row in rows
    ]


def set_topic_moderator_config(topic_id: str, config: dict, *, session=None) -> None:
    owns_session = session is None
    if owns_session:
        ctx = get_db_session()
        session = ctx.__enter__()
    try:
        session.execute(
            text("""
                INSERT INTO topic_moderator_configs (
                    topic_id, mode_id, num_rounds, custom_prompt, skill_list, mcp_server_ids, model, updated_at
                ) VALUES (
                    :topic_id, :mode_id, :num_rounds, :custom_prompt, :skill_list, :mcp_server_ids, :model, :updated_at
                )
                ON CONFLICT (topic_id) DO UPDATE SET
                    mode_id = EXCLUDED.mode_id,
                    num_rounds = EXCLUDED.num_rounds,
                    custom_prompt = EXCLUDED.custom_prompt,
                    skill_list = EXCLUDED.skill_list,
                    mcp_server_ids = EXCLUDED.mcp_server_ids,
                    model = EXCLUDED.model,
                    updated_at = EXCLUDED.updated_at
            """),
            {
                "topic_id": topic_id,
                "mode_id": config.get("mode_id", "standard"),
                "num_rounds": int(config.get("num_rounds") or 5),
                "custom_prompt": config.get("custom_prompt"),
                "skill_list": json.dumps(config.get("skill_list") or [], ensure_ascii=False),
                "mcp_server_ids": json.dumps(config.get("mcp_server_ids") or [], ensure_ascii=False),
                "model": config.get("model"),
                "updated_at": utc_now(),
            },
        )
        mode_name = "自定义模式" if config.get("mode_id") == "custom" else config.get("mode_name", "标准圆桌")
        session.execute(
            text("""
                UPDATE topics
                SET moderator_mode_id = :mode_id,
                    moderator_mode_name = :mode_name,
                    num_rounds = :num_rounds,
                    updated_at = :updated_at
                WHERE id = :topic_id
            """),
            {
                "topic_id": topic_id,
                "mode_id": config.get("mode_id", "standard"),
                "mode_name": mode_name,
                "num_rounds": int(config.get("num_rounds") or 5),
                "updated_at": utc_now(),
            },
        )
        if owns_session:
            ctx.__exit__(None, None, None)
            _invalidate_read_cache(topic_id=topic_id, invalidate_topic_lists=True)
    except Exception as exc:
        if owns_session:
            ctx.__exit__(type(exc), exc, exc.__traceback__)
        raise


def get_topic_moderator_config(topic_id: str) -> dict | None:
    with get_db_session() as session:
        row = session.execute(
            text("""
                SELECT mode_id, num_rounds, custom_prompt, skill_list, mcp_server_ids, model
                FROM topic_moderator_configs
                WHERE topic_id = :topic_id
            """),
            {"topic_id": topic_id},
        ).fetchone()
    if not row:
        return None
    return {
        "mode_id": row[0],
        "num_rounds": row[1],
        "custom_prompt": row[2],
        "skill_list": _json_loads(row[3], []),
        "mcp_server_ids": _json_loads(row[4], []),
        "model": row[5],
    }


def extract_preview_image(markdown: str | None) -> str | None:
    import re

    if not markdown:
        return None
    match = re.search(r"!\[[^\]]*]\(([^)\s]+(?:\s+\"[^\"]*\")?)\)", markdown)
    if not match:
        return None
    raw = match.group(1).strip()
    return raw.split('"')[0].strip() if '"' in raw else raw


def topic_record_to_dict(record: TopicRecord, *, lightweight: bool = False) -> dict:
    base = {
        "id": record.id,
        "session_id": record.session_id,
        "title": record.title,
        "body": record.body,
        "category": record.category,
        "status": record.status,
        "mode": record.mode,
        "discussion_status": record.discussion_status,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
        "moderator_mode_id": record.moderator_mode_id,
        "moderator_mode_name": record.moderator_mode_name,
        "preview_image": record.preview_image,
        "creator_user_id": record.creator_user_id,
        "creator_name": record.creator_name,
        "creator_auth_type": record.creator_auth_type,
        "posts_count": record.posts_count,
        "likes_count": record.likes_count,
        "favorites_count": record.favorites_count,
        "shares_count": record.shares_count,
        "interaction": {
            "likes_count": record.likes_count,
            "favorites_count": record.favorites_count,
            "shares_count": record.shares_count,
            "liked": False,
            "favorited": False,
        },
    }
    if lightweight:
        return base
    base["num_rounds"] = record.num_rounds
    base["expert_names"] = record.expert_names
    base["discussion_result"] = record.discussion_result
    return base


def post_row_to_dict(row) -> dict:
    return {
        "id": row.id,
        "topic_id": row.topic_id,
        "author": row.author,
        "author_type": row.author_type,
        "owner_user_id": getattr(row, "owner_user_id", None),
        "owner_auth_type": getattr(row, "owner_auth_type", None),
        "expert_name": row.expert_name,
        "expert_label": row.expert_label,
        "body": row.body or "",
        "mentions": _json_loads(row.mentions, []),
        "in_reply_to_id": row.in_reply_to_id,
        "root_post_id": getattr(row, "root_post_id", None) or row.id,
        "depth": int(getattr(row, "depth", 0) or 0),
        "reply_count": int(getattr(row, "reply_count", 0) or 0),
        "status": row.status,
        "created_at": _to_iso(row.created_at),
        "likes_count": int(getattr(row, "likes_count", 0) or 0),
        "shares_count": int(getattr(row, "shares_count", 0) or 0),
        "interaction": {
            "likes_count": int(getattr(row, "likes_count", 0) or 0),
            "shares_count": int(getattr(row, "shares_count", 0) or 0),
            "liked": False,
        },
    }


def delete_post(topic_id: str, post_id: str) -> int:
    with get_db_session() as session:
        parent_row = session.execute(
            text("""
                SELECT in_reply_to_id
                FROM posts
                WHERE topic_id = :topic_id AND id = :post_id
            """),
            {"topic_id": topic_id, "post_id": post_id},
        ).fetchone()
        subtree_rows = session.execute(
            text("""
                WITH RECURSIVE subtree AS (
                    SELECT id
                    FROM posts
                    WHERE topic_id = :topic_id AND id = :post_id
                    UNION ALL
                    SELECT child.id
                    FROM posts child
                    JOIN subtree parent ON child.in_reply_to_id = parent.id
                    WHERE child.topic_id = :topic_id
                )
                SELECT COUNT(*) AS deleted_count
                FROM subtree
            """),
            {"topic_id": topic_id, "post_id": post_id},
        ).fetchone()
        result = session.execute(
            text("""
                WITH RECURSIVE subtree AS (
                    SELECT id
                    FROM posts
                    WHERE topic_id = :topic_id AND id = :post_id
                    UNION ALL
                    SELECT child.id
                    FROM posts child
                    JOIN subtree parent ON child.in_reply_to_id = parent.id
                    WHERE child.topic_id = :topic_id
                )
                DELETE FROM posts
                WHERE topic_id = :topic_id
                  AND id IN (SELECT id FROM subtree)
            """),
            {"topic_id": topic_id, "post_id": post_id},
        )
        deleted_count = int((subtree_rows.deleted_count if subtree_rows else 0) or 0)
        if deleted_count > 0:
            session.execute(
                text("""
                    UPDATE topics
                    SET posts_count = CASE WHEN posts_count >= :deleted_count THEN posts_count - :deleted_count ELSE 0 END,
                        updated_at = :updated_at
                    WHERE id = :topic_id
                """),
                {"topic_id": topic_id, "deleted_count": deleted_count, "updated_at": utc_now()},
            )
            if parent_row and parent_row.in_reply_to_id:
                session.execute(
                    text("""
                        UPDATE posts
                        SET reply_count = CASE WHEN reply_count > 0 THEN reply_count - 1 ELSE 0 END
                        WHERE id = :parent_post_id
                    """),
                    {"parent_post_id": parent_row.in_reply_to_id},
                )
    if deleted_count > 0:
        _invalidate_read_cache(topic_id=topic_id, invalidate_topic_lists=True)
    return int(result.rowcount or 0)


def generate_post_delete_token() -> str:
    return f"ptok_{secrets.token_urlsafe(24)}"


def hash_post_delete_token(raw_token: str) -> str:
    return sha256(raw_token.encode("utf-8")).hexdigest()


def resolve_post_by_delete_token(raw_token: str) -> dict | None:
    token_hash = hash_post_delete_token(raw_token)
    with get_db_session() as session:
        row = session.execute(
            text("""
                SELECT * FROM posts
                WHERE delete_token_hash = :token_hash
                LIMIT 1
            """),
            {"token_hash": token_hash},
        ).fetchone()
    return post_row_to_dict(row) if row else None


def _cleanup_topic_user_action(topic_id: str, user_id: int, auth_type: str) -> None:
    with get_db_session() as session:
        session.execute(
            text("""
                DELETE FROM topic_user_actions
                WHERE topic_id = :topic_id
                  AND user_id = :user_id
                  AND auth_type = :auth_type
                  AND liked = FALSE
                  AND favorited = FALSE
            """),
            {"topic_id": topic_id, "user_id": user_id, "auth_type": auth_type},
        )


def _cleanup_post_user_action(post_id: str, user_id: int, auth_type: str) -> None:
    with get_db_session() as session:
        session.execute(
            text("""
                DELETE FROM post_user_actions
                WHERE post_id = :post_id
                  AND user_id = :user_id
                  AND auth_type = :auth_type
                  AND liked = FALSE
            """),
            {"post_id": post_id, "user_id": user_id, "auth_type": auth_type},
        )


def _cleanup_source_article_user_action(article_id: int, user_id: int, auth_type: str) -> None:
    with get_db_session() as session:
        session.execute(
            text("""
                DELETE FROM source_article_user_actions
                WHERE article_id = :article_id
                  AND user_id = :user_id
                  AND auth_type = :auth_type
                  AND liked = FALSE
                  AND favorited = FALSE
            """),
            {"article_id": article_id, "user_id": user_id, "auth_type": auth_type},
        )


def _remove_topic_from_all_favorite_categories(topic_id: str, *, user_id: int, auth_type: str) -> None:
    with get_db_session() as session:
        category_rows = session.execute(
            text("""
                SELECT DISTINCT category_id
                FROM favorite_category_items
                WHERE user_id = :user_id
                  AND auth_type = :auth_type
                  AND item_type = 'topic'
                  AND topic_id = :topic_id
            """),
            {"topic_id": topic_id, "user_id": user_id, "auth_type": auth_type},
        ).fetchall()
        session.execute(
            text("""
                DELETE FROM favorite_category_items
                WHERE user_id = :user_id
                  AND auth_type = :auth_type
                  AND item_type = 'topic'
                  AND topic_id = :topic_id
            """),
            {"topic_id": topic_id, "user_id": user_id, "auth_type": auth_type},
        )
        for row in category_rows:
            session.execute(
                text("""
                    UPDATE favorite_categories
                    SET topics_count = CASE WHEN topics_count > 0 THEN topics_count - 1 ELSE 0 END,
                        updated_at = :updated_at
                    WHERE id = :category_id
                """),
                {"category_id": row.category_id, "updated_at": utc_now()},
            )


def _remove_source_article_from_all_favorite_categories(article_id: int, *, user_id: int, auth_type: str) -> None:
    with get_db_session() as session:
        category_rows = session.execute(
            text("""
                SELECT DISTINCT category_id
                FROM favorite_category_items
                WHERE user_id = :user_id
                  AND auth_type = :auth_type
                  AND item_type = 'source_article'
                  AND article_id = :article_id
            """),
            {"article_id": article_id, "user_id": user_id, "auth_type": auth_type},
        ).fetchall()
        session.execute(
            text("""
                DELETE FROM favorite_category_items
                WHERE user_id = :user_id
                  AND auth_type = :auth_type
                  AND item_type = 'source_article'
                  AND article_id = :article_id
            """),
            {"article_id": article_id, "user_id": user_id, "auth_type": auth_type},
        )
        for row in category_rows:
            session.execute(
                text("""
                    UPDATE favorite_categories
                    SET source_articles_count = CASE WHEN source_articles_count > 0 THEN source_articles_count - 1 ELSE 0 END,
                        updated_at = :updated_at
                    WHERE id = :category_id
                """),
                {"category_id": row.category_id, "updated_at": utc_now()},
            )


def _get_source_article_interaction(article_id: int, *, user_id: int | None = None, auth_type: str | None = None) -> dict:
    article = {"id": article_id, "interaction": _source_interaction_template()}
    annotate_source_articles_with_interactions([article], user_id=user_id, auth_type=auth_type)
    return article["interaction"]


def set_topic_user_action(
    topic_id: str,
    *,
    user_id: int,
    auth_type: str,
    liked: bool | None = None,
    favorited: bool | None = None,
) -> dict:
    now = utc_now()
    with get_db_session() as session:
        existing = session.execute(
            text("""
                SELECT liked, favorited
                FROM topic_user_actions
                WHERE topic_id = :topic_id
                  AND user_id = :user_id
                  AND auth_type = :auth_type
            """),
            {"topic_id": topic_id, "user_id": user_id, "auth_type": auth_type},
        ).fetchone()
        resolved_liked = bool(existing.liked) if existing is not None else False
        resolved_favorited = bool(existing.favorited) if existing is not None else False
        previous_liked = resolved_liked
        previous_favorited = resolved_favorited
        if liked is not None:
            resolved_liked = liked
        if favorited is not None:
            resolved_favorited = favorited
        session.execute(
            text("""
                INSERT INTO topic_user_actions (
                    topic_id, user_id, auth_type, liked, favorited, created_at, updated_at
                ) VALUES (
                    :topic_id, :user_id, :auth_type, :liked, :favorited, :created_at, :updated_at
                )
                ON CONFLICT (topic_id, user_id, auth_type) DO UPDATE SET
                    liked = :liked,
                    favorited = :favorited,
                    updated_at = :updated_at
            """),
            {
                "topic_id": topic_id,
                "user_id": user_id,
                "auth_type": auth_type,
                "liked": resolved_liked,
                "favorited": resolved_favorited,
                "created_at": now,
                "updated_at": now,
            },
        )
        if previous_liked != resolved_liked:
            session.execute(
                text("""
                    UPDATE topics
                    SET likes_count = CASE WHEN likes_count + :delta >= 0 THEN likes_count + :delta ELSE 0 END,
                        updated_at = :updated_at
                    WHERE id = :topic_id
                """),
                {"topic_id": topic_id, "delta": 1 if resolved_liked else -1, "updated_at": now},
            )
        if previous_favorited != resolved_favorited:
            session.execute(
                text("""
                    UPDATE topics
                    SET favorites_count = CASE WHEN favorites_count + :delta >= 0 THEN favorites_count + :delta ELSE 0 END,
                        updated_at = :updated_at
                    WHERE id = :topic_id
                """),
                {"topic_id": topic_id, "delta": 1 if resolved_favorited else -1, "updated_at": now},
            )
    if not resolved_favorited:
        _remove_topic_from_all_favorite_categories(topic_id, user_id=user_id, auth_type=auth_type)
    _cleanup_topic_user_action(topic_id, user_id, auth_type)
    _invalidate_read_cache(topic_id=topic_id, invalidate_topic_lists=True)
    topic = get_topic(topic_id, user_id=user_id, auth_type=auth_type)
    if topic is None:
        raise KeyError(topic_id)
    return topic["interaction"]


def set_post_user_action(
    topic_id: str,
    post_id: str,
    *,
    user_id: int,
    auth_type: str,
    liked: bool,
) -> dict:
    now = utc_now()
    with get_db_session() as session:
        existing = session.execute(
            text("""
                SELECT liked
                FROM post_user_actions
                WHERE post_id = :post_id
                  AND user_id = :user_id
                  AND auth_type = :auth_type
            """),
            {"post_id": post_id, "user_id": user_id, "auth_type": auth_type},
        ).fetchone()
        session.execute(
            text("""
                INSERT INTO post_user_actions (
                    post_id, topic_id, user_id, auth_type, liked, created_at, updated_at
                ) VALUES (
                    :post_id, :topic_id, :user_id, :auth_type, :liked, :created_at, :updated_at
                )
                ON CONFLICT (post_id, user_id, auth_type) DO UPDATE SET
                    liked = :liked,
                    updated_at = :updated_at
            """),
            {
                "post_id": post_id,
                "topic_id": topic_id,
                "user_id": user_id,
                "auth_type": auth_type,
                "liked": liked,
                "created_at": now,
                "updated_at": now,
            },
        )
        previous_liked = bool(existing.liked) if existing is not None else False
        if previous_liked != liked:
            session.execute(
                text("""
                    UPDATE posts
                    SET likes_count = CASE WHEN likes_count + :delta >= 0 THEN likes_count + :delta ELSE 0 END
                    WHERE id = :post_id
                """),
                {"post_id": post_id, "delta": 1 if liked else -1},
            )
    _invalidate_read_cache(topic_id=topic_id)
    _cleanup_post_user_action(post_id, user_id, auth_type)
    post = get_post(topic_id, post_id, user_id=user_id, auth_type=auth_type)
    if post is None:
        raise KeyError(post_id)
    return post["interaction"]


def set_source_article_user_action(
    article_id: int,
    *,
    user_id: int,
    auth_type: str,
    liked: bool | None = None,
    favorited: bool | None = None,
    snapshot: dict | None = None,
) -> dict:
    now = utc_now()
    snapshot = snapshot or {}
    with get_db_session() as session:
        existing = session.execute(
            text("""
                SELECT liked, favorited
                FROM source_article_user_actions
                WHERE article_id = :article_id
                  AND user_id = :user_id
                  AND auth_type = :auth_type
            """),
            {"article_id": article_id, "user_id": user_id, "auth_type": auth_type},
        ).fetchone()
        resolved_liked = bool(existing.liked) if existing is not None else False
        resolved_favorited = bool(existing.favorited) if existing is not None else False
        previous_liked = resolved_liked
        previous_favorited = resolved_favorited
        if liked is not None:
            resolved_liked = liked
        if favorited is not None:
            resolved_favorited = favorited
        session.execute(
            text("""
                INSERT INTO source_article_user_actions (
                    article_id, user_id, auth_type, liked, favorited,
                    snapshot_title, snapshot_source_feed_name, snapshot_source_type,
                    snapshot_url, snapshot_pic_url, snapshot_description,
                    snapshot_publish_time, snapshot_created_at, created_at, updated_at
                ) VALUES (
                    :article_id, :user_id, :auth_type, :liked, :favorited,
                    :snapshot_title, :snapshot_source_feed_name, :snapshot_source_type,
                    :snapshot_url, :snapshot_pic_url, :snapshot_description,
                    :snapshot_publish_time, :snapshot_created_at, :created_at, :updated_at
                )
                ON CONFLICT (article_id, user_id, auth_type) DO UPDATE SET
                    liked = :liked,
                    favorited = :favorited,
                    snapshot_title = COALESCE(NULLIF(:snapshot_title, ''), source_article_user_actions.snapshot_title),
                    snapshot_source_feed_name = COALESCE(NULLIF(:snapshot_source_feed_name, ''), source_article_user_actions.snapshot_source_feed_name),
                    snapshot_source_type = COALESCE(NULLIF(:snapshot_source_type, ''), source_article_user_actions.snapshot_source_type),
                    snapshot_url = COALESCE(NULLIF(:snapshot_url, ''), source_article_user_actions.snapshot_url),
                    snapshot_pic_url = COALESCE(:snapshot_pic_url, source_article_user_actions.snapshot_pic_url),
                    snapshot_description = COALESCE(NULLIF(:snapshot_description, ''), source_article_user_actions.snapshot_description),
                    snapshot_publish_time = COALESCE(NULLIF(:snapshot_publish_time, ''), source_article_user_actions.snapshot_publish_time),
                    snapshot_created_at = COALESCE(NULLIF(:snapshot_created_at, ''), source_article_user_actions.snapshot_created_at),
                    updated_at = :updated_at
            """),
            {
                "article_id": article_id,
                "user_id": user_id,
                "auth_type": auth_type,
                "liked": resolved_liked,
                "favorited": resolved_favorited,
                "snapshot_title": str(snapshot.get("title") or ""),
                "snapshot_source_feed_name": str(snapshot.get("source_feed_name") or ""),
                "snapshot_source_type": str(snapshot.get("source_type") or ""),
                "snapshot_url": str(snapshot.get("url") or ""),
                "snapshot_pic_url": snapshot.get("pic_url"),
                "snapshot_description": str(snapshot.get("description") or ""),
                "snapshot_publish_time": str(snapshot.get("publish_time") or ""),
                "snapshot_created_at": str(snapshot.get("created_at") or ""),
                "created_at": now,
                "updated_at": now,
            },
        )
        session.execute(
            text("""
                INSERT INTO source_article_stats (article_id, likes_count, favorites_count, shares_count, updated_at)
                VALUES (:article_id, 0, 0, 0, :updated_at)
                ON CONFLICT (article_id) DO NOTHING
            """),
            {"article_id": article_id, "updated_at": now},
        )
        if previous_liked != resolved_liked:
            session.execute(
                text("""
                    UPDATE source_article_stats
                    SET likes_count = CASE WHEN likes_count + :delta >= 0 THEN likes_count + :delta ELSE 0 END,
                        updated_at = :updated_at
                    WHERE article_id = :article_id
                """),
                {"article_id": article_id, "delta": 1 if resolved_liked else -1, "updated_at": now},
            )
        if previous_favorited != resolved_favorited:
            session.execute(
                text("""
                    UPDATE source_article_stats
                    SET favorites_count = CASE WHEN favorites_count + :delta >= 0 THEN favorites_count + :delta ELSE 0 END,
                        updated_at = :updated_at
                    WHERE article_id = :article_id
                """),
                {"article_id": article_id, "delta": 1 if resolved_favorited else -1, "updated_at": now},
            )
    if not resolved_favorited:
        _remove_source_article_from_all_favorite_categories(article_id, user_id=user_id, auth_type=auth_type)
    _cleanup_source_article_user_action(article_id, user_id, auth_type)
    return _get_source_article_interaction(article_id, user_id=user_id, auth_type=auth_type)


def record_topic_share(topic_id: str, *, user_id: int | None = None, auth_type: str | None = None) -> dict:
    with get_db_session() as session:
        session.execute(
            text("""
                INSERT INTO topic_share_events (id, topic_id, user_id, auth_type, created_at)
                VALUES (:id, :topic_id, :user_id, :auth_type, :created_at)
            """),
            {
                "id": str(uuid.uuid4()),
                "topic_id": topic_id,
                "user_id": user_id,
                "auth_type": auth_type,
                "created_at": utc_now(),
            },
        )
        session.execute(
            text("""
                UPDATE topics
                SET shares_count = shares_count + 1,
                    updated_at = :updated_at
                WHERE id = :topic_id
            """),
            {"topic_id": topic_id, "updated_at": utc_now()},
        )
    _invalidate_read_cache(topic_id=topic_id, invalidate_topic_lists=True)
    topic = get_topic(topic_id, user_id=user_id, auth_type=auth_type)
    if topic is None:
        raise KeyError(topic_id)
    return topic["interaction"]


def record_post_share(
    topic_id: str,
    post_id: str,
    *,
    user_id: int | None = None,
    auth_type: str | None = None,
) -> dict:
    with get_db_session() as session:
        session.execute(
            text("""
                INSERT INTO post_share_events (id, post_id, topic_id, user_id, auth_type, created_at)
                VALUES (:id, :post_id, :topic_id, :user_id, :auth_type, :created_at)
            """),
            {
                "id": str(uuid.uuid4()),
                "post_id": post_id,
                "topic_id": topic_id,
                "user_id": user_id,
                "auth_type": auth_type,
                "created_at": utc_now(),
            },
        )
        session.execute(
            text("""
                UPDATE posts
                SET shares_count = shares_count + 1
                WHERE id = :post_id
            """),
            {"post_id": post_id},
        )
    _invalidate_read_cache(topic_id=topic_id)
    post = get_post(topic_id, post_id, user_id=user_id, auth_type=auth_type)
    if post is None:
        raise KeyError(post_id)
    return post["interaction"]


def record_source_article_share(
    article_id: int,
    *,
    user_id: int | None = None,
    auth_type: str | None = None,
) -> dict:
    with get_db_session() as session:
        session.execute(
            text("""
                INSERT INTO source_article_share_events (id, article_id, user_id, auth_type, created_at)
                VALUES (:id, :article_id, :user_id, :auth_type, :created_at)
            """),
            {
                "id": str(uuid.uuid4()),
                "article_id": article_id,
                "user_id": user_id,
                "auth_type": auth_type,
                "created_at": utc_now(),
            },
        )
        session.execute(
            text("""
                INSERT INTO source_article_stats (article_id, likes_count, favorites_count, shares_count, updated_at)
                VALUES (:article_id, 0, 0, 1, :updated_at)
                ON CONFLICT (article_id) DO UPDATE SET
                    shares_count = source_article_stats.shares_count + 1,
                    updated_at = EXCLUDED.updated_at
            """),
            {"article_id": article_id, "updated_at": utc_now()},
        )
    return _get_source_article_interaction(article_id, user_id=user_id, auth_type=auth_type)


def list_user_favorite_topics(*, user_id: int, auth_type: str) -> list[dict]:
    with get_db_session() as session:
        rows = session.execute(
            text("""
                SELECT
                    t.*,
                    r.status AS run_status,
                    r.turns_count,
                    r.cost_usd,
                    r.completed_at,
                    r.discussion_summary,
                    r.discussion_history
                FROM topic_user_actions a
                JOIN topics t ON t.id = a.topic_id
                LEFT JOIN discussion_runs r ON r.topic_id = t.id
                WHERE a.user_id = :user_id
                  AND a.auth_type = :auth_type
                  AND a.favorited = TRUE
                ORDER BY a.updated_at DESC
            """),
            {"user_id": user_id, "auth_type": auth_type},
        ).fetchall()
    topics = [topic_record_to_dict(_build_topic(row), lightweight=True) for row in rows]
    annotate_topics_with_interactions(topics, user_id=user_id, auth_type=auth_type)
    _annotate_items_with_favorite_categories(topics=topics, user_id=user_id, auth_type=auth_type)
    return topics


def list_user_favorite_source_articles(*, user_id: int, auth_type: str) -> list[dict]:
    with get_db_session() as session:
        rows = session.execute(
            text("""
                SELECT
                    article_id,
                    snapshot_title,
                    snapshot_source_feed_name,
                    snapshot_source_type,
                    snapshot_url,
                    snapshot_pic_url,
                    snapshot_description,
                    snapshot_publish_time,
                    snapshot_created_at
                FROM source_article_user_actions
                WHERE user_id = :user_id
                  AND auth_type = :auth_type
                  AND favorited = TRUE
                ORDER BY updated_at DESC
            """),
            {"user_id": user_id, "auth_type": auth_type},
        ).fetchall()
    articles = [
        {
            "id": int(row.article_id),
            "title": row.snapshot_title or "",
            "source_feed_name": row.snapshot_source_feed_name or "",
            "source_type": row.snapshot_source_type or "",
            "url": row.snapshot_url or "",
            "pic_url": row.snapshot_pic_url,
            "description": row.snapshot_description or "",
            "publish_time": row.snapshot_publish_time or "",
            "created_at": row.snapshot_created_at or "",
        }
        for row in rows
    ]
    annotate_source_articles_with_interactions(articles, user_id=user_id, auth_type=auth_type)
    _annotate_items_with_favorite_categories(source_articles=articles, user_id=user_id, auth_type=auth_type)
    return articles


def _favorite_category_item_key(item_type: str, item_id: str | int) -> str:
    return f"{item_type}:{item_id}"


def _annotate_items_with_favorite_categories(
    *,
    topics: list[dict] | None = None,
    source_articles: list[dict] | None = None,
    user_id: int,
    auth_type: str,
) -> None:
    topics = topics or []
    source_articles = source_articles or []
    topic_map = {str(item["id"]): item for item in topics if item.get("id")}
    article_map = {int(item["id"]): item for item in source_articles if item.get("id") is not None}

    for item in topics:
        item["favorite_category_ids"] = []
        item["favorite_categories"] = []
    for item in source_articles:
        item["favorite_category_ids"] = []
        item["favorite_categories"] = []

    if not topic_map and not article_map:
        return

    topic_ids = list(topic_map.keys())
    article_ids = list(article_map.keys())
    conditions: list[str] = []
    params: dict[str, object] = {
        "user_id": user_id,
        "auth_type": auth_type,
    }
    if topic_ids:
        conditions.append("fci.topic_id IN :topic_ids")
        params["topic_ids"] = topic_ids
    if article_ids:
        conditions.append("fci.article_id IN :article_ids")
        params["article_ids"] = article_ids

    query = text(f"""
        SELECT
            fci.item_type,
            fci.topic_id,
            fci.article_id,
            fc.id AS category_id,
            fc.name AS category_name
        FROM favorite_category_items fci
        JOIN favorite_categories fc ON fc.id = fci.category_id
        WHERE fci.user_id = :user_id
          AND fci.auth_type = :auth_type
          AND ({' OR '.join(conditions)})
        ORDER BY fc.updated_at DESC, fc.created_at DESC
    """)
    if "topic_ids" in params:
        query = query.bindparams(bindparam("topic_ids", expanding=True))
    if "article_ids" in params:
        query = query.bindparams(bindparam("article_ids", expanding=True))

    with get_db_session() as session:
        rows = session.execute(query, params).fetchall()

    for row in rows:
        category_item = {"id": str(row.category_id), "name": row.category_name or ""}
        if row.item_type == "topic" and row.topic_id in topic_map:
            target = topic_map[str(row.topic_id)]
        elif row.item_type == "source_article" and int(row.article_id) in article_map:
            target = article_map[int(row.article_id)]
        else:
            continue
        if category_item["id"] not in target["favorite_category_ids"]:
            target["favorite_category_ids"].append(category_item["id"])
            target["favorite_categories"].append(category_item)


def list_favorite_categories(*, user_id: int, auth_type: str) -> list[dict]:
    with get_db_session() as session:
        rows = session.execute(
            text("""
                SELECT
                    fc.id,
                    fc.name,
                    fc.description,
                    fc.topics_count,
                    fc.source_articles_count,
                    fc.created_at,
                    fc.updated_at
                FROM favorite_categories fc
                WHERE fc.user_id = :user_id
                  AND fc.auth_type = :auth_type
                ORDER BY fc.updated_at DESC, fc.created_at DESC
            """),
            {"user_id": user_id, "auth_type": auth_type},
        ).fetchall()
    return [
        {
            "id": str(row.id),
            "name": row.name or "",
            "description": row.description or "",
            "created_at": _to_iso(row.created_at),
            "updated_at": _to_iso(row.updated_at),
            "topics_count": int(getattr(row, "topics_count", 0) or 0),
            "source_articles_count": int(getattr(row, "source_articles_count", 0) or 0),
        }
        for row in rows
    ]


def create_favorite_category(*, user_id: int, auth_type: str, name: str, description: str = "") -> dict:
    category_id = str(uuid.uuid4())
    now = utc_now()
    with get_db_session() as session:
        session.execute(
            text("""
                INSERT INTO favorite_categories (id, user_id, auth_type, name, description, created_at, updated_at)
                VALUES (:id, :user_id, :auth_type, :name, :description, :created_at, :updated_at)
            """),
            {
                "id": category_id,
                "user_id": user_id,
                "auth_type": auth_type,
                "name": name.strip(),
                "description": description.strip(),
                "created_at": now,
                "updated_at": now,
            },
        )
    return get_favorite_category(category_id, user_id=user_id, auth_type=auth_type)


def update_favorite_category(
    category_id: str,
    *,
    user_id: int,
    auth_type: str,
    name: str | None = None,
    description: str | None = None,
) -> dict | None:
    assignments: list[str] = ["updated_at = :updated_at"]
    params: dict[str, object] = {
        "category_id": category_id,
        "user_id": user_id,
        "auth_type": auth_type,
        "updated_at": utc_now(),
    }
    if name is not None:
        assignments.append("name = :name")
        params["name"] = name.strip()
    if description is not None:
        assignments.append("description = :description")
        params["description"] = description.strip()
    with get_db_session() as session:
        result = session.execute(
            text(f"""
                UPDATE favorite_categories
                SET {', '.join(assignments)}
                WHERE id = :category_id
                  AND user_id = :user_id
                  AND auth_type = :auth_type
            """),
            params,
        )
    if not result.rowcount:
        return None
    return get_favorite_category(category_id, user_id=user_id, auth_type=auth_type)


def delete_favorite_category(category_id: str, *, user_id: int, auth_type: str) -> bool:
    with get_db_session() as session:
        result = session.execute(
            text("""
                DELETE FROM favorite_categories
                WHERE id = :category_id
                  AND user_id = :user_id
                  AND auth_type = :auth_type
            """),
            {"category_id": category_id, "user_id": user_id, "auth_type": auth_type},
        )
    return bool(result.rowcount)


def _favorite_category_exists(category_id: str, *, user_id: int, auth_type: str) -> bool:
    with get_db_session() as session:
        row = session.execute(
            text("""
                SELECT 1
                FROM favorite_categories
                WHERE id = :category_id
                  AND user_id = :user_id
                  AND auth_type = :auth_type
                LIMIT 1
            """),
            {"category_id": category_id, "user_id": user_id, "auth_type": auth_type},
        ).fetchone()
    return row is not None


def _assert_topic_is_favorited(topic_id: str, *, user_id: int, auth_type: str) -> None:
    with get_db_session() as session:
        row = session.execute(
            text("""
                SELECT 1
                FROM topic_user_actions
                WHERE topic_id = :topic_id
                  AND user_id = :user_id
                  AND auth_type = :auth_type
                  AND favorited = TRUE
                LIMIT 1
            """),
            {"topic_id": topic_id, "user_id": user_id, "auth_type": auth_type},
        ).fetchone()
    if row is None:
        raise KeyError("favorite_topic_required")


def _assert_source_article_is_favorited(article_id: int, *, user_id: int, auth_type: str) -> None:
    with get_db_session() as session:
        row = session.execute(
            text("""
                SELECT 1
                FROM source_article_user_actions
                WHERE article_id = :article_id
                  AND user_id = :user_id
                  AND auth_type = :auth_type
                  AND favorited = TRUE
                LIMIT 1
            """),
            {"article_id": article_id, "user_id": user_id, "auth_type": auth_type},
        ).fetchone()
    if row is None:
        raise KeyError("favorite_source_required")


def assign_topic_to_favorite_category(category_id: str, topic_id: str, *, user_id: int, auth_type: str) -> dict:
    if not _favorite_category_exists(category_id, user_id=user_id, auth_type=auth_type):
        raise KeyError("category_not_found")
    _assert_topic_is_favorited(topic_id, user_id=user_id, auth_type=auth_type)
    now = utc_now()
    with get_db_session() as session:
        result = session.execute(
            text("""
                INSERT INTO favorite_category_items (
                    id, category_id, user_id, auth_type, item_type, item_key, topic_id, article_id, created_at
                ) VALUES (
                    :id, :category_id, :user_id, :auth_type, 'topic', :item_key, :topic_id, NULL, :created_at
                )
                ON CONFLICT (category_id, item_key) DO NOTHING
            """),
            {
                "id": str(uuid.uuid4()),
                "category_id": category_id,
                "user_id": user_id,
                "auth_type": auth_type,
                "item_key": _favorite_category_item_key("topic", topic_id),
                "topic_id": topic_id,
                "created_at": now,
            },
        )
        session.execute(
            text("""
                UPDATE favorite_categories
                SET topics_count = topics_count + :delta,
                    updated_at = :updated_at
                WHERE id = :category_id
            """),
            {"category_id": category_id, "updated_at": now, "delta": 1 if result.rowcount else 0},
        )
    return get_favorite_category(category_id, user_id=user_id, auth_type=auth_type)


def unassign_topic_from_favorite_category(category_id: str, topic_id: str, *, user_id: int, auth_type: str) -> dict:
    if not _favorite_category_exists(category_id, user_id=user_id, auth_type=auth_type):
        raise KeyError("category_not_found")
    now = utc_now()
    with get_db_session() as session:
        result = session.execute(
            text("""
                DELETE FROM favorite_category_items
                WHERE category_id = :category_id
                  AND user_id = :user_id
                  AND auth_type = :auth_type
                  AND item_type = 'topic'
                  AND topic_id = :topic_id
            """),
            {"category_id": category_id, "user_id": user_id, "auth_type": auth_type, "topic_id": topic_id},
        )
        session.execute(
            text("""
                UPDATE favorite_categories
                SET topics_count = CASE WHEN topics_count >= :delta THEN topics_count - :delta ELSE 0 END,
                    updated_at = :updated_at
                WHERE id = :category_id
            """),
            {"category_id": category_id, "updated_at": now, "delta": int(result.rowcount or 0)},
        )
    return get_favorite_category(category_id, user_id=user_id, auth_type=auth_type)


def assign_source_article_to_favorite_category(category_id: str, article_id: int, *, user_id: int, auth_type: str) -> dict:
    if not _favorite_category_exists(category_id, user_id=user_id, auth_type=auth_type):
        raise KeyError("category_not_found")
    _assert_source_article_is_favorited(article_id, user_id=user_id, auth_type=auth_type)
    now = utc_now()
    with get_db_session() as session:
        result = session.execute(
            text("""
                INSERT INTO favorite_category_items (
                    id, category_id, user_id, auth_type, item_type, item_key, topic_id, article_id, created_at
                ) VALUES (
                    :id, :category_id, :user_id, :auth_type, 'source_article', :item_key, NULL, :article_id, :created_at
                )
                ON CONFLICT (category_id, item_key) DO NOTHING
            """),
            {
                "id": str(uuid.uuid4()),
                "category_id": category_id,
                "user_id": user_id,
                "auth_type": auth_type,
                "item_key": _favorite_category_item_key("source_article", article_id),
                "article_id": article_id,
                "created_at": now,
            },
        )
        session.execute(
            text("""
                UPDATE favorite_categories
                SET source_articles_count = source_articles_count + :delta,
                    updated_at = :updated_at
                WHERE id = :category_id
            """),
            {"category_id": category_id, "updated_at": now, "delta": 1 if result.rowcount else 0},
        )
    return get_favorite_category(category_id, user_id=user_id, auth_type=auth_type)


def unassign_source_article_from_favorite_category(category_id: str, article_id: int, *, user_id: int, auth_type: str) -> dict:
    if not _favorite_category_exists(category_id, user_id=user_id, auth_type=auth_type):
        raise KeyError("category_not_found")
    now = utc_now()
    with get_db_session() as session:
        result = session.execute(
            text("""
                DELETE FROM favorite_category_items
                WHERE category_id = :category_id
                  AND user_id = :user_id
                  AND auth_type = :auth_type
                  AND item_type = 'source_article'
                  AND article_id = :article_id
            """),
            {"category_id": category_id, "user_id": user_id, "auth_type": auth_type, "article_id": article_id},
        )
        session.execute(
            text("""
                UPDATE favorite_categories
                SET source_articles_count = CASE WHEN source_articles_count >= :delta THEN source_articles_count - :delta ELSE 0 END,
                    updated_at = :updated_at
                WHERE id = :category_id
            """),
            {"category_id": category_id, "updated_at": now, "delta": int(result.rowcount or 0)},
        )
    return get_favorite_category(category_id, user_id=user_id, auth_type=auth_type)


def get_favorite_category(category_id: str, *, user_id: int, auth_type: str) -> dict | None:
    with get_db_session() as session:
        row = session.execute(
            text("""
                SELECT id, name, description, topics_count, source_articles_count, created_at, updated_at
                FROM favorite_categories
                WHERE id = :category_id
                  AND user_id = :user_id
                  AND auth_type = :auth_type
                LIMIT 1
            """),
            {"category_id": category_id, "user_id": user_id, "auth_type": auth_type},
        ).fetchone()
    if not row:
        return None
    return {
        "id": str(row.id),
        "name": row.name or "",
        "description": row.description or "",
        "topics_count": int(row.topics_count or 0),
        "source_articles_count": int(row.source_articles_count or 0),
        "created_at": _to_iso(row.created_at),
        "updated_at": _to_iso(row.updated_at),
        "items_count": int(row.topics_count or 0) + int(row.source_articles_count or 0),
    }


def list_favorite_category_items(
    category_id: str,
    *,
    item_type: str,
    cursor: str | None = None,
    limit: int = 20,
    user_id: int,
    auth_type: str,
) -> dict:
    item_type_value = "topic" if item_type == "topics" else "source_article"
    cursor_tuple = _decode_cursor(cursor)
    params: dict[str, object] = {
        "category_id": category_id,
        "user_id": user_id,
        "auth_type": auth_type,
        "item_type": item_type_value,
        "limit": max(1, min(limit, 100)) + 1,
    }
    cursor_clause = ""
    if cursor_tuple:
        params["cursor_created_at"] = cursor_tuple[0]
        params["cursor_id"] = cursor_tuple[1]
        cursor_clause = """
          AND (
                fci.created_at < :cursor_created_at
                OR (fci.created_at = :cursor_created_at AND fci.id < :cursor_id)
          )
        """
    with get_db_session() as session:
        rows = session.execute(
            text(
                f"""
                SELECT fci.id, fci.created_at, fci.topic_id, fci.article_id
                FROM favorite_category_items fci
                WHERE fci.category_id = :category_id
                  AND fci.user_id = :user_id
                  AND fci.auth_type = :auth_type
                  AND fci.item_type = :item_type
                  {cursor_clause}
                ORDER BY fci.created_at DESC, fci.id DESC
                LIMIT :limit
                """
            ),
            params,
        ).fetchall()
    has_more = len(rows) > max(1, min(limit, 100))
    rows = rows[: max(1, min(limit, 100))]
    next_cursor = None
    if has_more and rows:
        last = rows[-1]
        next_cursor = _encode_cursor(_to_iso(last.created_at), str(last.id))

    if item_type == "topics":
        topic_ids = [str(row.topic_id) for row in rows if row.topic_id]
        if not topic_ids:
            return {"items": [], "next_cursor": next_cursor}
        placeholders = text("""
            SELECT t.*, r.status AS run_status, r.turns_count, r.cost_usd, r.completed_at, r.discussion_summary, r.discussion_history
            FROM topics t
            LEFT JOIN discussion_runs r ON r.topic_id = t.id
            WHERE t.id IN :topic_ids
        """).bindparams(bindparam("topic_ids", expanding=True))
        with get_db_session() as session:
            topic_rows = session.execute(placeholders, {"topic_ids": topic_ids}).fetchall()
        topics = [topic_record_to_dict(_build_topic(row), lightweight=True) for row in topic_rows]
        order_map = {topic_id: index for index, topic_id in enumerate(topic_ids)}
        topics.sort(key=lambda item: order_map.get(item["id"], 0))
        annotate_topics_with_interactions(topics, user_id=user_id, auth_type=auth_type)
        _annotate_items_with_favorite_categories(topics=topics, user_id=user_id, auth_type=auth_type)
        return {"items": topics, "next_cursor": next_cursor}

    article_ids = [int(row.article_id) for row in rows if row.article_id is not None]
    if not article_ids:
        return {"items": [], "next_cursor": next_cursor}
    with get_db_session() as session:
        article_rows = session.execute(
            text("""
                SELECT
                    article_id,
                    snapshot_title,
                    snapshot_source_feed_name,
                    snapshot_source_type,
                    snapshot_url,
                    snapshot_pic_url,
                    snapshot_description,
                    snapshot_publish_time,
                    snapshot_created_at
                FROM source_article_user_actions
                WHERE user_id = :user_id
                  AND auth_type = :auth_type
                  AND article_id IN :article_ids
                GROUP BY article_id, snapshot_title, snapshot_source_feed_name, snapshot_source_type,
                         snapshot_url, snapshot_pic_url, snapshot_description, snapshot_publish_time, snapshot_created_at
            """).bindparams(bindparam("article_ids", expanding=True)),
            {"user_id": user_id, "auth_type": auth_type, "article_ids": article_ids},
        ).fetchall()
    articles = [
        {
            "id": int(row.article_id),
            "title": row.snapshot_title or "",
            "source_feed_name": row.snapshot_source_feed_name or "",
            "source_type": row.snapshot_source_type or "",
            "url": row.snapshot_url or "",
            "pic_url": row.snapshot_pic_url,
            "description": row.snapshot_description or "",
            "publish_time": row.snapshot_publish_time or "",
            "created_at": row.snapshot_created_at or "",
        }
        for row in article_rows
    ]
    order_map = {article_id: index for index, article_id in enumerate(article_ids)}
    articles.sort(key=lambda item: order_map.get(int(item["id"]), 0))
    annotate_source_articles_with_interactions(articles, user_id=user_id, auth_type=auth_type)
    _annotate_items_with_favorite_categories(source_articles=articles, user_id=user_id, auth_type=auth_type)
    return {"items": articles, "next_cursor": next_cursor}


def list_recent_favorites(
    *,
    item_type: str,
    cursor: str | None = None,
    limit: int = 20,
    user_id: int,
    auth_type: str,
) -> dict:
    if item_type == "topics":
        cursor_tuple = _decode_cursor(cursor)
        params: dict[str, object] = {
            "user_id": user_id,
            "auth_type": auth_type,
            "limit": max(1, min(limit, 100)) + 1,
        }
        cursor_clause = ""
        if cursor_tuple:
            params["cursor_updated_at"] = cursor_tuple[0]
            params["cursor_topic_id"] = cursor_tuple[1]
            cursor_clause = """
              AND (
                    tua.updated_at < :cursor_updated_at
                    OR (tua.updated_at = :cursor_updated_at AND tua.topic_id < :cursor_topic_id)
              )
            """
        with get_db_session() as session:
            rows = session.execute(
                text(
                    f"""
                    SELECT t.*, r.status AS run_status, r.turns_count, r.cost_usd, r.completed_at, r.discussion_summary, r.discussion_history,
                           tua.updated_at AS favorite_updated_at
                    FROM topic_user_actions tua
                    JOIN topics t ON t.id = tua.topic_id
                    LEFT JOIN discussion_runs r ON r.topic_id = t.id
                    WHERE tua.user_id = :user_id
                      AND tua.auth_type = :auth_type
                      AND tua.favorited = TRUE
                      {cursor_clause}
                    ORDER BY tua.updated_at DESC, tua.topic_id DESC
                    LIMIT :limit
                    """
                ),
                params,
            ).fetchall()
        has_more = len(rows) > max(1, min(limit, 100))
        rows = rows[: max(1, min(limit, 100))]
        topics = [topic_record_to_dict(_build_topic(row), lightweight=True) for row in rows]
        annotate_topics_with_interactions(topics, user_id=user_id, auth_type=auth_type)
        _annotate_items_with_favorite_categories(topics=topics, user_id=user_id, auth_type=auth_type)
        next_cursor = None
        if has_more and rows:
            last = rows[-1]
            next_cursor = _encode_cursor(_to_iso(last.favorite_updated_at), str(last.id))
        return {"items": topics, "next_cursor": next_cursor}

    cursor_tuple = _decode_cursor(cursor)
    params = {
        "user_id": user_id,
        "auth_type": auth_type,
        "limit": max(1, min(limit, 100)) + 1,
    }
    cursor_clause = ""
    if cursor_tuple:
        params["cursor_updated_at"] = cursor_tuple[0]
        params["cursor_article_id"] = int(cursor_tuple[1])
        cursor_clause = """
          AND (
                sua.updated_at < :cursor_updated_at
                OR (sua.updated_at = :cursor_updated_at AND sua.article_id < :cursor_article_id)
          )
        """
    with get_db_session() as session:
        rows = session.execute(
            text(
                f"""
                SELECT
                    sua.article_id,
                    sua.snapshot_title,
                    sua.snapshot_source_feed_name,
                    sua.snapshot_source_type,
                    sua.snapshot_url,
                    sua.snapshot_pic_url,
                    sua.snapshot_description,
                    sua.snapshot_publish_time,
                    sua.snapshot_created_at,
                    sua.updated_at AS favorite_updated_at
                FROM source_article_user_actions sua
                WHERE sua.user_id = :user_id
                  AND sua.auth_type = :auth_type
                  AND sua.favorited = TRUE
                  {cursor_clause}
                ORDER BY sua.updated_at DESC, sua.article_id DESC
                LIMIT :limit
                """
            ),
            params,
        ).fetchall()
    has_more = len(rows) > max(1, min(limit, 100))
    rows = rows[: max(1, min(limit, 100))]
    sliced = [
        {
            "id": int(row.article_id),
            "title": row.snapshot_title or "",
            "source_feed_name": row.snapshot_source_feed_name or "",
            "source_type": row.snapshot_source_type or "",
            "url": row.snapshot_url or "",
            "pic_url": row.snapshot_pic_url,
            "description": row.snapshot_description or "",
            "publish_time": row.snapshot_publish_time or "",
            "created_at": row.snapshot_created_at or "",
        }
        for row in rows
    ]
    annotate_source_articles_with_interactions(sliced, user_id=user_id, auth_type=auth_type)
    _annotate_items_with_favorite_categories(source_articles=sliced, user_id=user_id, auth_type=auth_type)
    next_cursor = None
    if has_more and rows:
        last = rows[-1]
        next_cursor = _encode_cursor(_to_iso(last.favorite_updated_at), str(last.article_id))
    return {"items": sliced, "next_cursor": next_cursor}


def classify_favorites_by_category_name(
    *,
    user_id: int,
    auth_type: str,
    category_name: str,
    topic_ids: list[str] | None = None,
    article_ids: list[int] | None = None,
    description: str = "",
) -> dict:
    normalized_name = category_name.strip()
    if not normalized_name:
        raise ValueError("category_name_required")

    existing = None
    for item in list_favorite_categories(user_id=user_id, auth_type=auth_type):
        if item["name"] == normalized_name:
            existing = item
            break
    if existing:
        category_id = str(existing["id"])
        if description and not existing.get("description"):
            update_favorite_category(
                category_id,
                user_id=user_id,
                auth_type=auth_type,
                description=description,
            )
    else:
        category_id = str(create_favorite_category(
            user_id=user_id,
            auth_type=auth_type,
            name=normalized_name,
            description=description,
        )["id"])

    for topic_id in topic_ids or []:
        assign_topic_to_favorite_category(category_id, topic_id, user_id=user_id, auth_type=auth_type)
    for article_id in article_ids or []:
        assign_source_article_to_favorite_category(category_id, article_id, user_id=user_id, auth_type=auth_type)

    category = get_favorite_category(category_id, user_id=user_id, auth_type=auth_type)
    if category is None:
        raise KeyError("category_not_found")
    return category


def get_favorite_category_summary_payload(category_id: str, *, user_id: int, auth_type: str) -> dict | None:
    category = get_favorite_category(category_id, user_id=user_id, auth_type=auth_type)
    if category is None:
        return None
    topics = list_favorite_category_items(
        category_id,
        item_type="topics",
        limit=max(int(category.get("topics_count") or 0), 1),
        user_id=user_id,
        auth_type=auth_type,
    )["items"]
    source_articles = list_favorite_category_items(
        category_id,
        item_type="sources",
        limit=max(int(category.get("source_articles_count") or 0), 1),
        user_id=user_id,
        auth_type=auth_type,
    )["items"]

    lines = [
        f"# 收藏分类：{category['name']}",
        "",
    ]
    if category.get("description"):
        lines.extend([category["description"], ""])
    lines.extend([
        f"- 话题数：{len(topics)}",
        f"- 信源数：{len(source_articles)}",
        "",
        "## 话题",
    ])
    if topics:
        for index, topic in enumerate(topics, start=1):
            lines.extend([
                f"{index}. {topic.get('title') or 'Untitled'}",
                f"   链接：/topics/{topic.get('id')}",
                f"   摘要：{(topic.get('body') or '').strip()[:300]}",
                "",
            ])
    else:
        lines.extend(["暂无话题。", ""])
    lines.append("## 信源")
    if source_articles:
        for index, article in enumerate(source_articles, start=1):
            lines.extend([
                f"{index}. {article.get('title') or 'Untitled'}",
                f"   来源：{article.get('source_feed_name') or ''}",
                f"   链接：{article.get('url') or ''}",
                f"   摘要：{(article.get('description') or '').strip()[:300]}",
                "",
            ])
    else:
        lines.extend(["暂无信源。", ""])

    return {
        "category": {
            "id": category["id"],
            "name": category["name"],
            "description": category.get("description") or "",
        },
        "topics": topics,
        "source_articles": source_articles,
        "combined_markdown": "\n".join(lines).strip(),
    }
