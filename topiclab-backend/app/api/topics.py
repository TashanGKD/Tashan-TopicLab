"""Topic, posts, discussion, and topic-scoped proxy APIs."""

from __future__ import annotations

import asyncio
from hashlib import sha256
from io import BytesIO
from pathlib import Path
import tempfile
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import FileResponse, Response
from fastapi.security import HTTPAuthorizationCredentials
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.api.auth import security, verify_access_token
from app.services.content_moderation import moderate_post_content
from app.services.resonnet_client import request_json
from app.storage.database.postgres_client import get_db_session
from app.storage.database.topic_store import (
    DEFAULT_MODERATOR_MODE,
    assign_source_article_to_favorite_category,
    assign_topic_to_favorite_category,
    close_topic,
    classify_favorites_by_category_name,
    create_topic,
    create_favorite_category,
    delete_post,
    delete_favorite_category,
    delete_topic,
    extract_preview_image,
    generate_post_delete_token,
    get_generated_image,
    get_favorite_category,
    get_favorite_category_summary_payload,
    get_post,
    get_topic,
    get_topic_moderator_config,
    hash_post_delete_token,
    list_favorite_categories,
    list_user_favorite_source_articles,
    list_user_favorite_topics,
    list_discussion_turns,
    list_posts,
    list_topic_experts,
    list_topics,
    make_post,
    record_post_share,
    record_topic_share,
    replace_discussion_turns,
    replace_generated_images,
    replace_topic_experts,
    resolve_post_by_delete_token,
    set_discussion_status,
    set_post_user_action,
    set_source_article_user_action,
    set_topic_user_action,
    set_topic_moderator_config,
    unassign_source_article_from_favorite_category,
    unassign_topic_from_favorite_category,
    update_topic,
    update_favorite_category,
    upsert_post,
)

router = APIRouter()

_PREVIEW_CACHE_DIRNAME = ".generated_image_previews"
_PREVIEW_DEFAULT_QUALITY = 72
_PREVIEW_DEFAULT_FORMAT = "webp"
_PREVIEW_MAX_DIMENSION = 2048
_DISCUSSION_SYNC_INTERVAL_SECONDS = 2.0

TOPIC_CATEGORIES = [
    {"id": "plaza", "name": "广场", "description": "适合公开发起、泛讨论和社区互动的话题。", "profile_id": "community_dialogue"},
    {"id": "thought", "name": "思考", "description": "适合观点整理、开放问题和长线思辨。", "profile_id": "critical_thinking"},
    {"id": "research", "name": "科研", "description": "适合论文、实验、方法和研究路线相关的话题。", "profile_id": "research_review"},
    {"id": "product", "name": "产品", "description": "适合功能设计、用户反馈和产品判断。", "profile_id": "product_review"},
    {"id": "news", "name": "资讯", "description": "适合围绕最新动态、行业消息和热点展开讨论。", "profile_id": "news_analysis"},
]
TOPIC_CATEGORY_IDS = {item["id"] for item in TOPIC_CATEGORIES}
TOPIC_CATEGORY_MAP = {item["id"]: item for item in TOPIC_CATEGORIES}

TOPIC_CATEGORY_PROFILES = {
    "plaza": {
        "profile_id": "community_dialogue",
        "category": "plaza",
        "display_name": "广场参与策略",
        "objective": "快速理解上下文，给出可参与、可延续的社区讨论回应。",
        "tone": "清晰、友好、直接，降低理解门槛。",
        "reasoning_style": "先回应当前话题，再补一个具体观点或问题，避免过度铺陈。",
        "evidence_requirement": "medium",
        "questioning_requirement": "medium",
        "post_style": "readable and conversational",
        "reply_style": "engaging and concise",
        "discussion_start_style": "invite viewpoints and identify the most discussable angle",
        "default_actions": [
            "先总结当前讨论焦点，再追加一个明确观点。",
            "如果上下文不足，优先追问而不是强行定论。",
            "尽量把抽象判断改写成用户可继续接话的表达。",
        ],
        "avoid": [
            "不要写成论文式长文。",
            "不要堆砌术语或空泛口号。",
            "不要脱离当前帖子的讨论氛围。",
        ],
        "output_structure": [
            "一句话回应当前上下文",
            "一个核心判断",
            "一个可继续讨论的问题或建议",
        ],
    },
    "thought": {
        "profile_id": "critical_thinking",
        "category": "thought",
        "display_name": "思考参与策略",
        "objective": "帮助讨论者澄清概念、拆解立场，并推动更深入的思辨。",
        "tone": "克制、敏锐、开放。",
        "reasoning_style": "先重述问题，再拆前提，比较不同解释路径，最后给出暂时结论。",
        "evidence_requirement": "medium",
        "questioning_requirement": "strong",
        "post_style": "concept-first and exploratory",
        "reply_style": "clarify assumptions before conclusions",
        "discussion_start_style": "reframe the question and expose hidden assumptions",
        "default_actions": [
            "明确区分事实、判断和推测。",
            "主动指出争议点背后的隐含前提。",
            "给出至少一个反向视角或替代解释。",
        ],
        "avoid": [
            "不要把复杂问题过早压成单一句结论。",
            "不要只给态度，不给推理链。",
            "不要把推测包装成事实。",
        ],
        "output_structure": [
            "问题重述",
            "关键前提/概念",
            "正反或多路径分析",
            "暂时结论与保留项",
        ],
    },
    "research": {
        "profile_id": "research_review",
        "category": "research",
        "display_name": "科研参与策略",
        "objective": "像研究讨论一样推进话题，强调证据、局限和可验证下一步。",
        "tone": "严谨、审慎、有思辨精神。",
        "reasoning_style": "先定义问题，再列证据与缺口，提出反例、局限和验证方案。",
        "evidence_requirement": "high",
        "questioning_requirement": "strong",
        "post_style": "hypothesis-driven and evidence-aware",
        "reply_style": "evidence-first with limitations",
        "discussion_start_style": "define scope, surface uncertainty, then compare evidence",
        "default_actions": [
            "优先引用已有材料、实验条件或具体来源。",
            "主动区分结果、解释和假设。",
            "给出反例、局限性或后续验证建议。",
        ],
        "avoid": [
            "不要在没有证据时做强结论。",
            "不要忽略样本、条件、方法差异。",
            "不要把宣传性表述当成研究结论。",
        ],
        "output_structure": [
            "研究问题/假设",
            "现有证据",
            "局限与反例",
            "下一步验证或实验建议",
        ],
    },
    "product": {
        "profile_id": "product_review",
        "category": "product",
        "display_name": "产品参与策略",
        "objective": "把讨论落到用户价值、实现代价和产品取舍上。",
        "tone": "务实、明确、面向决策。",
        "reasoning_style": "围绕用户问题、价值、代价、风险和优先级展开。",
        "evidence_requirement": "medium",
        "questioning_requirement": "medium",
        "post_style": "decision-oriented and structured",
        "reply_style": "trade-off driven",
        "discussion_start_style": "pin down user problem, value, and implementation cost",
        "default_actions": [
            "先说清楚在解决谁的问题。",
            "比较收益、成本和风险，而不是只谈功能点。",
            "尽量给出优先级或上线建议。",
        ],
        "avoid": [
            "不要只给抽象方向，不给取舍。",
            "不要忽略用户场景与实现成本。",
            "不要把个人偏好当成产品结论。",
        ],
        "output_structure": [
            "用户问题",
            "方案与取舍",
            "风险/成本",
            "建议优先级",
        ],
    },
    "news": {
        "profile_id": "news_analysis",
        "category": "news",
        "display_name": "资讯参与策略",
        "objective": "快速整理事实、时间线和影响判断，避免传播未经区分的推测。",
        "tone": "克制、准确、信息密度高。",
        "reasoning_style": "先事实，后解释；先时间线，后影响；明确哪些是推断。",
        "evidence_requirement": "high",
        "questioning_requirement": "medium",
        "post_style": "timeline-first and source-aware",
        "reply_style": "fact-confirmation before interpretation",
        "discussion_start_style": "summarize confirmed facts, then evaluate implications",
        "default_actions": [
            "先交代确认过的事实和时间点。",
            "涉及判断时明确写出依据和不确定性。",
            "尽量比较不同来源的说法差异。",
        ],
        "avoid": [
            "不要把传闻和事实混写。",
            "不要跳过时间线直接下判断。",
            "不要制造确定性幻觉。",
        ],
        "output_structure": [
            "已确认事实",
            "时间线/来源",
            "影响判断",
            "未确认部分",
        ],
    },
}


class TopicCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    body: str = ""
    category: str = Field(default="plaza")


class TopicUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    body: str | None = None
    category: str | None = None


class CreatePostRequest(BaseModel):
    author: str = Field(..., min_length=1)
    body: str = Field(..., min_length=1)
    in_reply_to_id: str | None = None


class MentionExpertRequest(BaseModel):
    author: str = Field(..., min_length=1)
    body: str = Field(..., min_length=1)
    expert_name: str = Field(..., min_length=1)
    in_reply_to_id: str | None = None


class MentionExpertResponse(BaseModel):
    user_post: dict
    reply_post_id: str
    status: str


class StartDiscussionRequest(BaseModel):
    num_rounds: int = Field(default=5, ge=1, le=20)
    max_turns: int = Field(default=50000, ge=10, le=50000)
    max_budget_usd: float = Field(default=500.0, ge=0.1)
    model: str | None = None
    allowed_tools: list[str] | None = None
    skill_list: list[str] | None = Field(default=None)
    mcp_server_ids: list[str] | None = None


class ToggleActionRequest(BaseModel):
    enabled: bool = True


class SourceArticleActionRequest(ToggleActionRequest):
    title: str = ""
    source_feed_name: str = ""
    source_type: str = ""
    url: str = ""
    pic_url: str | None = None
    description: str = ""
    publish_time: str = ""
    created_at: str = ""


class FavoriteCategoryCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: str = ""


class FavoriteCategoryUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None


class FavoriteCategoryBatchClassifyRequest(BaseModel):
    category_name: str = Field(..., min_length=1, max_length=120)
    description: str = ""
    topic_ids: list[str] = Field(default_factory=list, max_length=100)
    article_ids: list[int] = Field(default_factory=list, max_length=100)


def get_workspace_base() -> Path:
    import os

    raw = os.getenv("WORKSPACE_BASE", "").strip()
    if raw:
        return Path(raw)
    return Path(__file__).resolve().parents[2] / "workspace"


def _topic_workspace(topic_id: str) -> Path:
    return get_workspace_base() / "topics" / topic_id


async def _moderate_or_raise(body: str, *, scenario: str) -> None:
    try:
        decision = await moderate_post_content(body, scenario=scenario)
    except ValueError as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "content_moderation_unavailable",
                "message": "内容审核暂时不可用，请稍后重试",
                "provider_message": str(exc),
            },
        ) from exc

    if decision.approved:
        return

    raise HTTPException(
        status_code=400,
        detail={
            "code": "content_moderation_rejected",
            "message": "内容审核未通过，请调整后再发布",
            "review_message": decision.reason,
            "suggestion": decision.suggestion,
            "category": decision.category,
        },
    )


def _preview_cache_dir(topic_id: str) -> Path:
    cache_dir = _topic_workspace(topic_id) / "shared" / _PREVIEW_CACHE_DIRNAME
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir


def _resolve_generated_image_path(topic_id: str, asset_path: str) -> Path:
    generated_dir = (_topic_workspace(topic_id) / "shared" / "generated_images").resolve()
    target = (generated_dir / asset_path).resolve()
    if generated_dir != target and generated_dir not in target.parents:
        raise HTTPException(status_code=404, detail="Asset not found")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="Asset not found")
    return target


def _encode_image_to_webp(source_path: Path) -> dict:
    try:
        with Image.open(source_path) as image:
            normalized = ImageOps.exif_transpose(image)
            normalized.load()
            normalized = normalized.copy()
            width, height = normalized.size
            if normalized.mode not in {"RGB", "RGBA"}:
                normalized = normalized.convert("RGBA" if "A" in normalized.getbands() else "RGB")

            output = BytesIO()
            normalized.save(output, format="WEBP", quality=90, method=6)
    except UnidentifiedImageError as exc:
        raise HTTPException(status_code=415, detail="Unsupported image format") from exc

    image_bytes = output.getvalue()
    return {
        "content_type": "image/webp",
        "image_bytes": image_bytes,
        "width": width,
        "height": height,
        "byte_size": len(image_bytes),
    }


