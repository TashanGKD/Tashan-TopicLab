"""Youth TED public endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.storage.database.youth_ted_store import (
    get_youth_ted_activity_poster,
    list_youth_ted_activities,
)

router = APIRouter(prefix="/youth-ted", tags=["youth-ted"])


@router.get("/activities")
def list_activities():
    return {"list": list_youth_ted_activities()}


@router.get("/activities/{slug}/poster.webp")
def get_activity_poster(slug: str):
    poster = get_youth_ted_activity_poster(slug)
    if poster is None:
        raise HTTPException(status_code=404, detail="Activity poster not found")
    payload, mime_type = poster
    return Response(content=payload, media_type=mime_type)
