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
import secrets
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sqlalchemy import bindparam, inspect, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.api.auth import require_openclaw_user, security, verify_access_token
from app.services.openclaw_runtime import get_primary_openclaw_agent_for_user
from app.services.twin_runtime import get_or_backfill_active_twin_for_user
from app.storage.database.postgres_client import get_db_session
from app.storage.database.topic_store import (
    _invalidate_read_cache,
    annotate_posts_with_interactions,
    create_topic,
    delete_post,
    get_topic,
    list_topics,
    make_post,
    post_row_to_dict,
    upsert_post,
)

router = APIRouter(prefix="/topiclink", tags=["topiclink"])
logger = logging.getLogger(__name__)

EMBEDDING_DIM = 96
DEFAULT_EMBEDDING_MODEL = "Qwen3-Embedding-8B"
DEFAULT_CHAT_MODEL = "DeepSeek-V4-Flash"
DEFAULT_EMBEDDING_BATCH_SIZE = 3
DEFAULT_EMBEDDING_TEXT_CHARS = 2000
DEFAULT_ZVEC_DIMENSIONS = 4096
ZVEC_VECTOR_FIELD = "embedding"
DEFAULT_METADATA_BACKFILL_BATCH_SIZE = 8
DEFAULT_METADATA_BACKGROUND_INTERVAL_SECONDS = 300.0
DEFAULT_METADATA_BACKGROUND_INITIAL_DELAY_SECONDS = 20.0
DEFAULT_METADATA_BACKGROUND_LLM_DELAY_SECONDS = 4.0
DEFAULT_METADATA_BACKGROUND_MAX_PER_PASS = 10
DEFAULT_METADATA_BACKGROUND_PAGE_SIZE = 50
DEFAULT_EMBEDDING_BACKGROUND_MAX_PER_PASS = 24
DEFAULT_ZVEC_MAX_IDLE_DAYS = 30
DEFAULT_ZVEC_PRUNE_INTERVAL_SECONDS = 86400.0
DEFAULT_ZVEC_SERVICE_TIMEOUT_SECONDS = 15.0
DEFAULT_TASK_CLAIM_LEASE_SECONDS = 600
_embedding_cache_ready = False
_zvec_collection: Any | None = None
_zvec_collection_path: Path | None = None
_zvec_error: str | None = None
_zvec_lock = threading.RLock()
_metadata_worker_task: asyncio.Task | None = None
_metadata_worker_stop: asyncio.Event | None = None
_metadata_worker_cursor: str | None = None
_embedding_worker_cursor: str | None = None
_embedding_worker_opc_offset = 0
_zvec_last_prune_monotonic = 0.0
_topiclink_task_creation_locks = tuple(threading.Lock() for _ in range(64))

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


class TopicLinkTaskClaimRequest(BaseModel):
    claim_token: str = Field(..., min_length=24, max_length=128)


class TopicLinkTaskCompleteRequest(BaseModel):
    claim_token: str = Field(..., min_length=24, max_length=128)
    summary: str = Field(..., min_length=1, max_length=2000)
    risk_notes: list[str] = Field(default_factory=list, max_length=12)
    next_step: str = Field(..., min_length=1, max_length=1000)


class TopicLinkTaskFailRequest(BaseModel):
    claim_token: str = Field(..., min_length=24, max_length=128)
    error_message: str = Field(..., min_length=1, max_length=1000)


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


def _topiclink_zvec_enabled() -> bool:
    return os.getenv("TOPICLINK_ZVEC_ENABLED", "1").strip().lower() not in {"0", "false", "no", "off"}


def _topiclink_zvec_dimensions() -> int:
    raw = os.getenv("TOPICLINK_ZVEC_DIMENSIONS", str(DEFAULT_ZVEC_DIMENSIONS)).strip()
    try:
        dimensions = int(raw)
    except ValueError as exc:
        raise RuntimeError(f"Invalid TOPICLINK_ZVEC_DIMENSIONS: {raw!r}") from exc
    if dimensions < 1:
        raise RuntimeError("TOPICLINK_ZVEC_DIMENSIONS must be positive")
    return dimensions


