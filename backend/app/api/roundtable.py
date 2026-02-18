"""Roundtable API endpoints."""

import asyncio
import logging
from pathlib import Path
from fastapi import APIRouter, HTTPException

from app.agent.roundtable import run_roundtable_for_topic
from app.agent.workspace import read_discussion_history, read_discussion_summary, validate_topic_id, get_topic_experts
from app.core.config import get_workspace_base
from app.models.schemas import (
    RoundtableProgress,
    RoundtableResult,
    RoundtableStatus,
    RoundtableStatusResponse,
    StartRoundtableRequest,
    Topic,
    TopicUpdate,
)
from app.models.store import (
    get_topic,
    update_topic,
    update_topic_roundtable,
)

logger = logging.getLogger(__name__)
router = APIRouter()


async def run_roundtable_background(
    topic_id: str,
    topic_title: str,
    topic_body: str,
    num_rounds: int,
    expert_names: list[str],
    max_turns: int,
    max_budget_usd: float,
    model: str | None = None,
):
    """Background task to run roundtable."""
    try:
        logger.info(f"Starting roundtable for topic {topic_id}")
        logger.debug(f"Topic title: {topic_title}")
        result = await run_roundtable_for_topic(
            topic_id=topic_id,
            topic_title=topic_title,
            topic_body=topic_body,
            num_rounds=num_rounds,
            expert_names=expert_names,
            max_turns=max_turns,
            max_budget_usd=max_budget_usd,
            model=model,
        )
        logger.info(f"Roundtable completed for topic {topic_id}, result: {result}")
        update_topic_roundtable(
            topic_id,
            RoundtableStatus.COMPLETED,
            result,
        )
    except Exception as e:
        logger.error(f"Roundtable failed for topic {topic_id}", exc_info=True)
        logger.error(f"Error details: {str(e)}")
        update_topic_roundtable(topic_id, RoundtableStatus.FAILED)


@router.post("/{topic_id}/roundtable", response_model=RoundtableStatusResponse, status_code=202)
async def start_roundtable_endpoint(topic_id: str, req: StartRoundtableRequest):
    try:
        validate_topic_id(topic_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    if topic.roundtable_status == RoundtableStatus.RUNNING:
        raise HTTPException(status_code=400, detail="Roundtable already running")
    # If expert_names is empty, try to sync from workspace agents directory (legacy topics)
    if not topic.expert_names:
        ws_path = get_workspace_base() / "topics" / topic_id
        workspace_experts = get_topic_experts(ws_path)
        if workspace_experts:
            synced = [e["name"] for e in workspace_experts]
            update_topic(topic_id, TopicUpdate(expert_names=synced))
            topic = get_topic(topic_id)
    if not topic.expert_names:
        raise HTTPException(status_code=400, detail="请先在圆桌配置中添加至少一位专家")

    # Mark as running
    update_topic_roundtable(topic_id, RoundtableStatus.RUNNING)

    # Start roundtable in background
    asyncio.create_task(run_roundtable_background(
        topic_id=topic_id,
        topic_title=topic.title,
        topic_body=topic.body,
        num_rounds=topic.num_rounds,
        expert_names=topic.expert_names,
        max_turns=req.max_turns,
        max_budget_usd=req.max_budget_usd,
        model=req.model,
    ))

    return RoundtableStatusResponse(
        status=RoundtableStatus.RUNNING,
        result=None,
    )


@router.get("/{topic_id}/roundtable/status", response_model=RoundtableStatusResponse)
def get_roundtable_status_endpoint(topic_id: str):
    try:
        validate_topic_id(topic_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    # Always read history and summary live from workspace files
    result = topic.roundtable_result
    progress: RoundtableProgress | None = None
    try:
        ws_base = get_workspace_base()
        ws_path = ws_base / "topics" / topic_id
        turns_dir = ws_path / "shared" / "turns"
        if turns_dir.exists():
            history = read_discussion_history(ws_path)
            summary = read_discussion_summary(ws_path)
            turn_files = sorted(turns_dir.glob("*.md"))
            turns_count = len(turn_files)
            if result:
                result.discussion_history = history
                result.discussion_summary = summary
                result.turns_count = turns_count
            elif history or summary:
                result = RoundtableResult(
                    discussion_history=history,
                    discussion_summary=summary,
                    turns_count=turns_count,
                    cost_usd=None,
                    completed_at="",
                )

            # Build progress info during running
            if topic.roundtable_status == RoundtableStatus.RUNNING:
                num_experts = len(topic.expert_names) if topic.expert_names else 4
                num_rounds = topic.num_rounds or 5
                total_turns = num_experts * num_rounds

                current_round = 0
                latest_speaker = ""
                if turn_files:
                    # Most recently modified file = latest speaker
                    latest_file = max(turn_files, key=lambda f: f.stat().st_mtime)
                    stem = latest_file.stem  # e.g. round2_physicist
                    parts = stem.split("_", 1)
                    if len(parts) == 2:
                        try:
                            current_round = int(parts[0].replace("round", ""))
                        except ValueError:
                            pass
                        latest_speaker = get_topic_experts(ws_path)
                        # Look up label for expert key
                        expert_meta = {e["name"]: e.get("label", e["name"]) for e in get_topic_experts(ws_path)}
                        latest_speaker = expert_meta.get(parts[1], parts[1])

                progress = RoundtableProgress(
                    completed_turns=turns_count,
                    total_turns=total_turns,
                    current_round=current_round,
                    latest_speaker=latest_speaker,
                )
    except Exception:
        pass

    return RoundtableStatusResponse(
        status=topic.roundtable_status,
        result=result,
        progress=progress,
    )
