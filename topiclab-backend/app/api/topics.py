"""Topic, posts, discussion, and topic-scoped proxy APIs."""

from __future__ import annotations

import asyncio
import logging
import os
import time
from hashlib import sha256
from urllib.parse import quote
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

from app.api.auth import (
    build_openclaw_key_invalid_detail,
    build_openclaw_key_invalid_headers,
    security,
    verify_access_token,
    verify_openclaw_api_key,
)
from app.services.content_moderation import moderate_post_content
from app.services.resonnet_client import request_json
from app.services.source_feed_pipeline import fetch_source_feed_article_detail, hydrate_topic_workspace
from app.services.source_feed_role_generation import generate_roles_from_topic
from app.services.source_feed_topic_generation import (
    build_fallback_body,
    generate_topic_body_from_source_article,
)
from app.services.openclaw_runtime import apply_rule_points, record_activity_event
from app.storage.database.postgres_client import get_db_session
from app.storage.database.topic_store import (
    check_and_reset_stale_running_discussion,
    DEFAULT_MODERATOR_MODE,
    DEFAULT_TOPIC_EXPERT_NAMES,
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
    get_source_pic_url_by_topic_ids,
    get_source_feed_name_by_topic_ids,
    get_topic_origin_by_ids,
    get_topic,
    get_topic_id_by_source_article,
    is_topic_from_source,
    get_topic_moderator_config,
    get_post_thread,
    hash_post_delete_token,
    link_source_article_to_topic,
    list_all_posts,
    list_favorite_categories,
    list_favorite_category_items,
    list_recent_favorites,
    list_post_inbox_messages,
    list_post_replies,
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
    mark_all_post_inbox_messages_read,
    mark_post_inbox_message_read,
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
_STATUS_CACHE_TTL_SECONDS = float(os.getenv("DISCUSSION_STATUS_CACHE_TTL_SECONDS", "1.5"))
_status_cache: dict[str, tuple[float, dict]] = {}


def _invalidate_status_cache(topic_id: str) -> None:
    _status_cache.pop(topic_id, None)

TOPIC_CATEGORIES = [
    {"id": "plaza", "name": "广场", "description": "适合公开发起、泛讨论和社区互动的话题。", "profile_id": "community_dialogue"},
    {"id": "test", "name": "测试", "description": "适合联调、验收、压测、功能验证和其他测试类帖子。", "profile_id": "testing_board"},
    {"id": "thought", "name": "思考", "description": "适合观点整理、开放问题和长线思辨。", "profile_id": "critical_thinking"},
    {"id": "research", "name": "科研", "description": "适合论文、实验、方法和研究路线相关的话题。", "profile_id": "research_review"},
    {"id": "product", "name": "产品", "description": "适合功能设计、用户反馈和产品判断。", "profile_id": "product_review"},
    {"id": "app", "name": "应用", "description": "适合围绕应用、插件、工具能力与使用体验展开讨论。", "profile_id": "app_review"},
    {"id": "news", "name": "资讯", "description": "适合围绕最新动态、行业消息和热点展开讨论。", "profile_id": "news_analysis"},
    {"id": "request", "name": "需求", "description": "发布需求、寻找协作、对接资源，把想法变成合作。", "profile_id": "request_matching"},
]
TOPIC_CATEGORY_IDS = {item["id"] for item in TOPIC_CATEGORIES}
TOPIC_CATEGORY_MAP = {item["id"]: item for item in TOPIC_CATEGORIES}

TOPIC_CATEGORY_PROFILES = {
    "test": {
        "profile_id": "testing_board",
        "category": "test",
        "display_name": "测试板块参与策略",
        "objective": "快速说明测试目标、环境、预期结果和实际结果，减少歧义。",
        "tone": "直接、清晰、偏执行。",
        "reasoning_style": "先写测试对象和环境，再写步骤、结果、异常和需要确认的问题。",
        "evidence_requirement": "medium",
        "questioning_requirement": "medium",
        "post_style": "structured and reproducible",
        "reply_style": "confirm scope, environment, and observed result",
        "discussion_start_style": "state test goal, steps, expected result, and actual result up front",
        "default_actions": [
            "明确测试对象、环境和时间。",
            "列出复现步骤、预期结果和实际结果。",
            "如果是联调或验收，写清依赖方和阻塞点。",
        ],
        "avoid": [
            "不要把测试贴发到普通讨论板块。",
            "不要只写“测一下”而不给上下文。",
            "不要省略预期结果和实际结果的差异。",
        ],
        "output_structure": [
            "测试目标/对象",
            "环境与前置条件",
            "步骤",
            "预期结果与实际结果",
            "阻塞点或待确认问题",
        ],
    },
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
    "app": {
        "profile_id": "app_review",
        "category": "app",
        "display_name": "应用参与策略",
        "objective": "围绕应用或工具的用途、体验、能力边界与接入价值展开讨论。",
        "tone": "务实、清晰、面向真实使用。",
        "reasoning_style": "先说明应用解决什么问题，再讨论上手成本、实际表现、局限与适用场景。",
        "evidence_requirement": "medium",
        "questioning_requirement": "medium",
        "post_style": "experience-aware and evaluation-oriented",
        "reply_style": "use-case first with trade-offs",
        "discussion_start_style": "pin down use cases, setup cost, actual value, and limitations",
        "default_actions": [
            "先明确这是给谁、解决什么问题的应用。",
            "区分功能介绍、实际体验和长期使用价值。",
            "尽量给出适用场景、不适用场景和接入建议。",
        ],
        "avoid": [
            "不要只复述功能列表，不讨论实际使用。",
            "不要忽略安装、配置和维护成本。",
            "不要把单次体验直接等同于长期价值。",
        ],
        "output_structure": [
            "应用定位/场景",
            "能力与体验",
            "局限与门槛",
            "是否值得接入",
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
    "request": {
        "profile_id": "request_matching",
        "category": "request",
        "display_name": "需求匹配策略",
        "objective": "帮助发布需求、理解需求、匹配资源，促进协作对接。",
        "tone": "务实、具体、面向行动。",
        "reasoning_style": "先明确需求本质，再分析所需资源/能力，最后给出匹配建议或行动方案。",
        "evidence_requirement": "medium",
        "questioning_requirement": "strong",
        "post_style": "action-oriented and resource-aware",
        "reply_style": "clarify requirements before proposing solutions",
        "discussion_start_style": "extract core needs, identify required capabilities, suggest matching paths",
        "default_actions": [
            "先总结需求的核心目标和关键约束。",
            "主动追问缺少的信息（预算、时间、技术栈、交付标准等）。",
            "区分需求类型（技术开发、资源对接、合作协作、咨询服务等）。",
            "给出可执行的下一步建议（发布到哪些渠道、需要联系哪类专家、如何描述需求更清晰）。",
        ],
        "avoid": [
            "不要在需求不清晰时强行给解决方案。",
            "不要忽略预算、时间、能力等现实约束。",
            "不要把模糊想法当成可执行需求。",
        ],
        "output_structure": [
            "需求总结",
            "关键信息/约束",
            "资源/能力匹配",
            "行动建议",
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
    reply_post: dict | None = None
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
    """Override expert set: when provided, use these instead of topic.expert_names. Use for 'use built-in' vs 'use topic' choice."""
    expert_names: list[str] | None = None


class DiscussionSnapshotPushRequest(BaseModel):
    """Snapshot pushed by Resonnet executor during discussion (per-round sync)."""
    turns: list[dict] = Field(default_factory=list)
    turns_count: int = 0
    discussion_history: str = ""
    discussion_summary: str = ""
    generated_images: list[str] = Field(default_factory=list)


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


class EnsureSourceArticleTopicResponse(BaseModel):
    topic: dict[str, Any]
    created: bool


def _get_topiclab_sync_url() -> str | None:
    """URL for Resonnet to push discussion snapshot. Resonnet calls POST {url}/internal/discussion-snapshot/{topic_id}."""
    import os

    raw = os.getenv("TOPICLAB_SYNC_URL", "").strip()
    if raw:
        return raw.rstrip("/")
    return None


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
    token = credentials.credentials
    if token.startswith("tloc_"):
        user = verify_openclaw_api_key(token)
        if not user:
            raise HTTPException(
                status_code=401,
                detail=build_openclaw_key_invalid_detail(),
                headers=build_openclaw_key_invalid_headers(),
            )
        return user
    return verify_access_token(token)


def _resolve_author_name(requested_author: str, user: dict | None) -> str:
    if not user:
        return requested_author
    user_id = user.get("sub")
    if user_id is None:
        return requested_author
    actual = _row_user_name(int(user_id))
    if user.get("auth_type") == "openclaw_key":
        base_name = actual or user.get("username") or user.get("phone") or ""
        return f"{base_name}'s openclaw" if base_name else "openclaw"
    base_name = actual or requested_author or user.get("username") or user.get("phone") or ""
    return base_name


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


def _apply_thread_metadata(topic_id: str, post: dict, parent_post: dict | None) -> dict:
    if parent_post is None:
        post["root_post_id"] = post["id"]
        post["depth"] = 0
        return post
    post["in_reply_to_id"] = parent_post["id"]
    post["root_post_id"] = parent_post.get("root_post_id") or parent_post["id"]
    post["depth"] = int(parent_post.get("depth") or 0) + 1
    return post


def _topic_has_completed_discussion(topic: dict | None) -> bool:
    if not topic:
        return False
    if bool(topic.get("discussion_completed_once")):
        return True
    if topic.get("discussion_status") == "completed":
        return True
    result = topic.get("discussion_result") or {}
    return bool(result.get("completed_at"))


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


def _topic_has_ai_generated_experts(topic: dict) -> bool:
    """True if topic has any expert not in built-in set (i.e. uses AI-generated roles)."""
    names = topic.get("expert_names") or []
    builtin = set(DEFAULT_TOPIC_EXPERT_NAMES)
    return any(n not in builtin for n in names)


async def _ensure_executor_workspace(topic_id: str) -> dict:
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    use_ai_roles = is_topic_from_source(topic_id) or _topic_has_ai_generated_experts(topic)
    await request_json(
        "POST",
        "/executor/topics/bootstrap",
        json_body={
            "topic_id": topic["id"],
            "topic_title": topic["title"],
            "topic_body": topic["body"],
            "num_rounds": topic.get("num_rounds") or 5,
            "use_ai_generated_roles": use_ai_roles,
        },
        timeout=120.0,
    )
    return topic


async def _sync_topic_experts_from_resonnet(topic_id: str, authorization: str | None) -> list[dict]:
    """Sync experts from Resonnet to topiclab-backend DB.

    Preserves user-added experts by only replacing is_from_topic_creation=True experts.
    """
    await _ensure_executor_workspace(topic_id)
    experts = await _proxy_to_resonnet("GET", f"/topics/{topic_id}/experts", authorization=authorization)
    # Only replace experts that were created during topic creation, preserve user-added experts
    replace_topic_experts(topic_id, experts, only_replace_creation_roles=True)
    return experts


async def _sync_topic_mode_from_resonnet(topic_id: str, authorization: str | None) -> dict:
    await _ensure_executor_workspace(topic_id)
    config = await _proxy_to_resonnet("GET", f"/topics/{topic_id}/moderator-mode", authorization=authorization)
    config["mode_name"] = _mode_name_from_id(config.get("mode_id"))
    set_topic_moderator_config(topic_id, config)
    return config


def _guess_topic_category_from_source_article(article: dict[str, Any]) -> str:
    marker = " ".join([
        str(article.get("source_feed_name") or ""),
        str(article.get("source_type") or ""),
        str(article.get("url") or ""),
    ]).lower()
    if "arxiv" in marker or "paper" in marker or "preprint" in marker:
        return "research"
    return "news"


def _collect_generated_images(topic_id: str, asset_paths: list[str]) -> list[dict]:
    generated_images: list[dict] = []
    for asset_path in asset_paths:
        try:
            encoded = _encode_image_to_webp(_resolve_generated_image_path(topic_id, asset_path))
        except HTTPException:
            continue
        generated_images.append({"asset_path": asset_path, **encoded})
    return generated_images


def _apply_snapshot_to_db(topic_id: str, snapshot: dict) -> None:
    """Apply discussion snapshot to database. Used by both polling and push-from-executor."""
    turns = snapshot.get("turns") or []
    discussion_history = snapshot.get("discussion_history") or _build_discussion_history(turns)
    discussion_summary = snapshot.get("discussion_summary") or ""
    generated_images = _collect_generated_images(topic_id, snapshot.get("generated_images") or [])

    snapshot_has_content = bool(turns or discussion_history or discussion_summary)
    if not snapshot_has_content:
        existing = get_topic(topic_id)
        existing_result = existing.get("discussion_result") if existing else None
        if existing_result and (
            existing_result.get("discussion_history") or existing_result.get("discussion_summary")
        ):
            return

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
    _invalidate_status_cache(topic_id)


async def _sync_discussion_snapshot(topic_id: str) -> dict | None:
    try:
        snapshot = await request_json("GET", f"/executor/discussions/{topic_id}/snapshot", timeout=120.0)
    except Exception:
        return None

    _apply_snapshot_to_db(topic_id, snapshot)
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
        topic = get_topic(topic_id)
        if topic and topic.get("creator_openclaw_agent_id"):
            event = record_activity_event(
                openclaw_agent_id=int(topic["creator_openclaw_agent_id"]),
                bound_user_id=topic.get("creator_user_id"),
                event_type="discussion.completed",
                action_name="discussion_completed",
                target_type="topic",
                target_id=topic_id,
                route=f"/api/v1/topics/{topic_id}/discussion",
                success=True,
                status_code=200,
                payload={"turns_count": result.get("turns_count") or len(turns)},
                result={"completed_at": result.get("completed_at")},
            )
            apply_rule_points(
                openclaw_agent_id=int(topic["creator_openclaw_agent_id"]),
                reason_code="discussion.completed",
                related_event_id=int(event["id"]),
                target_type="topic",
                target_id=topic_id,
            )
        _invalidate_status_cache(topic_id)
    except Exception as exc:
        logging.getLogger(__name__).exception(
            "Discussion failed for topic %s: %s", topic_id, exc
        )
        set_discussion_status(topic_id, "failed")
        topic = get_topic(topic_id)
        if topic and topic.get("creator_openclaw_agent_id"):
            record_activity_event(
                openclaw_agent_id=int(topic["creator_openclaw_agent_id"]),
                bound_user_id=topic.get("creator_user_id"),
                event_type="discussion.failed",
                action_name="discussion_failed",
                target_type="topic",
                target_id=topic_id,
                route=f"/api/v1/topics/{topic_id}/discussion",
                success=False,
                status_code=500,
                error_code="discussion_failed",
                payload={},
                result={},
            )
        _invalidate_status_cache(topic_id)


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
def get_topics(
    category: str | None = Query(default=None),
    q: str | None = Query(default=None, description="Search topic title/body"),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    user: dict | None = Depends(_get_optional_user),
):
    user_id, auth_type = _resolve_owner_identity(user)
    payload = list_topics(
        category=_normalize_topic_category(category),
        q=q,
        cursor=cursor,
        limit=limit,
        user_id=user_id,
        auth_type=auth_type,
    )
    items = payload.get("items") or []
    if items:
        pic_map = get_source_pic_url_by_topic_ids([t["id"] for t in items])
        source_name_map = get_source_feed_name_by_topic_ids([t["id"] for t in items])
        origin_map = get_topic_origin_by_ids([t["id"] for t in items])
        out = []
        for t in items:
            row = dict(t)
            pic = pic_map.get(t["id"])
            row["source_preview_image"] = f"/api/source-feed/image?url={quote(pic, safe='')}" if pic else None
            row["source_feed_name"] = source_name_map.get(t["id"]) or None
            row["topic_origin"] = origin_map.get(t["id"])
            out.append(row)
        payload = {"items": out, "next_cursor": payload.get("next_cursor")}
    return payload


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
    creator_openclaw_agent_id = None
    if user:
        raw_user_id = user.get("sub")
        if raw_user_id is not None:
            creator_user_id = int(raw_user_id)
        creator_name = _resolve_author_name("", user) or user.get("username") or user.get("phone")
        creator_auth_type = user.get("auth_type", "jwt")
        if creator_auth_type == "openclaw_key":
            creator_openclaw_agent_id = int(user["openclaw_agent_id"])
    topic = create_topic(
        data.title,
        data.body,
        category,
        creator_user_id=creator_user_id,
        creator_name=creator_name,
        creator_auth_type=creator_auth_type,
        creator_openclaw_agent_id=creator_openclaw_agent_id,
    )
    if creator_openclaw_agent_id is not None:
        event = record_activity_event(
            openclaw_agent_id=creator_openclaw_agent_id,
            bound_user_id=creator_user_id,
            event_type="topic.created",
            action_name="create_topic",
            target_type="topic",
            target_id=topic["id"],
            route="/api/v1/topics",
            http_method="POST",
            success=True,
            status_code=201,
            payload=data.model_dump(),
            result={"topic_id": topic["id"]},
        )
        apply_rule_points(
            openclaw_agent_id=creator_openclaw_agent_id,
            reason_code="topic.created",
            related_event_id=int(event["id"]),
            target_type="topic",
            target_id=topic["id"],
        )
    return topic


async def _fill_topic_body_in_background(topic_id: str, article_dict: dict) -> None:
    """Background task: call LLM to generate full topic body and update the topic."""
    try:
        body = await generate_topic_body_from_source_article(article_dict)
        body_preview = extract_preview_image(body)
        if body_preview:
            update_topic(topic_id, {"body": body, "preview_image": body_preview})
        else:
            # No image in generated body; preserve existing preview_image (e.g. source article pic_url)
            current = get_topic(topic_id)
            existing_preview = current.get("preview_image") if current else None
            update_topic(topic_id, {"body": body, "preview_image": existing_preview})
    except Exception:
        pass


@router.post("/source-articles/{article_id}/topic", response_model=EnsureSourceArticleTopicResponse)
async def ensure_source_article_topic_endpoint(
    article_id: int,
    user: dict | None = Depends(_get_optional_user),
):
    user_id, auth_type = _resolve_owner_identity(user)
    existing_topic_id = get_topic_id_by_source_article(article_id)
    if existing_topic_id:
        await _ensure_executor_workspace(existing_topic_id)
        await hydrate_topic_workspace(existing_topic_id, [article_id])
        topic = get_topic(existing_topic_id, user_id=user_id, auth_type=auth_type)
        if topic is None:
            raise HTTPException(status_code=404, detail="Topic not found")
        return {"topic": topic, "created": False}

    article = await fetch_source_feed_article_detail(article_id)

    # Create topic immediately with fallback body; LLM generation runs in background.
    initial_body = build_fallback_body(article.__dict__)
    topic = create_topic(
        article.title or f"信源 {article_id}",
        initial_body,
        _guess_topic_category_from_source_article(article.__dict__),
    )
    linked_topic_id = link_source_article_to_topic(
        article.id,
        topic["id"],
        title=article.title,
        source_feed_name=article.source_feed_name,
        source_type=article.source_type,
        url=article.url,
        pic_url=article.pic_url,
    )
    created = True
    if linked_topic_id != topic["id"]:
        created = False
        delete_topic(topic["id"])

    if created and article.pic_url:
        preview_url = f"/api/source-feed/image?url={quote(article.pic_url, safe='')}"
        update_topic(linked_topic_id, {"preview_image": preview_url})

    await _ensure_executor_workspace(linked_topic_id)
    await hydrate_topic_workspace(linked_topic_id, [article.id])
    resolved_topic = get_topic(linked_topic_id, user_id=user_id, auth_type=auth_type)
    if resolved_topic is None:
        raise HTTPException(status_code=404, detail="Topic not found")
    asyncio.create_task(_fill_topic_body_in_background(linked_topic_id, article.__dict__))
    return {"topic": resolved_topic, "created": created}


@router.get("/topics/{topic_id}")
def get_topic_endpoint(topic_id: str, user: dict | None = Depends(_get_optional_user)):
    user_id, auth_type = _resolve_owner_identity(user)
    topic = get_topic(topic_id, user_id=user_id, auth_type=auth_type)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    return topic


@router.get("/topics/{topic_id}/bundle")
async def get_topic_bundle_endpoint(
    topic_id: str,
    user: dict | None = Depends(_get_optional_user),
    authorization: str | None = Header(default=None),
):
    user_id, auth_type = _resolve_owner_identity(user)
    topic = get_topic(topic_id, user_id=user_id, auth_type=auth_type)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    posts = list_posts(topic_id, user_id=user_id, auth_type=auth_type, preview_replies=0)
    experts = await _sync_topic_experts_from_resonnet(topic_id, authorization)
    return {
        "topic": topic,
        "posts": posts,
        "experts": experts,
    }


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
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    user_id, auth_type = _require_owner_identity(user)
    previous = bool((get_topic(topic_id, user_id=user_id, auth_type=auth_type) or {}).get("interaction", {}).get("liked"))
    interaction = set_topic_user_action(topic_id, user_id=user_id, auth_type=auth_type, liked=req.enabled)
    if user and user.get("auth_type") == "openclaw_key":
        record_activity_event(
            openclaw_agent_id=int(user["openclaw_agent_id"]),
            bound_user_id=user_id,
            event_type="interaction.topic_liked",
            action_name="like_topic",
            target_type="topic",
            target_id=topic_id,
            route=f"/api/v1/topics/{topic_id}/like",
            http_method="POST",
            success=True,
            status_code=200,
            payload={"enabled": req.enabled},
            result=interaction,
        )
    if req.enabled and not previous and topic.get("creator_openclaw_agent_id"):
        actor_agent_id = int(user["openclaw_agent_id"]) if user and user.get("auth_type") == "openclaw_key" else None
        if int(topic["creator_openclaw_agent_id"]) != actor_agent_id:
            event = record_activity_event(
                openclaw_agent_id=int(topic["creator_openclaw_agent_id"]),
                bound_user_id=topic.get("creator_user_id"),
                event_type="interaction.topic_liked.received",
                action_name="topic_like_received",
                target_type="topic",
                target_id=topic_id,
                success=True,
                status_code=200,
                payload={"actor_auth_type": auth_type},
                result={},
            )
            apply_rule_points(
                openclaw_agent_id=int(topic["creator_openclaw_agent_id"]),
                reason_code="topic.liked.received",
                related_event_id=int(event["id"]),
                target_type="topic",
                target_id=topic_id,
            )
    return interaction


@router.post("/topics/{topic_id}/favorite")
def favorite_topic_endpoint(
    topic_id: str,
    req: ToggleActionRequest,
    user: dict | None = Depends(_get_optional_user),
):
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    user_id, auth_type = _require_owner_identity(user)
    previous = bool((get_topic(topic_id, user_id=user_id, auth_type=auth_type) or {}).get("interaction", {}).get("favorited"))
    interaction = set_topic_user_action(topic_id, user_id=user_id, auth_type=auth_type, favorited=req.enabled)
    if user and user.get("auth_type") == "openclaw_key":
        record_activity_event(
            openclaw_agent_id=int(user["openclaw_agent_id"]),
            bound_user_id=user_id,
            event_type="interaction.topic_favorited",
            action_name="favorite_topic",
            target_type="topic",
            target_id=topic_id,
            route=f"/api/v1/topics/{topic_id}/favorite",
            http_method="POST",
            success=True,
            status_code=200,
            payload={"enabled": req.enabled},
            result=interaction,
        )
    if req.enabled and not previous and topic.get("creator_openclaw_agent_id"):
        actor_agent_id = int(user["openclaw_agent_id"]) if user and user.get("auth_type") == "openclaw_key" else None
        if int(topic["creator_openclaw_agent_id"]) != actor_agent_id:
            event = record_activity_event(
                openclaw_agent_id=int(topic["creator_openclaw_agent_id"]),
                bound_user_id=topic.get("creator_user_id"),
                event_type="interaction.topic_favorited.received",
                action_name="topic_favorite_received",
                target_type="topic",
                target_id=topic_id,
                success=True,
                status_code=200,
                payload={"actor_auth_type": auth_type},
                result={},
            )
            apply_rule_points(
                openclaw_agent_id=int(topic["creator_openclaw_agent_id"]),
                reason_code="topic.favorited.received",
                related_event_id=int(event["id"]),
                target_type="topic",
                target_id=topic_id,
            )
    return interaction


@router.post("/topics/{topic_id}/share")
def share_topic_endpoint(
    topic_id: str,
    user: dict | None = Depends(_get_optional_user),
):
    if not get_topic(topic_id):
        raise HTTPException(status_code=404, detail="Topic not found")
    user_id, auth_type = _resolve_owner_identity(user)
    interaction = record_topic_share(topic_id, user_id=user_id, auth_type=auth_type)
    if user and user.get("auth_type") == "openclaw_key":
        record_activity_event(
            openclaw_agent_id=int(user["openclaw_agent_id"]),
            bound_user_id=user_id,
            event_type="interaction.topic_shared",
            action_name="share_topic",
            target_type="topic",
            target_id=topic_id,
            route=f"/api/v1/topics/{topic_id}/share",
            http_method="POST",
            success=True,
            status_code=200,
            payload={},
            result=interaction,
        )
    return interaction


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


@router.get("/me/favorite-categories/{category_id}/items")
def list_my_favorite_category_items_endpoint(
    category_id: str,
    type: str = Query(default="topics", pattern="^(topics|sources)$"),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    user: dict | None = Depends(_get_optional_user),
):
    user_id, auth_type = _require_owner_identity(user)
    category = get_favorite_category(category_id, user_id=user_id, auth_type=auth_type)
    if not category:
        raise HTTPException(status_code=404, detail="收藏分类不存在")
    return list_favorite_category_items(
        category_id,
        item_type=type,
        cursor=cursor,
        limit=limit,
        user_id=user_id,
        auth_type=auth_type,
    )


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


@router.get("/me/favorites/recent")
def get_recent_favorites_endpoint(
    type: str = Query(default="topics", pattern="^(topics|sources)$"),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    user: dict | None = Depends(_get_optional_user),
):
    user_id, auth_type = _require_owner_identity(user)
    return list_recent_favorites(
        item_type=type,
        cursor=cursor,
        limit=limit,
        user_id=user_id,
        auth_type=auth_type,
    )


@router.get("/me/inbox")
def list_my_inbox_endpoint(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: dict | None = Depends(_get_optional_user),
):
    user_id, _ = _require_owner_identity(user)
    return list_post_inbox_messages(user_id=user_id, limit=limit, offset=offset)


@router.post("/me/inbox/read-all")
def mark_all_my_inbox_messages_read_endpoint(user: dict | None = Depends(_get_optional_user)):
    user_id, _ = _require_owner_identity(user)
    updated_count = mark_all_post_inbox_messages_read(user_id=user_id)
    return {"ok": True, "updated_count": updated_count}


@router.post("/me/inbox/{message_id}/read")
def mark_my_inbox_message_read_endpoint(message_id: str, user: dict | None = Depends(_get_optional_user)):
    user_id, _ = _require_owner_identity(user)
    updated = mark_post_inbox_message_read(message_id, user_id=user_id)
    if not updated:
        raise HTTPException(status_code=404, detail="消息不存在")
    return {"ok": True, "message_id": message_id}


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
def list_posts_endpoint(
    topic_id: str,
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    preview_replies: int = Query(default=0, ge=0, le=5),
    user: dict | None = Depends(_get_optional_user),
):
    user_id, auth_type = _resolve_owner_identity(user)
    topic = get_topic(topic_id, user_id=user_id, auth_type=auth_type)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    return list_posts(
        topic_id,
        cursor=cursor,
        limit=limit,
        preview_replies=preview_replies,
        user_id=user_id,
        auth_type=auth_type,
    )


@router.get("/topics/{topic_id}/posts/{post_id}/replies")
def list_post_replies_endpoint(
    topic_id: str,
    post_id: str,
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    user: dict | None = Depends(_get_optional_user),
):
    user_id, auth_type = _resolve_owner_identity(user)
    if not get_topic(topic_id, user_id=user_id, auth_type=auth_type):
        raise HTTPException(status_code=404, detail="Topic not found")
    if not get_post(topic_id, post_id, user_id=user_id, auth_type=auth_type):
        raise HTTPException(status_code=404, detail="Post not found")
    return list_post_replies(
        topic_id,
        post_id,
        cursor=cursor,
        limit=limit,
        user_id=user_id,
        auth_type=auth_type,
    )


@router.get("/topics/{topic_id}/posts/{post_id}/thread")
def get_post_thread_endpoint(
    topic_id: str,
    post_id: str,
    user: dict | None = Depends(_get_optional_user),
):
    user_id, auth_type = _resolve_owner_identity(user)
    if not get_topic(topic_id, user_id=user_id, auth_type=auth_type):
        raise HTTPException(status_code=404, detail="Topic not found")
    if not get_post(topic_id, post_id, user_id=user_id, auth_type=auth_type):
        raise HTTPException(status_code=404, detail="Post not found")
    return {"items": get_post_thread(topic_id, post_id, user_id=user_id, auth_type=auth_type)}


@router.post("/topics/{topic_id}/posts", status_code=201)
async def create_post_endpoint(topic_id: str, req: CreatePostRequest, user: dict | None = Depends(_get_optional_user)):
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    await _moderate_or_raise(req.body, scenario="topic_post")
    author_name = _resolve_author_name(req.author, user)
    owner_user_id, owner_auth_type = _resolve_owner_identity(user)
    owner_openclaw_agent_id = int(user["openclaw_agent_id"]) if user and user.get("auth_type") == "openclaw_key" else None
    parent_post = None
    if req.in_reply_to_id:
        parent_post = get_post(topic_id, req.in_reply_to_id)
        if not parent_post:
            raise HTTPException(status_code=404, detail="Parent post not found")
    raw_delete_token = generate_post_delete_token()
    post = _apply_thread_metadata(topic_id, make_post(
        topic_id=topic_id,
        author=author_name,
        author_type="human",
        body=req.body,
        in_reply_to_id=req.in_reply_to_id,
        status="completed",
        owner_user_id=owner_user_id,
        owner_auth_type=owner_auth_type,
        owner_openclaw_agent_id=owner_openclaw_agent_id,
        delete_token_hash=hash_post_delete_token(raw_delete_token),
    ), parent_post)
    saved = upsert_post(post)
    saved["delete_token"] = raw_delete_token
    if owner_openclaw_agent_id is not None:
        event = record_activity_event(
            openclaw_agent_id=owner_openclaw_agent_id,
            bound_user_id=owner_user_id,
            event_type="post.replied" if req.in_reply_to_id else "post.created",
            action_name="create_post",
            target_type="post",
            target_id=saved["id"],
            route=f"/api/v1/topics/{topic_id}/posts",
            http_method="POST",
            success=True,
            status_code=201,
            payload=req.model_dump(),
            result={"post_id": saved["id"]},
        )
        apply_rule_points(
            openclaw_agent_id=owner_openclaw_agent_id,
            reason_code="post.created",
            related_event_id=int(event["id"]),
            target_type="post",
            target_id=saved["id"],
        )
    return {"post": saved, "parent_post": get_post(topic_id, req.in_reply_to_id) if req.in_reply_to_id else None}


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
    check_and_reset_stale_running_discussion(topic_id)
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    if topic["discussion_status"] == "running":
        raise HTTPException(status_code=409, detail="Discussion is running; wait for it to finish before @mentioning experts")
    if not _topic_has_completed_discussion(topic):
        raise HTTPException(
            status_code=409,
            detail="Discussion must complete at least once before @mentioning experts",
        )

    expert_map = {expert["name"]: expert for expert in list_topic_experts(topic_id)}
    expert = expert_map.get(req.expert_name)
    if expert is None:
        raise HTTPException(status_code=400, detail=f"Expert '{req.expert_name}' is not in this topic")

    author_name = _resolve_author_name(req.author, user)
    owner_user_id, owner_auth_type = _resolve_owner_identity(user)
    owner_openclaw_agent_id = int(user["openclaw_agent_id"]) if user and user.get("auth_type") == "openclaw_key" else None
    parent_post = None
    if req.in_reply_to_id:
        parent_post = get_post(topic_id, req.in_reply_to_id)
        if not parent_post:
            raise HTTPException(status_code=404, detail="Parent post not found")
    raw_delete_token = generate_post_delete_token()
    user_post = upsert_post(
        _apply_thread_metadata(topic_id, make_post(
            topic_id=topic_id,
            author=author_name,
            author_type="human",
            body=req.body,
            in_reply_to_id=req.in_reply_to_id,
            status="completed",
            owner_user_id=owner_user_id,
            owner_auth_type=owner_auth_type,
            owner_openclaw_agent_id=owner_openclaw_agent_id,
            delete_token_hash=hash_post_delete_token(raw_delete_token),
        ), parent_post)
    )
    user_post["delete_token"] = raw_delete_token
    reply_post = upsert_post(
        _apply_thread_metadata(topic_id, make_post(
            topic_id=topic_id,
            author=req.expert_name,
            author_type="agent",
            body="",
            expert_name=req.expert_name,
            expert_label=expert.get("label", req.expert_name),
            in_reply_to_id=user_post["id"],
            status="pending",
        ), user_post)
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
        "posts_context": _build_posts_context(list_all_posts(topic_id)),
    }
    if owner_openclaw_agent_id is not None:
        record_activity_event(
            openclaw_agent_id=owner_openclaw_agent_id,
            bound_user_id=owner_user_id,
            event_type="post.mentioned_expert",
            action_name="mention_expert",
            target_type="post",
            target_id=user_post["id"],
            route=f"/api/v1/topics/{topic_id}/posts/mention",
            http_method="POST",
            success=True,
            status_code=202,
            payload=req.model_dump(),
            result={"reply_post_id": reply_post["id"]},
        )
    asyncio.create_task(_run_expert_reply_background(topic_id, reply_post["id"], payload))
    return MentionExpertResponse(user_post=user_post, reply_post=reply_post, reply_post_id=reply_post["id"], status="pending")


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
    post = get_post(topic_id, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    user_id, auth_type = _require_owner_identity(user)
    previous = bool((get_post(topic_id, post_id, user_id=user_id, auth_type=auth_type) or {}).get("interaction", {}).get("liked"))
    interaction = set_post_user_action(topic_id, post_id, user_id=user_id, auth_type=auth_type, liked=req.enabled)
    if user and user.get("auth_type") == "openclaw_key":
        record_activity_event(
            openclaw_agent_id=int(user["openclaw_agent_id"]),
            bound_user_id=user_id,
            event_type="interaction.post_liked",
            action_name="like_post",
            target_type="post",
            target_id=post_id,
            route=f"/api/v1/topics/{topic_id}/posts/{post_id}/like",
            http_method="POST",
            success=True,
            status_code=200,
            payload={"enabled": req.enabled},
            result=interaction,
        )
    if req.enabled and not previous and post.get("owner_openclaw_agent_id"):
        actor_agent_id = int(user["openclaw_agent_id"]) if user and user.get("auth_type") == "openclaw_key" else None
        if int(post["owner_openclaw_agent_id"]) != actor_agent_id:
            event = record_activity_event(
                openclaw_agent_id=int(post["owner_openclaw_agent_id"]),
                bound_user_id=post.get("owner_user_id"),
                event_type="interaction.post_liked.received",
                action_name="post_like_received",
                target_type="post",
                target_id=post_id,
                success=True,
                status_code=200,
                payload={"actor_auth_type": auth_type},
                result={},
            )
            apply_rule_points(
                openclaw_agent_id=int(post["owner_openclaw_agent_id"]),
                reason_code="post.liked.received",
                related_event_id=int(event["id"]),
                target_type="post",
                target_id=post_id,
            )
    return interaction


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
    interaction = record_post_share(topic_id, post_id, user_id=user_id, auth_type=auth_type)
    if user and user.get("auth_type") == "openclaw_key":
        record_activity_event(
            openclaw_agent_id=int(user["openclaw_agent_id"]),
            bound_user_id=user_id,
            event_type="interaction.post_shared",
            action_name="share_post",
            target_type="post",
            target_id=post_id,
            route=f"/api/v1/topics/{topic_id}/posts/{post_id}/share",
            http_method="POST",
            success=True,
            status_code=200,
            payload={},
            result=interaction,
        )
    return interaction


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


@router.post("/internal/discussion-snapshot/{topic_id}", status_code=204)
def push_discussion_snapshot_endpoint(topic_id: str, req: DiscussionSnapshotPushRequest):
    """Receive snapshot from Resonnet executor during discussion. Updates DB per-round."""
    _invalidate_status_cache(topic_id)
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    snapshot = {
        "turns": req.turns,
        "turns_count": req.turns_count or len(req.turns),
        "discussion_history": req.discussion_history,
        "discussion_summary": req.discussion_summary,
        "generated_images": req.generated_images,
    }
    _apply_snapshot_to_db(topic_id, snapshot)
    return Response(status_code=204)


@router.post("/topics/{topic_id}/discussion", status_code=202)
async def start_discussion_endpoint(topic_id: str, req: StartDiscussionRequest):
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    check_and_reset_stale_running_discussion(topic_id)
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    if topic["discussion_status"] == "running":
        raise HTTPException(status_code=400, detail="Discussion already running")

    # Sync experts from Resonnet before starting discussion to include user-added experts
    await _sync_topic_experts_from_resonnet(topic_id, None)
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    topic_config = get_topic_moderator_config(topic_id) or DEFAULT_MODERATOR_MODE
    num_rounds = int(topic_config.get("num_rounds") or topic["num_rounds"] or req.num_rounds)
    updated = update_topic(topic_id, {"num_rounds": num_rounds})
    if not updated:
        raise HTTPException(status_code=404, detail="Topic not found")
    set_discussion_status(topic_id, "running", turns_count=0, discussion_summary="", discussion_history="")
    expert_names = req.expert_names if req.expert_names is not None else topic["expert_names"]
    payload = {
        "topic_id": topic_id,
        "topic_title": topic["title"],
        "topic_body": topic["body"],
        "num_rounds": num_rounds,
        "expert_names": expert_names,
        "max_turns": req.max_turns,
        "max_budget_usd": req.max_budget_usd,
        "model": req.model or topic_config.get("model"),
        "allowed_tools": req.allowed_tools,
        "skill_list": req.skill_list if req.skill_list is not None else topic_config.get("skill_list", []),
        "mcp_server_ids": req.mcp_server_ids if req.mcp_server_ids is not None else topic_config.get("mcp_server_ids", []),
        "posts_context": _build_posts_context(list_all_posts(topic_id)),
    }
    sync_url = _get_topiclab_sync_url()
    if sync_url:
        payload["topiclab_sync_url"] = sync_url
    asyncio.create_task(_run_discussion_background(topic_id, payload))
    if topic.get("creator_openclaw_agent_id"):
        record_activity_event(
            openclaw_agent_id=int(topic["creator_openclaw_agent_id"]),
            bound_user_id=topic.get("creator_user_id"),
            event_type="discussion.started",
            action_name="start_discussion",
            target_type="topic",
            target_id=topic_id,
            route=f"/api/v1/topics/{topic_id}/discussion",
            http_method="POST",
            success=True,
            status_code=202,
            payload={"num_rounds": num_rounds},
            result={"status": "running"},
        )
    return {"status": "running", "result": None, "progress": None}


@router.post("/topics/{topic_id}/discussion/cancel", status_code=200)
def cancel_discussion_endpoint(topic_id: str):
    """Fail-safe: cancel a stuck running discussion so @mention can be used again."""
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    if topic["discussion_status"] != "running":
        raise HTTPException(
            status_code=400,
            detail=f"Discussion is not running (current: {topic['discussion_status']}); nothing to cancel",
        )
    set_discussion_status(topic_id, "failed")
    if topic.get("creator_openclaw_agent_id"):
        record_activity_event(
            openclaw_agent_id=int(topic["creator_openclaw_agent_id"]),
            bound_user_id=topic.get("creator_user_id"),
            event_type="discussion.cancelled",
            action_name="cancel_discussion",
            target_type="topic",
            target_id=topic_id,
            route=f"/api/v1/topics/{topic_id}/discussion/cancel",
            http_method="POST",
            success=True,
            status_code=200,
            payload={},
            result={"status": "failed"},
        )
    _invalidate_status_cache(topic_id)
    return {"status": "failed", "result": topic.get("discussion_result"), "progress": None}


@router.get("/topics/{topic_id}/discussion/status")
async def get_discussion_status_endpoint(topic_id: str):
    now = time.time()
    cached = _status_cache.get(topic_id)
    if cached is not None:
        expires_at, payload = cached
        if expires_at > now:
            return payload

    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    check_and_reset_stale_running_discussion(topic_id)
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    if topic["discussion_status"] == "running":
        # When TOPICLAB_SYNC_URL is set, Resonnet pushes snapshot per-round; skip polling
        # to avoid redundant HTTP calls and DB writes (reduces load by ~50 req/min).
        if not _get_topiclab_sync_url():
            await _sync_discussion_snapshot(topic_id)
        topic = get_topic(topic_id)
        if not topic:
            raise HTTPException(status_code=404, detail="Topic not found")

    progress = None
    if topic["discussion_status"] == "running":
        progress = _discussion_progress_from_turns(topic, list_discussion_turns(topic_id))
    payload = {"status": topic["discussion_status"], "result": topic.get("discussion_result"), "progress": progress}
    if topic["discussion_status"] == "running" and _STATUS_CACHE_TTL_SECONDS > 0:
        _status_cache[topic_id] = (now + _STATUS_CACHE_TTL_SECONDS, payload)
    return payload


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


async def _generate_and_replace_experts_background(topic_id: str) -> None:
    """Background task: generate 4 roles via AI, replace topic creation roles, preserve user-added experts."""
    topic = get_topic(topic_id)
    if not topic:
        return
    roles = await generate_roles_from_topic(
        topic.get("title", ""),
        topic.get("body", ""),
    )
    if not roles:
        return
    try:
        await request_json(
            "POST",
            f"/executor/topics/{topic_id}/experts/replace",
            json_body={"experts": roles},
            timeout=60.0,
        )
    except Exception:
        return
    # Only replace roles that were created during topic creation, preserve user-added experts
    replace_topic_experts(
        topic_id,
        [
            {
                "name": r["name"],
                "label": r["label"],
                "description": r["description"],
                "source": "ai_generated",
                "is_from_topic_creation": True,
            }
            for r in roles
        ],
        only_replace_creation_roles=True,
    )


@router.post("/topics/{topic_id}/experts/generate-from-topic", status_code=202)
async def generate_experts_from_topic_endpoint(topic_id: str, authorization: str | None = Header(default=None)):
    """Start async generation of 4 discussion roles. Returns 202 immediately; poll GET /topics/{id} for expert_names."""
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    asyncio.create_task(_generate_and_replace_experts_background(topic_id))
    return {"status": "accepted", "message": "角色生成已启动，请稍候"}


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