def _build_preview_cache_path(
    topic_id: str,
    asset_key: str,
    source_path: Path,
    *,
    width: int | None,
    height: int | None,
    quality: int,
    output_format: str,
) -> Path:
    stat = source_path.stat()
    cache_key = sha256(
        f"{asset_key}|{stat.st_mtime_ns}|{stat.st_size}|{width}|{height}|{quality}|{output_format}".encode("utf-8")
    ).hexdigest()[:20]
    width_part = width if width is not None else "auto"
    height_part = height if height is not None else "auto"
    return _preview_cache_dir(topic_id) / (
        f"{source_path.stem}.{cache_key}.{width_part}x{height_part}.q{quality}.{output_format}"
    )


def _create_generated_image_preview(
    topic_id: str,
    asset_path: str,
    *,
    width: int | None,
    height: int | None,
    quality: int,
    output_format: str,
) -> Path:
    source_path = _resolve_generated_image_path(topic_id, asset_path)
    cache_path = _build_preview_cache_path(
        topic_id,
        asset_path,
        source_path,
        width=width,
        height=height,
        quality=quality,
        output_format=output_format,
    )
    if cache_path.exists():
        return cache_path

    max_size = (
        width if width is not None else _PREVIEW_MAX_DIMENSION,
        height if height is not None else _PREVIEW_MAX_DIMENSION,
    )

    try:
        with Image.open(source_path) as image:
            preview = ImageOps.exif_transpose(image)
            preview.load()
            preview = preview.copy()
            preview.thumbnail(max_size, Image.Resampling.LANCZOS)
            if preview.mode not in {"RGB", "RGBA"}:
                preview = preview.convert("RGBA" if "A" in preview.getbands() else "RGB")

            with tempfile.NamedTemporaryFile(
                dir=cache_path.parent,
                prefix=f"{cache_path.stem}.",
                suffix=".tmp",
                delete=False,
            ) as tmp_file:
                tmp_path = Path(tmp_file.name)
            try:
                preview.save(tmp_path, format=output_format.upper(), quality=quality, method=6)
                tmp_path.replace(cache_path)
            finally:
                if tmp_path.exists():
                    tmp_path.unlink()
    except UnidentifiedImageError as exc:
        raise HTTPException(status_code=415, detail="Unsupported image format") from exc

    return cache_path


def _create_generated_image_preview_bytes(
    image_bytes: bytes,
    *,
    width: int | None,
    height: int | None,
    quality: int,
    output_format: str,
) -> bytes:
    max_size = (
        width if width is not None else _PREVIEW_MAX_DIMENSION,
        height if height is not None else _PREVIEW_MAX_DIMENSION,
    )
    try:
        with Image.open(BytesIO(image_bytes)) as image:
            preview = ImageOps.exif_transpose(image)
            preview.load()
            preview = preview.copy()
            preview.thumbnail(max_size, Image.Resampling.LANCZOS)
            if preview.mode not in {"RGB", "RGBA"}:
                preview = preview.convert("RGBA" if "A" in preview.getbands() else "RGB")
            output = BytesIO()
            preview.save(output, format=output_format.upper(), quality=quality, method=6)
    except UnidentifiedImageError as exc:
        raise HTTPException(status_code=415, detail="Unsupported image format") from exc
    return output.getvalue()


def _build_posts_context(posts: list[dict]) -> str:
    if not posts:
        return "# Posts Context\n\n_No posts yet._\n"
    parts = ["# Posts Context"]
    for post in posts:
        author = post.get("expert_label") or post.get("author") or "unknown"
        status = post.get("status", "completed")
        header = f"## {author} ({post.get('author_type', 'unknown')}, {status})"
        body = (post.get("body") or "").strip() or "_empty_"
        parts.append(
            f"{header}\n\n- created_at: {post.get('created_at', '')}\n- id: {post.get('id')}\n\n{body}"
        )
    return "\n\n".join(parts) + "\n"


def _build_discussion_history(turns: list[dict]) -> str:
    parts: list[str] = []
    for turn in sorted(turns, key=lambda item: (item.get("round_num") or 0, item.get("turn_key") or "")):
        label = turn.get("expert_label") or turn.get("expert_name") or turn.get("turn_key", "Unknown")
        round_num = turn.get("round_num")
        heading = f"## Round {round_num} - {label}" if round_num else f"## {label}"
        parts.append(f"{heading}\n\n{(turn.get('body') or '').strip()}\n\n---")
    return "\n\n".join(parts)


def _discussion_progress_from_turns(topic: dict, turns: list[dict]) -> dict:
    latest_turn = turns[-1] if turns else None
    return {
        "completed_turns": len(turns),
        "total_turns": (topic.get("num_rounds") or 0) * len(topic.get("expert_names") or []),
        "current_round": latest_turn.get("round_num") if latest_turn else 0,
        "latest_speaker": (latest_turn or {}).get("expert_label") or (latest_turn or {}).get("expert_name") or "",
    }


def _row_user_name(user_id: int) -> str | None:
    with get_db_session() as session:
        row = session.execute(
            text("SELECT username, phone FROM users WHERE id = :id"),
            {"id": user_id},
        ).fetchone()
    if not row:
        return None
    return row[0] or row[1]


async def _get_optional_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict | None:
    if not credentials:
        return None
    return verify_access_token(credentials.credentials)


def _resolve_author_name(requested_author: str, user: dict | None) -> str:
    if not user:
        return requested_author
    user_id = user.get("sub")
    if user_id is None:
        return requested_author
    actual = _row_user_name(int(user_id))
    return actual or requested_author


def _resonnet_headers(authorization: str | None) -> dict[str, str]:
    if not authorization:
        return {}
    return {"Authorization": authorization}


def _resolve_owner_identity(user: dict | None) -> tuple[int | None, str | None]:
    if not user:
        return None, None
    raw_user_id = user.get("sub")
    if raw_user_id is None:
        return None, user.get("auth_type")
    return int(raw_user_id), user.get("auth_type", "jwt")


def _require_owner_identity(user: dict | None) -> tuple[int, str]:
    if not user:
        raise HTTPException(status_code=401, detail="未登录")
    user_id, auth_type = _resolve_owner_identity(user)
    if user_id is None:
        raise HTTPException(status_code=401, detail="无效账号")
    return user_id, auth_type or "jwt"


def _is_admin_user(user: dict | None) -> bool:
    return bool(user and user.get("is_admin"))


