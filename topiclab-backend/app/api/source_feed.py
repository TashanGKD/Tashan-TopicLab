"""Read-only bridge for external information collection articles."""

from __future__ import annotations

import os
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.services.source_feed_pipeline import (
    fetch_source_feed_article_detail,
    hydrate_topic_workspace,
)

router = APIRouter()
_ALLOWED_IMAGE_HOSTS = {
    "mmbiz.qpic.cn",
    "mmbiz.qlogo.cn",
}


class SourceFeedWorkspaceHydrateRequest(BaseModel):
    article_ids: list[int] = Field(..., min_length=1, max_length=20)


def _get_information_collection_base_url() -> str:
    return os.getenv("INFORMATION_COLLECTION_BASE_URL", "http://ic.nexus.tashan.ac.cn").rstrip("/")


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
):
    upstream_url = f"{_get_information_collection_base_url()}/api/v1/articles"

    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            response = await client.get(upstream_url, params={"limit": limit, "offset": offset})
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

    return {
        "list": [_normalize_article(item) for item in raw_list if isinstance(item, dict)],
        "limit": int(data.get("limit", limit)),
        "offset": int(data.get("offset", offset)),
    }


@router.get("/articles/{article_id}")
async def get_source_feed_article_detail(article_id: int):
    try:
        article = await fetch_source_feed_article_detail(article_id)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail="上游信源服务请求失败") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"获取信源全文失败: {exc}") from exc
    return article.__dict__


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
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            upstream = await client.get(image_url, headers=headers)
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
