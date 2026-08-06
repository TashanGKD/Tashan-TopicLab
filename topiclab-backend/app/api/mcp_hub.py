"""SkillHub-shaped read-only API for the active science MCP catalog."""

from __future__ import annotations

import asyncio
import json
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, StrictBool, StringConstraints, field_validator
from starlette.concurrency import run_in_threadpool

from app.api.auth import get_current_user, security, verify_access_token

from app.services.science_mcp_catalog import (
    get_mcp_catalog_categories,
    get_mcp_catalog_item,
    get_mcp_catalog_meta,
    list_mcp_catalog,
)
from app.services.science_mcp_finder import find_science_mcps, get_mcp_finder_capabilities
from app.services.science_skill_finder import get_finder_config
from app.services.science_mcp_hub import (
    add_mcp_collection_item,
    create_mcp_collection,
    create_mcp_review,
    create_mcp_wish,
    get_mcp_profile,
    get_mcp_content,
    get_mcp_asset,
    get_mcp_download_status,
    get_mcp_hub_guide,
    list_mcp_collections,
    list_mcp_leaderboard,
    list_mcp_reviews,
    list_mcp_tasks,
    list_mcp_wishes,
    remove_mcp_collection_item,
    submit_mcp_candidate,
    toggle_mcp_favorite,
    vote_mcp_review_helpful,
    vote_mcp_wish,
)
from app.services.model_usage_quota import consume_model_usage


router = APIRouter(prefix="/mcp-hub")


RequiredShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
OptionalShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
ReviewPoint = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
TaxonomyValue = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]
DimensionKey = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
DimensionText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
DimensionValue = int | float | bool | DimensionText | None


class McpHubRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ScienceMcpFinderRequest(McpHubRequest):
    query: str = Field(min_length=1, max_length=2000)
    limit: int = Field(default=8, ge=1, le=12)


class McpReviewCreateRequest(McpHubRequest):
    rating: int = Field(default=5, ge=1, le=5)
    content: str = Field(min_length=1, max_length=10_000)
    title: OptionalShortText | None = None
    model: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)] | None = None
    pros: list[ReviewPoint] = Field(default_factory=list, max_length=20)
    cons: list[ReviewPoint] = Field(default_factory=list, max_length=20)
    dimensions: dict[DimensionKey, DimensionValue] = Field(default_factory=dict, max_length=20)


class ToggleRequest(McpHubRequest):
    enabled: StrictBool = True


class McpWishTaxonomy(McpHubRequest):
    domain: TaxonomyValue | None = None
    subdomain: TaxonomyValue | None = None
    stage: TaxonomyValue | None = None
    function: TaxonomyValue | None = None


class McpWishCreateRequest(McpHubRequest):
    title: RequiredShortText
    content: str = Field(min_length=1, max_length=10_000)
    taxonomy: McpWishTaxonomy | None = None


class McpCollectionCreateRequest(McpHubRequest):
    title: RequiredShortText
    description: str = Field(default="", max_length=5_000)
    visibility: Literal["private", "public"] = "private"


class McpSubmissionCreateRequest(McpHubRequest):
    name: RequiredShortText
    summary: str = Field(min_length=1, max_length=2_000)
    canonical_url: AnyHttpUrl
    repo_url: AnyHttpUrl | None = None
    domain: TaxonomyValue | None = None
    subdomain: TaxonomyValue | None = None
    stage: TaxonomyValue | None = None
    function: TaxonomyValue | None = None
    evidence: str = Field(min_length=1, max_length=10_000)
    difference: str | None = Field(default=None, max_length=5_000)

    @field_validator("repo_url", "domain", "subdomain", "stage", "function", "difference", mode="before")
    @classmethod
    def empty_optional_values_are_none(cls, value):
        return None if isinstance(value, str) and not value.strip() else value


async def _get_optional_user(credentials=Depends(security)) -> dict | None:
    if not credentials:
        return None
    return await run_in_threadpool(verify_access_token, credentials.credentials)


def _authenticated_user_id(user: dict) -> int:
    raw = user.get("sub") or user.get("user_id") or user.get("id")
    try:
        user_id = int(raw)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="登录身份无效") from exc
    if user_id <= 0:
        raise HTTPException(status_code=401, detail="登录身份无效")
    return user_id


@router.get("/meta")
def get_mcp_hub_meta():
    return get_mcp_catalog_meta()


# The primary catalog contract intentionally mirrors SkillHub. The shorter
# /meta and /mcps routes below remain compatibility aliases for older clients.
@router.get("/science-catalog/meta")
def get_mcp_science_catalog_meta():
    return get_mcp_catalog_meta()