def _can_delete_topic(topic: dict, user: dict | None) -> bool:
    if not user:
        return False
    if _is_admin_user(user):
        return True
    current_user_id = user.get("sub")
    creator_user_id = topic.get("creator_user_id")
    if current_user_id is not None and creator_user_id is not None:
        return int(current_user_id) == int(creator_user_id)
    return False


def _can_delete_post(post: dict, user: dict | None) -> bool:
    if not user:
        return False
    if _is_admin_user(user):
        return True
    if post.get("author_type") != "human":
        return False
    current_user_id = user.get("sub")
    if current_user_id is not None and post.get("owner_user_id") is not None:
        return int(current_user_id) == int(post["owner_user_id"])
    author_name = _resolve_author_name(post.get("author") or "", user)
    return author_name == post.get("author")


def _normalize_topic_category(category: str | None) -> str | None:
    if category is None:
        return None
    normalized = category.strip().lower()
    if not normalized:
        return None
    if normalized not in TOPIC_CATEGORY_IDS:
        raise HTTPException(status_code=400, detail=f"Unsupported topic category: {category}")
    return normalized


def get_topic_category_profile(category: str) -> dict:
    normalized = _normalize_topic_category(category)
    if normalized is None:
        raise HTTPException(status_code=404, detail="Topic category not found")
    profile = TOPIC_CATEGORY_PROFILES.get(normalized)
    if profile is None:
        raise HTTPException(status_code=404, detail="Topic category profile not found")
    category_meta = TOPIC_CATEGORY_MAP[normalized]
    return {
        **profile,
        "category_name": category_meta["name"],
        "category_description": category_meta["description"],
    }


async def _proxy_to_resonnet(
    method: str,
    path: str,
    *,
    authorization: str | None = None,
    json_body: dict | None = None,
    params: dict | None = None,
) -> Any:
    try:
        return await request_json(
            method,
            path,
            json_body=json_body,
            params=params,
            headers=_resonnet_headers(authorization),
            timeout=120.0,
        )
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text
        try:
            detail_json = exc.response.json()
            detail = detail_json.get("detail", detail_json)
        except Exception:
            pass
        raise HTTPException(status_code=exc.response.status_code, detail=detail) from exc


async def _ensure_executor_workspace(topic_id: str) -> dict:
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    await request_json(
        "POST",
        "/executor/topics/bootstrap",
        json_body={
            "topic_id": topic["id"],
            "topic_title": topic["title"],
            "topic_body": topic["body"],
            "num_rounds": topic.get("num_rounds") or 5,
        },
        timeout=120.0,
    )
    return topic


async def _sync_topic_experts_from_resonnet(topic_id: str, authorization: str | None) -> list[dict]:
    await _ensure_executor_workspace(topic_id)
    experts = await _proxy_to_resonnet("GET", f"/topics/{topic_id}/experts", authorization=authorization)
    replace_topic_experts(topic_id, experts)
    return experts


async def _sync_topic_mode_from_resonnet(topic_id: str, authorization: str | None) -> dict:
    await _ensure_executor_workspace(topic_id)
    config = await _proxy_to_resonnet("GET", f"/topics/{topic_id}/moderator-mode", authorization=authorization)
    config["mode_name"] = _mode_name_from_id(config.get("mode_id"))
    set_topic_moderator_config(topic_id, config)
    return config


def _collect_generated_images(topic_id: str, asset_paths: list[str]) -> list[dict]:
    generated_images: list[dict] = []
    for asset_path in asset_paths:
        try:
            encoded = _encode_image_to_webp(_resolve_generated_image_path(topic_id, asset_path))
        except HTTPException:
            continue
        generated_images.append({"asset_path": asset_path, **encoded})
    return generated_images


async def _sync_discussion_snapshot(topic_id: str) -> dict | None:
    try:
        snapshot = await request_json("GET", f"/executor/discussions/{topic_id}/snapshot", timeout=120.0)
    except Exception:
        return None

    turns = snapshot.get("turns") or []
    discussion_history = snapshot.get("discussion_history") or _build_discussion_history(turns)
    discussion_summary = snapshot.get("discussion_summary") or ""
    generated_images = _collect_generated_images(topic_id, snapshot.get("generated_images") or [])

    replace_discussion_turns(topic_id, turns)
    replace_generated_images(topic_id, generated_images)
    set_discussion_status(
        topic_id,
        "running",
        turns_count=snapshot.get("turns_count") or len(turns),
        discussion_summary=discussion_summary,
        discussion_history=discussion_history,
    )

    preview_markdown_ref = (
        extract_preview_image(discussion_summary)
        or extract_preview_image(discussion_history)
        or (f"../generated_images/{generated_images[0]['asset_path']}" if generated_images else None)
    )
    if preview_markdown_ref:
        update_topic(topic_id, {"preview_image": preview_markdown_ref})
    return snapshot


def _mode_name_from_id(mode_id: str | None) -> str:
    if mode_id == "custom":
        return "自定义模式"
    if mode_id == "standard":
        return "标准圆桌"
    return mode_id or "standard"


async def _run_discussion_background(topic_id: str, payload: dict) -> None:
    try:
        discussion_task = asyncio.create_task(
            request_json("POST", "/executor/discussions", json_body=payload, timeout=3600.0)
        )
        while not discussion_task.done():
            await asyncio.wait({discussion_task}, timeout=_DISCUSSION_SYNC_INTERVAL_SECONDS)
            await _sync_discussion_snapshot(topic_id)
        result = await discussion_task
        turns = result.get("turns") or []
        discussion_history = result.get("discussion_history") or _build_discussion_history(turns)
        discussion_summary = result.get("discussion_summary") or ""
        generated_images = _collect_generated_images(topic_id, result.get("generated_images") or [])
        replace_discussion_turns(topic_id, turns)
        replace_generated_images(topic_id, generated_images)
        set_discussion_status(
            topic_id,
            "completed",
            turns_count=result.get("turns_count") or len(turns),
            cost_usd=result.get("cost_usd"),
            completed_at=result.get("completed_at"),
            discussion_summary=discussion_summary,
            discussion_history=discussion_history,
        )
        preview_markdown_ref = (
            extract_preview_image(discussion_summary)
            or extract_preview_image(discussion_history)
            or (f"../generated_images/{generated_images[0]['asset_path']}" if generated_images else None)
        )
        if preview_markdown_ref:
            update_topic(topic_id, {"preview_image": preview_markdown_ref})
    except Exception:
        set_discussion_status(topic_id, "failed")


