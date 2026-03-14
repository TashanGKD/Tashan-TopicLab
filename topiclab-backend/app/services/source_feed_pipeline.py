"""Source-feed article fetch and workspace materialization helpers."""

from __future__ import annotations

import json
import os
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx

from app.services.http_client import get_shared_async_client

@dataclass
class SourceArticle:
    id: int
    title: str
    source_feed_name: str
    source_type: str
    url: str
    pic_url: str | None
    description: str
    publish_time: str
    created_at: str
    content_md: str = ""
    content_source: str = ""
    md_path: str = ""
    run_dir: str = ""


def get_information_collection_base_url() -> str:
    return os.getenv("INFORMATION_COLLECTION_BASE_URL", "http://ic.nexus.tashan.ac.cn").rstrip("/")


def get_workspace_base() -> Path:
    explicit = os.getenv("WORKSPACE_BASE")
    if explicit:
        return Path(explicit).expanduser().resolve()
    return (Path(__file__).resolve().parents[3] / "workspace").resolve()


def get_materials_dir(topic_id: str) -> Path:
    return get_workspace_base() / "topics" / topic_id / "shared" / "source_feed"


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


def _normalize_article(article: dict[str, Any]) -> SourceArticle:
    return SourceArticle(
        id=int(article.get("id", 0)),
        title=str(article.get("title", "")),
        source_feed_name=str(article.get("source_feed_name", "")),
        source_type=str(article.get("source_type", "")),
        url=str(article.get("url", "")),
        pic_url=_normalize_pic_url(article.get("pic_url")),
        description=str(article.get("description", "")),
        publish_time=str(article.get("publish_time", "")),
        created_at=str(article.get("created_at", "")),
        content_md=str(article.get("content_md", "")),
        content_source=str(article.get("content_source", "")),
        md_path=str(article.get("md_path", "")),
        run_dir=str(article.get("run_dir", "")),
    )


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return slug[:48] or "article"


def _material_relpath(topic_id: str, file_path: Path) -> str:
    base = get_workspace_base() / "topics" / topic_id
    return str(file_path.relative_to(base))


def _validate_topic_workspace(topic_id: str) -> Path:
    if not re.fullmatch(r"[a-zA-Z0-9_-]+", topic_id):
        raise ValueError("Invalid topic_id")
    topic_root = get_workspace_base() / "topics" / topic_id
    if not topic_root.exists():
        raise FileNotFoundError(f"Topic workspace does not exist: {topic_id}")
    return topic_root


async def fetch_source_feed_articles(limit: int = 20, offset: int = 0) -> list[SourceArticle]:
    upstream_url = f"{get_information_collection_base_url()}/api/v1/articles"
    client = get_shared_async_client("source-feed")
    response = await client.get(upstream_url, params={"limit": limit, "offset": offset}, timeout=15.0)
    response.raise_for_status()
    payload = response.json()
    data = payload.get("data", {})
    raw_list = data.get("list", [])
    return [_normalize_article(item) for item in raw_list if isinstance(item, dict)]


async def fetch_source_feed_article_detail(article_id: int) -> SourceArticle:
    upstream_url = f"{get_information_collection_base_url()}/api/v1/articles/{article_id}"
    client = get_shared_async_client("source-feed")
    response = await client.get(upstream_url, timeout=20.0)
    response.raise_for_status()
    payload = response.json()
    data = payload.get("data")
    if not isinstance(data, dict):
        raise ValueError(f"Unexpected article detail payload for article_id={article_id}")
    return _normalize_article(data)


async def hydrate_topic_workspace(topic_id: str, article_ids: list[int]) -> dict[str, Any]:
    _validate_topic_workspace(topic_id)
    materials_dir = get_materials_dir(topic_id)
    materials_dir.mkdir(parents=True, exist_ok=True)

    articles: list[SourceArticle] = []
    written_files: list[str] = []
    for article_id in article_ids:
        article = await fetch_source_feed_article_detail(article_id)
        articles.append(article)
        filename = f"article_{article.id}_{_slugify(article.title)}.md"
        file_path = materials_dir / filename
        content = (
            f"# {article.title}\n\n"
            f"- article_id: {article.id}\n"
            f"- source_feed_name: {article.source_feed_name}\n"
            f"- publish_time: {article.publish_time}\n"
            f"- url: {article.url}\n\n"
            "## content_md\n\n"
            f"{article.content_md.strip()}\n"
        )
        file_path.write_text(content, encoding="utf-8")
        written_files.append(_material_relpath(topic_id, file_path))

    manifest_path = materials_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "topic_id": topic_id,
                "articles": [asdict(article) for article in articles],
                "written_files": written_files,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    readme_path = materials_dir / "README.md"
    readme_path.write_text(
        "# Source Feed Materials\n\n"
        "本目录由 TopicLab 后端自动写入，供 Resonnet 讨论时直接读取本地全文。\n\n"
        + "\n".join(f"- `{path}`" for path in written_files),
        encoding="utf-8",
    )
    manifest_rel = _material_relpath(topic_id, manifest_path)
    readme_rel = _material_relpath(topic_id, readme_path)
    return {
        "topic_id": topic_id,
        "article_ids": article_ids,
        "written_files": [readme_rel, manifest_rel, *written_files],
        "manifest_path": manifest_rel,
        "readme_path": readme_rel,
    }