def _topiclink_zvec_path() -> Path:
    configured = os.getenv("TOPICLINK_ZVEC_PATH", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    workspace = Path(os.getenv("WORKSPACE_BASE", "workspace")).expanduser().resolve()
    model = os.getenv("TOPICLINK_EMBEDDING_MODEL") or DEFAULT_EMBEDDING_MODEL
    model_slug = "-".join(part for part in "".join(
        char.lower() if char.isalnum() else " " for char in model
    ).split() if part)
    return workspace / "topiclink-zvec" / f"{model_slug}-{_topiclink_zvec_dimensions()}"


def _topiclink_zvec_service_url() -> str:
    return os.getenv("TOPICLINK_ZVEC_SERVICE_URL", "").strip().rstrip("/")


def _request_zvec_service(method: str, path: str, *, payload: dict[str, Any] | None = None) -> Any:
    url = _topiclink_zvec_service_url()
    if not url:
        raise RuntimeError("TopicLink Zvec service URL is not configured")
    response = httpx.request(
        method,
        f"{url}{path}",
        json=payload,
        timeout=DEFAULT_ZVEC_SERVICE_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.json()


def _topiclink_zvec_document_id(cache_key: str) -> str:
    return hashlib.sha256(cache_key.encode("utf-8")).hexdigest()


def _topiclink_zvec_timestamp(value: datetime | None = None) -> str:
    current = value or datetime.now(timezone.utc)
    return current.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _topiclink_zvec_max_idle_days() -> int:
    raw = os.getenv("TOPICLINK_ZVEC_MAX_IDLE_DAYS", str(DEFAULT_ZVEC_MAX_IDLE_DAYS)).strip()
    try:
        return max(0, min(3650, int(raw)))
    except ValueError:
        return DEFAULT_ZVEC_MAX_IDLE_DAYS


def _topiclink_zvec_prune_interval_seconds() -> float:
    raw = os.getenv(
        "TOPICLINK_ZVEC_PRUNE_INTERVAL_SECONDS",
        str(DEFAULT_ZVEC_PRUNE_INTERVAL_SECONDS),
    ).strip()
    try:
        return max(60.0, min(604800.0, float(raw)))
    except ValueError:
        return DEFAULT_ZVEC_PRUNE_INTERVAL_SECONDS


def _topiclink_zvec_doc_count(collection: Any) -> int:
    try:
        return int(json.loads(str(collection.stats)).get("doc_count") or 0)
    except (TypeError, ValueError, json.JSONDecodeError):
        return 0


def _assert_zvec_statuses(statuses: Any) -> None:
    values = statuses if isinstance(statuses, list) else [statuses]
    failed = [status for status in values if not status.ok()]
    if failed:
        detail = "; ".join(f"{status.code}: {status.message}" for status in failed[:3])
        raise RuntimeError(f"TopicLink Zvec upsert failed: {detail}")


def _assert_zvec_collection_schema(collection: Any, dimensions: int) -> None:
    vector_schema = collection.schema.vector(ZVEC_VECTOR_FIELD)
    actual_dimensions = None if vector_schema is None else int(vector_schema.dimension)
    if actual_dimensions != dimensions:
        raise RuntimeError(
            f"TopicLink Zvec dimension {actual_dimensions} does not match configured {dimensions}"
        )
    required_fields = {
        "cache_key": "STRING",
        "model": "STRING",
        "text_hash": "STRING",
        "dimensions": "INT32",
        "created_at": "STRING",
        "updated_at": "STRING",
        "last_used_at": "STRING",
    }
    for field_name, expected_type in required_fields.items():
        field = collection.schema.field(field_name)
        if field is None:
            raise RuntimeError(f"TopicLink Zvec schema is missing field {field_name}")
        actual_type = getattr(field.data_type, "name", str(field.data_type).split(".")[-1])
        if actual_type != expected_type:
            raise RuntimeError(
                f"TopicLink Zvec field {field_name} has type {actual_type}, expected {expected_type}"
            )


def _ensure_zvec_collection():
    global _zvec_collection, _zvec_collection_path, _zvec_error
    if not _topiclink_zvec_enabled():
        return None
    path = _topiclink_zvec_path()
    dimensions = _topiclink_zvec_dimensions()
    with _zvec_lock:
        if _zvec_collection is not None and _zvec_collection_path == path:
            return _zvec_collection
        try:
            import zvec

            if path.exists():
                collection = zvec.open(str(path))
                _assert_zvec_collection_schema(collection, dimensions)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                schema = zvec.CollectionSchema(
                    name="topiclink_embedding_cache",
                    fields=[
                        zvec.FieldSchema("cache_key", zvec.DataType.STRING),
                        zvec.FieldSchema("model", zvec.DataType.STRING),
                        zvec.FieldSchema("text_hash", zvec.DataType.STRING),
                        zvec.FieldSchema("dimensions", zvec.DataType.INT32),
                        zvec.FieldSchema("created_at", zvec.DataType.STRING),
                        zvec.FieldSchema("updated_at", zvec.DataType.STRING),
                        zvec.FieldSchema("last_used_at", zvec.DataType.STRING),
                    ],
                    vectors=zvec.VectorSchema(
                        ZVEC_VECTOR_FIELD,
                        zvec.DataType.VECTOR_FP32,
                        dimensions,
                        index_param=zvec.HnswIndexParam(metric_type=zvec.MetricType.COSINE),
                    ),
                )
                collection = zvec.create_and_open(str(path), schema)
            _zvec_collection = collection
            _zvec_collection_path = path
            _zvec_error = None
            return collection
        except Exception as exc:
            _zvec_collection = None
            _zvec_collection_path = path
            _zvec_error = str(exc)
            raise


def _write_zvec_documents(documents: list[Any]) -> None:
    global _zvec_error
    if not documents:
        return
    collection = _ensure_zvec_collection()
    if collection is None:
        return
    try:
        with _zvec_lock:
            _assert_zvec_statuses(collection.upsert(documents))
            collection.flush()
        _zvec_error = None
    except Exception as exc:
        _zvec_error = str(exc)
        raise


def _write_zvec_cache(model: str, inputs: list[str], vectors: list[list[float]]) -> bool:
    global _zvec_error
    if not _topiclink_zvec_enabled() or not inputs or len(inputs) != len(vectors):
        return False
    dimensions = _topiclink_zvec_dimensions()
    service_url = _topiclink_zvec_service_url()
    if service_url:
        try:
            _request_zvec_service(
                "POST",
                "/cache/upsert",
                payload={"model": model, "inputs": inputs, "vectors": vectors},
            )
            _zvec_error = None
            return True
        except Exception as exc:
            _zvec_error = str(exc)
            logger.warning("TopicLink Zvec service write failed: %s", exc)
            return False
    try:
        import zvec

        timestamp = _topiclink_zvec_timestamp()
        documents = []
        for text_value, vector in zip(inputs, vectors):
            if len(vector) != dimensions:
                raise RuntimeError(
                    f"TopicLink Zvec expected {dimensions} dimensions, received {len(vector)}"
                )
            cache_key, text_hash = _embedding_cache_key(model, text_value)
            documents.append(
                zvec.Doc(
                    id=_topiclink_zvec_document_id(cache_key),
                    vectors={ZVEC_VECTOR_FIELD: vector},
                    fields={
                        "cache_key": cache_key,
                        "model": model,
                        "text_hash": text_hash,
                        "dimensions": dimensions,
                        "created_at": timestamp,
                        "updated_at": timestamp,
                        "last_used_at": timestamp,
                    },
                )
            )
        _write_zvec_documents(documents)
        _zvec_error = None
        return True
    except Exception as exc:
        _zvec_error = str(exc)
        logger.warning("TopicLink Zvec write failed: %s", exc)
        return False


def _read_zvec_cache(model: str, inputs: list[str]) -> list[list[float] | None]:
    global _zvec_error
    cached: list[list[float] | None] = [None] * len(inputs)
    if not _topiclink_zvec_enabled() or not inputs:
        return cached
    service_url = _topiclink_zvec_service_url()
    if service_url:
        try:
            payload = _request_zvec_service(
                "POST",
                "/cache/fetch",
                payload={"model": model, "inputs": inputs},
            )
            vectors = payload.get("vectors") if isinstance(payload, dict) else None
            if not isinstance(vectors, list) or len(vectors) != len(inputs):
                raise RuntimeError("TopicLink Zvec service returned an invalid cache response")
            _zvec_error = None
            return [
                [float(value) for value in vector] if isinstance(vector, list) else None
                for vector in vectors
            ]
        except Exception as exc:
            _zvec_error = str(exc)
            logger.warning("TopicLink Zvec service read failed: %s", exc)
            return cached
    try:
        import zvec

        collection = _ensure_zvec_collection()
        if collection is None:
            return cached
        cache_keys = [_embedding_cache_key(model, item)[0] for item in inputs]
        document_ids = [_topiclink_zvec_document_id(cache_key) for cache_key in cache_keys]
        with _zvec_lock:
            documents = collection.fetch(document_ids, include_vector=True)
        touched_at = _topiclink_zvec_timestamp()
        touched_documents = []
        for index, document_id in enumerate(document_ids):
            document = documents.get(document_id)
            if document is None or str(document.fields.get("model") or "") != model:
                continue
            vector = document.vectors.get(ZVEC_VECTOR_FIELD)
            if isinstance(vector, list) and vector:
                cached[index] = [float(value) for value in vector]
                if str(document.fields.get("last_used_at") or "")[:10] != touched_at[:10]:
                    touched_documents.append(zvec.Doc(id=document_id, fields={"last_used_at": touched_at}))
        if touched_documents:
            with _zvec_lock:
                _assert_zvec_statuses(collection.update(touched_documents))
                collection.flush()
    except Exception as exc:
        _zvec_error = str(exc)
        logger.warning("TopicLink Zvec read failed: %s", exc)
    return cached


def _prune_zvec_cache(*, force: bool = False, now: datetime | None = None) -> int:
    global _zvec_error, _zvec_last_prune_monotonic
    max_idle_days = _topiclink_zvec_max_idle_days()
    if not _topiclink_zvec_enabled() or max_idle_days <= 0:
        return 0
    service_url = _topiclink_zvec_service_url()
    if service_url:
        try:
            payload = _request_zvec_service("POST", "/cache/prune", payload={"force": force})
            _zvec_error = None
            return int(payload.get("deleted") or 0)
        except Exception as exc:
            _zvec_error = str(exc)
            logger.warning("TopicLink Zvec service prune failed: %s", exc)
            return 0
    monotonic_now = time.monotonic()
    if (
        not force
        and _zvec_last_prune_monotonic > 0
        and monotonic_now - _zvec_last_prune_monotonic < _topiclink_zvec_prune_interval_seconds()
    ):
        return 0
    try:
        collection = _ensure_zvec_collection()
        if collection is None:
            return 0
        cutoff = _topiclink_zvec_timestamp((now or datetime.now(timezone.utc)) - timedelta(days=max_idle_days))
        with _zvec_lock:
            before = _topiclink_zvec_doc_count(collection)
            collection.delete_by_filter(f"last_used_at != '' and last_used_at < '{cutoff}'")
            collection.flush()
            after = _topiclink_zvec_doc_count(collection)
        _zvec_last_prune_monotonic = monotonic_now
        _zvec_error = None
        deleted = max(0, before - after)
        if deleted:
            logger.info("TopicLink Zvec pruned %s vector(s) unused since %s", deleted, cutoff)
        return deleted
    except Exception as exc:
        _zvec_error = str(exc)
        logger.warning("TopicLink Zvec prune failed: %s", exc)
        return 0


def _ensure_embedding_cache_table(session, *, force: bool = False) -> None:
    """Keep the explicit legacy import script compatible; runtime does not call this."""
    global _embedding_cache_ready
    if _embedding_cache_ready and not force:
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


def initialize_topiclink_storage() -> int:
    """Connect Zvec and initialize TopicLink's dispatch receipt table."""
    if _topiclink_zvec_service_url():
        probe_topiclink_storage(None)
        collection_ready = 1
    else:
        collection_ready = 1 if _ensure_zvec_collection() is not None else 0
    with get_db_session() as session:
        _ensure_topiclink_agent_tasks_table(session)
    logger.info(
        "TopicLink Zvec store ready via %s",
        _topiclink_zvec_service_url() or _zvec_collection_path,
    )
    return collection_ready


def probe_topiclink_storage(session) -> None:
    """Raise when the configured TopicLink Zvec store is unavailable."""
    if not _topiclink_zvec_enabled():
        return
    if _topiclink_zvec_service_url():
        payload = _request_zvec_service("GET", "/health/ready")
        if not isinstance(payload, dict) or payload.get("status") != "ready":
            raise RuntimeError("TopicLink Zvec service is not ready")
        return
    if _zvec_error:
        raise RuntimeError(f"TopicLink Zvec is unavailable: {_zvec_error}")
    if _zvec_collection is None:
        raise RuntimeError(f"TopicLink Zvec is unavailable: {_zvec_error or 'not initialized'}")
    with _zvec_lock:
        _zvec_collection.fetch("__topiclink_readiness_probe__", include_vector=False)


@router.get("/health/ready")
def topiclink_ready_health():
    try:
        probe_topiclink_storage(None)
    except Exception as exc:
        logger.warning("TopicLink Zvec readiness probe failed: %s", exc)
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "service": "topiclink", "zvec": "error"},
        )
    return {"status": "ready", "service": "topiclink", "zvec": "ok"}


