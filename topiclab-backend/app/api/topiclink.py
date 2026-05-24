"""TopicLink sidecar APIs.

This module is intentionally separate from ``app.api.topics``.  It reads topics
and user-provided profile text, then returns recommendation/simulation hints for
the TopicLink surface without changing the normal topic plaza behavior.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import logging
import math
import os
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sqlalchemy import bindparam, text
from sqlalchemy.exc import SQLAlchemyError

from app.api.auth import security, verify_access_token
from app.services.twin_runtime import get_or_backfill_active_twin_for_user
from app.storage.database.postgres_client import get_db_session
from app.storage.database.topic_store import (
    _invalidate_read_cache,
    annotate_posts_with_interactions,
    get_topic,
    list_topics,
    post_row_to_dict,
)

router = APIRouter(prefix="/topiclink", tags=["topiclink"])
logger = logging.getLogger(__name__)

EMBEDDING_DIM = 96
DEFAULT_EMBEDDING_MODEL = "Qwen3-Embedding-8B"
DEFAULT_CHAT_MODEL = "MiniMax-M2.5"
DEFAULT_EMBEDDING_BATCH_SIZE = 3
DEFAULT_EMBEDDING_TEXT_CHARS = 2000
DEFAULT_METADATA_BACKFILL_BATCH_SIZE = 8
DEFAULT_METADATA_BACKGROUND_INTERVAL_SECONDS = 300.0
DEFAULT_METADATA_BACKGROUND_INITIAL_DELAY_SECONDS = 20.0
DEFAULT_METADATA_BACKGROUND_LLM_DELAY_SECONDS = 4.0
DEFAULT_METADATA_BACKGROUND_MAX_PER_PASS = 10
DEFAULT_METADATA_BACKGROUND_PAGE_SIZE = 50
_embedding_cache_ready = False
_metadata_worker_task: asyncio.Task | None = None
_metadata_worker_stop: asyncio.Event | None = None
_metadata_worker_cursor: str | None = None

TOPICLINK_EXCLUDED_CATEGORIES = {"test"}
TOPICLINK_EXCLUDED_TITLE_MARKERS = (
    "live smoke",
    "connection test",
    "probe topic",
    "smoke test",
)

TOPICLINK_CATEGORY_ROLES: dict[str, dict[str, str]] = {
    "research": {
        "title": "能补材料的人",
        "description": "适合补充论文、报告、案例或可验证资料。",
        "kind": "source",
    },
    "news": {
        "title": "看过相关材料的人",
        "description": "适合补充上下文、相关材料或自己的判断。",
        "kind": "source",
    },
    "thought": {
        "title": "愿意反驳的人",
        "description": "适合提出反例、边界条件和不同解释。",
        "kind": "counterpoint",
    },
    "thinking": {
        "title": "愿意反驳的人",
        "description": "适合提出反例、边界条件和不同解释。",
        "kind": "counterpoint",
    },
    "product": {
        "title": "有实践经验的人",
        "description": "适合带来真实项目、落地细节和协作经验。",
        "kind": "practice",
    },
    "app": {
        "title": "有实践经验的人",
        "description": "适合从使用场景和落地路径切入。",
        "kind": "practice",
    },
    "application": {
        "title": "有实践经验的人",
        "description": "适合从使用场景和落地路径切入。",
        "kind": "practice",
    },
    "arcade": {
        "title": "愿意挑战题目的人",
        "description": "适合先读题面，看别人怎么走，再换一种解法试试。",
        "kind": "practice",
    },
    "request": {
        "title": "能回应需求的人",
        "description": "适合直接补资源、给建议或一起推进。",
        "kind": "peer",
    },
    "needs": {
        "title": "能回应需求的人",
        "description": "适合直接补资源、给建议或一起推进。",
        "kind": "peer",
    },
    "inspiration": {
        "title": "能回应需求的人",
        "description": "适合直接补资源、给建议或一起推进。",
        "kind": "peer",
    },
}


class TopicLinkScoreRequest(BaseModel):
    profile_text: str = Field(default="", max_length=12000)
    topics: list[dict[str, Any]] = Field(default_factory=list)


class TopicLinkKnowledgeAnswerRequest(BaseModel):
    query: str = Field(default="", max_length=1000)
    topics: list[dict[str, Any]] = Field(default_factory=list)


class TopicLinkSimulationRequest(BaseModel):
    profile_text: str | None = Field(default=None, max_length=12000)
    persona_name: str | None = Field(default=None, max_length=80)


class TopicLinkPresenceRequest(BaseModel):
    persona_name: str | None = Field(default=None, max_length=80)


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (str, int, float, bool)):
        return str(value)
    if isinstance(value, list):
        return "\n".join(_text(item) for item in value)
    if isinstance(value, dict):
        return "\n".join(_text(item) for item in value.values())
    return ""


def _fallback_topiclink_profile() -> dict[str, Any]:
    return {
        "username": "guest",
        "display_name": "先看看",
        "agent_name": "我这边",
        "title": "先看看",
        "subtitle": "登录后再按你的习惯来",
        "summary": "先看这桌在聊什么，等你登录后再带上你的记录。",
        "cards": [
            {"label": "可以先看", "value": "这桌在聊什么", "detail": "登录后会换成你的真实偏好"},
            {"label": "先不代说", "value": "不替你表态", "detail": "没有登录前只做浏览入口"},
            {"label": "怎么开始", "value": "从当前讨论开始", "detail": "先进讨论，再决定要不要接一句"},
            {"label": "相关的人", "value": "登录后更准", "detail": "登录后再看哪些人和你更近"},
        ],
        "source_parts_count": 0,
    }


def _optional_topiclink_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict[str, Any] | None:
    if not credentials:
        return None
    try:
        return verify_access_token(credentials.credentials)
    except Exception:
        return None


def _topiclink_profile_from_user(user: dict[str, Any] | None) -> dict[str, Any]:
    if not user or user.get("sub") is None:
        return _fallback_topiclink_profile()

    username = str(user.get("username") or user.get("phone") or "OpenClaw").strip()
    agent_name = str(user.get("openclaw_display_name") or user.get("agent_uid") or username).strip()
    display_name = agent_name or username
    title = "当前分身"
    subtitle = "先看现场，再决定怎么接话"
    summary = "先按当前身份和已有材料判断，不把不知道的事说满。"
    source_parts_count = 0

    try:
        twin = get_or_backfill_active_twin_for_user(int(user["sub"]))
    except Exception:
        twin = None
    if twin:
        display_name = str(twin.get("display_name") or display_name).strip()
        agent_name = str(twin.get("source_agent_name") or agent_name or display_name).strip()
        base_json = twin.get("base_profile_json") if isinstance(twin.get("base_profile_json"), dict) else {}
        sections = base_json.get("sections") if isinstance(base_json.get("sections"), dict) else {}
        identity = _compact_visible_text(sections.get("identity") or base_json.get("summary") or display_name, 80)
        expertise = _compact_visible_text(sections.get("expertise") or "按已有资料参与讨论", 80)
        thinking_style = _compact_visible_text(sections.get("thinking_style") or "先看边界和证据", 80)
        discussion_style = _compact_visible_text(sections.get("discussion_style") or "克制、接着现场说", 80)
        title = identity or title
        subtitle = expertise or subtitle
        summary = discussion_style or summary
        source_parts_count = sum(1 for value in sections.values() if str(value or "").strip())
    else:
        identity = display_name
        expertise = "按当前账号记录参与讨论"
        thinking_style = "先看问题和上下文"
        discussion_style = "自然接话，不代替本人承诺"

    return {
        "username": username,
        "display_name": display_name,
        "agent_name": agent_name or display_name,
        "title": title,
        "subtitle": subtitle,
        "summary": summary,
        "cards": [
            {"label": "当前身份", "value": display_name, "detail": identity},
            {"label": "能补什么", "value": "已有资料", "detail": expertise},
            {"label": "怎么判断", "value": "先看边界", "detail": thinking_style},
            {"label": "怎么说话", "value": "接着现场", "detail": discussion_style},
        ],
        "source_parts_count": source_parts_count,
    }


def _topic_text(topic: dict[str, Any]) -> str:
    metadata = topic.get("metadata") if isinstance(topic.get("metadata"), dict) else {}
    topic_link = metadata.get("topic_link") if isinstance(metadata.get("topic_link"), dict) else {}
    parts = [
        topic.get("title"),
        topic.get("body"),
        topic.get("category"),
        topic.get("creator_name"),
        topic_link.get("wanted"),
        topic_link.get("angles"),
        topic_link.get("profile_signals"),
        topic_link.get("openclaw_digest"),
    ]
    return "\n".join(_text(part) for part in parts if _text(part).strip())


def _safe_get_topic(topic_id: str | None) -> dict[str, Any] | None:
    if not topic_id:
        return None
    try:
        topic = get_topic(topic_id)
    except SQLAlchemyError:
        logger.info("TopicLink skipped topic lookup because topic storage is not ready")
        return None
    if not isinstance(topic, dict):
        return topic
    return _backfill_topiclink_metadata([topic], max_updates=1)[0]


def _safe_list_topics(limit: int) -> list[dict[str, Any]]:
    try:
        page = list_topics(limit=limit)
    except SQLAlchemyError:
        logger.info("TopicLink skipped recommendations because topic storage is not ready")
        return []
    items = page.get("items", []) if isinstance(page, dict) else []
    candidates = [
        item
        for item in items
        if isinstance(item, dict) and (_topiclink_has_metadata(item) or _topiclink_is_autofill_candidate(item))
    ]
    return _backfill_topiclink_metadata(candidates)


def _hash_embedding(text: str) -> list[float]:
    vector = [0.0] * EMBEDDING_DIM
    for token in text.lower().replace("/", " ").replace("_", " ").split():
        digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
        value = int.from_bytes(digest, "big")
        index = value % EMBEDDING_DIM
        vector[index] += 1.0 if value & 1 else -1.0
    norm = math.sqrt(sum(item * item for item in vector)) or 1.0
    return [item / norm for item in vector]


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    return sum(x * y for x, y in zip(a, b))


def _normalize_embedding_input(text: str, max_chars: int) -> str:
    return (text.strip() or " ").replace("\x00", " ")[:max_chars]


def _embedding_cache_key(model: str, text_value: str) -> tuple[str, str]:
    text_hash = hashlib.sha256(text_value.encode("utf-8")).hexdigest()
    return f"{model}:{text_hash}", text_hash


def _ensure_embedding_cache_table(session) -> None:
    global _embedding_cache_ready
    if _embedding_cache_ready:
        return
    is_sqlite = session.bind.dialect.name == "sqlite"
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS topic_link_embedding_cache (
                cache_key TEXT PRIMARY KEY,
                model TEXT NOT NULL,
                text_hash TEXT NOT NULL,
                vector_json TEXT NOT NULL,
                dimensions INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS topic_link_embedding_cache (
                cache_key TEXT PRIMARY KEY,
                model TEXT NOT NULL,
                text_hash TEXT NOT NULL,
                vector_json TEXT NOT NULL,
                dimensions INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_used_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    session.execute(text("CREATE INDEX IF NOT EXISTS idx_topic_link_embedding_cache_model_hash ON topic_link_embedding_cache(model, text_hash)"))
    _embedding_cache_ready = True


def _ensure_presence_table(session) -> None:
    is_sqlite = session.bind.dialect.name == "sqlite"
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS topic_link_presence (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                topic_id TEXT NOT NULL,
                persona_name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'resident',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS topic_link_presence (
                id SERIAL PRIMARY KEY,
                topic_id TEXT NOT NULL,
                persona_name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'resident',
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    session.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS idx_topic_link_presence_topic_persona ON topic_link_presence(topic_id, persona_name)"))


def _normalize_persona_name(value: str | None) -> str:
    persona = (value or "").strip()
    return persona[:80] or "分身"


def _get_topiclink_presence(topic_id: str, persona_name: str) -> dict[str, Any]:
    topic = _safe_get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    try:
        with get_db_session() as session:
            _ensure_presence_table(session)
            row = session.execute(
                text(
                    """
                    SELECT topic_id, persona_name, status, created_at, updated_at
                    FROM topic_link_presence
                    WHERE topic_id = :topic_id AND persona_name = :persona_name
                    """
                ),
                {"topic_id": topic_id, "persona_name": persona_name},
            ).fetchone()
    except Exception as exc:
        logger.info("TopicLink presence read failed", exc_info=True)
        raise HTTPException(status_code=500, detail="TopicLink presence unavailable") from exc
    if row is None:
        return {
            "topic_id": topic_id,
            "persona_name": persona_name,
            "resident": False,
            "status": "absent",
            "created_at": None,
            "updated_at": None,
        }
    return {
        "topic_id": str(row.topic_id),
        "persona_name": str(row.persona_name),
        "resident": str(row.status) == "resident",
        "status": str(row.status),
        "created_at": str(row.created_at) if row.created_at is not None else None,
        "updated_at": str(row.updated_at) if row.updated_at is not None else None,
    }


def _upsert_topiclink_presence(topic_id: str, persona_name: str) -> dict[str, Any]:
    topic = _safe_get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    try:
        with get_db_session() as session:
            _ensure_presence_table(session)
            is_sqlite = session.bind.dialect.name == "sqlite"
            session.execute(
                text(
                    """
                    INSERT INTO topic_link_presence (
                        topic_id, persona_name, status, created_at, updated_at
                    )
                    VALUES (
                        :topic_id, :persona_name, 'resident', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                    )
                    ON CONFLICT(topic_id, persona_name) DO UPDATE SET
                        status = 'resident',
                        updated_at = CURRENT_TIMESTAMP
                    """
                    if is_sqlite
                    else
                    """
                    INSERT INTO topic_link_presence (
                        topic_id, persona_name, status, created_at, updated_at
                    )
                    VALUES (
                        :topic_id, :persona_name, 'resident', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                    )
                    ON CONFLICT(topic_id, persona_name) DO UPDATE SET
                        status = 'resident',
                        updated_at = CURRENT_TIMESTAMP
                    """
                ),
                {"topic_id": topic_id, "persona_name": persona_name},
            )
        return _get_topiclink_presence(topic_id, persona_name)
    except HTTPException:
        raise
    except Exception as exc:
        logger.info("TopicLink presence write failed", exc_info=True)
        raise HTTPException(status_code=500, detail="TopicLink presence unavailable") from exc


def _read_embedding_cache(model: str, inputs: list[str]) -> list[list[float] | None]:
    if not inputs:
        return []
    cache_keys = [_embedding_cache_key(model, item)[0] for item in inputs]
    cached: list[list[float] | None] = [None] * len(inputs)
    try:
        with get_db_session() as session:
            _ensure_embedding_cache_table(session)
            rows = session.execute(
                text(
                    """
                    SELECT cache_key, vector_json, dimensions
                    FROM topic_link_embedding_cache
                    WHERE cache_key IN :cache_keys
                    """
                ).bindparams(bindparam("cache_keys", expanding=True)),
                {"cache_keys": cache_keys},
            ).fetchall()
            by_key = {str(row.cache_key): row for row in rows}
            hit_keys: list[str] = []
            for index, cache_key in enumerate(cache_keys):
                row = by_key.get(cache_key)
                if row is None:
                    continue
                try:
                    vector = json.loads(row.vector_json)
                except Exception:
                    continue
                if not isinstance(vector, list) or not vector:
                    continue
                cached[index] = [float(value) for value in vector]
                hit_keys.append(cache_key)
            if hit_keys:
                session.execute(
                    text(
                        """
                        UPDATE topic_link_embedding_cache
                        SET last_used_at = CURRENT_TIMESTAMP
                        WHERE cache_key IN :cache_keys
                        """
                    ).bindparams(bindparam("cache_keys", expanding=True)),
                    {"cache_keys": hit_keys},
                )
    except Exception:
        logger.info("TopicLink embedding cache read skipped", exc_info=True)
    return cached


def _write_embedding_cache(model: str, inputs: list[str], vectors: list[list[float]]) -> None:
    if not inputs or len(inputs) != len(vectors):
        return
    try:
        with get_db_session() as session:
            _ensure_embedding_cache_table(session)
            is_sqlite = session.bind.dialect.name == "sqlite"
            statement = (
                """
                INSERT INTO topic_link_embedding_cache (
                    cache_key, model, text_hash, vector_json, dimensions,
                    created_at, updated_at, last_used_at
                )
                VALUES (
                    :cache_key, :model, :text_hash, :vector_json, :dimensions,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                ON CONFLICT(cache_key) DO UPDATE SET
                    vector_json = excluded.vector_json,
                    dimensions = excluded.dimensions,
                    updated_at = CURRENT_TIMESTAMP,
                    last_used_at = CURRENT_TIMESTAMP
                """
                if is_sqlite
                else
                """
                INSERT INTO topic_link_embedding_cache (
                    cache_key, model, text_hash, vector_json, dimensions,
                    created_at, updated_at, last_used_at
                )
                VALUES (
                    :cache_key, :model, :text_hash, :vector_json, :dimensions,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                ON CONFLICT(cache_key) DO UPDATE SET
                    vector_json = EXCLUDED.vector_json,
                    dimensions = EXCLUDED.dimensions,
                    updated_at = CURRENT_TIMESTAMP,
                    last_used_at = CURRENT_TIMESTAMP
                """
            )
            params = []
            for text_value, vector in zip(inputs, vectors):
                cache_key, text_hash = _embedding_cache_key(model, text_value)
                params.append({
                    "cache_key": cache_key,
                    "model": model,
                    "text_hash": text_hash,
                    "vector_json": json.dumps(vector),
                    "dimensions": len(vector),
                })
            session.execute(text(statement), params)
    except Exception:
        logger.info("TopicLink embedding cache write skipped", exc_info=True)


async def _try_remote_embeddings(texts: list[str]) -> list[list[float]] | None:
    model = os.getenv("TOPICLINK_EMBEDDING_MODEL") or DEFAULT_EMBEDDING_MODEL
    max_chars = max(200, min(12000, int(os.getenv("TOPICLINK_EMBEDDING_TEXT_CHARS", str(DEFAULT_EMBEDDING_TEXT_CHARS)))))
    inputs = [_normalize_embedding_input(text, max_chars) for text in texts]
    cached_vectors = _read_embedding_cache(model, inputs)
    if cached_vectors and all(vector is not None for vector in cached_vectors):
        return [vector for vector in cached_vectors if vector is not None]

    api_key = os.getenv("TOPICLINK_EMBEDDING_API_KEY") or os.getenv("SCNET_API_KEY")
    if not api_key:
        return None

    base_url = (os.getenv("TOPICLINK_EMBEDDING_BASE_URL") or os.getenv("SCNET_BASE_URL") or "https://api.scnet.cn/api/llm/v1").rstrip("/")
    batch_size = max(1, min(32, int(os.getenv("TOPICLINK_EMBEDDING_BATCH_SIZE", str(DEFAULT_EMBEDDING_BATCH_SIZE)))))
    missing_indexes = [index for index, vector in enumerate(cached_vectors) if vector is None]
    missing_inputs = [inputs[index] for index in missing_indexes]
    fetched_vectors: list[list[float]] = []
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            for start in range(0, len(missing_inputs), batch_size):
                batch = missing_inputs[start:start + batch_size]
                res = await client.post(
                    f"{base_url}/embeddings",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={"model": model, "input": batch},
                )
                res.raise_for_status()
                payload = res.json()
                data = payload.get("data") if isinstance(payload, dict) else None
                if not isinstance(data, list) or len(data) != len(batch):
                    return None
                for item in data:
                    embedding = item.get("embedding") if isinstance(item, dict) else None
                    if not isinstance(embedding, list):
                        return None
                    fetched_vectors.append([float(value) for value in embedding])
    except Exception:
        return None

    if len(fetched_vectors) != len(missing_inputs):
        return None
    _write_embedding_cache(model, missing_inputs, fetched_vectors)
    merged = list(cached_vectors)
    for index, vector in zip(missing_indexes, fetched_vectors):
        merged[index] = vector
    if any(vector is None for vector in merged):
        return None
    return [vector for vector in merged if vector is not None]


def _score_from_similarity(similarity: float) -> int:
    return round(_clamp(50 + similarity * 46, 35, 96))


def _reason_for_score(score: int, topic: dict[str, Any]) -> list[str]:
    category = str(topic.get("category") or "话题")
    reasons = [f"方向接近：{category}"]
    if score >= 78:
        reasons.append("适合直接加入")
    elif score >= 62:
        reasons.append("适合先看一轮")
    else:
        reasons.append("可以先收藏观察")
    return reasons


def _compact_visible_text(value: Any, limit: int = 900) -> str:
    text_value = " ".join(_text(value).replace("\x00", " ").split())
    if len(text_value) <= limit:
        return text_value
    return f"{text_value[:limit - 1]}…"


def _topiclink_metadata_autofill_enabled() -> bool:
    return os.getenv("TOPICLINK_METADATA_AUTOFILL", "1").strip().lower() not in {"0", "false", "no", "off"}


def _topiclink_background_autofill_enabled() -> bool:
    if not _topiclink_metadata_autofill_enabled():
        return False
    return os.getenv("TOPICLINK_METADATA_BACKGROUND_AUTOFILL", "1").strip().lower() not in {"0", "false", "no", "off"}


def _topiclink_metadata_backfill_batch_size() -> int:
    raw_value = os.getenv("TOPICLINK_METADATA_BACKFILL_BATCH_SIZE", str(DEFAULT_METADATA_BACKFILL_BATCH_SIZE))
    try:
        return max(0, min(24, int(raw_value)))
    except ValueError:
        return DEFAULT_METADATA_BACKFILL_BATCH_SIZE


def _topiclink_int_env(name: str, default: int, *, low: int, high: int) -> int:
    raw_value = os.getenv(name, str(default)).strip()
    try:
        return max(low, min(high, int(raw_value)))
    except ValueError:
        return default


def _topiclink_float_env(name: str, default: float, *, low: float, high: float) -> float:
    raw_value = os.getenv(name, str(default)).strip()
    try:
        return max(low, min(high, float(raw_value)))
    except ValueError:
        return default


def _topiclink_background_page_size() -> int:
    return _topiclink_int_env("TOPICLINK_METADATA_BACKGROUND_PAGE_SIZE", DEFAULT_METADATA_BACKGROUND_PAGE_SIZE, low=10, high=100)


def _topiclink_background_max_per_pass() -> int:
    return _topiclink_int_env("TOPICLINK_METADATA_BACKGROUND_MAX_PER_PASS", DEFAULT_METADATA_BACKGROUND_MAX_PER_PASS, low=0, high=30)


def _topiclink_background_interval_seconds() -> float:
    return _topiclink_float_env(
        "TOPICLINK_METADATA_BACKGROUND_INTERVAL_SECONDS",
        DEFAULT_METADATA_BACKGROUND_INTERVAL_SECONDS,
        low=30.0,
        high=3600.0,
    )


def _topiclink_background_initial_delay_seconds() -> float:
    return _topiclink_float_env(
        "TOPICLINK_METADATA_BACKGROUND_INITIAL_DELAY_SECONDS",
        DEFAULT_METADATA_BACKGROUND_INITIAL_DELAY_SECONDS,
        low=0.0,
        high=600.0,
    )


def _topiclink_background_llm_delay_seconds() -> float:
    return _topiclink_float_env(
        "TOPICLINK_METADATA_BACKGROUND_LLM_DELAY_SECONDS",
        DEFAULT_METADATA_BACKGROUND_LLM_DELAY_SECONDS,
        low=0.0,
        high=60.0,
    )


def _topiclink_role_for_topic(topic: dict[str, Any]) -> dict[str, str]:
    category = str(topic.get("category") or "plaza").strip().lower()
    return TOPICLINK_CATEGORY_ROLES.get(
        category,
        {
            "title": "能接一句的人",
            "description": "先把眼前这件事说清楚，再看下一步。",
            "kind": "peer",
        },
    )


def _topiclink_is_autofill_candidate(topic: dict[str, Any]) -> bool:
    category = str(topic.get("category") or "").strip().lower()
    if category in TOPICLINK_EXCLUDED_CATEGORIES:
        return False
    title = str(topic.get("title") or "").strip().lower()
    if any(marker in title for marker in TOPICLINK_EXCLUDED_TITLE_MARKERS):
        return False
    return bool(str(topic.get("id") or "").strip() and (str(topic.get("title") or "").strip() or str(topic.get("body") or "").strip()))


def _topiclink_has_metadata(topic: dict[str, Any]) -> bool:
    metadata = topic.get("metadata") if isinstance(topic.get("metadata"), dict) else {}
    topic_link = metadata.get("topic_link") if isinstance(metadata.get("topic_link"), dict) else None
    return bool(topic_link)


def _topiclink_creator_participant(topic: dict[str, Any], role: dict[str, str]) -> list[dict[str, Any]]:
    creator_name = str(topic.get("creator_name") or "").strip()
    if not creator_name:
        return []
    if creator_name in {"我这边", "有人一起想想", "合适的人"}:
        return []
    is_openclaw = str(topic.get("creator_auth_type") or "").strip() == "openclaw_key" or "openclaw" in creator_name.lower()
    return [
        {
            "name": creator_name,
            "role": "开了这桌" if is_openclaw else role["title"],
            "status": "starter",
            "openclaw": is_openclaw,
            "fit": 72,
        }
    ]


def _derive_topiclink_metadata(topic: dict[str, Any]) -> dict[str, Any]:
    role = _topiclink_role_for_topic(topic)
    category = str(topic.get("category") or "plaza").strip() or "plaza"
    posts_count = int(topic.get("posts_count") or 0)
    return {
        "version": 1,
        "source": "topiclink_autofill",
        "connection_mode": "openclaw_link",
        "table_state": "active" if posts_count > 0 else "seeking",
        "participants": _topiclink_creator_participant(topic, role),
        "wanted": [
            {
                "kind": role["kind"],
                "title": role["title"],
                "description": role["description"],
                "source": "topic_category",
            }
        ],
        "angles": [
            {
                "id": "read",
                "title": "先了解一下",
                "description": "先把大家说到哪一步理清楚。",
                "kind": "co_read",
            },
            {
                "id": "source",
                "title": "补一条材料",
                "description": "带来案例、数据或可验证材料。",
                "kind": "source",
            },
            {
                "id": "reply",
                "title": "接着说一句",
                "description": "从经验、反例或下一步建议接上。",
                "kind": role["kind"],
            },
        ],
        "profile_signals": {
            "field": category,
            "need": role["title"],
            "status": "已经有人在聊" if posts_count > 0 else "等第一句回应",
        },
        "openclaw_digest": _compact_visible_text(topic.get("body") or topic.get("title") or "", 220),
    }


def _merge_topiclink_metadata(topic: dict[str, Any]) -> dict[str, Any] | None:
    if _topiclink_has_metadata(topic) or not _topiclink_is_autofill_candidate(topic):
        return None
    metadata = topic.get("metadata") if isinstance(topic.get("metadata"), dict) else {}
    merged = dict(metadata)
    merged["topic_link"] = _derive_topiclink_metadata(topic)
    return merged


def _merge_topiclink_metadata_payload(topic: dict[str, Any], topic_link: dict[str, Any]) -> dict[str, Any] | None:
    if _topiclink_has_metadata(topic) or not _topiclink_is_autofill_candidate(topic):
        return None
    metadata = topic.get("metadata") if isinstance(topic.get("metadata"), dict) else {}
    merged = dict(metadata)
    merged["topic_link"] = topic_link
    return merged


def _persist_topiclink_metadata(topic_id: str, metadata: dict[str, Any]) -> dict[str, Any] | None:
    """Persist TopicLink sidecar metadata without changing the topic timeline."""

    topic_id = str(topic_id or "").strip()
    if not topic_id:
        return None
    payload = json.dumps(metadata, ensure_ascii=False)
    try:
        with get_db_session() as session:
            if session.bind.dialect.name == "sqlite":
                result = session.execute(
                    text("UPDATE topics SET metadata = :metadata WHERE id = :topic_id"),
                    {"topic_id": topic_id, "metadata": payload},
                )
            else:
                result = session.execute(
                    text("UPDATE topics SET metadata = CAST(:metadata AS JSONB) WHERE id = :topic_id"),
                    {"topic_id": topic_id, "metadata": payload},
                )
            if result.rowcount == 0:
                return None
    except Exception:
        logger.info("TopicLink metadata persist skipped for topic %s", topic_id, exc_info=True)
        return None
    _invalidate_read_cache(topic_id=topic_id, invalidate_topic_lists=True)
    return get_topic(topic_id)


def _topiclink_chat_config() -> tuple[str, str, str] | None:
    api_key = os.getenv("TOPICLINK_CHAT_API_KEY") or os.getenv("SCNET_API_KEY") or os.getenv("MINIMAX_API_KEY")
    if not api_key:
        return None
    base_url = (os.getenv("TOPICLINK_CHAT_BASE_URL") or os.getenv("SCNET_BASE_URL") or "https://api.scnet.cn/api/llm/v1").rstrip("/")
    model = os.getenv("TOPICLINK_CHAT_MODEL") or DEFAULT_CHAT_MODEL
    return base_url, api_key, model


def _clean_topiclink_label(value: Any, fallback: str, limit: int) -> str:
    text_value = _compact_visible_text(value, limit)
    banned = ("模型", "向量", "embedding", "Embedding", "缓存", "推荐分", "画像", "AI助手", "作为AI", "作为 AI")
    if not text_value or any(word in text_value for word in banned):
        return fallback
    return text_value


async def _try_remote_topiclink_metadata(topic: dict[str, Any]) -> dict[str, Any] | None:
    config = _topiclink_chat_config()
    if not config:
        return None
    base_url, api_key, model = config
    role = _topiclink_role_for_topic(topic)
    title = _compact_visible_text(topic.get("title"), 180)
    body = _compact_visible_text(topic.get("body"), 1200)
    category = _compact_visible_text(topic.get("category"), 40)
    posts_count = int(topic.get("posts_count") or 0)
    prompt = f"""请把下面这个 TopicLab 话题整理成 TopicLink 广场里可用的“这桌需要谁来接”的侧边信息。

只输出 JSON，不要 Markdown。不要写模型、向量、推荐、缓存、画像、系统、AI 助手。语气要像产品里的自然短句，不要客服腔。

话题标题：{title}
分类：{category or "广场"}
已有回应数：{posts_count}
话题正文：{body}

输出格式：
{{
  "wanted_title": "6 个汉字以内，说明这桌需要谁",
  "wanted_description": "18 个汉字以内，说明怎么接上",
  "angles": [
    {{"title": "6 个汉字以内", "description": "18 个汉字以内"}},
    {{"title": "6 个汉字以内", "description": "18 个汉字以内"}},
    {{"title": "6 个汉字以内", "description": "18 个汉字以内"}}
  ],
  "digest": "60 个汉字以内，概括这桌正在聊什么"
}}
"""
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "你只负责把讨论话题整理成自然、克制、可读的 TopicLink 侧边信息。"},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.25,
                    "max_tokens": 500,
                    "response_format": {"type": "json_object"},
                },
            )
            response.raise_for_status()
            payload = response.json()
    except Exception:
        logger.info("TopicLink metadata LLM fallback used", exc_info=True)
        return None

    content = ""
    try:
        choices = payload.get("choices") if isinstance(payload, dict) else None
        first = choices[0] if isinstance(choices, list) and choices else {}
        message = first.get("message") if isinstance(first, dict) else None
        content = str(message.get("content") if isinstance(message, dict) else first.get("text") or "")
    except Exception:
        content = ""
    parsed = _parse_chat_json(content)
    if not parsed:
        return None

    fallback = _derive_topiclink_metadata(topic)
    wanted_title = _clean_topiclink_label(parsed.get("wanted_title"), role["title"], 18)
    wanted_description = _clean_topiclink_label(parsed.get("wanted_description"), role["description"], 36)
    raw_angles = parsed.get("angles") if isinstance(parsed.get("angles"), list) else []
    angles: list[dict[str, str]] = []
    for index, item in enumerate(raw_angles[:3]):
        if not isinstance(item, dict):
            continue
        fallback_angle = fallback["angles"][min(index, len(fallback["angles"]) - 1)]
        angles.append(
            {
                "id": str(fallback_angle.get("id") or f"angle-{index + 1}"),
                "title": _clean_topiclink_label(item.get("title"), str(fallback_angle.get("title") or "接着说"), 18),
                "description": _clean_topiclink_label(
                    item.get("description"),
                    str(fallback_angle.get("description") or "从当前讨论接上。"),
                    36,
                ),
                "kind": str(fallback_angle.get("kind") or role["kind"]),
            }
        )
    if len(angles) < 3:
        angles.extend(fallback["angles"][len(angles):])

    metadata = dict(fallback)
    metadata["source"] = "topiclink_llm_autofill"
    metadata["wanted"] = [
        {
            "kind": role["kind"],
            "title": wanted_title,
            "description": wanted_description,
            "source": "topiclink_background",
        }
    ]
    metadata["angles"] = angles[:3]
    metadata["profile_signals"] = {
        **fallback["profile_signals"],
        "need": wanted_title,
    }
    metadata["openclaw_digest"] = _clean_topiclink_label(parsed.get("digest"), fallback["openclaw_digest"], 120)
    return metadata


def _backfill_topiclink_metadata(topics: list[dict[str, Any]], max_updates: int | None = None) -> list[dict[str, Any]]:
    if not _topiclink_metadata_autofill_enabled():
        return topics
    budget = _topiclink_metadata_backfill_batch_size() if max_updates is None else max(0, min(24, max_updates))
    if budget <= 0:
        return topics

    updated_topics: list[dict[str, Any]] = []
    writes = 0
    for topic in topics:
        if not isinstance(topic, dict):
            updated_topics.append(topic)
            continue
        next_metadata = _merge_topiclink_metadata(topic)
        if next_metadata is None or writes >= budget:
            updated_topics.append(topic)
            continue
        topic_id = str(topic.get("id") or "").strip()
        updated = _persist_topiclink_metadata(topic_id, next_metadata)
        if isinstance(updated, dict):
            updated_topics.append(updated)
        else:
            local_topic = dict(topic)
            local_topic["metadata"] = next_metadata
            updated_topics.append(local_topic)
        writes += 1
    if writes:
        logger.info("TopicLink metadata autofill wrote %s topic(s)", writes)
    return updated_topics


async def _sleep_until_topiclink_worker_tick(seconds: float) -> bool:
    stop_event = _metadata_worker_stop
    if stop_event is None:
        await asyncio.sleep(seconds)
        return True
    try:
        await asyncio.wait_for(stop_event.wait(), timeout=max(0.0, seconds))
    except asyncio.TimeoutError:
        return True
    return False


async def _build_background_topiclink_metadata(topic: dict[str, Any]) -> dict[str, Any]:
    llm_metadata = await _try_remote_topiclink_metadata(topic)
    return llm_metadata or _derive_topiclink_metadata(topic)


async def _run_topiclink_metadata_background_pass() -> dict[str, int]:
    global _metadata_worker_cursor

    if not _topiclink_background_autofill_enabled():
        return {"scanned": 0, "written": 0}

    page_size = _topiclink_background_page_size()
    max_writes = _topiclink_background_max_per_pass()
    if max_writes <= 0:
        return {"scanned": 0, "written": 0}

    scanned = 0
    written = 0
    pages_seen = 0
    cursor = _metadata_worker_cursor
    max_pages = max(1, math.ceil(max_writes * 3 / page_size) + 2)

    while written < max_writes and pages_seen < max_pages:
        try:
            page = list_topics(limit=page_size, cursor=cursor)
        except SQLAlchemyError:
            logger.info("TopicLink metadata background pass skipped because topic storage is not ready")
            return {"scanned": scanned, "written": written}
        except Exception:
            logger.info("TopicLink metadata background pass failed", exc_info=True)
            return {"scanned": scanned, "written": written}

        items = page.get("items", []) if isinstance(page, dict) else []
        next_cursor = page.get("next_cursor") if isinstance(page, dict) else None
        pages_seen += 1
        if not items:
            cursor = None
            break

        for topic in items:
            if written >= max_writes:
                break
            if not isinstance(topic, dict):
                continue
            scanned += 1
            if _topiclink_has_metadata(topic) or not _topiclink_is_autofill_candidate(topic):
                continue
            topic_link = await _build_background_topiclink_metadata(topic)
            merged = _merge_topiclink_metadata_payload(topic, topic_link)
            if merged is None:
                continue
            topic_id = str(topic.get("id") or "").strip()
            if _persist_topiclink_metadata(topic_id, merged):
                written += 1
                await _sleep_until_topiclink_worker_tick(_topiclink_background_llm_delay_seconds())

        cursor = str(next_cursor or "").strip() or None
        if cursor is None:
            break

    _metadata_worker_cursor = cursor
    if written:
        logger.info("TopicLink metadata background pass wrote %s topic(s) after scanning %s", written, scanned)
    return {"scanned": scanned, "written": written}


async def _topiclink_metadata_worker_loop() -> None:
    if not await _sleep_until_topiclink_worker_tick(_topiclink_background_initial_delay_seconds()):
        return
    while _metadata_worker_stop is not None and not _metadata_worker_stop.is_set():
        try:
            await _run_topiclink_metadata_background_pass()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.info("TopicLink metadata background worker iteration failed", exc_info=True)
        if not await _sleep_until_topiclink_worker_tick(_topiclink_background_interval_seconds()):
            return


def start_topiclink_metadata_worker() -> None:
    global _metadata_worker_task, _metadata_worker_stop
    if not _topiclink_background_autofill_enabled():
        logger.info("TopicLink metadata background worker disabled")
        return
    if _metadata_worker_task and not _metadata_worker_task.done():
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.info("TopicLink metadata background worker skipped because no event loop is running")
        return
    _metadata_worker_stop = asyncio.Event()
    _metadata_worker_task = loop.create_task(_topiclink_metadata_worker_loop())
    logger.info("TopicLink metadata background worker started")


async def stop_topiclink_metadata_worker() -> None:
    global _metadata_worker_task, _metadata_worker_stop
    task = _metadata_worker_task
    stop_event = _metadata_worker_stop
    _metadata_worker_task = None
    _metadata_worker_stop = None
    if stop_event is not None:
        stop_event.set()
    if task is not None and not task.done():
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


def _fallback_simulation(topic: dict[str, Any], persona: str, provider_status: str = "unconfigured", message: str | None = None) -> dict[str, Any]:
    title = str(topic.get("title") or "这桌讨论").strip()
    category = str(topic.get("category") or "公共讨论").strip()
    return {
        "provider_status": provider_status,
        "model": os.getenv("TOPICLINK_CHAT_MODEL") or DEFAULT_CHAT_MODEL,
        "summary": f"{persona} 会先看清楚「{title}」已经聊到哪一步，再决定怎么接话。",
        "turns": [
            {
                "speaker": persona,
                "role": category,
                "message": f"我先顺一下这桌在讨论什么：如果问题已经落到具体材料或案例，我可以补资料；如果还停在判断上，我会先问清边界。",
            }
        ],
        "suggested_action": "先看一轮，再决定回应或邀请更合适的人。",
        "message": message or "未配置对话模型，已返回本地参与建议。",
    }


def _topiclink_recent_posts_text(topic_id: str, limit: int = 5) -> str:
    page = _list_topiclink_posts(topic_id, limit)
    posts = page.get("items") if isinstance(page, dict) else []
    if not isinstance(posts, list):
        return ""
    lines = []
    for post in posts[:limit]:
        if not isinstance(post, dict):
            continue
        author = str(post.get("author") or post.get("expert_label") or "参与者").strip()
        body = _compact_visible_text(post.get("body"), 240)
        if body:
            lines.append(f"{author}: {body}")
    return "\n".join(lines)


def _parse_chat_json(content: str) -> dict[str, Any] | None:
    cleaned = content.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        cleaned = cleaned[start:end + 1]
    try:
        payload = json.loads(cleaned)
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


async def _try_remote_simulation(topic: dict[str, Any], req: TopicLinkSimulationRequest | None, persona: str) -> dict[str, Any] | None:
    api_key = os.getenv("TOPICLINK_CHAT_API_KEY") or os.getenv("SCNET_API_KEY") or os.getenv("MINIMAX_API_KEY")
    if not api_key:
        return None
    base_url = (os.getenv("TOPICLINK_CHAT_BASE_URL") or os.getenv("SCNET_BASE_URL") or "https://api.scnet.cn/api/llm/v1").rstrip("/")
    model = os.getenv("TOPICLINK_CHAT_MODEL") or DEFAULT_CHAT_MODEL
    profile_text = _compact_visible_text(req.profile_text if req else "", 1600)
    title = _compact_visible_text(topic.get("title"), 180)
    body = _compact_visible_text(topic.get("body"), 1400)
    recent_posts = _topiclink_recent_posts_text(str(topic.get("id") or ""), 5)
    prompt = f"""你现在是一个认知分身，名字是：{persona}。

请基于下面的话题和已有回应，判断你如果进入这桌，第一句应该怎么自然接上。

要求：
- 只输出 JSON，不要 Markdown。
- 不解释模型、推荐分数、向量、缓存或系统状态。
- 语气像刚读完上下文的人，不要客服腔，不要说“作为 AI”。
- 不冒充本人做现实承诺，不编造论文、项目或经历。
- message 控制在 80 个汉字以内。

个人底稿：
{profile_text or "暂无完整底稿，只能按当前话题保守参与。"}

话题标题：
{title}

话题正文：
{body}

已有回应：
{recent_posts or "暂无可读回应。"}

输出格式：
{{"summary":"一句内部参与判断","message":"公开第一句回应","suggested_action":"下一步动作"}}
"""
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "你帮助认知分身判断怎样自然参与 TopicLab 讨论。"},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.45,
                    "max_tokens": 700,
                },
            )
            response.raise_for_status()
            payload = response.json()
    except Exception:
        logger.info("TopicLink chat simulation fallback used", exc_info=True)
        return None

    content = ""
    try:
        choices = payload.get("choices") if isinstance(payload, dict) else None
        first = choices[0] if isinstance(choices, list) and choices else {}
        message = first.get("message") if isinstance(first, dict) else None
        content = str(message.get("content") if isinstance(message, dict) else first.get("text") or "")
    except Exception:
        content = ""
    parsed = _parse_chat_json(content)
    if parsed:
        summary = _compact_visible_text(parsed.get("summary"), 240)
        reply = _compact_visible_text(parsed.get("message"), 110)
        suggested_action = _compact_visible_text(parsed.get("suggested_action"), 180)
    else:
        summary = "已经读过这桌的背景和回应。"
        reply = _compact_visible_text(content, 110)
        suggested_action = "可以先用这一句接上。"
    if not reply:
        return None
    return {
        "provider_status": "ready",
        "model": model,
        "summary": summary or "已经读过这桌的背景和回应。",
        "turns": [
            {
                "speaker": persona,
                "role": str(topic.get("category") or "公共讨论"),
                "message": reply,
            }
        ],
        "suggested_action": suggested_action or "可以先用这一句接上。",
        "message": None,
    }


def _fallback_knowledge_answer(query: str, topics: list[dict[str, Any]]) -> str:
    titles = [_compact_visible_text(topic.get("title") or topic.get("body") or "一桌讨论", 42) for topic in topics[:3]]
    titles = [title for title in titles if title]
    if not titles:
        return f"我在当前这批话题里还没找到特别贴近「{query}」的线索，可以换个说法再搜一次。"
    if len(titles) == 1:
        return f"先看「{titles[0]}」这一桌；它和「{query}」最接近，进去后再看有没有能接上的回应。"
    if len(titles) == 2:
        return f"先看「{titles[0]}」，旁边还有「{titles[1]}」；一个像主线，一个适合补充看。"
    return f"先看「{titles[0]}」；另外「{titles[1]}」和「{titles[2]}」也能顺手对照。"


async def _try_remote_knowledge_answer(query: str, topics: list[dict[str, Any]]) -> str | None:
    api_key = os.getenv("TOPICLINK_CHAT_API_KEY") or os.getenv("SCNET_API_KEY") or os.getenv("MINIMAX_API_KEY")
    if not api_key or not topics:
        return None
    base_url = (os.getenv("TOPICLINK_CHAT_BASE_URL") or os.getenv("SCNET_BASE_URL") or "https://api.scnet.cn/api/llm/v1").rstrip("/")
    model = os.getenv("TOPICLINK_CHAT_MODEL") or DEFAULT_CHAT_MODEL
    snippets = []
    for index, topic in enumerate(topics[:5], start=1):
        snippets.append(
            "\n".join(
                [
                    f"{index}. 标题：{_compact_visible_text(topic.get('title'), 120)}",
                    f"分类：{_compact_visible_text(topic.get('category'), 40)}",
                    f"内容：{_compact_visible_text(topic.get('body'), 260)}",
                ]
            )
        )
    prompt = f"""你在 TopicLink 里帮用户把检索到的几桌话题串起来。

用户想找：{_compact_visible_text(query, 180)}

候选话题：
{chr(10).join(snippets)}

请只输出一段中文，70 个汉字以内。
要求：
- 像人帮人找话题，不要客服腔。
- 不提模型、向量、Embedding、推荐分数、缓存、系统。
- 不编造候选话题里没有的信息。
- 告诉用户先看哪一桌，以及为什么顺手看另一桌。
"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "你帮用户把知识库里检索到的话题讲成人话。"},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.35,
                    "max_tokens": 220,
                },
            )
            response.raise_for_status()
            payload = response.json()
    except Exception:
        logger.info("TopicLink knowledge answer fallback used", exc_info=True)
        return None

    try:
        choices = payload.get("choices") if isinstance(payload, dict) else None
        first = choices[0] if isinstance(choices, list) and choices else {}
        message = first.get("message") if isinstance(first, dict) else None
        content = str(message.get("content") if isinstance(message, dict) else first.get("text") or "")
    except Exception:
        content = ""
    answer = _compact_visible_text(content, 180)
    return answer or None


