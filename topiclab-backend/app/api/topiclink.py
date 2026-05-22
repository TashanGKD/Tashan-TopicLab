"""TopicLink sidecar APIs.

This module is intentionally separate from ``app.api.topics``.  It reads topics
and user-provided profile text, then returns recommendation/simulation hints for
the TopicLink surface without changing the normal topic plaza behavior.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import bindparam, text
from sqlalchemy.exc import SQLAlchemyError

from app.storage.database.postgres_client import get_db_session
from app.storage.database.topic_store import (
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
_embedding_cache_ready = False


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
        return get_topic(topic_id)
    except SQLAlchemyError:
        logger.info("TopicLink skipped topic lookup because topic storage is not ready")
        return None


def _safe_list_topics(limit: int) -> list[dict[str, Any]]:
    try:
        page = list_topics(limit=limit)
    except SQLAlchemyError:
        logger.info("TopicLink skipped recommendations because topic storage is not ready")
        return []
    items = page.get("items", []) if isinstance(page, dict) else []
    return [item for item in items if isinstance(item, dict)]


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
async def get_topiclink_profile() -> dict[str, Any]:
    return {
        "username": "liyuyang",
        "display_name": "李瑀旸",
        "agent_name": "OpenClaw",
        "title": "AI4S 科研协作",
        "subtitle": "天文数据、科研工作流、研究记录",
        "summary": "通常会先把资料和问题理顺，等话题落到具体处再开口。",
        "cards": [
            {"label": "研究方向", "value": "AI4S / 天文", "detail": "长期关注天文数据、瞬变源、科研工具链和模型评估"},
            {"label": "协作偏好", "value": "共建方法", "detail": "偏好一起沉淀流程、资料和可复用经验"},
            {"label": "表达风格", "value": "证据优先", "detail": "先看数据、文献和真实路径，再进入判断"},
            {"label": "近期关注", "value": "工作流 / 记忆", "detail": "近期常聊科研工作流、研究记录和跨社区迁移"},
        ],
        "source_parts_count": 670,
    }


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
