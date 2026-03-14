"""Read-only bridge for external information collection articles."""

from __future__ import annotations

import os
import time
from typing import Any
from urllib.parse import quote, urlsplit, urlunsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from app.api.auth import security, verify_access_token
from app.services.resonnet_client import request_json
from app.services.source_feed_pipeline import (
    fetch_source_feed_article_detail,
    hydrate_topic_workspace,
)
import asyncio

from app.services.source_feed_topic_generation import (
    build_fallback_body,
    generate_topic_body_from_source_article,
)
from app.services.http_client import get_shared_async_client
from app.storage.database.topic_store import (
    annotate_source_articles_with_interactions,
    create_topic,
    extract_preview_image,
    get_topic,
    get_topic_id_by_source_article,
    link_source_article_to_topic,
    record_source_article_share,
    set_source_article_user_action,
    update_topic,
)

router = APIRouter()
_ALLOWED_IMAGE_HOSTS = {
    "mmbiz.qpic.cn",
    "mmbiz.qlogo.cn",
}
_DEFAULT_SOURCE_FEED_LIST_CACHE_TTL_SECONDS = 30.0
_MAX_SOURCE_FEED_LIST_CACHE_ENTRIES = 256
_source_feed_list_cache: dict[tuple[int, int], tuple[float, dict[str, Any]]] = {}


class SourceFeedWorkspaceHydrateRequest(BaseModel):
    article_ids: list[int] = Field(..., min_length=1, max_length=20)


class SourceArticleActionRequest(BaseModel):
    enabled: bool = True
    title: str = ""
    source_feed_name: str = ""
    source_type: str = ""
    url: str = ""
    pic_url: str | None = None
    description: str = ""
    publish_time: str = ""
    created_at: str = ""


class EnsureSourceArticleTopicResponse(BaseModel):
    topic: dict[str, Any]
    created: bool


async def _get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict | None:
    if not credentials:
        return None
    return verify_access_token(credentials.credentials)


def _resolve_owner_identity(user: dict | None) -> tuple[int | None, str | None]:
    if not user:
        return None, None
    raw_user_id = user.get("sub")
    if raw_user_id is None:
        return None, user.get("auth_type")
    return int(raw_user_id), user.get("auth_type", "jwt")


def _require_owner_identity(user: dict | None) -> tuple[int, str]:
    user_id, auth_type = _resolve_owner_identity(user)
    if user_id is None:
        raise HTTPException(status_code=401, detail="未登录")
    return user_id, auth_type or "jwt"


def _get_information_collection_base_url() -> str:
    return os.getenv("INFORMATION_COLLECTION_BASE_URL", "http://ic.nexus.tashan.ac.cn").rstrip("/")


def _get_source_feed_list_cache_ttl_seconds() -> float:
    raw = (os.getenv("SOURCE_FEED_LIST_CACHE_TTL_SECONDS", "") or "").strip()
    if not raw:
        return _DEFAULT_SOURCE_FEED_LIST_CACHE_TTL_SECONDS
    try:
        ttl = float(raw)
    except ValueError:
        return _DEFAULT_SOURCE_FEED_LIST_CACHE_TTL_SECONDS
    return max(0.0, ttl)


def _prune_source_feed_list_cache(now: float) -> None:
    expired_keys = [key for key, (expires_at, _) in _source_feed_list_cache.items() if expires_at <= now]
    for key in expired_keys:
        _source_feed_list_cache.pop(key, None)
    if len(_source_feed_list_cache) <= _MAX_SOURCE_FEED_LIST_CACHE_ENTRIES:
        return
    overflow = len(_source_feed_list_cache) - _MAX_SOURCE_FEED_LIST_CACHE_ENTRIES
    for key, _ in sorted(_source_feed_list_cache.items(), key=lambda item: item[1][0])[:overflow]:
        _source_feed_list_cache.pop(key, None)


def _clone_source_feed_page_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "list": [dict(item) for item in payload.get("list", []) if isinstance(item, dict)],
        "limit": int(payload.get("limit", 0) or 0),
        "offset": int(payload.get("offset", 0) or 0),
    }


def _normalize_pic_url(url: Any) -> str | None:
    if not isinstance(url, str):
        return None
    raw = url.strip()
    if not raw:
        return None
    parts = urlsplit(raw)
    if parts.scheme == "http":
        return urlunsplit(("https", parts.netloc, parts.path, parts.query, parts.fragment))
    return raw


