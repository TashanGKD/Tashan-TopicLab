"""Posts API: human posts and expert @mention replies."""

import asyncio
import logging
import threading
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.agent.expert_reply import run_expert_reply
from app.agent.posts import load_post, load_posts, make_post, save_post
from app.agent.workspace import get_topic_experts
from app.core.config import get_workspace_base
from app.models.schemas import (
    CreatePostRequest,
    MentionExpertRequest,
    MentionExpertResponse,
    Post,
)
from app.models.store import get_topic

logger = logging.getLogger(__name__)
router = APIRouter()


def _ws_path(topic_id: str) -> Path:
    return get_workspace_base() / "topics" / topic_id


# ---------------------------------------------------------------------------
# GET /topics/{topic_id}/posts
# ---------------------------------------------------------------------------

@router.get("/{topic_id}/posts", response_model=list[Post])
def list_posts(topic_id: str):
    """Return all posts for a topic (human + agent), sorted by created_at."""
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    return load_posts(_ws_path(topic_id))


# ---------------------------------------------------------------------------
# POST /topics/{topic_id}/posts
# ---------------------------------------------------------------------------

@router.post("/{topic_id}/posts", response_model=Post, status_code=201)
def create_post(topic_id: str, req: CreatePostRequest):
    """Create a human post."""
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    post = make_post(
        topic_id=topic_id,
        author=req.author,
        author_type="human",
        body=req.body,
        status="completed",
    )
    save_post(_ws_path(topic_id), post)
    return post


# ---------------------------------------------------------------------------
# POST /topics/{topic_id}/posts/mention
# ---------------------------------------------------------------------------

def _run_expert_reply_sync(
    ws_path: Path,
    topic_id: str,
    topic_title: str,
    expert_name: str,
    expert_label: str,
    user_post_id: str,
    user_author: str,
    user_question: str,
    reply_post_id: str,
    reply_created_at: str,
) -> None:
    """Thread target: runs the async agent in a brand-new event loop."""
    try:
        asyncio.run(run_expert_reply(
            ws_path=ws_path,
            topic_id=topic_id,
            topic_title=topic_title,
            expert_name=expert_name,
            expert_label=expert_label,
            user_post_id=user_post_id,
            user_author=user_author,
            user_question=user_question,
            reply_post_id=reply_post_id,
            reply_created_at=reply_created_at,
        ))
    except Exception:
        logger.error(
            f"Background expert reply failed: topic={topic_id} expert={expert_name}",
            exc_info=True,
        )


@router.post("/{topic_id}/posts/mention", response_model=MentionExpertResponse, status_code=202)
def mention_expert(topic_id: str, req: MentionExpertRequest):
    """User @mentions an expert.

    Saves the human post immediately, creates a pending reply placeholder,
    then launches the expert agent in a daemon thread with its own event loop
    (avoids conflicts with uvicorn's event loop).
    """
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    ws_path = _ws_path(topic_id)

    # Validate expert is in this topic's workspace
    experts = get_topic_experts(ws_path)
    expert_meta = next((e for e in experts if e["name"] == req.expert_name), None)
    if not expert_meta:
        raise HTTPException(
            status_code=400,
            detail=f"Expert '{req.expert_name}' is not in this topic. "
                   f"Available: {[e['name'] for e in experts]}",
        )

    expert_label = expert_meta.get("label", req.expert_name)

    # 1. Save the human post
    user_post = make_post(
        topic_id=topic_id,
        author=req.author,
        author_type="human",
        body=req.body,
        in_reply_to_id=req.in_reply_to_id,
        status="completed",
    )
    save_post(ws_path, user_post)

    # 2. Create a pending placeholder for the expert reply
    reply_post = make_post(
        topic_id=topic_id,
        author=req.expert_name,
        author_type="agent",
        body="",
        expert_name=req.expert_name,
        expert_label=expert_label,
        in_reply_to_id=user_post["id"],
        status="pending",
    )
    save_post(ws_path, reply_post)

    # 3. Launch the agent in a daemon thread with its own event loop.
    #    threading.Thread avoids conflicts with uvicorn's running event loop.
    t = threading.Thread(
        target=_run_expert_reply_sync,
        kwargs=dict(
            ws_path=ws_path,
            topic_id=topic_id,
            topic_title=topic.title,
            expert_name=req.expert_name,
            expert_label=expert_label,
            user_post_id=user_post["id"],
            user_author=req.author,
            user_question=req.body,
            reply_post_id=reply_post["id"],
            reply_created_at=reply_post["created_at"],
        ),
        daemon=True,
    )
    t.start()
    logger.info(f"Started expert reply thread {t.name} for {req.expert_name}")

    return MentionExpertResponse(
        user_post=Post(**user_post),
        reply_post_id=reply_post["id"],
        status="pending",
    )


# ---------------------------------------------------------------------------
# GET /topics/{topic_id}/posts/mention/{reply_post_id}
# ---------------------------------------------------------------------------

@router.get("/{topic_id}/posts/mention/{reply_post_id}", response_model=Post)
def get_reply_status(topic_id: str, reply_post_id: str):
    """Poll the status of an expert reply post (pending / completed / failed)."""
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    post = load_post(_ws_path(topic_id), reply_post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Reply post not found")
    return post
