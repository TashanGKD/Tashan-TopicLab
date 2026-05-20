"""Inspiration Co-Creation demand submission and path endpoints."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from app.api.auth import get_current_user, security, verify_access_token
from app.services.inspiration_assistant import run_inspiration_assistant_once
from app.services.inspiration_review import (
    build_initial_inspiration_review,
    build_initial_public_redaction,
)
from app.storage.database.inspiration_store import (
    add_demand_update,
    claim_demand,
    create_assistant_run,
    create_demand,
    get_demand_by_slug,
    list_public_demands,
    set_demand_interest,
    update_demand_private,
    update_demand_public_fields,
    update_demand_public_mode,
    update_demand_update,
)

router = APIRouter(prefix="/inspiration", tags=["inspiration"])


class InspirationDemandSubmitRequest(BaseModel):
    submitter_name: str = Field(default="", max_length=120)
    participation_mode: str = Field(default="", max_length=120)
    contact: str = Field(default="", max_length=255)
    problem: str = Field(..., min_length=1, max_length=6000)
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


class InspirationDemandPrivateUpdateRequest(BaseModel):
    private: dict[str, Any] = Field(default_factory=dict)


class InspirationDemandPublicModeRequest(BaseModel):
    raw_public: bool = False


class InspirationDemandPublicFieldsRequest(BaseModel):
    title: str | None = Field(default=None, max_length=80)
    summary: str | None = Field(default=None, max_length=2000)
    stuck: str | None = Field(default=None, max_length=500)


class InspirationDemandInterestRequest(BaseModel):
    interested: bool = True


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


def _enqueue_assistant_run(*, slug: str, trigger_type: str, trigger_update_id: str | None = None) -> dict[str, Any]:
    run = create_assistant_run(slug=slug, trigger_type=trigger_type, trigger_update_id=trigger_update_id)
    asyncio.create_task(run_inspiration_assistant_once(run["id"]))
    return run


@router.get("/demands")
def list_demands():
    return {"list": list_public_demands()}


@router.post("/demands")
async def submit_demand(req: InspirationDemandSubmitRequest, user: dict | None = Depends(_optional_current_user)):
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
    slug = created["demand"]["slug"]
    _enqueue_assistant_run(slug=slug, trigger_type="initial_submission")
    demand = get_demand_by_slug(slug, user=user)
    return {"demand": demand or created["demand"], "claim_token": created["claim_token"], "llm_review": llm_review, "redaction": redaction}


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


@router.patch("/demands/{slug}/private")
def update_private_info(slug: str, req: InspirationDemandPrivateUpdateRequest, user: dict = Depends(get_current_user)):
    demand = update_demand_private(slug=slug, private_payload=req.private, user=user)
    if demand is None:
        raise HTTPException(status_code=404, detail="需求不存在")
    if demand.get("error") == "forbidden":
        raise HTTPException(status_code=403, detail="没有更新权限")
    return {"demand": demand}


@router.patch("/demands/{slug}/public-mode")
async def update_public_mode(slug: str, req: InspirationDemandPublicModeRequest, user: dict = Depends(get_current_user)):
    demand = update_demand_public_mode(slug=slug, raw_public=req.raw_public, user=user)
    if demand is None:
        raise HTTPException(status_code=404, detail="需求不存在")
    if demand.get("error") == "forbidden":
        raise HTTPException(status_code=403, detail="没有更新权限")
    return {"demand": demand}


@router.patch("/demands/{slug}/public-fields")
def update_public_fields(slug: str, req: InspirationDemandPublicFieldsRequest, user: dict = Depends(get_current_user)):
    public_payload = req.model_dump(exclude_unset=True)
    demand = update_demand_public_fields(slug=slug, public_payload=public_payload, user=user)
    if demand is None:
        raise HTTPException(status_code=404, detail="需求不存在")
    if demand.get("error") == "forbidden":
        raise HTTPException(status_code=403, detail="没有更新权限")
    return {"demand": demand}


@router.post("/demands/{slug}/interest")
def update_interest(slug: str, req: InspirationDemandInterestRequest, user: dict = Depends(get_current_user)):
    interest = set_demand_interest(slug=slug, user=user, interested=req.interested)
    if interest is None:
        raise HTTPException(status_code=404, detail="需求不存在")
    if interest.get("error") == "unauthorized":
        raise HTTPException(status_code=401, detail="未登录")
    return {"interest": interest}


@router.post("/demands/{slug}/updates")
async def create_update(slug: str, req: InspirationDemandUpdateRequest, user: dict = Depends(get_current_user)):
    demand = get_demand_by_slug(slug, user=user)
    if demand is None:
        raise HTTPException(status_code=404, detail="需求不存在")
    if not demand.get("can_update"):
        raise HTTPException(status_code=403, detail="没有更新权限")
    created_by = int(user["sub"]) if user.get("sub") is not None else None
    update = add_demand_update(slug=slug, payload=req.model_dump(), created_by_user_id=created_by)
    if update is None:
        raise HTTPException(status_code=404, detail="需求不存在")
    _enqueue_assistant_run(slug=slug, trigger_type="path_update", trigger_update_id=update["id"])
    return {"update": update}


@router.patch("/demands/{slug}/updates/{update_id}")
async def update_existing_update(slug: str, update_id: str, req: InspirationDemandUpdateRequest, user: dict = Depends(get_current_user)):
    update = update_demand_update(slug=slug, update_id=update_id, payload=req.model_dump(), user=user)
    if update is None:
        raise HTTPException(status_code=404, detail="进展不存在")
    if update.get("error") == "forbidden":
        raise HTTPException(status_code=403, detail="没有更新权限")
    _enqueue_assistant_run(slug=slug, trigger_type="path_update_edit", trigger_update_id=update["id"])
    return {"update": update}