def _normalize_topiclink_post(post: dict[str, Any]) -> dict[str, Any]:
    if not post.get("in_reply_to_id"):
        post["in_reply_to_id"] = None
    if not post.get("root_post_id"):
        post["root_post_id"] = post.get("id")
    post["latest_replies"] = post.get("latest_replies") or []
    return post


def _list_topiclink_posts(topic_id: str, limit: int) -> dict[str, Any]:
    safe_limit = max(1, min(limit, 100))
    try:
        with get_db_session() as session:
            root_rows = session.execute(
                text(
                    """
                    SELECT *
                    FROM posts
                    WHERE topic_id = :topic_id
                      AND (in_reply_to_id IS NULL OR in_reply_to_id = '')
                      AND TRIM(COALESCE(body, '')) NOT IN ('', '-')
                    ORDER BY created_at ASC, id ASC
                    LIMIT :limit
                    """
                ),
                {"topic_id": topic_id, "limit": safe_limit + 1},
            ).fetchall()
            has_more = len(root_rows) > safe_limit
            root_rows = root_rows[:safe_limit]
            posts = [_normalize_topiclink_post(post_row_to_dict(row)) for row in root_rows]
            root_ids = [post["id"] for post in posts]
            replies_by_root: dict[str, list[dict[str, Any]]] = {}
            if root_ids:
                reply_rows = session.execute(
                    text(
                        """
                        SELECT *
                        FROM posts
                        WHERE topic_id = :topic_id
                          AND id NOT IN :root_ids
                          AND TRIM(COALESCE(body, '')) NOT IN ('', '-')
                          AND (
                            in_reply_to_id IN :root_ids
                            OR COALESCE(NULLIF(root_post_id, ''), id) IN :root_ids
                          )
                        ORDER BY created_at ASC, id ASC
                        """
                    ).bindparams(
                        bindparam("root_ids", expanding=True),
                    ),
                    {"topic_id": topic_id, "root_ids": root_ids},
                ).fetchall()
                for row in reply_rows:
                    reply = _normalize_topiclink_post(post_row_to_dict(row))
                    root_id = str(reply.get("root_post_id") or reply.get("in_reply_to_id") or "")
                    replies_by_root.setdefault(root_id, []).append(reply)
            annotate_posts_with_interactions(posts)
            for post in posts:
                replies = replies_by_root.get(str(post["id"]), [])
                annotate_posts_with_interactions(replies)
                post["latest_replies"] = replies[:3]
                post["reply_count"] = max(int(post.get("reply_count") or 0), len(replies))
            return {
                "items": posts,
                "next_cursor": "__more__" if has_more else None,
            }
    except SQLAlchemyError:
        logger.info("TopicLink skipped legacy posts lookup because topic storage is not ready")
        return {"items": [], "next_cursor": None}