async def _run_expert_reply_background(topic_id: str, reply_post_id: str, payload: dict) -> None:
    try:
        result = await request_json("POST", "/executor/expert-replies", json_body=payload, timeout=1800.0)
        reply = get_post(topic_id, reply_post_id)
        if not reply:
            return
        reply["body"] = result.get("reply_body", "")
        reply["status"] = "completed"
        upsert_post(reply)
    except Exception:
        reply = get_post(topic_id, reply_post_id)
        if not reply:
            return
        reply["body"] = "(Expert reply failed; please try again later)"
        reply["status"] = "failed"
        upsert_post(reply)


@router.get("/topics")
def get_topics(category: str | None = Query(default=None), user: dict | None = Depends(_get_optional_user)):
    user_id, auth_type = _resolve_owner_identity(user)
    return list_topics(category=_normalize_topic_category(category), user_id=user_id, auth_type=auth_type)


@router.get("/topics/categories")
def get_topic_categories():
    return {"list": TOPIC_CATEGORIES}


@router.get("/topics/categories/{category_id}/profile")
def get_topic_category_profile_endpoint(category_id: str):
    return get_topic_category_profile(category_id)


@router.post("/topics", status_code=201)
async def create_topic_endpoint(data: TopicCreateRequest, user: dict | None = Depends(_get_optional_user)):
    category = _normalize_topic_category(data.category) or "plaza"
    creator_user_id = None
    creator_name = None
    creator_auth_type = None
    if user:
        raw_user_id = user.get("sub")
        if raw_user_id is not None:
            creator_user_id = int(raw_user_id)
        creator_name = _resolve_author_name("", user) or user.get("username") or user.get("phone")
        creator_auth_type = user.get("auth_type", "jwt")
    return create_topic(
        data.title,
        data.body,
        category,
        creator_user_id=creator_user_id,
        creator_name=creator_name,
        creator_auth_type=creator_auth_type,
    )


@router.get("/topics/{topic_id}")
def get_topic_endpoint(topic_id: str, user: dict | None = Depends(_get_optional_user)):
    user_id, auth_type = _resolve_owner_identity(user)
    topic = get_topic(topic_id, user_id=user_id, auth_type=auth_type)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    return topic


@router.patch("/topics/{topic_id}")
def update_topic_endpoint(topic_id: str, data: TopicUpdateRequest):
    payload = data.model_dump(exclude_unset=True)
    if "category" in payload:
        payload["category"] = _normalize_topic_category(payload["category"])
    updated = update_topic(topic_id, payload)
    if not updated:
        raise HTTPException(status_code=404, detail="Topic not found")
    return updated


@router.post("/topics/{topic_id}/close")
def close_topic_endpoint(topic_id: str):
    closed = close_topic(topic_id)
    if not closed:
        raise HTTPException(status_code=404, detail="Topic not found")
    return closed


@router.delete("/topics/{topic_id}")
def delete_topic_endpoint(topic_id: str, user: dict | None = Depends(_get_optional_user)):
    user_id, auth_type = _resolve_owner_identity(user)
    topic = get_topic(topic_id, user_id=user_id, auth_type=auth_type)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    if not user:
        raise HTTPException(status_code=401, detail="未登录")
    if not _can_delete_topic(topic, user):
        raise HTTPException(status_code=403, detail="No permission to delete this topic")
    if not delete_topic(topic_id):
        raise HTTPException(status_code=404, detail="Topic not found")
    return {"ok": True, "topic_id": topic_id}


@router.post("/topics/{topic_id}/like")
def like_topic_endpoint(
    topic_id: str,
    req: ToggleActionRequest,
    user: dict | None = Depends(_get_optional_user),
):
    if not get_topic(topic_id):
        raise HTTPException(status_code=404, detail="Topic not found")
    user_id, auth_type = _require_owner_identity(user)
    return set_topic_user_action(topic_id, user_id=user_id, auth_type=auth_type, liked=req.enabled)


@router.post("/topics/{topic_id}/favorite")
def favorite_topic_endpoint(
    topic_id: str,
    req: ToggleActionRequest,
    user: dict | None = Depends(_get_optional_user),
):
    if not get_topic(topic_id):
        raise HTTPException(status_code=404, detail="Topic not found")
    user_id, auth_type = _require_owner_identity(user)
    return set_topic_user_action(topic_id, user_id=user_id, auth_type=auth_type, favorited=req.enabled)


@router.post("/topics/{topic_id}/share")
def share_topic_endpoint(
    topic_id: str,
    user: dict | None = Depends(_get_optional_user),
):
    if not get_topic(topic_id):
        raise HTTPException(status_code=404, detail="Topic not found")
    user_id, auth_type = _resolve_owner_identity(user)
    return record_topic_share(topic_id, user_id=user_id, auth_type=auth_type)


@router.get("/me/favorites")
def get_my_favorites_endpoint(user: dict | None = Depends(_get_optional_user)):
    user_id, auth_type = _require_owner_identity(user)
    return {
        "topics": list_user_favorite_topics(user_id=user_id, auth_type=auth_type),
        "source_articles": list_user_favorite_source_articles(user_id=user_id, auth_type=auth_type),
        "categories": list_favorite_categories(user_id=user_id, auth_type=auth_type),
    }


@router.get("/me/favorite-categories")
def list_my_favorite_categories_endpoint(user: dict | None = Depends(_get_optional_user)):
    user_id, auth_type = _require_owner_identity(user)
    return {"list": list_favorite_categories(user_id=user_id, auth_type=auth_type)}


@router.post("/me/favorite-categories", status_code=201)
def create_my_favorite_category_endpoint(
    req: FavoriteCategoryCreateRequest,
    user: dict | None = Depends(_get_optional_user),
):
    user_id, auth_type = _require_owner_identity(user)
    try:
        return create_favorite_category(
            user_id=user_id,
            auth_type=auth_type,
            name=req.name,
            description=req.description,
        )
    except Exception as exc:
        raise HTTPException(status_code=409, detail=f"创建收藏分类失败: {exc}") from exc


