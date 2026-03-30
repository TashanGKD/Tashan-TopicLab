"""SkillHub API routes."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse

from app.api.auth import get_current_user, security, verify_access_token
from app.services.skill_hub import (
    add_skill_version,
    create_download,
    create_or_rotate_skill_hub_key,
    create_review,
    create_skill,
    create_wish,
    get_asset_path,
    get_guide_markdown,
    get_leaderboard,
    get_profile,
    get_skill_content,
    get_skill_detail,
    list_categories,
    list_collections,
    list_reviews,
    list_skills,
    list_tasks,
    list_wishes,
    toggle_favorite,
    vote_review_helpful,
    vote_wish,
)

router = APIRouter(prefix="/skill-hub")


async def _get_optional_user(credentials=Depends(security)) -> dict | None:
    if not credentials:
        return None
    return verify_access_token(credentials.credentials)


def _parse_csv_list(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _parse_json_object(value: str | None) -> dict:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


@router.get("/skills")
async def get_skill_hub_skills(
    q: str | None = Query(default=None),
    category: str | None = Query(default=None),
    cluster: str | None = Query(default=None),
    sort: str = Query(default="hot"),
    featured_only: bool = Query(default=False),
    openclaw_ready_only: bool = Query(default=False),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: dict | None = Depends(_get_optional_user),
):
    user_id = int(user["sub"]) if user and user.get("sub") is not None else None
    return list_skills(
        user_id=user_id,
        q=q,
        category=category,
        cluster=cluster,
        sort=sort,
        featured_only=featured_only,
        openclaw_ready_only=openclaw_ready_only,
        limit=limit,
        offset=offset,
    )


@router.get("/skills/{id_or_slug}")
async def get_skill_hub_skill_detail(id_or_slug: str, user: dict | None = Depends(_get_optional_user)):
    user_id = int(user["sub"]) if user and user.get("sub") is not None else None
    return get_skill_detail(id_or_slug, user_id=user_id)


@router.post("/skills")
async def publish_skill_hub_skill(
    name: str = Form(...),
    summary: str = Form(...),
    description: str = Form(...),
    category_key: str = Form(...),
    cluster_key: str = Form(...),
    tagline: str | None = Form(default=None),
    slug: str | None = Form(default=None),
    tags: str | None = Form(default=None),
    capabilities: str | None = Form(default=None),
    framework: str = Form(default="openclaw"),
    compatibility_level: str = Form(default="metadata"),
    pricing_status: str = Form(default="free"),
    price_points: int = Form(default=0),
    install_command: str | None = Form(default=None),
    source_url: str | None = Form(default=None),
    source_name: str | None = Form(default=None),
    docs_url: str | None = Form(default=None),
    license: str | None = Form(default=None),
    hero_note: str | None = Form(default=None),
    version: str = Form(default="0.1.0"),
    changelog: str | None = Form(default=None),
    content_markdown: str | None = Form(default=None),
    file: UploadFile | None = File(default=None),
    user: dict = Depends(get_current_user),
):
    return create_skill(
        user=user,
        name=name,
        summary=summary,
        description=description,
        category_key=category_key,
        cluster_key=cluster_key,
        tagline=tagline,
        slug=slug,
        tags=_parse_csv_list(tags),
        capabilities=_parse_csv_list(capabilities),
        framework=framework,
        compatibility_level=compatibility_level,
        pricing_status=pricing_status,
        price_points=price_points,
        install_command=install_command,
        source_url=source_url,
        source_name=source_name,
        docs_url=docs_url,
        license=license,
        hero_note=hero_note,
        version=version,
        changelog=changelog,
        content_markdown=content_markdown,
        file=file,
    )


@router.post("/skills/{id_or_slug}/versions")
async def publish_skill_hub_skill_version(
    id_or_slug: str,
    version: str = Form(...),
    changelog: str | None = Form(default=None),
    install_command: str | None = Form(default=None),
    content_markdown: str | None = Form(default=None),
    file: UploadFile | None = File(default=None),
    user: dict = Depends(get_current_user),
):
    return add_skill_version(
        skill_id_or_slug=id_or_slug,
        user=user,
        version=version,
        changelog=changelog,
        install_command=install_command,
        content_markdown=content_markdown,
        file=file,
    )


@router.get("/skills/{id_or_slug}/content")
async def get_skill_hub_skill_content(id_or_slug: str):
    return get_skill_content(id_or_slug)


@router.post("/skills/{id_or_slug}/favorite")
async def favorite_skill_hub_skill(
    id_or_slug: str,
    enabled: bool = Query(default=True),
    user: dict = Depends(get_current_user),
):
    return toggle_favorite(skill_id_or_slug=id_or_slug, user=user, enabled=enabled)


@router.get("/skills/{id_or_slug}/download")
async def download_skill_hub_skill(
    id_or_slug: str,
    referrer: str | None = Query(default=None),
    user: dict = Depends(get_current_user),
):
    return create_download(skill_id_or_slug=id_or_slug, user=user, referrer=referrer)


@router.get("/categories")
async def get_skill_hub_categories():
    return list_categories()


@router.get("/search")
async def search_skill_hub(
    q: str = Query(...),
    category: str | None = Query(default=None),
    cluster: str | None = Query(default=None),
    sort: str = Query(default="hot"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: dict | None = Depends(_get_optional_user),
):
    user_id = int(user["sub"]) if user and user.get("sub") is not None else None
    return list_skills(
        user_id=user_id,
        q=q,
        category=category,
        cluster=cluster,
        sort=sort,
        limit=limit,
        offset=offset,
    )


@router.get("/reviews")
async def get_skill_hub_reviews(skill_id: str = Query(...), sort: str = Query(default="helpful")):
    return list_reviews(skill_id=skill_id, sort=sort)


@router.post("/reviews")
async def post_skill_hub_review(
    payload: dict,
    user: dict = Depends(get_current_user),
):
    skill_id = str(payload.get("skill_id") or "").strip()
    if not skill_id:
        raise HTTPException(status_code=400, detail="skill_id 必填")
    return create_review(
        user=user,
        skill_id_or_slug=skill_id,
        rating=int(payload.get("rating") or 5),
        content=str(payload.get("content") or ""),
        model=(str(payload.get("model")) if payload.get("model") else None),
        title=(str(payload.get("title")) if payload.get("title") else None),
        pros=payload.get("pros") if isinstance(payload.get("pros"), list) else None,
        cons=payload.get("cons") if isinstance(payload.get("cons"), list) else None,
        dimensions=payload.get("dimensions") if isinstance(payload.get("dimensions"), dict) else None,
    )


@router.post("/reviews/{review_id}/helpful")
async def vote_skill_hub_review_helpful_endpoint(
    review_id: int,
    payload: dict | None = None,
    user: dict = Depends(get_current_user),
):
    enabled = True if not payload else bool(payload.get("enabled", True))
    return vote_review_helpful(review_id=review_id, user=user, enabled=enabled)


@router.get("/leaderboard")
async def get_skill_hub_leaderboard():
    return get_leaderboard()


@router.get("/wishes")
async def get_skill_hub_wishes(limit: int = Query(default=50, ge=1, le=100)):
    return list_wishes(limit=limit)


@router.post("/wishes")
async def post_skill_hub_wish(payload: dict, user: dict = Depends(get_current_user)):
    title = str(payload.get("title") or "").strip()
    content = str(payload.get("content") or "").strip()
    if not title or not content:
        raise HTTPException(status_code=400, detail="title 和 content 必填")
    return create_wish(user=user, title=title, content=content, category_key=payload.get("category_key"))


@router.post("/wishes/{wish_id}/vote")
async def vote_skill_hub_wish_endpoint(
    wish_id: int,
    payload: dict | None = None,
    user: dict = Depends(get_current_user),
):
    enabled = True if not payload else bool(payload.get("enabled", True))
    return vote_wish(wish_id=wish_id, user=user, enabled=enabled)


@router.get("/profile")
async def get_skill_hub_profile(user: dict = Depends(get_current_user)):
    return get_profile(user=user)


@router.post("/profile/openclaw-key")
async def create_skill_hub_openclaw_key(user: dict = Depends(get_current_user)):
    return create_or_rotate_skill_hub_key(user=user)


@router.get("/tasks")
async def get_skill_hub_tasks(user: dict = Depends(get_current_user)):
    return list_tasks(user=user)


@router.get("/collections")
async def get_skill_hub_collections(user: dict | None = Depends(_get_optional_user)):
    user_id = int(user["sub"]) if user and user.get("sub") is not None else None
    return list_collections(user_id=user_id)


@router.get("/guide.md", response_class=PlainTextResponse)
async def get_skill_hub_guide():
    return PlainTextResponse(get_guide_markdown(), media_type="text/markdown; charset=utf-8")


@router.get("/assets/{version_id}")
async def get_skill_hub_asset(version_id: int):
    asset = get_asset_path(version_id)
    return FileResponse(
        asset["path"],
        media_type=asset["content_type"],
        filename=asset["filename"],
    )
