"""Twin runtime endpoints for the TopicLab OpenClaw CLI bridge."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from typing import Optional

from app.api.auth import (
    build_openclaw_key_invalid_detail,
    build_openclaw_key_invalid_headers,
    get_current_user,
    security,
    verify_access_token,
)
from app.services.openclaw_policy_pack import DEFAULT_SCENE
from app.services.twin_runtime import (
    append_observation,
    backfill_twins_from_legacy,
    build_runtime_profile,
    get_or_backfill_active_twin_for_user,
    get_twin_version_payload,
    list_observations,
    upsert_runtime_state,
)

router = APIRouter(prefix="/openclaw/twins", tags=["openclaw-twins"])


class TwinObservationRequest(BaseModel):
    instance_id: str = Field(..., min_length=1)
    source: str = Field(default="topiclab_cli", min_length=1)
    observation_type: str = Field(..., min_length=1)
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    payload: dict = Field(default_factory=dict)


class TwinRuntimeStateRequest(BaseModel):
    instance_id: str = Field(..., min_length=1)
    active_scene: Optional[str] = Field(default=None)
    current_focus: dict = Field(default_factory=dict)
    recent_threads: list = Field(default_factory=list)
    recent_style_shift: dict = Field(default_factory=dict)


class TwinBackfillRequest(BaseModel):
    user_id: Optional[int] = Field(default=None, ge=1)
    all_users: bool = Field(default=False)
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=500, ge=1, le=5000)


def _require_openclaw_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="OpenClaw key required")
    token = credentials.credentials
    if not token.startswith("tloc_"):
        raise HTTPException(
            status_code=401,
            detail="OpenClaw runtime key required",
            headers=build_openclaw_key_invalid_headers(),
        )
    user = verify_access_token(token)
    if not user or user.get("auth_type") != "openclaw_key":
        raise HTTPException(
            status_code=401,
            detail=build_openclaw_key_invalid_detail(),
            headers=build_openclaw_key_invalid_headers(),
        )
    return user


def _require_admin_user(user: dict = Depends(get_current_user)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@router.post("/backfill")
async def backfill_legacy_twins(
    req: TwinBackfillRequest,
    _: dict = Depends(_require_admin_user),
):
    return {
        "ok": True,
        **backfill_twins_from_legacy(
            user_id=req.user_id,
            all_users=req.all_users,
            offset=req.offset,
            limit=req.limit,
        ),
    }


@router.get("/current")
async def get_current_twin(user: dict = Depends(_require_openclaw_user)):
    user_id = int(user["sub"])
    twin = get_or_backfill_active_twin_for_user(user_id)
    if not twin:
        raise HTTPException(status_code=404, detail="No active twin found")
    return {
        "twin": {
            "twin_id": twin["twin_id"],
            "display_name": twin["display_name"],
            "visibility": twin["visibility"],
            "exposure": twin["exposure"],
            "version": twin["version"],
            "updated_at": twin["updated_at"],
        },
        "default_scene": DEFAULT_SCENE,
        "available_scenes": [
            "forum.research",
            "forum.request",
            "forum.product",
            "forum.app",
            "forum.arcade",
        ],
        "openclaw_agent": {
            "agent_uid": user.get("agent_uid"),
            "display_name": user.get("openclaw_display_name"),
            "handle": user.get("openclaw_handle"),
        },
    }


@router.get("/{twin_id}/runtime-profile")
async def get_runtime_profile(
    twin_id: str,
    scene: Optional[str] = Query(default=None),
    topic_category: Optional[str] = Query(default=None),
    topic_id: Optional[str] = Query(default=None),
    thread_id: Optional[str] = Query(default=None),
    user: dict = Depends(_require_openclaw_user),
):
    try:
        return build_runtime_profile(
            twin_id=twin_id,
            owner_user_id=int(user["sub"]),
            scene=scene,
            topic_category=topic_category,
            topic_id=topic_id,
            thread_id=thread_id,
            instance_id=str(user.get("agent_uid") or ""),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{twin_id}/observations")
async def create_twin_observation(
    twin_id: str,
    req: TwinObservationRequest,
    user: dict = Depends(_require_openclaw_user),
):
    try:
        result = append_observation(
            twin_id=twin_id,
            owner_user_id=int(user["sub"]),
            instance_id=req.instance_id,
            source=req.source,
            observation_type=req.observation_type,
            confidence=req.confidence,
            payload=req.payload,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True, **result}


@router.get("/{twin_id}/observations")
async def get_twin_observations(
    twin_id: str,
    observation_type: Optional[str] = Query(default=None),
    explicitness: Optional[str] = Query(default=None),
    scope: Optional[str] = Query(default=None),
    scene: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: dict = Depends(get_current_user),
):
    requester_user_id = int(user["sub"]) if user.get("sub") is not None else None
    try:
        return {
            "ok": True,
            **list_observations(
                twin_id=twin_id,
                requester_user_id=requester_user_id,
                is_admin=bool(user.get("is_admin")),
                observation_type=observation_type,
                explicitness=explicitness,
                scope=scope,
                scene=scene,
                limit=limit,
                offset=offset,
            ),
        }
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.patch("/{twin_id}/runtime-state")
async def patch_twin_runtime_state(
    twin_id: str,
    req: TwinRuntimeStateRequest,
    user: dict = Depends(_require_openclaw_user),
):
    try:
        state = upsert_runtime_state(
            twin_id=twin_id,
            owner_user_id=int(user["sub"]),
            instance_id=req.instance_id,
            active_scene=req.active_scene,
            current_focus=req.current_focus,
            recent_threads=req.recent_threads,
            recent_style_shift=req.recent_style_shift,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {
        "ok": True,
        "runtime_state_version": state["version"],
        "updated_at": state["updated_at"],
    }


@router.get("/{twin_id}/version")
async def get_twin_version(
    twin_id: str,
    instance_id: Optional[str] = Query(default=None),
    user: dict = Depends(_require_openclaw_user),
):
    try:
        return get_twin_version_payload(
            twin_id=twin_id,
            owner_user_id=int(user["sub"]),
            instance_id=instance_id or str(user.get("agent_uid") or ""),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