async def _score_topics(profile_text: str, topics: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str]:
    profile = profile_text.strip() or "关注科研、协作、资料整理和真实经验。"
    topic_texts = [_topic_text(topic) for topic in topics]
    vectors = await _try_remote_embeddings([profile, *topic_texts])
    source = "qwen_embedding" if vectors else "local_text_rule"
    if vectors:
        profile_vector = vectors[0]
        topic_vectors = vectors[1:]
    else:
        profile_vector = _hash_embedding(profile)
        topic_vectors = [_hash_embedding(text) for text in topic_texts]
    items: list[dict[str, Any]] = []
    for topic, vector in zip(topics, topic_vectors):
        similarity = _cosine(profile_vector, vector)
        score = _score_from_similarity(similarity)
        items.append(
            {
                "topic_id": str(topic.get("id") or ""),
                "semantic_similarity": score,
                "profile_similarity": score,
                "recommendation_score": score,
                "confidence": "high" if score >= 78 else "medium" if score >= 62 else "low",
                "score_source": source,
                "reasons": _reason_for_score(score, topic),
                "next_action": "可以先看一轮，再决定是否回应。" if score < 78 else "适合加入讨论。",
                "embedding_breakdown": {
                    "semantic": score,
                    "demand": max(35, score - 4),
                    "context": max(35, score - 2),
                    "field": score,
                },
            }
        )
    items.sort(key=lambda item: item["recommendation_score"], reverse=True)
    return items, source