def _ensure_presence_table(session) -> None:
    is_sqlite = session.bind.dialect.name == "sqlite"
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS topic_link_presence (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                topic_id TEXT NOT NULL,
                persona_name TEXT NOT NULL,
                requested_by_user_id INTEGER,
                target_openclaw_agent_id INTEGER,
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
                requested_by_user_id INTEGER,
                target_openclaw_agent_id INTEGER,
                status TEXT NOT NULL DEFAULT 'resident',
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    columns = {
        str(column[1])
        for column in session.execute(text("PRAGMA table_info(topic_link_presence)")).fetchall()
    } if is_sqlite else {
        str(column["name"])
        for column in inspect(session.connection()).get_columns("topic_link_presence")
    }
    for column_name in ("requested_by_user_id", "target_openclaw_agent_id"):
        if column_name not in columns:
            session.execute(
                text(f"ALTER TABLE topic_link_presence ADD COLUMN {column_name} INTEGER")
            )
    session.execute(text("DROP INDEX IF EXISTS idx_topic_link_presence_topic_persona"))
    session.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_topic_link_presence_topic_persona "
            "ON topic_link_presence(topic_id, persona_name)"
        )
    )
    session.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_topic_link_presence_owner_agent "
            "ON topic_link_presence(topic_id, requested_by_user_id, target_openclaw_agent_id)"
        )
    )


def _normalize_persona_name(value: str | None) -> str:
    persona = (value or "").strip()
    return persona[:80] or "分身"


def _get_topiclink_presence(
    topic_id: str,
    persona_name: str,
    *,
    user_id: int | None = None,
    agent_id: int | None = None,
) -> dict[str, Any]:
    topic = _safe_get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    try:
        with get_db_session() as session:
            _ensure_presence_table(session)
            if user_id is not None and agent_id is not None:
                where_sql = (
                    "topic_id = :topic_id AND requested_by_user_id = :user_id "
                    "AND target_openclaw_agent_id = :agent_id"
                )
            else:
                where_sql = "topic_id = :topic_id AND persona_name = :persona_name"
            row = session.execute(
                text(
                    "SELECT topic_id, persona_name, status, created_at, updated_at "
                    f"FROM topic_link_presence WHERE {where_sql} "
                    "ORDER BY updated_at DESC LIMIT 1"
                ),
                {
                    "topic_id": topic_id,
                    "persona_name": persona_name,
                    "user_id": user_id,
                    "agent_id": agent_id,
                },
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
        "resident": str(row.status) == "dispatched",
        "status": str(row.status),
        "created_at": str(row.created_at) if row.created_at is not None else None,
        "updated_at": str(row.updated_at) if row.updated_at is not None else None,
    }


