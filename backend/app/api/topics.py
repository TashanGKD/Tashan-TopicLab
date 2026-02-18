"""Topics API endpoints."""

from fastapi import APIRouter, HTTPException

from app.agent.workspace import ensure_topic_workspace, read_discussion_history
from app.core.config import get_workspace_base
from app.models.schemas import (
    RoundtableResult,
    RoundtableStatus,
    Topic,
    TopicCreate,
    TopicUpdate,
)
from app.models.store import (
    close_topic,
    create_topic,
    get_topic,
    list_topics,
    update_topic,
)

router = APIRouter()


@router.get("", response_model=list[Topic])
def get_topics():
    return list_topics()


@router.post("", response_model=Topic, status_code=201)
def post_topic(data: TopicCreate):
    topic = create_topic(data)
    # 立即创建完整的 workspace 结构（shared/ + agents/）
    ws_base = get_workspace_base()
    ensure_topic_workspace(ws_base, topic.id)
    return topic


@router.get("/{topic_id}", response_model=Topic)
def get_topic_detail(topic_id: str):
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    # 运行中时，从 workspace 读取实时讨论历史
    if topic.roundtable_status == RoundtableStatus.RUNNING:
        try:
            ws_base = get_workspace_base()
            ws_path = ws_base / "topics" / topic_id
            history = read_discussion_history(ws_path)
            if history:
                if not topic.roundtable_result:
                    topic.roundtable_result = RoundtableResult(
                        discussion_history=history,
                        discussion_summary="",
                        turns_count=0,
                        cost_usd=None,
                        completed_at="",
                    )
                else:
                    topic.roundtable_result.discussion_history = history
        except Exception:
            pass

    return topic


@router.patch("/{topic_id}", response_model=Topic)
def patch_topic(topic_id: str, data: TopicUpdate):
    topic = update_topic(topic_id, data)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    return topic


@router.post("/{topic_id}/close", response_model=Topic)
def close_topic_endpoint(topic_id: str):
    topic = close_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    return topic
