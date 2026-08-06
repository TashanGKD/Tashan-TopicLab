"""Read-only access to the active, taxonomy-reviewed science MCP catalog."""

from __future__ import annotations

import hashlib
import json
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from fastapi import HTTPException


CATALOG_PATH = Path(
    os.getenv("SCIENCE_MCP_CATALOG_PATH", str(Path(__file__).resolve().parents[1] / "data" / "science_mcp_catalog.json"))
)
SEARCH_FIELDS = (
    "id",
    "name",
    "summary",
    "task",
    "domain",
    "subdomain",
    "stage",
    "function",
    "status",
    "evidence",
    "overlap_difference",
    "rationale",
    "tags",
    "capabilities",
    "framework",
    "compatibility_level",
    "license",
    "latest_version",
    "install_command",
    "transport",
    "source_name",
    "info_page",
)
READINESS_ORDER = {"trusted": 0, "provisional": 1, "restricted": 2}
EVIDENCE_SCOPE_ORDER = {"source_reviewed": 0, "fast_metadata_triage": 1}
SORT_LABELS = {
    "organized": "按领域路径",
    "evidence": "按资料核对",
    "tools": "按工具数量",
    "name": "按名称",
}
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def normalize_canonical_url(value: str) -> str:
    """Normalize a source URL for identity checks without rewriting stored evidence."""
    raw = str(value or "").strip()
    parsed = urlsplit(raw)
    if not parsed.scheme or not parsed.netloc:
        return raw.casefold().rstrip("/")
    try:
        port = parsed.port
    except ValueError:
        return raw.casefold().rstrip("/")
    host = (parsed.hostname or "").casefold()
    if (parsed.scheme.casefold(), port) in {("http", 80), ("https", 443)}:
        port = None
    netloc = host + (f":{port}" if port is not None else "")
    path = parsed.path.rstrip("/") or "/"
    return urlunsplit((parsed.scheme.casefold(), netloc, path, parsed.query, ""))


def _tokens(value: str) -> set[str]:
    normalized = value.casefold()
    tokens = set(re.findall(r"[a-z0-9][a-z0-9+._-]{1,}", normalized))
    for run in re.findall(r"[\u4e00-\u9fff]+", normalized):
        tokens.update(run[index : index + width] for width in (2, 3, 4) for index in range(max(0, len(run) - width + 1)))
    return tokens


def _score(item: dict[str, Any], query: str) -> int:
    if not query:
        return 0
    haystack = " ".join(str(item.get(key) or "") for key in SEARCH_FIELDS).casefold()
    compact_query = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", query.casefold())
    compact_haystack = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", haystack)
    query_tokens = _tokens(query)
    if compact_query and compact_query in compact_haystack:
        return max(1, len(query_tokens)) + 4
    return len(query_tokens & _tokens(haystack))