def _normalize_article(article: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": int(article.get("id", 0)),
        "title": str(article.get("title", "")),
        "source_feed_name": str(article.get("source_feed_name", "")),
        "source_type": str(article.get("source_type", "")),
        "url": str(article.get("url", "")),
        "pic_url": _normalize_pic_url(article.get("pic_url")),
        "description": str(article.get("description", "")),
        "publish_time": str(article.get("publish_time", "")),
        "created_at": str(article.get("created_at", "")),
    }


def _guess_topic_category_from_source_article(article: dict[str, Any]) -> str:
    marker = " ".join([
        str(article.get("source_feed_name") or ""),
        str(article.get("source_type") or ""),
        str(article.get("url") or ""),
    ]).lower()
    if "arxiv" in marker or "paper" in marker or "preprint" in marker:
        return "research"
    return "news"


async def _ensure_executor_workspace_for_topic(topic_id: str) -> dict:
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    await request_json(
        "POST",
        "/executor/topics/bootstrap",
        json_body={
            "topic_id": topic["id"],
            "topic_title": topic["title"],
            "topic_body": topic["body"],
            "num_rounds": topic.get("num_rounds") or 5,
        },
        timeout=120.0,
    )
    return topic


def _validate_image_url(url: str) -> str:
    normalized = _normalize_pic_url(url)
    if not normalized:
        raise HTTPException(status_code=400, detail="图片地址不能为空")
    parts = urlsplit(normalized)
    if parts.scheme not in {"http", "https"}:
        raise HTTPException(status_code=400, detail="图片协议不支持")
    if parts.netloc not in _ALLOWED_IMAGE_HOSTS:
        raise HTTPException(status_code=400, detail="图片来源不受支持")
    return normalized


@router.get("/articles")
async def get_source_feed_articles(
    limit: int = Query(default=8, ge=1, le=20),
    offset: int = Query(default=0, ge=0),
    user: dict | None = Depends(_get_optional_user),
):
    cache_ttl = _get_source_feed_list_cache_ttl_seconds()
    cache_key = (limit, offset)
    page_payload: dict[str, Any] | None = None
    now = time.monotonic()
    if cache_ttl > 0:
        cached = _source_feed_list_cache.get(cache_key)
        if cached and cached[0] > now:
            page_payload = _clone_source_feed_page_payload(cached[1])

    if page_payload is None:
        upstream_url = f"{_get_information_collection_base_url()}/api/v1/articles"
        try:
            client = get_shared_async_client("source-feed")
            response = await client.get(upstream_url, params={"limit": limit, "offset": offset}, timeout=6.0)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=exc.response.status_code, detail="上游信源服务请求失败") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="无法连接信源服务") from exc

        payload = response.json()
        data = payload.get("data")
        if not isinstance(data, dict):
            raise HTTPException(status_code=502, detail="信源服务返回格式异常")

        raw_list = data.get("list")
        if not isinstance(raw_list, list):
            raise HTTPException(status_code=502, detail="信源文章列表缺失")

        page_payload = {
            "list": [_normalize_article(item) for item in raw_list if isinstance(item, dict)],
            "limit": int(data.get("limit", limit)),
            "offset": int(data.get("offset", offset)),
        }
        if cache_ttl > 0:
            _prune_source_feed_list_cache(now)
            _source_feed_list_cache[cache_key] = (now + cache_ttl, _clone_source_feed_page_payload(page_payload))

    user_id, auth_type = _resolve_owner_identity(user)
    articles = [dict(item) for item in page_payload.get("list", []) if isinstance(item, dict)]
    annotate_source_articles_with_interactions(articles, user_id=user_id, auth_type=auth_type)

    return {
        "list": articles,
        "limit": int(page_payload.get("limit", limit)),
        "offset": int(page_payload.get("offset", offset)),
    }


@router.get("/articles/{article_id}")
async def get_source_feed_article_detail(article_id: int):
    try:
        article = await fetch_source_feed_article_detail(article_id)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail="上游信源服务请求失败") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"获取信源全文失败: {exc}") from exc
    payload = article.__dict__
    annotate_source_articles_with_interactions([payload])
    return payload


async def _fill_topic_body_in_background(topic_id: str, article_dict: dict) -> None:
    """Background task: call LLM to generate full topic body and update the topic."""
    try:
        body = await generate_topic_body_from_source_article(article_dict)
        body_preview = extract_preview_image(body)
        if body_preview:
            update_topic(topic_id, {"body": body, "preview_image": body_preview})
        else:
            # No image in generated body; preserve existing preview_image (e.g. source article pic_url)
            current = get_topic(topic_id)
            existing_preview = current.get("preview_image") if current else None
            update_topic(topic_id, {"body": body, "preview_image": existing_preview})
    except Exception:
        pass