@router.patch("/me/favorite-categories/{category_id}")
def update_my_favorite_category_endpoint(
    category_id: str,
    req: FavoriteCategoryUpdateRequest,
    user: dict | None = Depends(_get_optional_user),
):
    user_id, auth_type = _require_owner_identity(user)
    updated = update_favorite_category(
        category_id,
        user_id=user_id,
        auth_type=auth_type,
        name=req.name,
        description=req.description,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="收藏分类不存在")
    return updated


@router.delete("/me/favorite-categories/{category_id}")
def delete_my_favorite_category_endpoint(category_id: str, user: dict | None = Depends(_get_optional_user)):
    user_id, auth_type = _require_owner_identity(user)
    if not delete_favorite_category(category_id, user_id=user_id, auth_type=auth_type):
        raise HTTPException(status_code=404, detail="收藏分类不存在")
    return {"ok": True, "category_id": category_id}


@router.get("/me/favorite-categories/{category_id}")
def get_my_favorite_category_endpoint(category_id: str, user: dict | None = Depends(_get_optional_user)):
    user_id, auth_type = _require_owner_identity(user)
    category = get_favorite_category(category_id, user_id=user_id, auth_type=auth_type)
    if not category:
        raise HTTPException(status_code=404, detail="收藏分类不存在")
    return category


@router.get("/me/favorite-categories/{category_id}/summary-payload")
def get_my_favorite_category_summary_payload_endpoint(
    category_id: str,
    user: dict | None = Depends(_get_optional_user),
):
    user_id, auth_type = _require_owner_identity(user)
    payload = get_favorite_category_summary_payload(category_id, user_id=user_id, auth_type=auth_type)
    if not payload:
        raise HTTPException(status_code=404, detail="收藏分类不存在")
    return payload


@router.post("/me/favorite-categories/classify")
def classify_my_favorites_endpoint(
    req: FavoriteCategoryBatchClassifyRequest,
    user: dict | None = Depends(_get_optional_user),
):
    user_id, auth_type = _require_owner_identity(user)
    try:
        return classify_favorites_by_category_name(
            user_id=user_id,
            auth_type=auth_type,
            category_name=req.category_name,
            description=req.description,
            topic_ids=req.topic_ids,
            article_ids=req.article_ids,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KeyError as exc:
        if str(exc) == "'favorite_topic_required'":
            raise HTTPException(status_code=400, detail="只能对已收藏的话题做分类") from exc
        if str(exc) == "'favorite_source_required'":
            raise HTTPException(status_code=400, detail="只能对已收藏的信源做分类") from exc
        raise HTTPException(status_code=404, detail="收藏分类不存在") from exc
    except Exception as exc:
        raise HTTPException(status_code=409, detail=f"收藏分类失败: {exc}") from exc


@router.post("/me/favorite-categories/{category_id}/topics/{topic_id}")
def assign_topic_to_my_favorite_category_endpoint(
    category_id: str,
    topic_id: str,
    user: dict | None = Depends(_get_optional_user),
):
    user_id, auth_type = _require_owner_identity(user)
    try:
        return assign_topic_to_favorite_category(category_id, topic_id, user_id=user_id, auth_type=auth_type)
    except KeyError as exc:
        if str(exc) == "'favorite_topic_required'":
            raise HTTPException(status_code=400, detail="只能对已收藏的话题做分类") from exc
        raise HTTPException(status_code=404, detail="收藏分类不存在") from exc


@router.delete("/me/favorite-categories/{category_id}/topics/{topic_id}")
def unassign_topic_from_my_favorite_category_endpoint(
    category_id: str,
    topic_id: str,
    user: dict | None = Depends(_get_optional_user),
):
    user_id, auth_type = _require_owner_identity(user)
    try:
        return unassign_topic_from_favorite_category(category_id, topic_id, user_id=user_id, auth_type=auth_type)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="收藏分类不存在") from exc


@router.post("/me/favorite-categories/{category_id}/source-articles/{article_id}")
def assign_source_article_to_my_favorite_category_endpoint(
    category_id: str,
    article_id: int,
    user: dict | None = Depends(_get_optional_user),
):
    user_id, auth_type = _require_owner_identity(user)
    try:
        return assign_source_article_to_favorite_category(category_id, article_id, user_id=user_id, auth_type=auth_type)
    except KeyError as exc:
        if str(exc) == "'favorite_source_required'":
            raise HTTPException(status_code=400, detail="只能对已收藏的信源做分类") from exc
        raise HTTPException(status_code=404, detail="收藏分类不存在") from exc


@router.delete("/me/favorite-categories/{category_id}/source-articles/{article_id}")
def unassign_source_article_from_my_favorite_category_endpoint(
    category_id: str,
    article_id: int,
    user: dict | None = Depends(_get_optional_user),
):
    user_id, auth_type = _require_owner_identity(user)
    try:
        return unassign_source_article_from_favorite_category(category_id, article_id, user_id=user_id, auth_type=auth_type)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="收藏分类不存在") from exc


@router.get("/topics/{topic_id}/posts")
def list_posts_endpoint(topic_id: str, user: dict | None = Depends(_get_optional_user)):
    user_id, auth_type = _resolve_owner_identity(user)
    topic = get_topic(topic_id, user_id=user_id, auth_type=auth_type)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    return list_posts(topic_id, user_id=user_id, auth_type=auth_type)


@router.post("/topics/{topic_id}/posts", status_code=201)
async def create_post_endpoint(topic_id: str, req: CreatePostRequest, user: dict | None = Depends(_get_optional_user)):
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    await _moderate_or_raise(req.body, scenario="topic_post")
    author_name = _resolve_author_name(req.author, user)
    owner_user_id, owner_auth_type = _resolve_owner_identity(user)
    raw_delete_token = generate_post_delete_token()
    post = make_post(
        topic_id=topic_id,
        author=author_name,
        author_type="human",
        body=req.body,
        in_reply_to_id=req.in_reply_to_id,
        status="completed",
        owner_user_id=owner_user_id,
        owner_auth_type=owner_auth_type,
        delete_token_hash=hash_post_delete_token(raw_delete_token),
    )
    saved = upsert_post(post)
    saved["delete_token"] = raw_delete_token
    return saved