@lru_cache(maxsize=1)
def _load_catalog() -> tuple[dict[str, Any], str]:
    raw = CATALOG_PATH.read_bytes()
    payload = json.loads(raw.decode("utf-8"))
    if payload.get("schema") != "science_mcp_catalog_v1" or not isinstance(payload.get("mcps"), list):
        raise RuntimeError("Invalid science MCP catalog snapshot")
    dimensions = payload.get("dimensions")
    if not isinstance(dimensions, dict) or any(not isinstance(dimensions.get(key), list) for key in ("domains", "subdomains", "stages", "functions")):
        raise RuntimeError("Science MCP catalog dimensions are invalid")
    items = payload["mcps"]
    if payload.get("active_catalog_count") != len(items):
        raise RuntimeError("Science MCP catalog count does not match payload")
    ids = [str(item.get("id") or "") for item in items]
    urls = [str(item.get("source_url") or "") for item in items]
    if any(not value for value in ids + urls) or len(ids) != len(set(ids)) or len(urls) != len(set(urls)):
        raise RuntimeError("Science MCP catalog contains duplicate or empty identity fields")
    normalized_urls = [normalize_canonical_url(value) for value in urls]
    if len(normalized_urls) != len(set(normalized_urls)):
        raise RuntimeError("Science MCP catalog contains duplicate normalized canonical URLs")
    allowed = {key: set(dimensions[key]) for key in ("domains", "subdomains", "stages", "functions")}
    for item in items:
        if item.get("domain") not in allowed["domains"] or item.get("subdomain") not in allowed["subdomains"]:
            raise RuntimeError(f"Science MCP catalog has invalid domain taxonomy: {item.get('id')}")
        if item.get("stage") not in allowed["stages"] or item.get("function") not in allowed["functions"]:
            raise RuntimeError(f"Science MCP catalog has invalid stage/function taxonomy: {item.get('id')}")
        if item.get("evidence_scope") not in {"fast_metadata_triage", "source_reviewed"}:
            raise RuntimeError(f"Science MCP catalog has invalid evidence scope: {item.get('id')}")
        if item.get("review_status") != "taxonomy_reviewed" or not str(item.get("classification_rationale") or "").strip():
            raise RuntimeError(f"Science MCP catalog has incomplete taxonomy review: {item.get('id')}")
        verification = item.get("source_verification")
        if not isinstance(verification, dict) or not verification.get("observed_path"):
            raise RuntimeError(f"Science MCP catalog lacks source verification: {item.get('id')}")
        if verification.get("fetch_status") == "fetched" and not SHA256_RE.fullmatch(str(verification.get("content_sha256") or "")):
            raise RuntimeError(f"Science MCP catalog has untraceable fetched content: {item.get('id')}")
        if "source_metadata" in item or "content_path" in verification:
            raise RuntimeError(f"Science MCP catalog exposes local cache metadata: {item.get('id')}")
    return payload, hashlib.sha256(raw).hexdigest()


def get_mcp_catalog_meta() -> dict[str, Any]:
    payload, digest = _load_catalog()
    return {
        "schema": payload["schema"],
        "total": payload["active_catalog_count"],
        "active_catalog_count": payload["active_catalog_count"],
        "retired_archive_excluded": bool(payload.get("retired_archive_excluded", True)),
        "generated_at": payload.get("generated_at"),
        "dimensions": payload["dimensions"],
        "taxonomy_index": payload.get("taxonomy_index") or {},
        "hub_index": payload.get("hub_index") or {},
        "skillhub_parity": payload.get("skillhub_parity") or {},
        "product_surface": {
            "catalog_mode": "taxonomy_reviewed_only",
            "read_only_surfaces": ["library", "search", "categories", "detail", "content", "asset", "guide", "share", "download_status"],
            "community_features": ["favorite", "review", "helpful", "wish", "collection", "profile", "leaderboard", "submission"],
            "candidate_status": "needs_review",
            "active_catalog_effect": "none_until_taxonomy_reviewed_sync",
            "download_status": "safe_placeholder_unavailable",
            "execution_or_installation": False,
        },
        "source": {**(payload.get("source") or {}), "snapshot_sha256": digest},
    }


def get_mcp_catalog_items() -> list[dict[str, Any]]:
    payload, _ = _load_catalog()
    return list(payload["mcps"])


def list_mcp_catalog(
    *,
    q: str | None = None,
    domain: str | None = None,
    subdomain: str | None = None,
    stage: str | None = None,
    function: str | None = None,
    status: str | None = None,
    readiness: str | None = None,
    sort: str | None = None,
    limit: int = 24,
    offset: int = 0,
) -> dict[str, Any]:
    payload, _ = _load_catalog()
    query = (q or "").strip()
    expected = {
        "domain": (domain or "").strip(),
        "subdomain": (subdomain or "").strip(),
        "stage": (stage or "").strip(),
        "function": (function or "").strip(),
        "status": (status or "").strip(),
        "readiness": (readiness or "").strip(),
    }
    matches = [
        item
        for item in payload["mcps"]
        if (not query or _score(item, query) > 0)
        and all(not value or str(item.get(key) or "") == value for key, value in expected.items())
    ]
    sort_mode = str(sort or "organized").strip().casefold()
    if sort_mode not in SORT_LABELS:
        sort_mode = "organized"
    def tool_count(item: dict[str, Any]) -> int:
        evidence = item.get("capability_evidence") or {}
        return max(len(item.get("capabilities") or []), int(evidence.get("tool_count") or 0))
    def organized_key(item: dict[str, Any]) -> tuple[Any, ...]:
        return (
            str(item.get("domain") or "").casefold(),
            str(item.get("subdomain") or "").casefold(),
            str(item.get("stage") or "").casefold(),
            str(item.get("function") or "").casefold(),
            str(item.get("name") or item.get("id") or "").casefold(),
        )
    def item_key(item: dict[str, Any]) -> tuple[Any, ...]:
        score_key = -_score(item, query)
        if sort_mode == "name":
            return (score_key, str(item.get("name") or item.get("id") or "").casefold())
        if sort_mode == "tools":
            return (score_key, -tool_count(item), organized_key(item))
        if sort_mode == "evidence":
            return (
                score_key,
                EVIDENCE_SCOPE_ORDER.get(str(item.get("evidence_scope") or ""), 9),
                -int(item.get("quality_score") or 0),
                organized_key(item),
            )
        return (score_key, organized_key(item))
    matches.sort(key=item_key)
    safe_limit = max(1, min(int(limit), 100))
    safe_offset = max(0, int(offset))
    return {"list": matches[safe_offset : safe_offset + safe_limit], "total": len(matches), "limit": safe_limit, "offset": safe_offset, "sort": sort_mode, "sort_label": SORT_LABELS[sort_mode]}