@router.post("/articles/{article_id}/topic", response_model=EnsureSourceArticleTopicResponse)
async def ensure_source_article_topic(article_id: int, user: dict | None = Depends(_get_optional_user)):
    user_id, auth_type = _resolve_owner_identity(user)
    existing_topic_id = get_topic_id_by_source_article(article_id)
    if existing_topic_id:
        await _ensure_executor_workspace_for_topic(existing_topic_id)
        topic = get_topic(existing_topic_id, user_id=user_id, auth_type=auth_type)
        if topic is None:
            raise HTTPException(status_code=404, detail="Topic not found")
        await hydrate_topic_workspace(existing_topic_id, [article_id])
        return {"topic": topic, "created": False}

    try:
        article = await fetch_source_feed_article_detail(article_id)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail="上游信源服务请求失败") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"获取信源全文失败: {exc}") from exc

    # Create topic immediately with fallback body; LLM generation runs in background.
    initial_body = build_fallback_body(article.__dict__)
    topic = create_topic(
        article.title or f"信源 {article_id}",
        initial_body,
        _guess_topic_category_from_source_article(article.__dict__),
    )
    linked_topic_id = link_source_article_to_topic(
        article.id,
        topic["id"],
        title=article.title,
        source_feed_name=article.source_feed_name,
        source_type=article.source_type,
        url=article.url,
    )
    created = True

    if article.pic_url:
        preview_url = f"/api/source-feed/image?url={quote(article.pic_url, safe='')}"
        update_topic(linked_topic_id, {"preview_image": preview_url})

    asyncio.create_task(_fill_topic_body_in_background(linked_topic_id, article.__dict__))

    await _ensure_executor_workspace_for_topic(linked_topic_id)
    await hydrate_topic_workspace(linked_topic_id, [article.id])
    resolved_topic = get_topic(linked_topic_id, user_id=user_id, auth_type=auth_type)
    if resolved_topic is None:
        raise HTTPException(status_code=404, detail="Topic not found")
    return {"topic": resolved_topic, "created": created}


@router.post("/topics/{topic_id}/workspace-materials")
async def write_source_feed_materials_to_workspace(topic_id: str, req: SourceFeedWorkspaceHydrateRequest):
    try:
        return await hydrate_topic_workspace(topic_id, req.article_ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"写入工作区材料失败: {exc}") from exc


@router.get("/image")
async def proxy_source_feed_image(url: str = Query(..., min_length=1)):
    image_url = _validate_image_url(url)
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        ),
        "Referer": "https://mp.weixin.qq.com/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    }

    try:
        client = get_shared_async_client("source-feed")
        upstream = await client.get(image_url, headers=headers, timeout=12.0, follow_redirects=True)
        upstream.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail="上游图片请求失败") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="无法获取图片") from exc

    response_headers = {
        "Cache-Control": "public, max-age=86400",
        "Content-Disposition": "inline",
    }
    return Response(
        content=upstream.content,
        media_type=upstream.headers.get("Content-Type", "image/jpeg"),
        headers=response_headers,
    )


@router.post("/articles/{article_id}/like")
async def like_source_feed_article(
    article_id: int,
    req: SourceArticleActionRequest,
    user: dict | None = Depends(_get_optional_user),
):
    user_id, auth_type = _require_owner_identity(user)
    return set_source_article_user_action(
        article_id,
        user_id=user_id,
        auth_type=auth_type,
        liked=req.enabled,
        snapshot=req.model_dump(exclude={"enabled"}),
    )


@router.post("/articles/{article_id}/favorite")
async def favorite_source_feed_article(
    article_id: int,
    req: SourceArticleActionRequest,
    user: dict | None = Depends(_get_optional_user),
):
    user_id, auth_type = _require_owner_identity(user)
    return set_source_article_user_action(
        article_id,
        user_id=user_id,
        auth_type=auth_type,
        favorited=req.enabled,
        snapshot=req.model_dump(exclude={"enabled"}),
    )


@router.post("/articles/{article_id}/share")
async def share_source_feed_article(
    article_id: int,
    user: dict | None = Depends(_get_optional_user),
):
    user_id, auth_type = _resolve_owner_identity(user)
    return record_source_article_share(article_id, user_id=user_id, auth_type=auth_type)