def _upsert_topiclink_presence(
    topic_id: str,
    persona_name: str,
    *,
    user_id: int,
    agent_id: int,
    status: str = "resident",
) -> dict[str, Any]:
    topic = _safe_get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    normalized_status = "dispatched" if status == "dispatched" else "resident"
    try:
        with get_db_session() as session:
            _ensure_presence_table(session)
            is_sqlite = session.bind.dialect.name == "sqlite"
            session.execute(
                text(
                    """
                    INSERT INTO topic_link_presence (
                        topic_id, persona_name, requested_by_user_id,
                        target_openclaw_agent_id, status, created_at, updated_at
                    )
                    VALUES (
                        :topic_id, :persona_name, :user_id, :agent_id, :status,
                        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                    )
                    ON CONFLICT(topic_id, requested_by_user_id, target_openclaw_agent_id) DO UPDATE SET
                        persona_name = :persona_name,
                        status = :status,
                        updated_at = CURRENT_TIMESTAMP
                    """
                    if is_sqlite
                    else
                    """
                    INSERT INTO topic_link_presence (
                        topic_id, persona_name, requested_by_user_id,
                        target_openclaw_agent_id, status, created_at, updated_at
                    )
                    VALUES (
                        :topic_id, :persona_name, :user_id, :agent_id, :status,
                        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                    )
                    ON CONFLICT(topic_id, requested_by_user_id, target_openclaw_agent_id) DO UPDATE SET
                        persona_name = :persona_name,
                        status = :status,
                        updated_at = CURRENT_TIMESTAMP
                    """
                ),
                {
                    "topic_id": topic_id,
                    "persona_name": persona_name,
                    "user_id": user_id,
                    "agent_id": agent_id,
                    "status": normalized_status,
                },
            )
        return _get_topiclink_presence(
            topic_id, persona_name, user_id=user_id, agent_id=agent_id
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.info("TopicLink presence write failed", exc_info=True)
        raise HTTPException(status_code=500, detail="TopicLink presence unavailable") from exc


def _reserve_topiclink_presence_dispatch(
    topic_id: str,
    persona_name: str,
    *,
    user_id: int,
    agent_id: int,
) -> tuple[dict[str, Any], bool]:
    with get_db_session() as session:
        _ensure_presence_table(session)
        inserted = session.execute(
            text(
                """
                INSERT INTO topic_link_presence (
                    topic_id, persona_name, requested_by_user_id,
                    target_openclaw_agent_id, status, created_at, updated_at
                ) VALUES (
                    :topic_id, :persona_name, :user_id, :agent_id,
                    'dispatching', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                ON CONFLICT(topic_id, requested_by_user_id, target_openclaw_agent_id)
                DO NOTHING
                """
            ),
            {
                "topic_id": topic_id,
                "persona_name": persona_name,
                "user_id": user_id,
                "agent_id": agent_id,
            },
        ).rowcount == 1
    current = _get_topiclink_presence(
        topic_id, persona_name, user_id=user_id, agent_id=agent_id
    )
    return current, inserted


def _release_topiclink_presence_dispatch(
    topic_id: str,
    *,
    user_id: int,
    agent_id: int,
) -> None:
    with get_db_session() as session:
        _ensure_presence_table(session)
        session.execute(
            text(
                "DELETE FROM topic_link_presence WHERE topic_id = :topic_id "
                "AND requested_by_user_id = :user_id "
                "AND target_openclaw_agent_id = :agent_id AND status = 'dispatching'"
            ),
            {"topic_id": topic_id, "user_id": user_id, "agent_id": agent_id},
        )


def _load_topiclink_dispatch_context(topic_id: str, limit: int = 4) -> list[dict[str, Any]]:
    try:
        with get_db_session() as session:
            rows = session.execute(
                text(
                    """
                    SELECT author, expert_label, body
                    FROM posts
                    WHERE topic_id = :topic_id
                      AND TRIM(COALESCE(body, '')) NOT IN ('', '-')
                      AND COALESCE(expert_name, '') <> 'topiclink_dispatcher'
                    ORDER BY created_at DESC, id DESC
                    LIMIT :limit
                    """
                ),
                {"topic_id": topic_id, "limit": max(1, min(limit, 8))},
            ).fetchall()
        return [
            {
                "author": row.author,
                "expert_label": row.expert_label,
                "body": row.body,
            }
            for row in reversed(rows)
        ]
    except Exception:
        logger.info("TopicLink dispatch context unavailable", exc_info=True)
        return []


def _build_topiclink_dispatch_body(
    *,
    topic: dict[str, Any],
    agent_handle: str,
    context_posts: list[dict[str, Any]],
) -> str:
    title = _compact_visible_text(topic.get("title") or "未命名话题", 120)
    topic_body = _compact_visible_text(topic.get("body") or "题面暂无公开摘要。", 700)
    context_lines = []
    for post in context_posts[:4]:
        author = _compact_visible_text(post.get("expert_label") or post.get("author") or "参与者", 40)
        post_body = _compact_visible_text(post.get("body"), 320)
        if post_body:
            context_lines.append(f"- {author}：{post_body}")
    context = "\n".join(context_lines) if context_lines else "- 暂无可见回应，请只基于题面谨慎判断。"
    return (
        f"@{agent_handle}，主人从 TopicLink 外派你到这桌。\n"
        f"【话题】{title}\n"
        f"【题面】{topic_body}\n"
        f"【最近回应】\n{context}\n"
        "【执行要求】先读以上上下文，再基于你的数字分身画像自然参与；"
        "不要冒充主人，不要补写未经核验的事实，并回复这条调度帖。"
    )


def _enqueue_topiclink_dispatch(
    *,
    topic: dict[str, Any],
    user_id: int,
    agent: dict[str, Any],
    dispatch_body: str | None = None,
    dispatch_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    topic_id = str(topic.get("id") or "")
    agent_id = int(agent["id"])
    agent_name = str(agent.get("display_name") or agent.get("handle") or "分身").strip()
    agent_handle = str(agent.get("handle") or agent.get("agent_uid") or "openclaw").strip()
    body = dispatch_body or _build_topiclink_dispatch_body(
        topic=topic,
        agent_handle=agent_handle,
        context_posts=_load_topiclink_dispatch_context(topic_id),
    )
    dispatch_details = {
        "status": "dispatched",
        "requested_by_user_id": user_id,
        "target_openclaw_agent_id": agent_id,
        "target_agent_uid": agent.get("agent_uid"),
        "target_display_name": agent_name,
    }
    dispatch_details.update(dispatch_metadata or {})
    dispatch_post = upsert_post(
        make_post(
            topic_id,
            author="TopicLink 调度台",
            author_type="agent",
            body=body,
            expert_name="topiclink_dispatcher",
            expert_label="TopicLink 调度台",
            status="completed",
            owner_auth_type="system",
            metadata={
                "topic_link_dispatch": dispatch_details,
            },
        )
    )
    try:
        with get_db_session() as session:
            session.execute(
                text(
                    """
                    INSERT INTO post_inbox_messages (
                        id, recipient_user_id, message_type, topic_id,
                        parent_post_id, reply_post_id, actor_user_id,
                        actor_openclaw_agent_id, is_read, created_at, read_at
                    ) VALUES (
                        :id, :recipient_user_id, 'topiclink_dispatch', :topic_id,
                        :post_id, :post_id, :actor_user_id,
                        NULL, FALSE, CURRENT_TIMESTAMP, NULL
                    )
                    ON CONFLICT (message_type, reply_post_id) DO NOTHING
                    """
                ),
                {
                    "id": str(uuid.uuid4()),
                    "recipient_user_id": user_id,
                    "topic_id": topic_id,
                    "post_id": dispatch_post["id"],
                    "actor_user_id": user_id,
                },
            )
            session.execute(
                text(
                    "UPDATE topics SET posts_count = CASE "
                    "WHEN posts_count > 0 THEN posts_count - 1 ELSE 0 END "
                    "WHERE id = :topic_id"
                ),
                {"topic_id": topic_id},
            )
    except Exception:
        with contextlib.suppress(Exception):
            delete_post(topic_id, str(dispatch_post["id"]))
        raise
    _invalidate_read_cache(topic_id=topic_id, invalidate_topic_lists=True)
    return {
        "dispatch_post_id": str(dispatch_post["id"]),
        "status": "dispatched",
    }


def _dispatch_topiclink_presence(
    topic_id: str,
    *,
    persona_name: str,
    user: dict[str, Any],
) -> dict[str, Any]:
    topic = _safe_get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    user_id = int(user["sub"])
    agent = get_primary_openclaw_agent_for_user(user_id)
    if not agent:
        raise HTTPException(status_code=409, detail="请先绑定 OpenClaw 分身，再执行外派")
    if str(agent.get("status") or "") != "active":
        raise HTTPException(status_code=409, detail="当前绑定的 OpenClaw 分身未处于 active 状态")

    current, reserved = _reserve_topiclink_presence_dispatch(
        topic_id,
        persona_name,
        user_id=user_id,
        agent_id=int(agent["id"]),
    )
    if current.get("status") == "dispatched":
        return current
    if not reserved:
        raise HTTPException(status_code=409, detail="分身正在外派，请稍后再看")

    try:
        dispatch = _enqueue_topiclink_dispatch(topic=topic, user_id=user_id, agent=agent)
    except Exception:
        _release_topiclink_presence_dispatch(
            topic_id, user_id=user_id, agent_id=int(agent["id"])
        )
        raise
    presence = _upsert_topiclink_presence(
        topic_id,
        persona_name,
        user_id=user_id,
        agent_id=int(agent["id"]),
        status="dispatched",
    )
    return {
        **presence,
        **dispatch,
        "openclaw_agent": {
            "agent_uid": agent.get("agent_uid"),
            "display_name": agent.get("display_name"),
            "handle": agent.get("handle"),
        },
    }


def _ensure_topiclink_agent_tasks_table(session) -> None:
    timestamp_type = "TEXT" if session.bind.dialect.name == "sqlite" else "TIMESTAMPTZ"
    session.execute(
        text(
            f"""
            CREATE TABLE IF NOT EXISTS topiclink_agent_tasks (
                id VARCHAR(36) PRIMARY KEY,
                task_type VARCHAR(32) NOT NULL,
                source_type VARCHAR(32) NOT NULL,
                source_id VARCHAR(255) NOT NULL,
                source_title TEXT NOT NULL,
                source_path TEXT NOT NULL,
                requested_by_user_id INTEGER NOT NULL,
                target_openclaw_agent_id INTEGER NOT NULL,
                target_agent_uid VARCHAR(255) NOT NULL,
                target_handle VARCHAR(255) NOT NULL,
                status VARCHAR(32) NOT NULL DEFAULT 'pending',
                reservation_key VARCHAR(64),
                claim_token_hash VARCHAR(64),
                claim_expires_at {timestamp_type},
                input_json TEXT NOT NULL DEFAULT '{{}}',
                output_json TEXT NOT NULL DEFAULT '{{}}',
                error_message TEXT,
                created_at {timestamp_type} NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at {timestamp_type} NOT NULL DEFAULT CURRENT_TIMESTAMP,
                claimed_at {timestamp_type},
                completed_at {timestamp_type}
            )
            """
        )
    )
    claim_token_column_added = False
    claim_expires_column_added = False
    reservation_key_column_added = False
    if session.bind.dialect.name == "sqlite":
        columns = {
            str(row[1])
            for row in session.execute(text("PRAGMA table_info(topiclink_agent_tasks)")).fetchall()
        }
        if "claim_token_hash" not in columns:
            session.execute(
                text("ALTER TABLE topiclink_agent_tasks ADD COLUMN claim_token_hash VARCHAR(64)")
            )
            claim_token_column_added = True
        if "claim_expires_at" not in columns:
            session.execute(
                text(f"ALTER TABLE topiclink_agent_tasks ADD COLUMN claim_expires_at {timestamp_type}")
            )
            claim_expires_column_added = True
        if "reservation_key" not in columns:
            session.execute(
                text("ALTER TABLE topiclink_agent_tasks ADD COLUMN reservation_key VARCHAR(64)")
            )
            reservation_key_column_added = True
    else:
        columns = {
            str(column["name"])
            for column in inspect(session.connection()).get_columns("topiclink_agent_tasks")
        }
        if "claim_token_hash" not in columns:
            session.execute(
                text(
                    "ALTER TABLE topiclink_agent_tasks "
                    "ADD COLUMN IF NOT EXISTS claim_token_hash VARCHAR(64)"
                )
            )
            claim_token_column_added = True
        if "claim_expires_at" not in columns:
            session.execute(
                text(
                    "ALTER TABLE topiclink_agent_tasks "
                    "ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ"
                )
            )
            claim_expires_column_added = True
        if "reservation_key" not in columns:
            session.execute(
                text(
                    "ALTER TABLE topiclink_agent_tasks "
                    "ADD COLUMN IF NOT EXISTS reservation_key VARCHAR(64)"
                )
            )
            reservation_key_column_added = True
    if claim_expires_column_added:
        session.execute(
            text(
                "UPDATE topiclink_agent_tasks SET status = 'pending', claimed_at = NULL, "
                "reservation_key = NULL, claim_token_hash = NULL, claim_expires_at = NULL, "
                "updated_at = CURRENT_TIMESTAMP WHERE status = 'claimed'"
            )
        )
    elif claim_token_column_added:
        session.execute(
            text(
                "UPDATE topiclink_agent_tasks SET status = 'pending', claimed_at = NULL, "
                "updated_at = CURRENT_TIMESTAMP "
                "WHERE status = 'claimed' AND claim_token_hash IS NULL"
            )
        )
    if reservation_key_column_added:
        session.execute(
            text(
                "UPDATE topiclink_agent_tasks SET reservation_key = NULL "
                "WHERE status NOT IN ('pending', 'claimed')"
            )
        )
    session.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_topiclink_agent_tasks_target_status
            ON topiclink_agent_tasks(target_openclaw_agent_id, status, created_at)
            """
        )
    )
    session.execute(
        text(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_topiclink_agent_tasks_reservation
            ON topiclink_agent_tasks(reservation_key)
            """
        )
    )
    session.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_topiclink_agent_tasks_owner_created
            ON topiclink_agent_tasks(requested_by_user_id, created_at)
            """
        )
    )


def _topiclink_json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not value:
        return {}
    try:
        parsed = json.loads(str(value))
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _topiclink_json_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if not value:
        return []
    try:
        parsed = json.loads(str(value))
    except (TypeError, ValueError):
        return []
    return parsed if isinstance(parsed, list) else []


def _topiclink_claim_is_expired(row: Any) -> bool:
    if str(row.status) != "claimed" or row.claim_expires_at is None:
        return False
    expires_at = row.claim_expires_at
    if not isinstance(expires_at, datetime):
        try:
            expires_at = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
        except ValueError:
            return False
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at <= datetime.now(timezone.utc)


def _serialize_topiclink_agent_task(row: Any) -> dict[str, Any]:
    claim_expired = _topiclink_claim_is_expired(row)
    return {
        "id": str(row.id),
        "task_type": str(row.task_type),
        "status": "pending" if claim_expired else str(row.status),
        "recovery_reason": "claim_expired" if claim_expired else None,
        "source": {
            "type": str(row.source_type),
            "id": str(row.source_id),
            "title": str(row.source_title),
            "path": str(row.source_path),
        },
        "target_agent": {
            "agent_uid": str(row.target_agent_uid),
            "handle": str(row.target_handle),
        },
        "input": _topiclink_json_object(row.input_json),
        "output": _topiclink_json_object(row.output_json),
        "error_message": str(row.error_message) if row.error_message else None,
        "created_at": str(row.created_at) if row.created_at is not None else None,
        "updated_at": str(row.updated_at) if row.updated_at is not None else None,
        "claimed_at": str(row.claimed_at) if row.claimed_at is not None else None,
        "claim_expires_at": (
            str(row.claim_expires_at) if row.claim_expires_at is not None else None
        ),
        "completed_at": str(row.completed_at) if row.completed_at is not None else None,
    }


OPC_PUBLIC_ASSISTANT_TEXT_FIELDS = ("summary", "public_stuck", "clarity", "next_step")
OPC_PUBLIC_ASSISTANT_LIST_FIELDS = (
    "follow_up_questions",
    "suggested_roles",
    "recommended_tools",
    "risk_notes",
)


def _public_opc_assistant_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    public: dict[str, Any] = {}
    for field in OPC_PUBLIC_ASSISTANT_TEXT_FIELDS:
        value = snapshot.get(field)
        if isinstance(value, str) and value.strip():
            public[field] = value.strip()
    for field in OPC_PUBLIC_ASSISTANT_LIST_FIELDS:
        value = snapshot.get(field)
        if isinstance(value, list):
            items = [str(item).strip() for item in value if str(item).strip()]
            if items:
                public[field] = items
    return public


def _load_public_opc_demand(session, slug: str) -> dict[str, Any] | None:
    row = session.execute(
        text(
            """
            SELECT id, slug, status, allow_public, public_title, public_summary,
                   public_tags, public_stuck, assistant_status, assistant_snapshot_json
            FROM inspiration_demands
            WHERE slug = :slug
            LIMIT 1
            """
        ),
        {"slug": slug},
    ).fetchone()
    if not row or str(row.status) != "published" or not bool(row.allow_public):
        return None
    snapshot = _public_opc_assistant_snapshot(
        _topiclink_json_object(row.assistant_snapshot_json)
    )
    demand = {
        "id": str(row.id),
        "slug": str(row.slug),
        "title": str(row.public_title or "未命名公开线索"),
        "summary": str(row.public_summary or ""),
        "tags": [str(item) for item in _topiclink_json_list(row.public_tags) if str(item).strip()],
        "stuck": str(row.public_stuck or ""),
    }
    if snapshot:
        demand["existing_assistant"] = {
            "status": str(row.assistant_status or "ready"),
            "snapshot": snapshot,
        }
    return demand


def _opc_demand_as_score_topic(demand: dict[str, Any]) -> dict[str, Any]:
    tags = [str(item).strip() for item in demand.get("tags", []) if str(item).strip()]
    body = "\n".join(
        item
        for item in (
            str(demand.get("summary") or "").strip(),
            f"当前卡点：{str(demand.get('stuck') or '').strip()}" if demand.get("stuck") else "",
            f"方向标签：{' / '.join(tags)}" if tags else "",
        )
        if item
    )
    return {
        "id": f"inspiration:{demand.get('slug')}",
        "title": str(demand.get("title") or "未命名公开线索"),
        "body": body,
        "category": "request",
        "creator_name": "灵感共创队",
    }


def _list_public_opc_demands_for_embedding(*, limit: int, offset: int) -> dict[str, Any]:
    page_limit = max(1, min(100, int(limit)))
    page_offset = max(0, int(offset))
    with get_db_session() as session:
        rows = session.execute(
            text(
                """
                SELECT id, slug, public_title, public_summary, public_tags, public_stuck
                FROM inspiration_demands
                WHERE status = 'published' AND allow_public = TRUE
                ORDER BY updated_at DESC, id DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {"limit": page_limit + 1, "offset": page_offset},
        ).fetchall()
    has_more = len(rows) > page_limit
    items = [
        {
            "id": str(row.id),
            "slug": str(row.slug),
            "title": str(row.public_title or "未命名公开线索"),
            "summary": str(row.public_summary or ""),
            "tags": [str(item) for item in _topiclink_json_list(row.public_tags) if str(item).strip()],
            "stuck": str(row.public_stuck or ""),
        }
        for row in rows[:page_limit]
    ]
    return {
        "items": items,
        "next_offset": page_offset + len(items) if has_more else 0,
    }


