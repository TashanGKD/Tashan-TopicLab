"""Comments API endpoints."""

from fastapi import APIRouter, HTTPException

from app.models.schemas import (
    Comment,
    CommentCreate,
)
from app.models.store import (
    create_comment,
    get_topic,
    list_comments_for_topic,
)

router = APIRouter()


@router.get("/{topic_id}/comments", response_model=list[Comment])
def get_topic_comments(topic_id: str):
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    return list_comments_for_topic(topic_id)


@router.post("/{topic_id}/comments", response_model=Comment, status_code=201)
def post_topic_comment(topic_id: str, data: CommentCreate):
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    comment = create_comment(topic_id, data)
    return comment
