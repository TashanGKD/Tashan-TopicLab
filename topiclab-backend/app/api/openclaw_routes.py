"""OpenClaw-dedicated write routes.

These routes require a valid OpenClaw key and derive the acting identity
from the bound OpenClaw agent. JWT is rejected on these routes.
"""

from __future__ import annotations

import asyncio
import logging
import re
from pydantic import BaseModel, Field

from fastapi import APIRouter, Depends, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials

from app.api.auth import (
    build_openclaw_key_invalid_detail,
    build_openclaw_key_invalid_headers,
    security,
    verify_openclaw_api_key,
)
from app.services.openclaw_runtime import apply_rule_points, record_activity_event
from app.api.topics import (
    MentionExpertResponse,
    _apply_thread_metadata,
    _build_posts_context,
    _moderate_or_raise,
    _normalize_topic_category,
    _resolve_author_name,
    _run_expert_reply_background,
)
from app.services.oss_upload import get_signed_media_url, upload_comment_media_to_oss
from app.storage.database.topic_store import (
    check_and_reset_stale_running_discussion,
    create_topic,
    generate_post_delete_token,
    get_post,
    get_topic,
    hash_post_delete_token,
    list_all_posts,
    list_topic_experts,
    make_post,
    upsert_post,
)

router = APIRouter(prefix="/openclaw", tags=["openclaw-dedicated"])
logger = logging.getLogger(__name__)
TEST_TOPIC_PATTERN = re.compile(r"(?:^|[\s\-_])(test|testing|debug|qa|e2e|smoke)(?:$|[\s\-_])|测试|联调|验收|压测|回归|冒烟|调试", re.IGNORECASE)


class OpenClawTopicCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    body: str = ""
    category: str = Field(default="plaza")


class OpenClawCreatePostRequest(BaseModel):
    body: str = Field(..., min_length=1)
    in_reply_to_id: str | None = None


class OpenClawMentionRequest(BaseModel):
    body: str = Field(..., min_length=1)
    expert_name: str = Field(..., min_length=1)
    in_reply_to_id: str | None = None


class OpenClawMediaUploadResponse(BaseModel):
    url: str
    markdown: str
    object_key: str
    content_type: str
    media_type: str
    width: int
    height: int
    size_bytes: int


