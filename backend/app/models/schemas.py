"""Pydantic schemas for data models."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class TopicStatus(str, Enum):
    DRAFT = "draft"
    OPEN = "open"
    CLOSED = "closed"


class TopicMode(str, Enum):
    HUMAN_AGENT = "human_agent"
    ROUNDTABLE = "roundtable"
    BOTH = "both"


class RoundtableStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class AuthorType(str, Enum):
    HUMAN = "human"
    AGENT = "agent"


# --- Topic models ---

class TopicCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    body: str = Field(default="", min_length=0)  # 改为可选，默认空字符串
    category: Optional[str] = None
    # 移除 mode, num_rounds, expert_names
    # 这些配置在创建后进入话题内进行


class TopicUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    body: Optional[str] = Field(None, min_length=0)
    category: Optional[str] = None
    expert_names: Optional[list[str]] = None


class RoundtableResult(BaseModel):
    discussion_history: str
    discussion_summary: str
    turns_count: int
    cost_usd: Optional[float] = None
    completed_at: str


class Topic(BaseModel):
    id: str
    session_id: str = ""  # 等于 id，对应 workspace/topics/{session_id}/ 目录
    title: str
    body: str
    category: Optional[str]
    status: TopicStatus
    mode: TopicMode
    num_rounds: int = 5
    expert_names: list[str] = Field(default_factory=list)
    roundtable_result: Optional[RoundtableResult] = None
    roundtable_status: RoundtableStatus = RoundtableStatus.PENDING
    created_at: str
    updated_at: str


# --- Comment models ---

class CommentCreate(BaseModel):
    body: str = Field(..., min_length=1)
    author: str = Field(..., min_length=1)
    author_type: AuthorType = AuthorType.HUMAN


class Comment(BaseModel):
    id: str
    topic_id: str
    author: str
    author_type: AuthorType
    body: str
    mentions: list[str] = Field(default_factory=list)
    created_at: str


# --- Roundtable API models ---

class StartRoundtableRequest(BaseModel):
    num_rounds: int = Field(default=5, ge=1, le=10)
    max_turns: int = Field(default=60, ge=10, le=200)
    max_budget_usd: float = Field(default=5.0, ge=0.1, le=50.0)


class RoundtableProgress(BaseModel):
    completed_turns: int = 0
    total_turns: int = 0          # num_rounds × num_experts; 0 = unknown
    current_round: int = 0        # highest round seen so far
    latest_speaker: str = ""      # label of most recently written turn


class RoundtableStatusResponse(BaseModel):
    status: RoundtableStatus
    result: Optional[RoundtableResult] = None
    progress: Optional[RoundtableProgress] = None


# --- Expert models ---

class ExpertInfo(BaseModel):
    name: str
    label: str
    description: str
    skill_file: str
    skill_content: str


class ExpertUpdateRequest(BaseModel):
    skill_content: str = Field(..., min_length=1)


# --- Topic-level expert models ---

class TopicExpert(BaseModel):
    """话题级专家信息（从 workspace 读取）"""
    name: str                           # physicist | economist_custom
    label: str                          # 物理学研究员 | 经济学家
    description: str                    # 专家简介
    source: str                         # "preset" | "custom" | "ai_generated"
    role_file: str                      # agents/physicist/role.md
    added_at: str                       # 添加时间
    is_from_topic_creation: bool = False  # 是否来自话题创建时的选择


class AddExpertRequest(BaseModel):
    """添加专家请求"""
    source: str = Field(..., pattern="^(preset|custom|ai_generated)$")
    # 从预设添加
    preset_name: Optional[str] = None
    # 手动创建
    name: Optional[str] = None
    label: Optional[str] = None
    description: Optional[str] = None
    role_content: Optional[str] = None
    # AI 生成
    user_prompt: Optional[str] = None


class GenerateExpertRequest(BaseModel):
    """AI 生成专家请求"""
    expert_name: Optional[str] = Field(None, min_length=2, max_length=50, pattern=r"^[a-z_]+$")
    expert_label: str = Field(..., min_length=2, max_length=50)
    description: str = Field(..., min_length=10, max_length=1000)


class GenerateModeratorModeRequest(BaseModel):
    """AI 生成主持人模式请求"""
    prompt: str = Field(..., min_length=10, max_length=1000)


# --- Moderator mode models ---

class ModeratorModeInfo(BaseModel):
    """主持人模式信息"""
    id: str
    name: str
    description: str
    num_rounds: int
    convergence_strategy: str


class ModeratorModeConfig(BaseModel):
    """话题主持人模式配置"""
    mode_id: str
    num_rounds: int = Field(default=5, ge=1, le=10)
    custom_prompt: Optional[str] = None


class SetModeratorModeRequest(BaseModel):
    """设置主持人模式请求"""
    mode_id: str
    num_rounds: int = Field(default=5, ge=1, le=10)
    custom_prompt: Optional[str] = None


# --- Post models ---

class Post(BaseModel):
    id: str
    topic_id: str
    author: str
    author_type: AuthorType
    expert_name: Optional[str] = None
    expert_label: Optional[str] = None
    body: str
    mentions: list[str] = Field(default_factory=list)
    in_reply_to_id: Optional[str] = None
    status: str = "completed"   # "pending" | "completed" | "failed"
    created_at: str


class CreatePostRequest(BaseModel):
    author: str = Field(..., min_length=1)
    body: str = Field(..., min_length=1)


class MentionExpertRequest(BaseModel):
    author: str = Field(..., min_length=1)
    body: str = Field(..., min_length=1)
    expert_name: str = Field(..., min_length=1)
    in_reply_to_id: Optional[str] = None


class MentionExpertResponse(BaseModel):
    user_post: Post
    reply_post_id: str          # id of the pending agent reply post
    status: str = "pending"


# --- Topic expert mutation response models ---

class UpdateTopicExpertRequest(BaseModel):
    role_content: str = Field(..., min_length=1)


class TopicExpertResponse(BaseModel):
    message: str
    expert_name: str


class GenerateExpertActionResponse(BaseModel):
    message: str
    expert_name: str
    expert_label: str
    role_content: str


class GenerateModeratorModeResponse(BaseModel):
    message: str
    custom_prompt: str
    config: ModeratorModeConfig