@router.get("/profile")
async def get_topiclink_profile(user: dict[str, Any] | None = Depends(_optional_topiclink_user)) -> dict[str, Any]:
    return _topiclink_profile_from_user(user)


@router.get("/recommendations")
async def recommend_topiclink_topics(
    topic_id: str | None = Query(default=None),
    limit: int = Query(default=32, ge=1, le=80),
) -> dict[str, Any]:
    seed = _safe_get_topic(topic_id)
    candidate_limit = min(80, max(12, limit * 3))
    topics = [item for item in _safe_list_topics(limit=candidate_limit) if not topic_id or item.get("id") != topic_id]
    profile_text = _topic_text(seed) if seed else ""
    items, source = await _score_topics(profile_text, topics)
    return {
        "vector_status": "ready" if source == "qwen_embedding" else "unconfigured",
        "embedding_model": DEFAULT_EMBEDDING_MODEL,
        "items": items[:limit],
        "message": None if source == "qwen_embedding" else "未配置远程 Embedding，已使用本地相近度估计。",
    }


@router.post("/recommendations/score")
async def score_topiclink_topics(req: TopicLinkScoreRequest) -> dict[str, Any]:
    items, source = await _score_topics(req.profile_text, req.topics[:80])
    return {
        "vector_status": "ready" if source == "qwen_embedding" else "unconfigured",
        "embedding_model": DEFAULT_EMBEDDING_MODEL,
        "items": items,
        "message": None if source == "qwen_embedding" else "未配置远程 Embedding，已使用本地相近度估计。",
    }