async def _get_openclaw_actor(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict | None:
    if not credentials:
        raise HTTPException(status_code=401, detail="OpenClaw key required")
    token = credentials.credentials
    if not token.startswith("tloc_"):
        raise HTTPException(status_code=401, detail="OpenClaw dedicated routes only accept OpenClaw key, not JWT")
    user = verify_openclaw_api_key(token)
    if not user:
        raise HTTPException(
            status_code=401,
            detail=build_openclaw_key_invalid_detail(),
            headers=build_openclaw_key_invalid_headers(),
        )
    return user


def _resolve_openclaw_author_identity(user: dict) -> tuple[str, int, str, int]:
    owner_user_id = int(user["sub"])
    author_name = _resolve_author_name("", user) or "openclaw"
    return author_name, owner_user_id, "openclaw_key", int(user["openclaw_agent_id"])


def _openclaw_agent_summary(user: dict) -> dict:
    return {
        "agent_uid": user.get("agent_uid"),
        "display_name": user.get("openclaw_display_name"),
        "handle": user.get("openclaw_handle"),
        "openclaw_agent_id": int(user["openclaw_agent_id"]),
    }


def _looks_like_test_topic(title: str, body: str) -> bool:
    sample = f"{title}\n{body}"
    return bool(TEST_TOPIC_PATTERN.search(sample))


def _resolve_openclaw_topic_category(title: str, body: str, requested_category: str | None) -> str:
    normalized = _normalize_topic_category(requested_category)
    if _looks_like_test_topic(title, body):
        return "test"
    return normalized or "plaza"


@router.post("/topics", status_code=201)
async def create_topic_openclaw(
    request: Request,
    data: OpenClawTopicCreateRequest,
    user: dict | None = Depends(_get_openclaw_actor),
    user_agent: str | None = Header(default=None, alias="User-Agent"),
    x_forwarded_for: str | None = Header(default=None, alias="X-Forwarded-For"),
):
    category = _resolve_openclaw_topic_category(data.title, data.body, data.category)
    creator_name, creator_user_id, creator_auth_type, creator_openclaw_agent_id = _resolve_openclaw_author_identity(user)
    try:
        topic = create_topic(
            data.title,
            data.body,
            category,
            creator_user_id=creator_user_id,
            creator_name=creator_name,
            creator_auth_type=creator_auth_type,
            creator_openclaw_agent_id=creator_openclaw_agent_id,
        )
        event = record_activity_event(
            openclaw_agent_id=creator_openclaw_agent_id,
            bound_user_id=creator_user_id,
            event_type="topic.created",
            action_name="openclaw_create_topic",
            target_type="topic",
            target_id=topic["id"],
            http_method=request.method if request else "POST",
            route=request.url.path if request else "/api/v1/openclaw/topics",
            success=True,
            status_code=201,
            payload=data.model_dump(),
            result={"topic_id": topic["id"]},
            client_ip=x_forwarded_for,
            user_agent=user_agent,
        )
        apply_rule_points(
            openclaw_agent_id=creator_openclaw_agent_id,
            reason_code="topic.created",
            related_event_id=int(event["id"]),
            target_type="topic",
            target_id=topic["id"],
        )
        topic["openclaw_agent"] = _openclaw_agent_summary(user)
        return topic
    except HTTPException:
        record_activity_event(
            openclaw_agent_id=creator_openclaw_agent_id,
            bound_user_id=creator_user_id,
            event_type="topic.created",
            action_name="openclaw_create_topic",
            target_type="topic",
            target_id=None,
            http_method=request.method if request else "POST",
            route=request.url.path if request else "/api/v1/openclaw/topics",
            success=False,
            status_code=400,
            error_code="http_error",
            payload=data.model_dump(),
            result={},
            client_ip=x_forwarded_for,
            user_agent=user_agent,
        )
        raise


@router.post("/topics/{topic_id}/posts", status_code=201)
async def create_post_openclaw(
    request: Request,
    topic_id: str,
    req: OpenClawCreatePostRequest,
    user: dict | None = Depends(_get_openclaw_actor),
    user_agent: str | None = Header(default=None, alias="User-Agent"),
    x_forwarded_for: str | None = Header(default=None, alias="X-Forwarded-For"),
):
    author_name, owner_user_id, owner_auth_type, owner_openclaw_agent_id = _resolve_openclaw_author_identity(user)
    try:
        topic = get_topic(topic_id)
        if not topic:
            raise HTTPException(status_code=404, detail="Topic not found")
        await _moderate_or_raise(req.body, scenario="topic_post")
        parent_post = None
        if req.in_reply_to_id:
            parent_post = get_post(topic_id, req.in_reply_to_id)
            if not parent_post:
                raise HTTPException(status_code=404, detail="Parent post not found")
        raw_delete_token = generate_post_delete_token()
        post = _apply_thread_metadata(
            topic_id,
            make_post(
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
            ),
            parent_post,
        )
        saved = upsert_post(post)
        saved["delete_token"] = raw_delete_token
        event = record_activity_event(
            openclaw_agent_id=owner_openclaw_agent_id,
            bound_user_id=owner_user_id,
            event_type="post.replied" if req.in_reply_to_id else "post.created",
            action_name="openclaw_create_post",
            target_type="post",
            target_id=saved["id"],
            http_method=request.method if request else "POST",
            route=request.url.path if request else f"/api/v1/openclaw/topics/{topic_id}/posts",
            success=True,
            status_code=201,
            payload=req.model_dump(),
            result={"post_id": saved["id"], "topic_id": topic_id},
            client_ip=x_forwarded_for,
            user_agent=user_agent,
        )
        apply_rule_points(
            openclaw_agent_id=owner_openclaw_agent_id,
            reason_code="post.created",
            related_event_id=int(event["id"]),
            target_type="post",
            target_id=saved["id"],
        )
        return {
            "post": saved,
            "parent_post": get_post(topic_id, req.in_reply_to_id) if req.in_reply_to_id else None,
            "openclaw_agent": _openclaw_agent_summary(user),
        }
    except HTTPException as exc:
        record_activity_event(
            openclaw_agent_id=owner_openclaw_agent_id,
            bound_user_id=owner_user_id,
            event_type="post.replied" if req.in_reply_to_id else "post.created",
            action_name="openclaw_create_post",
            target_type="post",
            target_id=None,
            http_method=request.method if request else "POST",
            route=request.url.path if request else f"/api/v1/openclaw/topics/{topic_id}/posts",
            success=False,
            status_code=exc.status_code,
            error_code="http_error",
            payload=req.model_dump(),
            result={},
            client_ip=x_forwarded_for,
            user_agent=user_agent,
        )
        raise


@router.post("/topics/{topic_id}/media", response_model=OpenClawMediaUploadResponse)
async def upload_comment_media_openclaw(
    request: Request,
    topic_id: str,
    file: UploadFile = File(...),
    user: dict | None = Depends(_get_openclaw_actor),
    user_agent: str | None = Header(default=None, alias="User-Agent"),
    x_forwarded_for: str | None = Header(default=None, alias="X-Forwarded-For"),
):
    """Upload OpenClaw comment media via backend.

    Images are converted to webp. Videos are validated then uploaded as-is.
    """
    try:
        _, owner_user_id, _, owner_openclaw_agent_id = _resolve_openclaw_author_identity(user)
        topic = get_topic(topic_id)
        if not topic:
            raise HTTPException(status_code=404, detail="Topic not found")
        payload = await file.read()
        uploaded = upload_comment_media_to_oss(
            topic_id=topic_id,
            filename=file.filename or "media",
            content_type=file.content_type,
            payload=payload,
        )
        record_activity_event(
            openclaw_agent_id=owner_openclaw_agent_id,
            bound_user_id=owner_user_id,
            event_type="media.uploaded",
            action_name="openclaw_upload_media",
            target_type="topic",
            target_id=topic_id,
            http_method=request.method if request else "POST",
            route=request.url.path if request else f"/api/v1/openclaw/topics/{topic_id}/media",
            success=True,
            status_code=200,
            payload={"filename": file.filename, "content_type": file.content_type},
            result={"object_key": uploaded.get("object_key")},
            client_ip=x_forwarded_for,
            user_agent=user_agent,
        )
        return uploaded
    except HTTPException as exc:
        owner_user_id = int(user["sub"])
        owner_openclaw_agent_id = int(user["openclaw_agent_id"])
        record_activity_event(
            openclaw_agent_id=owner_openclaw_agent_id,
            bound_user_id=owner_user_id,
            event_type="media.uploaded",
            action_name="openclaw_upload_media",
            target_type="topic",
            target_id=topic_id,
            http_method=request.method if request else "POST",
            route=request.url.path if request else f"/api/v1/openclaw/topics/{topic_id}/media",
            success=False,
            status_code=exc.status_code,
            error_code="http_error",
            payload={"filename": file.filename, "content_type": file.content_type},
            result={},
            client_ip=x_forwarded_for,
            user_agent=user_agent,
        )
        raise
    except RuntimeError as exc:
        logger.exception("OSS comment media upload misconfigured for topic %s", topic_id)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Failed to upload OpenClaw comment media for topic %s", topic_id)
        raise HTTPException(status_code=502, detail="Failed to upload media") from exc


@router.post("/topics/{topic_id}/images", response_model=OpenClawMediaUploadResponse)
async def upload_comment_image_openclaw(
    topic_id: str,
    file: UploadFile = File(...),
    user: dict | None = Depends(_get_openclaw_actor),
):
    """Backward-compatible alias for media upload; still accepts images and videos."""
    return await upload_comment_media_openclaw(topic_id=topic_id, file=file, user=user)


@router.get("/media/{object_key:path}")
async def redirect_openclaw_media(object_key: str):
    """Return a short-lived signed OSS URL for comment media."""
    try:
        signed_url = get_signed_media_url(object_key)
    except RuntimeError as exc:
        logger.exception("OSS comment media signing misconfigured for object %s", object_key)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Failed to sign OpenClaw comment media for object %s", object_key)
        raise HTTPException(status_code=502, detail="Failed to sign media URL") from exc
    return RedirectResponse(url=signed_url, status_code=307)


@router.post("/topics/{topic_id}/posts/mention", status_code=202, response_model=MentionExpertResponse)
async def mention_expert_openclaw(
    request: Request,
    topic_id: str,
    req: OpenClawMentionRequest,
    user: dict | None = Depends(_get_openclaw_actor),
    user_agent: str | None = Header(default=None, alias="User-Agent"),
    x_forwarded_for: str | None = Header(default=None, alias="X-Forwarded-For"),
):
    author_name, owner_user_id, owner_auth_type, owner_openclaw_agent_id = _resolve_openclaw_author_identity(user)
    try:
        topic = get_topic(topic_id)
        if not topic:
            raise HTTPException(status_code=404, detail="Topic not found")
        await _moderate_or_raise(req.body, scenario="topic_post_mention")
        check_and_reset_stale_running_discussion(topic_id)
        topic = get_topic(topic_id)
        if not topic:
            raise HTTPException(status_code=404, detail="Topic not found")
        if topic["discussion_status"] == "running":
            raise HTTPException(
                status_code=409,
                detail="Discussion is running; wait for it to finish before @mentioning experts",
            )

        expert_map = {expert["name"]: expert for expert in list_topic_experts(topic_id)}
        expert = expert_map.get(req.expert_name)
        if expert is None:
            raise HTTPException(status_code=400, detail=f"Expert '{req.expert_name}' is not in this topic")

        parent_post = None
        if req.in_reply_to_id:
            parent_post = get_post(topic_id, req.in_reply_to_id)
            if not parent_post:
                raise HTTPException(status_code=404, detail="Parent post not found")
        raw_delete_token = generate_post_delete_token()
        user_post = upsert_post(
            _apply_thread_metadata(
                topic_id,
                make_post(
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
                ),
                parent_post,
            )
        )
        user_post["delete_token"] = raw_delete_token
        reply_post = upsert_post(
            _apply_thread_metadata(
                topic_id,
                make_post(
                    topic_id=topic_id,
                    author=req.expert_name,
                    author_type="agent",
                    body="",
                    expert_name=req.expert_name,
                    expert_label=expert.get("label", req.expert_name),
                    in_reply_to_id=user_post["id"],
                    status="pending",
                ),
                user_post,
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
            "posts_context": _build_posts_context(list_all_posts(topic_id)),
        }
        record_activity_event(
            openclaw_agent_id=owner_openclaw_agent_id,
            bound_user_id=owner_user_id,
            event_type="post.mentioned_expert",
            action_name="openclaw_mention_expert",
            target_type="post",
            target_id=user_post["id"],
            http_method=request.method if request else "POST",
            route=request.url.path if request else f"/api/v1/openclaw/topics/{topic_id}/posts/mention",
            success=True,
            status_code=202,
            payload=req.model_dump(),
            result={"reply_post_id": reply_post["id"]},
            client_ip=x_forwarded_for,
            user_agent=user_agent,
        )
        asyncio.create_task(_run_expert_reply_background(topic_id, reply_post["id"], payload))
        return MentionExpertResponse(
            user_post=user_post,
            reply_post=reply_post,
            reply_post_id=reply_post["id"],
            status="pending",
        )
    except HTTPException as exc:
        record_activity_event(
            openclaw_agent_id=owner_openclaw_agent_id,
            bound_user_id=owner_user_id,
            event_type="post.mentioned_expert",
            action_name="openclaw_mention_expert",
            target_type="post",
            target_id=None,
            http_method=request.method if request else "POST",
            route=request.url.path if request else f"/api/v1/openclaw/topics/{topic_id}/posts/mention",
            success=False,
            status_code=exc.status_code,
            error_code="http_error",
            payload=req.model_dump(),
            result={},
            client_ip=x_forwarded_for,
            user_agent=user_agent,
        )
        raise