@router.post("/topics/{topic_id}/posts/mention", status_code=202, response_model=MentionExpertResponse)
async def mention_expert_endpoint(
    topic_id: str,
    req: MentionExpertRequest,
    user: dict | None = Depends(_get_optional_user),
):
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    await _moderate_or_raise(req.body, scenario="topic_post_mention")
    if topic["discussion_status"] == "running":
        raise HTTPException(status_code=409, detail="Discussion is running; wait for it to finish before @mentioning experts")

    expert_map = {expert["name"]: expert for expert in list_topic_experts(topic_id)}
    expert = expert_map.get(req.expert_name)
    if expert is None:
        raise HTTPException(status_code=400, detail=f"Expert '{req.expert_name}' is not in this topic")

    author_name = _resolve_author_name(req.author, user)
    owner_user_id, owner_auth_type = _resolve_owner_identity(user)
    raw_delete_token = generate_post_delete_token()
    user_post = upsert_post(
        make_post(
            topic_id=topic_id,
            author=author_name,
            author_type="human",
            body=req.body,
            in_reply_to_id=req.in_reply_to_id,
            status="completed",
            owner_user_id=owner_user_id,
            owner_auth_type=owner_auth_type,
            delete_token_hash=hash_post_delete_token(raw_delete_token),
        )
    )
    user_post["delete_token"] = raw_delete_token
    reply_post = upsert_post(
        make_post(
            topic_id=topic_id,
            author=req.expert_name,
            author_type="agent",
            body="",
            expert_name=req.expert_name,
            expert_label=expert.get("label", req.expert_name),
            in_reply_to_id=user_post["id"],
            status="pending",
        )
    )
    payload = {
        "topic_id": topic_id,
        "topic_title": topic["title"],
        "topic_body": topic["body"],
        "expert_name": req.expert_name,
        "expert_label": expert.get("label", req.expert_name),
        "user_post_id": user_post["id"],
        "user_author": author_name,
        "user_question": req.body,
        "reply_post_id": reply_post["id"],
        "reply_created_at": reply_post["created_at"],
        "posts_context": _build_posts_context(list_posts(topic_id)),
    }
    asyncio.create_task(_run_expert_reply_background(topic_id, reply_post["id"], payload))
    return MentionExpertResponse(user_post=user_post, reply_post_id=reply_post["id"], status="pending")


@router.get("/topics/{topic_id}/posts/mention/{reply_post_id}")
def get_reply_status_endpoint(topic_id: str, reply_post_id: str, user: dict | None = Depends(_get_optional_user)):
    user_id, auth_type = _resolve_owner_identity(user)
    topic = get_topic(topic_id, user_id=user_id, auth_type=auth_type)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    post = get_post(topic_id, reply_post_id, user_id=user_id, auth_type=auth_type)
    if not post:
        raise HTTPException(status_code=404, detail="Reply post not found")
    return post


@router.post("/topics/{topic_id}/posts/{post_id}/like")
def like_post_endpoint(
    topic_id: str,
    post_id: str,
    req: ToggleActionRequest,
    user: dict | None = Depends(_get_optional_user),
):
    if not get_topic(topic_id):
        raise HTTPException(status_code=404, detail="Topic not found")
    if not get_post(topic_id, post_id):
        raise HTTPException(status_code=404, detail="Post not found")
    user_id, auth_type = _require_owner_identity(user)
    return set_post_user_action(topic_id, post_id, user_id=user_id, auth_type=auth_type, liked=req.enabled)


@router.post("/topics/{topic_id}/posts/{post_id}/share")
def share_post_endpoint(
    topic_id: str,
    post_id: str,
    user: dict | None = Depends(_get_optional_user),
):
    if not get_topic(topic_id):
        raise HTTPException(status_code=404, detail="Topic not found")
    if not get_post(topic_id, post_id):
        raise HTTPException(status_code=404, detail="Post not found")
    user_id, auth_type = _resolve_owner_identity(user)
    return record_post_share(topic_id, post_id, user_id=user_id, auth_type=auth_type)


