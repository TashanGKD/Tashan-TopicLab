"""User feedback persisted to TopicLab database."""

from __future__ import annotations

import threading

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.auth import security, verify_access_token
from app.services.openclaw_runtime import record_activity_event
from app.storage.database.postgres_client import ensure_site_feedback_schema, get_db_session

router = APIRouter(prefix="/feedback", tags=["feedback"])

_feedback_schema_lock = threading.Lock()


def _ensure_feedback_schema_once() -> None:
    with _feedback_schema_lock:
        ensure_site_feedback_schema()


class FeedbackCreateRequest(BaseModel):
    body: str = Field(..., min_length=1, max_length=8000)
    scenario: str = Field(default="", max_length=2000)
    steps_to_reproduce: str = Field(default="", max_length=4000)
    page_url: str | None = Field(default=None, max_length=2048)


async def _get_optional_user(credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> dict | None:
    if not credentials:
        return None
    return verify_access_token(credentials.credentials)


def _to_iso(value) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return value.isoformat()


@router.post("", status_code=201)
async def create_feedback(
    req: FeedbackCreateRequest,
    user: dict | None = Depends(_get_optional_user),
    user_agent: str | None = Header(default=None, alias="User-Agent"),
):
    """Record feedback; logged-in users keep identity, guests are stored anonymously."""
    user_id: int | None = None
    username = "匿名用户"
    auth_channel = "anonymous"
    raw_sub = user.get("sub") if user else None
    if raw_sub is not None:
        try:
            user_id = int(raw_sub)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=401, detail="登录状态无效") from exc
        auth_channel = (user.get("auth_type") or "jwt").strip() or "jwt"
    ua = (user_agent or "")[:512] or None
    page_url = (req.page_url or "").strip()[:2048] or None

    try:
        _ensure_feedback_schema_once()
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=503,
            detail="反馈服务暂不可用（数据表初始化失败），请稍后重试或联系管理员。",
        ) from exc

    try:
        with get_db_session() as session:
            if user_id is not None:
                row = session.execute(
                    text("SELECT username, phone FROM users WHERE id = :id"),
                    {"id": user_id},
                ).fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="用户不存在")
                username = (row[0] or row[1] or "").strip() or f"user-{user_id}"
            inserted = session.execute(
                text(
                    """
                    INSERT INTO site_feedback (
                        user_id, username, auth_channel, scenario, body, steps_to_reproduce, page_url, client_user_agent
                    )
                    VALUES (
                        :user_id, :username, :auth_channel, :scenario, :body, :steps_to_reproduce, :page_url, :client_user_agent
                    )
                    RETURNING id, created_at
                    """
                ),
                {
                    "user_id": user_id,
                    "username": username[:255],
                    "auth_channel": auth_channel[:32],
                    "scenario": req.scenario,
                    "body": req.body,
                    "steps_to_reproduce": req.steps_to_reproduce,
                    "page_url": page_url,
                    "client_user_agent": ua,
                },
            ).fetchone()
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=503,
            detail="反馈写入失败，请稍后重试。若持续失败请联系管理员。",
        ) from exc

    if inserted is None:
        raise HTTPException(status_code=503, detail="反馈写入未返回结果，请稍后重试。")

    if user and user.get("auth_type") == "openclaw_key" and user.get("openclaw_agent_id") is not None and user_id is not None:
        record_activity_event(
            openclaw_agent_id=int(user["openclaw_agent_id"]),
            bound_user_id=user_id,
            event_type="feedback.submitted",
            action_name="create_feedback",
            target_type="feedback",
            target_id=str(int(inserted[0])),
            route="/api/v1/feedback",
            http_method="POST",
            success=True,
            status_code=201,
            payload=req.model_dump(),
            result={"feedback_id": int(inserted[0])},
            user_agent=ua,
        )

    return {
        "id": int(inserted[0]),
        "username": username[:255],
        "created_at": _to_iso(inserted[1]),
    }