OPC_RESPONSE_TEMPLATE = [
    "需求判断（summary）",
    "已核验进展（progress）",
    "主要阻塞（blockers）",
    "建议下一步（next_steps）",
    "可交付物（artifacts）",
]


def _find_or_create_opc_discussion_topic(*, demand: dict[str, Any], user_id: int) -> dict[str, Any]:
    with get_db_session() as session:
        rows = session.execute(
            text(
                "SELECT id, metadata FROM topics "
                "WHERE category = 'request' ORDER BY updated_at DESC LIMIT 500"
            )
        ).fetchall()
    for row in rows:
        metadata = _topiclink_json_object(row.metadata)
        topic_link = metadata.get("topic_link") if isinstance(metadata.get("topic_link"), dict) else {}
        if (
            topic_link.get("source_type") == "inspiration_demand"
            and str(topic_link.get("source_id") or "") == demand["slug"]
        ):
            existing = _safe_get_topic(str(row.id))
            if existing:
                return existing

    source_path = f"/inspiration-co-creation/needs/{demand['slug']}"
    tags = " / ".join(demand["tags"]) if demand["tags"] else "待补充"
    body = (
        "来源：灵感共创队公开线索\n"
        f"原线索：{source_path}\n\n"
        f"需求摘要：{demand['summary'] or '暂无公开摘要。'}\n"
        f"方向标签：{tags}\n"
        f"当前卡点：{demand['stuck'] or '待分身先核验。'}"
    )
    return create_topic(
        demand["title"],
        body,
        "request",
        creator_user_id=user_id,
        creator_name="OPC Link",
        creator_auth_type="jwt",
        initial_expert_names=[],
        metadata={
            "topic_link": {
                "mode": "opc",
                "source_type": "inspiration_demand",
                "source_id": demand["slug"],
                "source_path": source_path,
                "origin": "inspiration_co_creation",
            }
        },
    )


def _build_opc_diligence_dispatch_body(*, demand: dict[str, Any], agent_handle: str) -> str:
    tags = " / ".join(demand["tags"]) if demand["tags"] else "待补充"
    template = "\n".join(f"- {field}：" for field in OPC_RESPONSE_TEMPLATE)
    return (
        f"@{agent_handle}，主人从 OPC Link 派你参与这条需求讨论。\n"
        f"【公开需求】{demand['title']}\n"
        f"【需求摘要】{demand['summary'] or '暂无公开摘要。'}\n"
        f"【方向标签】{tags}\n"
        f"【当前卡点】{demand['stuck'] or '待核验。'}\n"
        f"【待填写回执】\n{template}\n"
        "【执行边界】只使用公开线索和当前分身画像；不要冒充主人，"
        "不要自动承接或对外承诺。请直接回复这条调度帖，等待主人确认。"
    )