@router.post("/knowledge/answer")
async def answer_topiclink_knowledge(req: TopicLinkKnowledgeAnswerRequest) -> dict[str, Any]:
    query = _compact_visible_text(req.query, 1000)
    if not query:
        raise HTTPException(status_code=400, detail="请输入想找的内容")
    candidates = req.topics[:80] or _safe_list_topics(limit=80)
    items, source = await _score_topics(query, candidates)
    topic_by_id = {str(topic.get("id") or ""): topic for topic in candidates}
    ranked_topics = [
        topic_by_id.get(str(item.get("topic_id") or ""))
        for item in items[:6]
        if topic_by_id.get(str(item.get("topic_id") or ""))
    ]
    answer = await _try_remote_knowledge_answer(query, ranked_topics)
    provider_status = "ready" if answer else "local"
    if not answer:
        answer = _fallback_knowledge_answer(query, ranked_topics)
    return {
        "provider_status": provider_status,
        "vector_status": "ready" if source == "qwen_embedding" else "unconfigured",
        "embedding_model": DEFAULT_EMBEDDING_MODEL,
        "answer": answer,
        "topic_ids": [str(topic.get("id") or "") for topic in ranked_topics],
        "message": None,
    }


@router.get("/{topic_id}/posts")
async def get_topiclink_posts(
    topic_id: str,
    limit: int = Query(default=50, ge=1, le=100),
) -> dict[str, Any]:
    if not _safe_get_topic(topic_id):
        raise HTTPException(status_code=404, detail="话题不存在")
    return _list_topiclink_posts(topic_id, limit)


@router.get("/{topic_id}/presence")
async def get_topiclink_presence(
    topic_id: str,
    persona_name: str | None = Query(default=None, max_length=80),
) -> dict[str, Any]:
    return _get_topiclink_presence(topic_id, _normalize_persona_name(persona_name))


@router.post("/{topic_id}/presence")
async def set_topiclink_presence(topic_id: str, req: TopicLinkPresenceRequest | None = None) -> dict[str, Any]:
    persona_name = _normalize_persona_name(req.persona_name if req else None)
    return _upsert_topiclink_presence(topic_id, persona_name)


@router.post("/{topic_id}/simulate")
async def simulate_topiclink(topic_id: str, req: TopicLinkSimulationRequest | None = None) -> dict[str, Any]:
    topic = _safe_get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="话题不存在")
    persona = (req.persona_name if req else None) or "分身"
    remote = await _try_remote_simulation(topic, req, persona)
    if remote:
        return remote
    return _fallback_simulation(topic, persona)
