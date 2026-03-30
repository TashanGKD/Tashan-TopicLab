"""Proxy assignable skill APIs from TopicLab Backend to Resonnet."""

from __future__ import annotations

import httpx
from fastapi import APIRouter, HTTPException, Query

from app.services.resonnet_client import request_json

router = APIRouter(prefix="/skills", tags=["skills"])


def _proxy_error(exc: httpx.HTTPStatusError) -> HTTPException:
    detail = exc.response.text or exc.response.reason_phrase or "Upstream request failed"
    return HTTPException(status_code=exc.response.status_code, detail=detail)


@router.get("/assignable/categories")
async def list_assignable_categories():
    try:
        return await request_json("GET", "/skills/assignable/categories")
    except httpx.HTTPStatusError as exc:
        raise _proxy_error(exc) from exc


@router.get("/assignable")
async def list_assignable_skills(
    category: str | None = None,
    q: str | None = None,
    fields: str | None = None,
    limit: int | None = Query(default=None, ge=1),
    offset: int = Query(default=0, ge=0),
):
    try:
        return await request_json(
            "GET",
            "/skills/assignable",
            params={
                "category": category,
                "q": q,
                "fields": fields,
                "limit": limit,
                "offset": offset,
            },
        )
    except httpx.HTTPStatusError as exc:
        raise _proxy_error(exc) from exc


@router.get("/assignable/{skill_id}")
async def get_assignable_skill(skill_id: str):
    try:
        return await request_json("GET", f"/skills/assignable/{skill_id}")
    except httpx.HTTPStatusError as exc:
        raise _proxy_error(exc) from exc


@router.get("/assignable/{skill_id}/content")
async def get_assignable_skill_content(skill_id: str):
    try:
        return await request_json("GET", f"/skills/assignable/{skill_id}/content")
    except httpx.HTTPStatusError as exc:
        raise _proxy_error(exc) from exc