def _opc_diligence_reservation_key(*, slug: str, user_id: int, agent_id: int) -> str:
    value = f"diligence:inspiration_demand:{slug}:{user_id}:{agent_id}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _wait_for_reserved_opc_task(reservation_key: str, timeout_seconds: float = 3.0) -> Any | None:
    deadline = time.monotonic() + timeout_seconds
    while True:
        with get_db_session() as session:
            row = session.execute(
                text(
                    "SELECT * FROM topiclink_agent_tasks "
                    "WHERE reservation_key = :reservation_key LIMIT 1"
                ),
                {"reservation_key": reservation_key},
            ).fetchone()
        if row:
            payload = _topiclink_json_object(row.input_json)
            if payload.get("discussion_topic_id") and payload.get("dispatch_post_id"):
                return row
        if time.monotonic() >= deadline:
            return row
        time.sleep(0.05)


def _create_opc_diligence_task(*, slug: str, user_id: int, agent: dict[str, Any]) -> dict[str, Any]:
    agent_id = int(agent["id"])
    agent_uid = str(agent.get("agent_uid") or "").strip()
    agent_handle = str(agent.get("handle") or agent_uid or "openclaw").strip()
    with get_db_session() as session:
        demand = _load_public_opc_demand(session, slug)
        if not demand:
            raise HTTPException(status_code=404, detail="公开 OPC 线索不存在")

    lock_key = f"{demand['slug']}:{user_id}:{agent_id}".encode("utf-8")
    lock_index = int.from_bytes(hashlib.sha256(lock_key).digest()[:2], "big") % len(
        _topiclink_task_creation_locks
    )
    with _topiclink_task_creation_locks[lock_index]:
        return _create_opc_diligence_task_locked(
            demand=demand,
            user_id=user_id,
            agent=agent,
            agent_id=agent_id,
            agent_uid=agent_uid,
            agent_handle=agent_handle,
        )


def _create_opc_diligence_task_locked(
    *,
    demand: dict[str, Any],
    user_id: int,
    agent: dict[str, Any],
    agent_id: int,
    agent_uid: str,
    agent_handle: str,
) -> dict[str, Any]:
    reservation_key = _opc_diligence_reservation_key(
        slug=demand["slug"], user_id=user_id, agent_id=agent_id
    )
    with get_db_session() as session:
        _ensure_topiclink_agent_tasks_table(session)
        existing = session.execute(
            text(
                """
                SELECT *
                FROM topiclink_agent_tasks
                WHERE task_type = 'diligence'
                  AND source_type = 'inspiration_demand'
                  AND source_id = :source_id
                  AND requested_by_user_id = :user_id
                  AND target_openclaw_agent_id = :agent_id
                  AND status IN ('pending', 'claimed')
                ORDER BY created_at DESC
                LIMIT 1
                """
            ),
            {"source_id": demand["slug"], "user_id": user_id, "agent_id": agent_id},
        ).fetchone()
    if existing:
        existing_payload = _topiclink_json_object(existing.input_json)
        if existing_payload.get("discussion_topic_id") and existing_payload.get("dispatch_post_id"):
            return _serialize_topiclink_agent_task(existing)

    if existing:
        reserved = _wait_for_reserved_opc_task(reservation_key)
        if reserved:
            reserved_payload = _topiclink_json_object(reserved.input_json)
            if reserved_payload.get("discussion_topic_id") and reserved_payload.get("dispatch_post_id"):
                return _serialize_topiclink_agent_task(reserved)
        raise HTTPException(status_code=409, detail="调研任务正在创建，请稍后重试")

    task_id = str(uuid.uuid4())
    source_path = f"/inspiration-co-creation/needs/{demand['slug']}"
    try:
        with get_db_session() as session:
            _ensure_topiclink_agent_tasks_table(session)
            session.execute(
                text(
                    """
                    INSERT INTO topiclink_agent_tasks (
                        id, task_type, source_type, source_id, source_title, source_path,
                        requested_by_user_id, target_openclaw_agent_id, target_agent_uid,
                        target_handle, status, reservation_key, input_json, output_json,
                        error_message, created_at, updated_at, claimed_at, completed_at
                    ) VALUES (
                        :id, 'diligence', 'inspiration_demand', :source_id, :source_title,
                        :source_path, :requested_by_user_id, :target_openclaw_agent_id,
                        :target_agent_uid, :target_handle, 'pending', :reservation_key,
                        '{}', '{}', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, NULL
                    )
                    """
                ),
                {
                    "id": task_id,
                    "source_id": demand["slug"],
                    "source_title": demand["title"],
                    "source_path": source_path,
                    "requested_by_user_id": user_id,
                    "target_openclaw_agent_id": agent_id,
                    "target_agent_uid": agent_uid,
                    "target_handle": agent_handle,
                    "reservation_key": reservation_key,
                },
            )
    except IntegrityError:
        reserved = _wait_for_reserved_opc_task(reservation_key)
        if reserved:
            reserved_payload = _topiclink_json_object(reserved.input_json)
            if reserved_payload.get("discussion_topic_id") and reserved_payload.get("dispatch_post_id"):
                return _serialize_topiclink_agent_task(reserved)
        raise HTTPException(status_code=409, detail="调研任务正在创建，请稍后重试") from None

    try:
        discussion_topic = _find_or_create_opc_discussion_topic(demand=demand, user_id=user_id)
        dispatch = _enqueue_topiclink_dispatch(
            topic=discussion_topic,
            user_id=user_id,
            agent=agent,
            dispatch_body=_build_opc_diligence_dispatch_body(
                demand=demand, agent_handle=agent_handle
            ),
            dispatch_metadata={
                "mode": "opc",
                "source_type": "inspiration_demand",
                "source_id": demand["slug"],
                "task_id": task_id,
            },
        )
    except Exception:
        with get_db_session() as session:
            session.execute(
                text(
                    "UPDATE topiclink_agent_tasks SET status = 'failed', reservation_key = NULL, "
                    "error_message = :error_message, updated_at = CURRENT_TIMESTAMP, "
                    "completed_at = CURRENT_TIMESTAMP WHERE id = :id"
                ),
                {"id": task_id, "error_message": "创建 TopicLab 调研讨论失败"},
            )
        raise
    input_payload = {
        "mention": f"@{agent_handle}",
        "title": demand["title"],
        "summary": demand["summary"],
        "tags": demand["tags"],
        "blocker": demand["stuck"],
        "source_path": source_path,
        "discussion_topic_id": discussion_topic["id"],
        "discussion_path": f"/topiclink/{discussion_topic['id']}",
        "dispatch_post_id": dispatch["dispatch_post_id"],
        "response_template": OPC_RESPONSE_TEMPLATE,
        "execution": [
            "只使用公开线索和当前分身画像做尽调",
            "不得冒充主人，不得自动承接或对外承诺",
            "回复 TopicLab 调度帖，等待主人确认",
        ],
    }
    if demand.get("existing_assistant"):
        input_payload["existing_assistant"] = demand["existing_assistant"]

    with get_db_session() as session:
        _ensure_topiclink_agent_tasks_table(session)
        session.execute(
            text(
                "UPDATE topiclink_agent_tasks SET input_json = :input_json, "
                "updated_at = CURRENT_TIMESTAMP WHERE id = :id AND reservation_key = :reservation_key"
            ),
            {
                "id": task_id,
                "reservation_key": reservation_key,
                "input_json": json.dumps(input_payload, ensure_ascii=False),
            },
        )
        created = session.execute(
            text("SELECT * FROM topiclink_agent_tasks WHERE id = :id"),
            {"id": task_id},
        ).fetchone()
    return _serialize_topiclink_agent_task(created)


def _get_topiclink_agent_task(*, task_id: str, requested_by_user_id: int) -> Any | None:
    with get_db_session() as session:
        _ensure_topiclink_agent_tasks_table(session)
        task = session.execute(
            text(
                "SELECT * FROM topiclink_agent_tasks "
                "WHERE id = :id AND requested_by_user_id = :requested_by_user_id"
            ),
            {"id": task_id, "requested_by_user_id": requested_by_user_id},
        ).fetchone()
        if not task:
            return None
        if str(task.status) not in {"pending", "claimed"}:
            return task
        input_payload = _topiclink_json_object(task.input_json)
        discussion_topic_id = str(input_payload.get("discussion_topic_id") or "")
        dispatch_post_id = str(input_payload.get("dispatch_post_id") or "")
        if not discussion_topic_id or not dispatch_post_id:
            return task
        reply = session.execute(
            text(
                "SELECT id, body FROM posts "
                "WHERE topic_id = :topic_id AND in_reply_to_id = :post_id "
                "AND owner_openclaw_agent_id = :agent_id AND status = 'completed' "
                "ORDER BY created_at ASC, id ASC LIMIT 1"
            ),
            {
                "topic_id": discussion_topic_id,
                "post_id": dispatch_post_id,
                "agent_id": int(task.target_openclaw_agent_id),
            },
        ).fetchone()
        if not reply:
            return task
        output = {
            "summary": str(reply.body),
            "risk_notes": [],
            "next_step": "主人确认后再打开原线索。",
            "reply_post_id": str(reply.id),
            "discussion_path": input_payload.get("discussion_path"),
        }
        session.execute(
            text(
                "UPDATE topiclink_agent_tasks SET status = 'replied', output_json = :output_json, "
                "claim_token_hash = NULL, claim_expires_at = NULL, "
                "updated_at = CURRENT_TIMESTAMP, claimed_at = COALESCE(claimed_at, CURRENT_TIMESTAMP), "
                "completed_at = CURRENT_TIMESTAMP WHERE id = :id "
                "AND requested_by_user_id = :requested_by_user_id "
                "AND status = 'pending' AND claim_token_hash IS NULL"
            ),
            {
                "id": task_id,
                "requested_by_user_id": requested_by_user_id,
                "output_json": json.dumps(output, ensure_ascii=False),
            },
        )
        return session.execute(
            text("SELECT * FROM topiclink_agent_tasks WHERE id = :id"),
            {"id": task_id},
        ).fetchone()


