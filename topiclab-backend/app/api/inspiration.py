"""Inspiration Co-Creation demand submission and path endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from app.api.auth import get_current_user, security, verify_access_token
from app.services.inspiration_review import build_initial_inspiration_review, build_initial_public_redaction
from app.storage.database.inspiration_store import (
    add_demand_update,
    claim_demand,
    create_demand,
    get_demand_by_slug,
    list_public_demands,
)

router = APIRouter(prefix="/inspiration", tags=["inspiration"])


class InspirationDemandSubmitRequest(BaseModel):
    submitter_name: str = Field(default="", max_length=120)
    participation_mode: str = Field(default="", max_length=120)
    contact: str = Field(default="", max_length=255)
    problem: str = Field(..., min_length=4, max_length=6000)
    category: str = Field(default="", max_length=255)
    category_extra: str = Field(default="", max_length=500)
    current_blockers: str = Field(default="", max_length=500)
    note: str = Field(default="", max_length=2000)
    allow_public: bool = True


class InspirationDemandUpdateRequest(BaseModel):
    week_label: str = Field(default="", max_length=80)
    stage_key: str = Field(default="", max_length=64)
    stage_status: str = Field(default="", max_length=32)
    summary: str = Field(default="", max_length=1000)
    progress: str = Field(default="", max_length=4000)
    blockers: str = Field(default="", max_length=2000)
    next_steps: str = Field(default="", max_length=2000)
    emotion_note: str = Field(default="", max_length=1000)
    artifacts: list[dict[str, Any]] = Field(default_factory=list)
    visibility: str = Field(default="public", pattern="^(public|admin_only)$")


class InspirationDemandClaimRequest(BaseModel):
    claim_token: str = Field(..., min_length=8, max_length=128)


def _build_public_payload(req: InspirationDemandSubmitRequest, redaction: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": str(redaction.get("title") or "未命名共创线索"),
        "summary": str(redaction.get("summary") or ""),
        "tags": [str(item) for item in (redaction.get("tags") or [])][:4],
        "stuck": str(redaction.get("stuck") or ""),
        "allow_public": bool(req.allow_public),
        "redaction_method": str(redaction.get("method") or "rule_only"),
        "redaction_status": str(redaction.get("status") or ("published" if req.allow_public else "draft")),
        "redaction_notes": [str(item) for item in (redaction.get("notes") or [])],
    }


def _optional_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> dict | None:
    if not credentials:
        return None
    return verify_access_token(credentials.credentials)


def _require_admin(user: dict = Depends(get_current_user)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user


@router.get("/demands")
def list_demands():
    return {"list": list_public_demands()}


@router.post("/demands")
def submit_demand(req: InspirationDemandSubmitRequest, user: dict | None = Depends(_optional_current_user)):
    private_payload = req.model_dump()
    if user:
        private_payload["account_user_id"] = user.get("sub")
        private_payload["account_username"] = user.get("username")
        private_payload["account_phone"] = user.get("phone")
    llm_review = build_initial_inspiration_review(private_payload)
    redaction = build_initial_public_redaction(private_payload, llm_review)
    public_payload = _build_public_payload(req, redaction)
    owner_user_id = int(user["sub"]) if user and user.get("sub") is not None else None
    created = create_demand(
        payload=private_payload,
        public_payload=public_payload,
        llm_review=llm_review,
        owner_user_id=owner_user_id,
    )
    return {"demand": created["demand"], "claim_token": created["claim_token"], "llm_review": llm_review, "redaction": redaction}


@router.get("/demands/{slug}")
def get_demand(slug: str, include_private: bool = False, user: dict | None = Depends(_optional_current_user)):
    demand = get_demand_by_slug(slug, user=user, include_private=include_private)
    if demand is None:
        raise HTTPException(status_code=404, detail="需求不存在")
    if demand["status"] != "published" and not demand.get("can_view_private"):
        raise HTTPException(status_code=404, detail="需求不存在")
    return {"demand": demand}


@router.post("/demands/{slug}/claim")
def claim_submitted_demand(slug: str, req: InspirationDemandClaimRequest, user: dict = Depends(get_current_user)):
    user_id = int(user["sub"]) if user.get("sub") is not None else None
    if user_id is None:
        raise HTTPException(status_code=401, detail="未登录")
    demand = claim_demand(slug=slug, claim_token=req.claim_token, user_id=user_id)
    if demand is None:
        raise HTTPException(status_code=404, detail="需求不存在或认领链接已失效")
    return {"demand": demand}


@router.post("/demands/{slug}/updates")
def create_update(slug: str, req: InspirationDemandUpdateRequest, user: dict = Depends(get_current_user)):
    demand = get_demand_by_slug(slug, user=user)
    if demand is None:
        raise HTTPException(status_code=404, detail="需求不存在")
    if not demand.get("can_update"):
        raise HTTPException(status_code=403, detail="没有更新权限")
    created_by = int(user["sub"]) if user.get("sub") is not None else None
    update = add_demand_update(slug=slug, payload=req.model_dump(), created_by_user_id=created_by)
    if update is None:
        raise HTTPException(status_code=404, detail="需求不存在")
    return {"update": update}
