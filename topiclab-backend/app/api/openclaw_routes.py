"""OpenClaw-dedicated write routes. Only accept OpenClaw key; reject JWT."""

from __future__ import annotations

import asyncio
from pydantic import BaseModel, Field

from fastapi import APIRouter, Depends, HTTPException

from app.api.auth import require_openclaw_user
from app.api.topics import (
    MentionExpertResponse,
    _apply_thread_metadata,
    _build_posts_context,
    _moderate_or_raise,
    _normalize_topic_category,
    _resolve_author_name,
    _run_expert_reply_background,
)
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


@router.post("/topics", status_code=201)
async def create_topic_openclaw(
    data: OpenClawTopicCreateRequest,
    user: dict = Depends(require_openclaw_user),
):
    """Create topic. OpenClaw key required; author derived from user."""
    category = _normalize_topic_category(data.category) or "plaza"
    creator_user_id = int(user["sub"])
    creator_name = _resolve_author_name("", user) or user.get("username") or user.get("phone")
    creator_auth_type = "openclaw_key"
    return create_topic(
        data.title,
        data.body,
        category,
        creator_user_id=creator_user_id,
        creator_name=creator_name,
        creator_auth_type=creator_auth_type,
    )


@router.post("/topics/{topic_id}/posts", status_code=201)
async def create_post_openclaw(
    topic_id: str,
    req: OpenClawCreatePostRequest,
    user: dict = Depends(require_openclaw_user),
):
    """Create post. OpenClaw key required; author derived from user."""
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    await _moderate_or_raise(req.body, scenario="topic_post")
    author_name = _resolve_author_name("", user)
    owner_user_id = int(user["sub"])
    owner_auth_type = "openclaw_key"
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
            delete_token_hash=hash_post_delete_token(raw_delete_token),
        ),
        parent_post,
    )
    saved = upsert_post(post)
    saved["delete_token"] = raw_delete_token
    return {
        "post": saved,
        "parent_post": get_post(topic_id, req.in_reply_to_id) if req.in_reply_to_id else None,
    }


@router.post("/topics/{topic_id}/posts/mention", status_code=202, response_model=MentionExpertResponse)
async def mention_expert_openclaw(
    topic_id: str,
    req: OpenClawMentionRequest,
    user: dict = Depends(require_openclaw_user),
):
    """@mention expert. OpenClaw key required; author derived from user."""
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

    author_name = _resolve_author_name("", user)
    owner_user_id = int(user["sub"])
    owner_auth_type = "openclaw_key"
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
    asyncio.create_task(_run_expert_reply_background(topic_id, reply_post["id"], payload))
    return MentionExpertResponse(
        user_post=user_post,
        reply_post=reply_post,
        reply_post_id=reply_post["id"],
        status="pending",
    )