def _list_topiclink_agent_tasks(*, agent_id: int, status: str) -> list[dict[str, Any]]:
    with get_db_session() as session:
        _ensure_topiclink_agent_tasks_table(session)
        status_sql = (
            "(status = 'pending' OR (status = 'claimed' "
            "AND claim_expires_at IS NOT NULL AND claim_expires_at <= CURRENT_TIMESTAMP))"
            if status == "pending"
            else "status = :status"
        )
        rows = session.execute(
            text(
                f"""
                SELECT *
                FROM topiclink_agent_tasks
                WHERE target_openclaw_agent_id = :agent_id
                  AND {status_sql}
                ORDER BY created_at ASC, id ASC
                LIMIT 50
                """
            ),
            {"agent_id": agent_id, "status": status},
        ).fetchall()
    return [_serialize_topiclink_agent_task(row) for row in rows]


def _transition_topiclink_agent_task(
    *,
    task_id: str,
    agent_id: int,
    status: str,
    claim_token: str,
    output: dict[str, Any] | None = None,
    error_message: str | None = None,
) -> dict[str, Any]:
    with get_db_session() as session:
        _ensure_topiclink_agent_tasks_table(session)
        current = session.execute(
            text("SELECT * FROM topiclink_agent_tasks WHERE id = :id"),
            {"id": task_id},
        ).fetchone()
        if not current or int(current.target_openclaw_agent_id) != agent_id:
            raise HTTPException(status_code=404, detail="调度单不存在")
        if status == "claimed" and str(current.status) not in {"pending", "claimed"}:
            raise HTTPException(status_code=409, detail="调度单已被领取或结束")
        if status in {"replied", "failed"} and str(current.status) != "claimed":
            raise HTTPException(status_code=409, detail="请先领取调度单")

        claim_token_hash = hashlib.sha256(claim_token.encode("utf-8")).hexdigest()
        if (
            status == "claimed"
            and str(current.status) == "claimed"
            and not _topiclink_claim_is_expired(current)
        ):
            if not secrets.compare_digest(str(current.claim_token_hash or ""), claim_token_hash):
                raise HTTPException(status_code=409, detail="调度单已被领取或结束")
        claim_expires_sql = (
            f"datetime(CURRENT_TIMESTAMP, '+{DEFAULT_TASK_CLAIM_LEASE_SECONDS} seconds')"
            if session.bind.dialect.name == "sqlite"
            else (
                "CURRENT_TIMESTAMP + "
                f"INTERVAL '{DEFAULT_TASK_CLAIM_LEASE_SECONDS} seconds'"
            )
        )
        claimed_sql = (
            "COALESCE(claimed_at, CURRENT_TIMESTAMP)"
            if status in {"claimed", "replied", "failed"}
            else "claimed_at"
        )
        completed_sql = "CURRENT_TIMESTAMP" if status in {"replied", "failed"} else "completed_at"
        allowed_status_sql = (
            "(status = 'pending' OR (status = 'claimed' "
            "AND claim_expires_at IS NOT NULL AND claim_expires_at <= CURRENT_TIMESTAMP) "
            "OR (status = 'claimed' AND claim_token_hash = :claim_token_hash "
            "AND claim_expires_at IS NOT NULL AND claim_expires_at > CURRENT_TIMESTAMP))"
            if status == "claimed"
            else (
                "status = 'claimed' AND claim_token_hash = :claim_token_hash "
                "AND claim_expires_at IS NOT NULL AND claim_expires_at > CURRENT_TIMESTAMP"
            )
        )
        claim_token_set_sql = ":claim_token_hash" if status == "claimed" else "NULL"
        claim_expires_set_sql = claim_expires_sql if status == "claimed" else "NULL"
        result = session.execute(
            text(
                f"""
                UPDATE topiclink_agent_tasks
                SET status = :status,
                    output_json = :output_json,
                    error_message = :error_message,
                    reservation_key = CASE
                        WHEN :status IN ('replied', 'failed') THEN NULL
                        ELSE reservation_key
                    END,
                    claim_token_hash = {claim_token_set_sql},
                    claim_expires_at = {claim_expires_set_sql},
                    updated_at = CURRENT_TIMESTAMP,
                    claimed_at = {claimed_sql},
                    completed_at = {completed_sql}
                WHERE id = :id
                  AND target_openclaw_agent_id = :agent_id
                  AND {allowed_status_sql}
                """
            ),
            {
                "id": task_id,
                "agent_id": agent_id,
                "status": status,
                "claim_token_hash": claim_token_hash,
                "output_json": json.dumps(output or {}, ensure_ascii=False),
                "error_message": error_message,
            },
        )
        if result.rowcount != 1:
            raise HTTPException(status_code=409, detail="调度单已被领取或结束")
        updated = session.execute(
            text("SELECT * FROM topiclink_agent_tasks WHERE id = :id"),
            {"id": task_id},
        ).fetchone()
    return _serialize_topiclink_agent_task(updated)


def _read_embedding_cache(model: str, inputs: list[str]) -> list[list[float] | None]:
    return _read_zvec_cache(model, inputs)


def _write_embedding_cache(model: str, inputs: list[str], vectors: list[list[float]]) -> None:
    if not inputs or len(inputs) != len(vectors):
        return
    _write_zvec_cache(model, inputs, vectors)


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
    return os.getenv("TOPICLINK_METADATA_AUTOFILL", "0").strip().lower() not in {"0", "false", "no", "off"}


def _topiclink_background_autofill_enabled() -> bool:
    if not _topiclink_metadata_autofill_enabled():
        return False
    return os.getenv("TOPICLINK_METADATA_BACKGROUND_AUTOFILL", "1").strip().lower() not in {"0", "false", "no", "off"}


def _topiclink_embedding_background_autofill_enabled() -> bool:
    configured = os.getenv("TOPICLINK_EMBEDDING_BACKGROUND_AUTOFILL", "1").strip().lower()
    api_key = os.getenv("TOPICLINK_EMBEDDING_API_KEY") or os.getenv("SCNET_API_KEY")
    return _topiclink_zvec_enabled() and configured not in {"0", "false", "no", "off"} and bool(api_key)


def _topiclink_background_worker_enabled() -> bool:
    return (
        _topiclink_background_autofill_enabled()
        or _topiclink_embedding_background_autofill_enabled()
        or (_topiclink_zvec_enabled() and _topiclink_zvec_max_idle_days() > 0)
    )


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


def _topiclink_embedding_background_max_per_pass() -> int:
    return _topiclink_int_env(
        "TOPICLINK_EMBEDDING_BACKGROUND_MAX_PER_PASS",
        DEFAULT_EMBEDDING_BACKGROUND_MAX_PER_PASS,
        low=1,
        high=100,
    )


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
    base_url = (
        os.getenv("TOPICLINK_CHAT_BASE_URL")
        or os.getenv("SCNET_BASE_URL")
        or os.getenv("MINIMAX_BASE_URL")
        or "https://api.scnet.cn/api/llm/v1"
    ).rstrip("/")
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


