"""Read-only access to the active, taxonomy-reviewed science MCP catalog."""

from __future__ import annotations

import hashlib
import json
import os
import re
import zlib
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from app.services.science_mcp_catalog_db import (
    database_matches_source,
    decode_catalog_payload,
    hashed_search_terms,
    normalize_canonical_url,
    open_catalog_database,
    search_tokens,
    validate_catalog_snapshot,
)


CATALOG_PATH = Path(
    os.getenv(
        "SCIENCE_MCP_CATALOG_PATH",
        str(Path(__file__).resolve().parents[1] / "data" / "science_mcp_catalog.json"),
    )
)
CATALOG_DATABASE_PATH = Path(
    os.getenv("SCIENCE_MCP_CATALOG_DB_PATH", str(CATALOG_PATH.with_suffix(".sqlite3")))
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
SORT_LABELS = {
    "organized": "按领域路径",
    "evidence": "按资料核对",
    "tools": "按工具数量",
    "name": "按名称",
}
EVIDENCE_SCOPE_ORDER = {"source_reviewed": 0, "fast_metadata_triage": 1}


def _tokens(value: str) -> set[str]:
    return search_tokens(value)


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
    """Fallback loader for source checkouts without a compiled runtime index."""

    raw = CATALOG_PATH.read_bytes()
    payload = json.loads(raw.decode("utf-8"))
    validate_catalog_snapshot(payload)
    return payload, hashlib.sha256(raw).hexdigest()


@lru_cache(maxsize=1)
def _runtime_database_path() -> Path | None:
    if database_matches_source(CATALOG_PATH, CATALOG_DATABASE_PATH):
        return CATALOG_DATABASE_PATH
    return None


def _database_metadata(database: Path) -> tuple[dict[str, Any], str]:
    with open_catalog_database(database) as connection:
        metadata = dict(connection.execute("SELECT key, value FROM catalog_metadata"))
    return json.loads(metadata["catalog_json"]), metadata["source_sha256"]


def _public_meta(payload: dict[str, Any], digest: str) -> dict[str, Any]:
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
            "read_only_surfaces": [
                "library",
                "search",
                "categories",
                "detail",
                "content",
                "asset",
                "guide",
                "share",
                "download_status",
            ],
            "community_features": [
                "favorite",
                "review",
                "helpful",
                "wish",
                "collection",
                "profile",
                "leaderboard",
                "submission",
            ],
            "candidate_status": "needs_review",
            "active_catalog_effect": "none_until_taxonomy_reviewed_sync",
            "download_status": "safe_placeholder_unavailable",
            "execution_or_installation": False,
        },
        "source": {**(payload.get("source") or {}), "snapshot_sha256": digest},
    }


def get_mcp_catalog_meta() -> dict[str, Any]:
    database = _runtime_database_path()
    if database is not None:
        payload, digest = _database_metadata(database)
    else:
        payload, digest = _load_catalog()
    return _public_meta(payload, digest)


@lru_cache(maxsize=1)
def _database_finder_items(database_path: str) -> tuple[dict[str, Any], ...]:
    with open_catalog_database(Path(database_path)) as connection:
        rows = connection.execute("SELECT finder_json FROM mcps ORDER BY position").fetchall()
    return tuple(json.loads(zlib.decompress(row["finder_json"]).decode("utf-8")) for row in rows)


def get_mcp_catalog_items() -> list[dict[str, Any]]:
    """Return the lightweight fields needed by the semantic finder."""

    database = _runtime_database_path()
    if database is not None:
        return [dict(item) for item in _database_finder_items(str(database))]
    payload, _ = _load_catalog()
    return list(payload["mcps"])


def _safe_sort_mode(value: str | None) -> str:
    mode = str(value or "organized").strip().casefold()
    return mode if mode in SORT_LABELS else "organized"


def _database_order(sort_mode: str, *, searching: bool) -> str:
    score = "bm25(mcp_search), " if searching else ""
    organized = "m.domain, m.subdomain, m.stage, m.function_name, m.name_sort, m.id"
    if sort_mode == "name":
        return f"{score}m.name_sort, m.id"
    if sort_mode == "tools":
        return f"{score}m.tool_count DESC, {organized}"
    if sort_mode == "evidence":
        return f"{score}m.evidence_rank, m.quality_score DESC, {organized}"
    return f"{score}{organized}"