def _mcp_card_projection(item: dict[str, Any]) -> dict[str, Any]:
    """Keep related MCPs in the same card shape as SkillHub related skills."""
    fields = (
        "id", "slug", "name", "tagline", "summary", "description", "domain",
        "subdomain", "stage", "function", "task", "category_key", "category_name",
        "cluster_key", "cluster_name", "tags", "capabilities", "framework",
        "capability_evidence", "information_status",
        "compatibility_level", "pricing_status", "price_points", "license",
        "license_status", "license_source", "license_raw", "license_evidence",
        "source_url", "source_name", "docs_url", "latest_version", "featured",
        "hero_note", "total_reviews", "avg_rating", "total_favorites",
        "total_downloads", "weekly_downloads", "viewer_favorited", "created_at",
        "updated_at", "published_at", "quality_score", "readiness", "status",
        "transport", "info_page_fetched",
    )
    return {field: item.get(field) for field in fields}


def get_mcp_catalog_item(mcp_id: str, *, include_related: bool = False) -> dict[str, Any]:
    payload, _ = _load_catalog()
    needle = mcp_id.strip()
    for item in payload["mcps"]:
        if item.get("id") == needle:
            if not include_related:
                return item
            related = [
                candidate
                for candidate in payload["mcps"]
                if candidate.get("id") != needle
                and (
                    candidate.get("subdomain") == item.get("subdomain")
                    or candidate.get("domain") == item.get("domain")
                )
            ]
            related.sort(
                key=lambda candidate: (
                    candidate.get("subdomain") != item.get("subdomain"),
                    candidate.get("domain") != item.get("domain"),
                    -int(candidate.get("quality_score") or 0),
                    str(candidate.get("name") or candidate.get("id") or "").casefold(),
                )
            )
            detail = dict(item)
            # MCP Hub is catalog-only, so it has no executable package versions;
            # retaining the SkillHub detail key keeps consumers schema-aligned.
            detail["versions"] = []
            detail["reviews"] = []
            detail["related_mcps"] = [_mcp_card_projection(candidate) for candidate in related[:4]]
            return detail
    raise HTTPException(status_code=404, detail="科研 MCP 不存在")


def get_mcp_catalog_categories() -> dict[str, Any]:
    payload, _ = _load_catalog()
    dimensions = payload["dimensions"]
    counts: dict[str, dict[str, int]] = {key: {value: 0 for value in values} for key, values in dimensions.items()}
    status_counts: dict[str, int] = {}
    item_keys = {"domains": "domain", "subdomains": "subdomain", "stages": "stage", "functions": "function"}
    for item in payload["mcps"]:
        for dimension_key, item_key in item_keys.items():
            counts[dimension_key][str(item[item_key])] += 1
        status = str(item.get("status") or "unknown")
        status_counts[status] = status_counts.get(status, 0) + 1
    return {
        "dimensions": dimensions,
        "counts": counts,
        "status_counts": status_counts,
        "taxonomy_index": payload.get("taxonomy_index") or {},
        "hub_index": payload.get("hub_index") or {},
    }