async def _run_topiclink_embedding_background_pass() -> dict[str, int]:
    global _embedding_worker_cursor, _embedding_worker_opc_offset

    if not _topiclink_embedding_background_autofill_enabled():
        return {"scanned": 0, "indexed": 0}
    try:
        probe_topiclink_storage(None)
        page_limit = _topiclink_embedding_background_max_per_pass()
        page = list_topics(
            limit=page_limit,
            cursor=_embedding_worker_cursor,
        )
        opc_page = _list_public_opc_demands_for_embedding(
            limit=page_limit,
            offset=_embedding_worker_opc_offset,
        )
    except Exception:
        logger.info("TopicLink embedding background pass skipped because storage is not ready", exc_info=True)
        return {"scanned": 0, "indexed": 0}

    items = page.get("items", []) if isinstance(page, dict) else []
    next_cursor = page.get("next_cursor") if isinstance(page, dict) else None
    opc_items = opc_page.get("items", []) if isinstance(opc_page, dict) else []
    next_opc_offset = opc_page.get("next_offset") if isinstance(opc_page, dict) else 0
    eligible = [
        topic
        for topic in items
        if isinstance(topic, dict) and _topiclink_is_autofill_candidate(topic)
    ][:page_limit]
    opc_topics = [
        _opc_demand_as_score_topic(demand)
        for demand in opc_items
        if isinstance(demand, dict)
    ][:page_limit]
    _embedding_worker_cursor = str(next_cursor or "").strip() or None
    _embedding_worker_opc_offset = max(0, int(next_opc_offset or 0))
    all_topics = [*eligible, *opc_topics]
    scanned = len(items) + len(opc_items)
    if not all_topics:
        return {"scanned": scanned, "indexed": 0}

    vectors = await _try_remote_embeddings([_topic_text(topic) for topic in all_topics])
    if vectors is None:
        return {"scanned": scanned, "indexed": 0}
    logger.info(
        "TopicLink embedding background pass indexed %s topic(s) and %s public OPC demand(s)",
        len(eligible),
        len(opc_topics),
    )
    return {"scanned": scanned, "indexed": len(all_topics)}


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


async def _run_topiclink_zvec_maintenance_pass() -> dict[str, int]:
    return {"deleted": _prune_zvec_cache()}


async def _topiclink_metadata_worker_loop() -> None:
    if not await _sleep_until_topiclink_worker_tick(_topiclink_background_initial_delay_seconds()):
        return
    while _metadata_worker_stop is not None and not _metadata_worker_stop.is_set():
        for label, run_pass in (
            ("zvec-prune", _run_topiclink_zvec_maintenance_pass),
            ("embedding", _run_topiclink_embedding_background_pass),
            ("metadata", _run_topiclink_metadata_background_pass),
        ):
            try:
                await run_pass()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.info("TopicLink %s background worker iteration failed", label, exc_info=True)
        if not await _sleep_until_topiclink_worker_tick(_topiclink_background_interval_seconds()):
            return


def start_topiclink_metadata_worker() -> None:
    global _metadata_worker_task, _metadata_worker_stop
    if _topiclink_zvec_service_url():
        logger.info("TopicLink background worker delegated to the Zvec service")
        return
    if not _topiclink_background_worker_enabled():
        logger.info("TopicLink background worker disabled")
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
            "message": "我先顺一下这桌在讨论什么：如果问题已经落到具体材料或案例，我可以补资料；如果还停在判断上，我会先问清边界。",
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
    config = _topiclink_chat_config()
    if not config:
        return None
    base_url, api_key, model = config
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
    config = _topiclink_chat_config()
    if not config or not topics:
        return None
    base_url, api_key, model = config
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
                    SELECT p.*,
                           CASE WHEN COALESCE(parent.expert_name, '') = 'topiclink_dispatcher'
                                THEN 1 ELSE 0 END AS topiclink_promoted_root
                    FROM posts p
                    LEFT JOIN posts parent
                      ON parent.topic_id = p.topic_id AND parent.id = p.in_reply_to_id
                    WHERE p.topic_id = :topic_id
                      AND COALESCE(p.expert_name, '') <> 'topiclink_dispatcher'
                      AND (
                        p.in_reply_to_id IS NULL
                        OR p.in_reply_to_id = ''
                        OR COALESCE(parent.expert_name, '') = 'topiclink_dispatcher'
                      )
                      AND TRIM(COALESCE(p.body, '')) NOT IN ('', '-')
                    ORDER BY p.created_at ASC, p.id ASC
                    LIMIT :limit
                    """
                ),
                {"topic_id": topic_id, "limit": safe_limit + 1},
            ).fetchall()
            has_more = len(root_rows) > safe_limit
            root_rows = root_rows[:safe_limit]
            posts = []
            for row in root_rows:
                post = _normalize_topiclink_post(post_row_to_dict(row))
                if bool(getattr(row, "topiclink_promoted_root", False)):
                    post["in_reply_to_id"] = None
                    post["root_post_id"] = post["id"]
                    post["depth"] = 0
                posts.append(post)
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


@router.post("/opc/{slug}/diligence", status_code=201)
async def dispatch_opc_diligence(
    slug: str,
    user: dict[str, Any] | None = Depends(_optional_topiclink_user),
) -> dict[str, Any]:
    if not user or user.get("sub") is None:
        raise HTTPException(status_code=401, detail="登录后才能派出绑定的 OpenClaw 分身")
    user_id = int(user["sub"])
    agent = get_primary_openclaw_agent_for_user(user_id)
    if not agent:
        raise HTTPException(status_code=409, detail="请先绑定 OpenClaw 分身，再执行调研")
    if str(agent.get("status") or "") != "active":
        raise HTTPException(status_code=409, detail="当前绑定的 OpenClaw 分身未处于 active 状态")
    return {"task": _create_opc_diligence_task(slug=slug, user_id=user_id, agent=agent)}


@router.get("/dispatches/{task_id}")
async def get_topiclink_dispatch(
    task_id: str,
    user: dict[str, Any] | None = Depends(_optional_topiclink_user),
) -> dict[str, Any]:
    if not user or user.get("sub") is None:
        raise HTTPException(status_code=401, detail="登录后才能查看调研结果")
    task = _get_topiclink_agent_task(
        task_id=task_id,
        requested_by_user_id=int(user["sub"]),
    )
    if not task or int(task.requested_by_user_id) != int(user["sub"]):
        raise HTTPException(status_code=404, detail="调度单不存在")
    return {"task": _serialize_topiclink_agent_task(task)}


@router.get("/agent-tasks")
async def list_topiclink_agent_tasks(
    status: str = Query(default="pending"),
    user: dict[str, Any] = Depends(require_openclaw_user),
) -> dict[str, Any]:
    if status not in {"pending", "claimed", "replied", "failed"}:
        raise HTTPException(status_code=400, detail="不支持的调度状态")
    return {
        "items": _list_topiclink_agent_tasks(
            agent_id=int(user["openclaw_agent_id"]),
            status=status,
        )
    }


@router.post("/agent-tasks/{task_id}/claim")
async def claim_topiclink_agent_task(
    task_id: str,
    req: TopicLinkTaskClaimRequest | None = None,
    user: dict[str, Any] = Depends(require_openclaw_user),
) -> dict[str, Any]:
    claim_token = req.claim_token if req else secrets.token_urlsafe(32)
    task = _transition_topiclink_agent_task(
        task_id=task_id,
        agent_id=int(user["openclaw_agent_id"]),
        status="claimed",
        claim_token=claim_token,
    )
    return {"task": task, "claim_token": claim_token}


@router.post("/agent-tasks/{task_id}/complete")
async def complete_topiclink_agent_task(
    task_id: str,
    req: TopicLinkTaskCompleteRequest,
    user: dict[str, Any] = Depends(require_openclaw_user),
) -> dict[str, Any]:
    task = _transition_topiclink_agent_task(
        task_id=task_id,
        agent_id=int(user["openclaw_agent_id"]),
        status="replied",
        claim_token=req.claim_token,
        output={
            "summary": req.summary,
            "risk_notes": req.risk_notes,
            "next_step": req.next_step,
        },
    )
    return {"task": task}


@router.post("/agent-tasks/{task_id}/fail")
async def fail_topiclink_agent_task(
    task_id: str,
    req: TopicLinkTaskFailRequest,
    user: dict[str, Any] = Depends(require_openclaw_user),
) -> dict[str, Any]:
    task = _transition_topiclink_agent_task(
        task_id=task_id,
        agent_id=int(user["openclaw_agent_id"]),
        status="failed",
        claim_token=req.claim_token,
        error_message=req.error_message,
    )
    return {"task": task}


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
async def set_topiclink_presence(
    topic_id: str,
    req: TopicLinkPresenceRequest | None = None,
    user: dict[str, Any] | None = Depends(_optional_topiclink_user),
) -> dict[str, Any]:
    if not user or user.get("sub") is None:
        raise HTTPException(status_code=401, detail="登录后才能外派绑定的 OpenClaw 分身")
    persona_name = _normalize_persona_name(req.persona_name if req else None)
    return _dispatch_topiclink_presence(topic_id, persona_name=persona_name, user=user)


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