def _list_mcp_catalog_database(
    database: Path,
    *,
    query: str,
    expected: dict[str, str],
    sort_mode: str,
    limit: int,
    offset: int,
) -> dict[str, Any]:
    clauses: list[str] = []
    parameters: list[Any] = []
    from_sql = "mcps m"
    if query:
        terms = hashed_search_terms(query)
        if not terms:
            return {
                "list": [],
                "total": 0,
                "limit": limit,
                "offset": offset,
                "sort": sort_mode,
                "sort_label": SORT_LABELS[sort_mode],
            }
        from_sql = "mcp_search JOIN mcps m ON m.position = mcp_search.rowid - 1"
        clauses.append("mcp_search.terms MATCH ?")
        parameters.append(" OR ".join(terms))
    column_names = {
        "domain": "m.domain",
        "subdomain": "m.subdomain",
        "stage": "m.stage",
        "function": "m.function_name",
        "status": "m.status",
        "readiness": "m.readiness",
    }
    for key, value in expected.items():
        if value:
            clauses.append(f"{column_names[key]} = ?")
            parameters.append(value)
    where_sql = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    order_sql = _database_order(sort_mode, searching=bool(query))
    with open_catalog_database(database) as connection:
        total = int(
            connection.execute(
                f"SELECT COUNT(*) FROM {from_sql}{where_sql}",
                parameters,
            ).fetchone()[0]
        )
        rows = connection.execute(
            f"SELECT m.payload FROM {from_sql}{where_sql} "
            f"ORDER BY {order_sql} LIMIT ? OFFSET ?",
            [*parameters, limit, offset],
        ).fetchall()
    return {
        "list": [decode_catalog_payload(row["payload"]) for row in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
        "sort": sort_mode,
        "sort_label": SORT_LABELS[sort_mode],
    }


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
    query = (q or "").strip()
    expected = {
        "domain": (domain or "").strip(),
        "subdomain": (subdomain or "").strip(),
        "stage": (stage or "").strip(),
        "function": (function or "").strip(),
        "status": (status or "").strip(),
        "readiness": (readiness or "").strip(),
    }
    sort_mode = _safe_sort_mode(sort)
    safe_limit = max(1, min(int(limit), 100))
    safe_offset = max(0, int(offset))
    database = _runtime_database_path()
    if database is not None:
        return _list_mcp_catalog_database(
            database,
            query=query,
            expected=expected,
            sort_mode=sort_mode,
            limit=safe_limit,
            offset=safe_offset,
        )

    payload, _ = _load_catalog()
    matches = [
        item
        for item in payload["mcps"]
        if (not query or _score(item, query) > 0)
        and all(not value or str(item.get(key) or "") == value for key, value in expected.items())
    ]

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
    return {
        "list": matches[safe_offset : safe_offset + safe_limit],
        "total": len(matches),
        "limit": safe_limit,
        "offset": safe_offset,
        "sort": sort_mode,
        "sort_label": SORT_LABELS[sort_mode],
    }


def _mcp_card_projection(item: dict[str, Any]) -> dict[str, Any]:
    """Keep related MCPs in the same card shape as SkillHub related skills."""

    fields = (
        "id",
        "slug",
        "name",
        "tagline",
        "summary",
        "description",
        "domain",
        "subdomain",
        "stage",
        "function",
        "task",
        "category_key",
        "category_name",
        "cluster_key",
        "cluster_name",
        "tags",
        "capabilities",
        "framework",
        "capability_evidence",
        "information_status",
        "compatibility_level",
        "pricing_status",
        "price_points",
        "license",
        "license_status",
        "license_source",
        "license_raw",
        "license_evidence",
        "source_url",
        "source_name",
        "docs_url",
        "latest_version",
        "featured",
        "hero_note",
        "total_reviews",
        "avg_rating",
        "total_favorites",
        "total_downloads",
        "weekly_downloads",
        "viewer_favorited",
        "created_at",
        "updated_at",
        "published_at",
        "quality_score",
        "readiness",
        "status",
        "transport",
        "info_page_fetched",
    )
    return {field: item.get(field) for field in fields}


def _database_item(database: Path, mcp_id: str) -> dict[str, Any] | None:
    with open_catalog_database(database) as connection:
        row = connection.execute("SELECT payload FROM mcps WHERE id = ? LIMIT 1", (mcp_id,)).fetchone()
    return decode_catalog_payload(row["payload"]) if row is not None else None


def hydrate_mcp_catalog_results(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Hydrate finder projections only after ranking has selected a small result set."""

    if not results:
        return []
    database = _runtime_database_path()
    if database is None:
        return results
    ids = [str(result.get("id") or "") for result in results]
    placeholders = ",".join("?" for _ in ids)
    with open_catalog_database(database) as connection:
        rows = connection.execute(
            f"SELECT id, payload FROM mcps WHERE id IN ({placeholders})",
            ids,
        ).fetchall()
    payloads = {str(row["id"]): decode_catalog_payload(row["payload"]) for row in rows}
    hydrated: list[dict[str, Any]] = []
    for result in results:
        item = payloads.get(str(result.get("id") or ""))
        if item is None:
            continue
        enriched = dict(item)
        enriched.update(
            {
                key: value
                for key, value in result.items()
                if key in {"rank", "recommendation_reason", "ranking_signals"}
            }
        )
        hydrated.append(enriched)
    return hydrated


def get_mcp_catalog_item(mcp_id: str, *, include_related: bool = False) -> dict[str, Any]:
    needle = mcp_id.strip()
    database = _runtime_database_path()
    if database is not None:
        item = _database_item(database, needle)
        if item is None:
            raise HTTPException(status_code=404, detail="科研 MCP 不存在")
        if not include_related:
            return item
        with open_catalog_database(database) as connection:
            rows = connection.execute(
                """
                SELECT payload FROM mcps
                WHERE id != ? AND (subdomain = ? OR domain = ?)
                ORDER BY
                    CASE WHEN subdomain = ? THEN 0 ELSE 1 END,
                    CASE WHEN domain = ? THEN 0 ELSE 1 END,
                    quality_score DESC,
                    name_sort,
                    id
                LIMIT 4
                """,
                (needle, item.get("subdomain"), item.get("domain"), item.get("subdomain"), item.get("domain")),
            ).fetchall()
        related = [decode_catalog_payload(row["payload"]) for row in rows]
    else:
        payload, _ = _load_catalog()
        item = next((candidate for candidate in payload["mcps"] if candidate.get("id") == needle), None)
        if item is None:
            raise HTTPException(status_code=404, detail="科研 MCP 不存在")
        if not include_related:
            return item
        related = [
            candidate
            for candidate in payload["mcps"]
            if candidate.get("id") != needle
            and (candidate.get("subdomain") == item.get("subdomain") or candidate.get("domain") == item.get("domain"))
        ]
        related.sort(
            key=lambda candidate: (
                candidate.get("subdomain") != item.get("subdomain"),
                candidate.get("domain") != item.get("domain"),
                -int(candidate.get("quality_score") or 0),
                str(candidate.get("name") or candidate.get("id") or "").casefold(),
            )
        )
        related = related[:4]
    detail = dict(item)
    detail["versions"] = []
    detail["reviews"] = []
    detail["related_mcps"] = [_mcp_card_projection(candidate) for candidate in related]
    return detail


def get_mcp_catalog_categories() -> dict[str, Any]:
    database = _runtime_database_path()
    if database is not None:
        with open_catalog_database(database) as connection:
            row = connection.execute(
                "SELECT value FROM catalog_metadata WHERE key = 'categories_json'"
            ).fetchone()
        return json.loads(row["value"])

    payload, _ = _load_catalog()
    dimensions = payload["dimensions"]
    counts: dict[str, dict[str, int]] = {
        key: {value: 0 for value in values}
        for key, values in dimensions.items()
    }
    status_counts: dict[str, int] = {}
    item_keys = {
        "domains": "domain",
        "subdomains": "subdomain",
        "stages": "stage",
        "functions": "function",
    }
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
