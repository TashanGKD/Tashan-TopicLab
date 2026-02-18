"""In-memory store for topics and comments with persistence."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import uuid
from pathlib import Path
from typing import Dict, List, Optional

from app.core.config import WORKSPACE_BASE
from .schemas import (
    RoundtableResult,
    RoundtableStatus,
    Topic,
    TopicCreate,
    TopicMode,
    TopicStatus,
    TopicUpdate,
)

topics_db: Dict[str, Topic] = {}


def _get_topic_file_path(topic_id: str) -> Path:
    """Get the path to the topic's JSON metadata file."""
    return WORKSPACE_BASE / "topics" / topic_id / "topic.json"


def _save_topic_to_file(topic: Topic):
    """Save topic metadata to JSON file in topic workspace."""
    topic_file = _get_topic_file_path(topic.id)
    topic_file.parent.mkdir(parents=True, exist_ok=True)
    topic_data = topic.model_dump()
    topic_file.write_text(json.dumps(topic_data, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_topic_from_file(topic_id: str) -> Optional[Topic]:
    """Load topic from JSON file if it exists."""
    topic_file = _get_topic_file_path(topic_id)
    if not topic_file.exists():
        return None
    try:
        topic_data = json.loads(topic_file.read_text(encoding="utf-8"))
        return Topic(**topic_data)
    except Exception:
        return None


def initialize_store_from_workspace():
    """Load all existing topics from workspace on startup.

    Any topic persisted with status 'running' is reset to 'failed' because
    the background asyncio task was lost when the server restarted.
    """
    topics_dir = WORKSPACE_BASE / "topics"
    if not topics_dir.exists():
        return

    for topic_dir in topics_dir.iterdir():
        if topic_dir.is_dir():
            topic = _load_topic_from_file(topic_dir.name)
            if topic:
                if topic.roundtable_status == RoundtableStatus.RUNNING:
                    topic.roundtable_status = RoundtableStatus.FAILED
                    _save_topic_to_file(topic)
                topics_db[topic.id] = topic


def sync_store_with_workspace():
    """Sync in-memory store with workspace directory.
    
    - Adds topics that exist in workspace but not in memory
    - Removes topics that are in memory but no longer in workspace
    - Updates topics if topic.json has been modified
    """
    topics_dir = WORKSPACE_BASE / "topics"
    workspace_topic_ids = set()
    
    if topics_dir.exists():
        # Collect all topic IDs from workspace
        for topic_dir in topics_dir.iterdir():
            if topic_dir.is_dir():
                workspace_topic_ids.add(topic_dir.name)
    
    # Remove topics that are no longer in workspace
    for topic_id in list(topics_db.keys()):
        if topic_id not in workspace_topic_ids:
            del topics_db[topic_id]
    
    # Add or update topics from workspace
    for topic_id in workspace_topic_ids:
        topic = _load_topic_from_file(topic_id)
        if topic:
            topics_db[topic_id] = topic


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- Topic operations ---

def create_topic(data: TopicCreate) -> Topic:
    topic_id = str(uuid.uuid4())
    now = utc_now_iso()
    topic = Topic(
        id=topic_id,
        session_id=topic_id,
        title=data.title,
        body=data.body if data.body else "",  # 允许空正文
        category=data.category,
        status=TopicStatus.OPEN,
        mode=TopicMode.ROUNDTABLE,  # 默认圆桌模式
        num_rounds=5,  # 默认 5 轮
        expert_names=[],  # 默认空，用户进入话题后添加专家
        roundtable_result=None,
        roundtable_status=RoundtableStatus.PENDING,
        created_at=now,
        updated_at=now,
    )
    topics_db[topic_id] = topic
    _save_topic_to_file(topic)
    return topic


def get_topic(topic_id: str) -> Optional[Topic]:
    return topics_db.get(topic_id)


def list_topics() -> List[Topic]:
    return list(topics_db.values())


def update_topic(topic_id: str, data: TopicUpdate) -> Optional[Topic]:
    topic = topics_db.get(topic_id)
    if not topic:
        return None
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(topic, key, value)
    topic.updated_at = utc_now_iso()
    _save_topic_to_file(topic)
    return topic


def close_topic(topic_id: str) -> Optional[Topic]:
    topic = topics_db.get(topic_id)
    if not topic:
        return None
    topic.status = TopicStatus.CLOSED
    topic.updated_at = utc_now_iso()
    _save_topic_to_file(topic)
    return topic


def update_topic_roundtable(
    topic_id: str,
    status: RoundtableStatus,
    result: Optional[RoundtableResult] = None,
) -> Optional[Topic]:
    topic = topics_db.get(topic_id)
    if not topic:
        return None
    topic.roundtable_status = status
    if result:
        topic.roundtable_result = result
    topic.updated_at = utc_now_iso()
    _save_topic_to_file(topic)
    return topic