@router.delete("/topics/{topic_id}/posts/{post_id}")
def delete_post_endpoint(
    topic_id: str,
    post_id: str,
    user: dict | None = Depends(_get_optional_user),
):
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    post = get_post(topic_id, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    if not user:
        raise HTTPException(status_code=401, detail="未登录")
    if not _can_delete_post(post, user):
        raise HTTPException(status_code=403, detail="No permission to delete this post")

    deleted_count = delete_post(topic_id, post_id)
    if deleted_count <= 0:
        raise HTTPException(status_code=404, detail="Post not found")
    return {"ok": True, "topic_id": topic_id, "post_id": post_id, "deleted_count": deleted_count}


@router.post("/topics/{topic_id}/discussion", status_code=202)
async def start_discussion_endpoint(topic_id: str, req: StartDiscussionRequest):
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    if topic["discussion_status"] == "running":
        raise HTTPException(status_code=400, detail="Discussion already running")

    topic_config = get_topic_moderator_config(topic_id) or DEFAULT_MODERATOR_MODE
    num_rounds = int(topic_config.get("num_rounds") or topic["num_rounds"] or req.num_rounds)
    updated = update_topic(topic_id, {"num_rounds": num_rounds})
    if not updated:
        raise HTTPException(status_code=404, detail="Topic not found")
    set_discussion_status(topic_id, "running", turns_count=0, discussion_summary="", discussion_history="")
    payload = {
        "topic_id": topic_id,
        "topic_title": topic["title"],
        "topic_body": topic["body"],
        "num_rounds": num_rounds,
        "expert_names": topic["expert_names"],
        "max_turns": req.max_turns,
        "max_budget_usd": req.max_budget_usd,
        "model": req.model or topic_config.get("model"),
        "allowed_tools": req.allowed_tools,
        "skill_list": req.skill_list if req.skill_list is not None else topic_config.get("skill_list", []),
        "mcp_server_ids": req.mcp_server_ids if req.mcp_server_ids is not None else topic_config.get("mcp_server_ids", []),
        "posts_context": _build_posts_context(list_posts(topic_id)),
    }
    asyncio.create_task(_run_discussion_background(topic_id, payload))
    return {"status": "running", "result": None, "progress": None}


@router.get("/topics/{topic_id}/discussion/status")
async def get_discussion_status_endpoint(topic_id: str):
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    if topic["discussion_status"] == "running":
        await _sync_discussion_snapshot(topic_id)
        topic = get_topic(topic_id)
        if not topic:
            raise HTTPException(status_code=404, detail="Topic not found")

    progress = None
    if topic["discussion_status"] == "running":
        progress = _discussion_progress_from_turns(topic, list_discussion_turns(topic_id))
    return {"status": topic["discussion_status"], "result": topic.get("discussion_result"), "progress": progress}


@router.get("/topics/{topic_id}/assets/generated_images/{asset_path:path}")
def get_generated_image_endpoint(
    topic_id: str,
    asset_path: str,
    w: int | None = Query(default=None, ge=1, le=_PREVIEW_MAX_DIMENSION),
    h: int | None = Query(default=None, ge=1, le=_PREVIEW_MAX_DIMENSION),
    q: int = Query(default=_PREVIEW_DEFAULT_QUALITY, ge=30, le=95),
    fm: str | None = Query(default=None, pattern="^webp$"),
):
    stored = get_generated_image(topic_id, asset_path)
    if stored is not None:
        if w is None and h is None and fm is None:
            return Response(
                content=stored["image_bytes"],
                media_type=stored["content_type"],
                headers={"Cache-Control": "public, max-age=300"},
            )
        output_format = fm or _PREVIEW_DEFAULT_FORMAT
        return Response(
            content=_create_generated_image_preview_bytes(
                stored["image_bytes"],
                width=w,
                height=h,
                quality=q,
                output_format=output_format,
            ),
            media_type=f"image/{output_format}",
            headers={"Cache-Control": "public, max-age=300"},
        )

    if w is None and h is None and fm is None:
        return FileResponse(_resolve_generated_image_path(topic_id, asset_path), headers={"Cache-Control": "public, max-age=300"})
    output_format = fm or _PREVIEW_DEFAULT_FORMAT
    return FileResponse(
        _create_generated_image_preview(
            topic_id,
            asset_path,
            width=w,
            height=h,
            quality=q,
            output_format=output_format,
        ),
        media_type=f"image/{output_format}",
        headers={"Cache-Control": "public, max-age=300"},
    )


@router.get("/topics/{topic_id}/experts")
async def list_topic_experts_endpoint(topic_id: str, authorization: str | None = Header(default=None)):
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    return await _sync_topic_experts_from_resonnet(topic_id, authorization)


@router.post("/topics/{topic_id}/experts", status_code=201)
async def add_topic_expert_endpoint(topic_id: str, req: dict, authorization: str | None = Header(default=None)):
    await _ensure_executor_workspace(topic_id)
    result = await _proxy_to_resonnet("POST", f"/topics/{topic_id}/experts", authorization=authorization, json_body=req)
    await _sync_topic_experts_from_resonnet(topic_id, authorization)
    return result


@router.put("/topics/{topic_id}/experts/{expert_name}")
async def update_topic_expert_endpoint(topic_id: str, expert_name: str, req: dict, authorization: str | None = Header(default=None)):
    await _ensure_executor_workspace(topic_id)
    result = await _proxy_to_resonnet(
        "PUT",
        f"/topics/{topic_id}/experts/{expert_name}",
        authorization=authorization,
        json_body=req,
    )
    await _sync_topic_experts_from_resonnet(topic_id, authorization)
    return result


@router.delete("/topics/{topic_id}/experts/{expert_name}")
async def delete_topic_expert_endpoint(topic_id: str, expert_name: str, authorization: str | None = Header(default=None)):
    await _ensure_executor_workspace(topic_id)
    result = await _proxy_to_resonnet(
        "DELETE",
        f"/topics/{topic_id}/experts/{expert_name}",
        authorization=authorization,
    )
    await _sync_topic_experts_from_resonnet(topic_id, authorization)
    return result


@router.get("/topics/{topic_id}/experts/{expert_name}/content")
async def get_topic_expert_content_endpoint(topic_id: str, expert_name: str, authorization: str | None = Header(default=None)):
    await _ensure_executor_workspace(topic_id)
    return await _proxy_to_resonnet(
        "GET",
        f"/topics/{topic_id}/experts/{expert_name}/content",
        authorization=authorization,
    )


@router.post("/topics/{topic_id}/experts/generate")
async def generate_topic_expert_endpoint(topic_id: str, req: dict, authorization: str | None = Header(default=None)):
    await _ensure_executor_workspace(topic_id)
    result = await _proxy_to_resonnet(
        "POST",
        f"/topics/{topic_id}/experts/generate",
        authorization=authorization,
        json_body=req,
    )
    await _sync_topic_experts_from_resonnet(topic_id, authorization)
    return result


@router.post("/topics/{topic_id}/experts/{expert_name}/share")
async def share_topic_expert_endpoint(topic_id: str, expert_name: str, req: dict | None = None, authorization: str | None = Header(default=None)):
    await _ensure_executor_workspace(topic_id)
    return await _proxy_to_resonnet(
        "POST",
        f"/topics/{topic_id}/experts/{expert_name}/share",
        authorization=authorization,
        json_body=req,
    )


@router.get("/topics/{topic_id}/moderator-mode")
async def get_topic_moderator_mode_endpoint(topic_id: str, authorization: str | None = Header(default=None)):
    return await _sync_topic_mode_from_resonnet(topic_id, authorization)


@router.put("/topics/{topic_id}/moderator-mode")
async def set_topic_moderator_mode_endpoint(topic_id: str, req: dict, authorization: str | None = Header(default=None)):
    await _ensure_executor_workspace(topic_id)
    await _proxy_to_resonnet(
        "PUT",
        f"/topics/{topic_id}/moderator-mode",
        authorization=authorization,
        json_body=req,
    )
    return await _sync_topic_mode_from_resonnet(topic_id, authorization)


@router.post("/topics/{topic_id}/moderator-mode/generate")
async def generate_topic_moderator_mode_endpoint(topic_id: str, req: dict, authorization: str | None = Header(default=None)):
    await _ensure_executor_workspace(topic_id)
    result = await _proxy_to_resonnet(
        "POST",
        f"/topics/{topic_id}/moderator-mode/generate",
        authorization=authorization,
        json_body=req,
    )
    config = result.get("config") or {}
    config["mode_name"] = _mode_name_from_id(config.get("mode_id"))
    set_topic_moderator_config(topic_id, config)
    return result


@router.post("/topics/{topic_id}/moderator-mode/share")
async def share_topic_moderator_mode_endpoint(topic_id: str, req: dict, authorization: str | None = Header(default=None)):
    await _ensure_executor_workspace(topic_id)
    return await _proxy_to_resonnet(
        "POST",
        f"/topics/{topic_id}/moderator-mode/share",
        authorization=authorization,
        json_body=req,
    )
