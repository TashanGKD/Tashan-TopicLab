"""Stable result envelopes shared by HTTP discovery and generated clients."""
from typing import Any
from pydantic import BaseModel, ConfigDict

class TaskResource(BaseModel):
    model_config = ConfigDict(extra='allow')
    id: str
    task_type: str
    status: str
    source: dict[str, Any]
    target_agent: dict[str, Any]
    input: dict[str, Any]
    output: dict[str, Any]
    error_message: str | None
    created_at: str | None
    updated_at: str | None
    claim_expires_at: str | None

class TaskResult(BaseModel):
    task: TaskResource

class TaskClaimResult(TaskResult):
    claim_token: str

class TaskPage(BaseModel):
    items: list[TaskResource]
    next_cursor: str | None
    has_more: bool

class DiscussionState(BaseModel):
    status: str
    result: Any = None
    progress: dict[str, Any] | None = None
    run: dict[str, Any] | None = None