@router.get("/science-catalog")
def list_mcp_science_catalog(
    q: str | None = Query(default=None, max_length=200),
    domain: str | None = Query(default=None, max_length=128),
    subdomain: str | None = Query(default=None, max_length=128),
    stage: str | None = Query(default=None, max_length=128),
    function: str | None = Query(default=None, max_length=128),
    readiness: str | None = Query(default=None, max_length=32),
    sort: str | None = Query(default=None, max_length=32),
    limit: int = Query(default=24, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    return list_mcp_catalog(
        q=q,
        domain=domain,
        subdomain=subdomain,
        stage=stage,
        function=function,
        readiness=readiness,
        sort=sort,
        limit=limit,
        offset=offset,
    )


@router.get("/science-catalog/finder/capabilities")
def get_mcp_science_finder_capabilities():
    return get_mcp_finder_capabilities()


@router.post("/science-catalog/find")
async def find_mcp_science_catalog(
    payload: ScienceMcpFinderRequest,
    user: dict | None = Depends(_get_optional_user),
):
    query = payload.query.strip()
    if not query:
        raise HTTPException(status_code=422, detail="科研需求不能为空")
    allow_model = user is not None and get_finder_config().configured
    if allow_model:
        await run_in_threadpool(consume_model_usage, _authenticated_user_id(user), "science_finder")
    return await find_science_mcps(query, limit=payload.limit, allow_model=allow_model)


@router.get("/mcps")
def get_mcp_hub_mcps(
    q: str | None = Query(default=None, max_length=200),
    domain: str | None = Query(default=None, max_length=128),
    subdomain: str | None = Query(default=None, max_length=128),
    stage: str | None = Query(default=None, max_length=128),
    function: str | None = Query(default=None, max_length=128),
    status: str | None = Query(default=None, max_length=32),
    sort: str | None = Query(default=None, max_length=32),
    limit: int = Query(default=24, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    return list_mcp_catalog(
        q=q,
        domain=domain,
        subdomain=subdomain,
        stage=stage,
        function=function,
        status=status,
        sort=sort,
        limit=limit,
        offset=offset,
    )


@router.get("/search")
def search_mcp_hub(
    q: str = Query(..., min_length=1, max_length=200),
    domain: str | None = Query(default=None, max_length=128),
    subdomain: str | None = Query(default=None, max_length=128),
    stage: str | None = Query(default=None, max_length=128),
    function: str | None = Query(default=None, max_length=128),
    status: str | None = Query(default=None, max_length=32),
    sort: str | None = Query(default=None, max_length=32),
    limit: int = Query(default=24, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    """SkillHub-compatible search alias for clients that use `/search`."""
    return list_mcp_catalog(
        q=q,
        domain=domain,
        subdomain=subdomain,
        stage=stage,
        function=function,
        status=status,
        sort=sort,
        limit=limit,
        offset=offset,
    )


def _mcp_finder_event(event: str, payload: dict) -> str:
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {data}\n\n"


@router.post("/science-catalog/find/stream")
async def stream_mcp_catalog_endpoint(
    payload: ScienceMcpFinderRequest,
    user: dict | None = Depends(_get_optional_user),
):
    """SkillHub-aligned model search with a deterministic catalog fallback."""
    query = payload.query.strip()
    if not query:
        raise HTTPException(status_code=422, detail="科研需求不能为空")
    allow_model = user is not None and get_finder_config().configured
    if allow_model:
        await run_in_threadpool(consume_model_usage, _authenticated_user_id(user), "science_finder")

    async def stream():
        queue: asyncio.Queue[tuple[str, dict] | None] = asyncio.Queue()

        async def emit(event: str, event_payload: dict):
            await queue.put((event, event_payload))
            if event == "result":
                await asyncio.sleep(0.3)

        async def produce():
            try:
                result = await find_science_mcps(
                    query,
                    limit=payload.limit,
                    on_event=emit,
                    allow_model=allow_model,
                )
                await queue.put(("done", {key: value for key, value in result.items() if key != "results"}))
            except Exception:
                await queue.put(("error", {"message": "搜索暂时不可用，请稍后重试。"}))
            finally:
                await queue.put(None)

        task = asyncio.create_task(produce())
        yield _mcp_finder_event("status", {"message": "正在理解科研需求"})
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield _mcp_finder_event(item[0], item[1])
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/science-catalog/{mcp_id}")
def get_mcp_science_catalog_item(mcp_id: str):
    item = get_mcp_catalog_item(mcp_id, include_related=True)
    try:
        item["reviews"] = list_mcp_reviews(mcp_id=mcp_id, limit=20)["list"]
    except Exception:
        # Catalog/detail must remain readable when the optional community DB is
        # unavailable; the page can render an empty review state and retry the
        # community surfaces independently.
        item["reviews"] = []
    return item


@router.get("/mcps/{mcp_id}")
def get_mcp_hub_mcp(mcp_id: str):
    item = get_mcp_catalog_item(mcp_id, include_related=True)
    try:
        item["reviews"] = list_mcp_reviews(mcp_id=mcp_id, limit=20)["list"]
    except Exception:
        item["reviews"] = []
    return item


@router.get("/categories")
def get_mcp_hub_categories():
    return get_mcp_catalog_categories()


@router.get("/mcps/{mcp_id}/content")
def get_mcp_content_endpoint(mcp_id: str):
    return get_mcp_content(mcp_id=mcp_id)


@router.get("/mcps/{mcp_id}/download")
def get_mcp_download_endpoint(mcp_id: str):
    """Keep the SkillHub route shape while returning a safe non-execution status."""
    return get_mcp_download_status(mcp_id=mcp_id)


@router.get("/assets/{mcp_id}", response_class=PlainTextResponse)
def get_mcp_asset_endpoint(mcp_id: str):
    asset = get_mcp_asset(mcp_id=mcp_id)
    return PlainTextResponse(
        asset["content"],
        media_type=asset["content_type"],
        headers={
            "Content-Disposition": f"inline; filename=\"{asset['filename']}\"",
            "X-Science-MCP-Executable": "false",
        },
    )


@router.post("/mcps/{mcp_id}/favorite")
def favorite_mcp(mcp_id: str, enabled: bool = Query(default=True), user: dict = Depends(get_current_user)):
    return toggle_mcp_favorite(mcp_id=mcp_id, user=user, enabled=enabled)


@router.get("/mcps/{mcp_id}/reviews")
def get_mcp_reviews(mcp_id: str, sort: str = Query(default="helpful", max_length=32), limit: int = Query(default=50, ge=1, le=100)):
    return list_mcp_reviews(mcp_id=mcp_id, sort=sort, limit=limit)


@router.post("/mcps/{mcp_id}/reviews")
def post_mcp_review(mcp_id: str, payload: McpReviewCreateRequest, user: dict = Depends(get_current_user)):
    return create_mcp_review(
        mcp_id=mcp_id,
        user=user,
        rating=payload.rating,
        content=payload.content,
        title=payload.title,
        model=payload.model,
        pros=payload.pros,
        cons=payload.cons,
        dimensions=payload.dimensions,
    )


@router.post("/reviews/{review_id}/helpful")
def vote_mcp_review(review_id: int, payload: ToggleRequest | None = None, user: dict = Depends(get_current_user)):
    enabled = payload.enabled if payload else True
    return vote_mcp_review_helpful(review_id=review_id, user=user, enabled=enabled)


@router.get("/leaderboard")
def get_mcp_leaderboard():
    return list_mcp_leaderboard()


@router.get("/wishes")
def get_mcp_wish_list(limit: int = Query(default=50, ge=1, le=100)):
    return list_mcp_wishes(limit=limit)


@router.post("/wishes")
def post_mcp_wish(payload: McpWishCreateRequest, user: dict = Depends(get_current_user)):
    taxonomy = payload.taxonomy.model_dump(exclude_none=True) if payload.taxonomy else None
    return create_mcp_wish(user=user, title=payload.title, content=payload.content, taxonomy=taxonomy)


@router.post("/wishes/{wish_id}/vote")
def vote_mcp_wish_endpoint(wish_id: int, payload: ToggleRequest | None = None, user: dict = Depends(get_current_user)):
    enabled = payload.enabled if payload else True
    return vote_mcp_wish(wish_id=wish_id, user=user, enabled=enabled)


@router.get("/collections")
def get_mcp_collections(user: dict | None = Depends(_get_optional_user)):
    return list_mcp_collections(user=user)


@router.post("/collections")
def post_mcp_collection(payload: McpCollectionCreateRequest, user: dict = Depends(get_current_user)):
    return create_mcp_collection(
        user=user,
        title=payload.title,
        description=payload.description,
        visibility=payload.visibility,
    )


@router.post("/collections/{collection_id}/items/{mcp_id}")
def add_mcp_item(collection_id: int, mcp_id: str, user: dict = Depends(get_current_user)):
    return add_mcp_collection_item(collection_id=collection_id, mcp_id=mcp_id, user=user)


@router.delete("/collections/{collection_id}/items/{mcp_id}")
def delete_mcp_item(collection_id: int, mcp_id: str, user: dict = Depends(get_current_user)):
    return remove_mcp_collection_item(collection_id=collection_id, mcp_id=mcp_id, user=user)


@router.get("/profile")
def get_mcp_hub_profile(user: dict = Depends(get_current_user)):
    return get_mcp_profile(user=user)


@router.get("/tasks")
def get_mcp_hub_tasks(user: dict = Depends(get_current_user)):
    return list_mcp_tasks(user=user)


@router.post("/submissions")
def post_mcp_submission(payload: McpSubmissionCreateRequest, user: dict = Depends(get_current_user)):
    return submit_mcp_candidate(user=user, payload=payload.model_dump(mode="json", exclude_none=True))


@router.get("/guide.md", response_class=PlainTextResponse)
def get_mcp_hub_guide_endpoint():
    return PlainTextResponse(get_mcp_hub_guide(), media_type="text/markdown; charset=utf-8")
