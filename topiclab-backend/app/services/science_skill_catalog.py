"""Read-only, source-traceable access to the built-in science skill catalog."""

from __future__ import annotations

import hashlib
import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import HTTPException


CATALOG_PATH = Path(__file__).resolve().parents[1] / "data" / "science_skill_catalog.json"
SOURCE_REPOSITORY = "TashanGKD/tashan-research-skills"
SOURCE_PATH = "skills/find-science-skills/data/science_skill_catalog.json"

READINESS_ORDER = {"trusted": 0, "provisional": 1, "restricted": 2}
SOURCE_REVIEW_ORDER = {
    "manual_confirmed": 0,
    "model_assisted_full_source_review": 1,
    "metadata_reviewed": 2,
    "needs_source_review": 3,
}
SEARCH_FIELDS = ("id", "name", "summary", "domain", "subdomain", "stage", "function", "task")
SEARCH_STOPWORDS = frozenset({
    "a", "an", "and", "for", "help", "in", "need", "of", "research", "the", "to", "use", "with",
    "一个", "使用", "帮我", "帮助", "科研", "研究", "需要", "搜索", "技能", "工具",
})


@lru_cache(maxsize=1)
def _load_catalog() -> tuple[dict[str, Any], str]:
    raw = CATALOG_PATH.read_bytes()
    payload = json.loads(raw.decode("utf-8"))
    skills = payload.get("skills")
    if payload.get("schema") != "science_skill_catalog_v1" or not isinstance(skills, list):
        raise RuntimeError("Invalid built-in science skill catalog")
    if payload.get("skill_count") != len(skills):
        raise RuntimeError("Built-in science skill catalog count does not match payload")
    ids = [str(item.get("id") or "") for item in skills]
    if any(not item for item in ids) or len(ids) != len(set(ids)):
        raise RuntimeError("Built-in science skill catalog contains empty or duplicate IDs")
    return payload, hashlib.sha256(raw).hexdigest()


def get_catalog_meta() -> dict[str, Any]:
    payload, digest = _load_catalog()
    return {
        "schema": payload["schema"],
        "total": int(payload["skill_count"]),
        "source_skill_count": int(payload.get("source_skill_count") or payload["skill_count"]),
        "excluded_non_scientific_count": int(payload.get("excluded_non_scientific_count") or 0),
        "dimensions": payload["dimensions"],
        "source": {
            "repository": SOURCE_REPOSITORY,
            "path": SOURCE_PATH,
            "sha256": digest,
        },
    }


def get_catalog_items() -> list[dict[str, Any]]:
    payload, _ = _load_catalog()
    return list(payload["skills"])


def _search_tokens(value: str) -> set[str]:
    normalized = value.casefold()
    tokens = set(re.findall(r"[a-z0-9][a-z0-9+._-]{1,}", normalized))
    for run in re.findall(r"[\u4e00-\u9fff]+", normalized):
        for width in (2, 3, 4):
            tokens.update(run[index : index + width] for index in range(max(0, len(run) - width + 1)))
    return tokens


def _query_match_score(item: dict[str, Any], query: str) -> int:
    if not query:
        return 0
    haystack = " ".join(str(item.get(key) or "") for key in SEARCH_FIELDS).casefold()
    compact_query = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", query.casefold())
    compact_haystack = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", haystack)
    query_tokens = {token for token in _search_tokens(query) if token not in SEARCH_STOPWORDS}
    item_tokens = _search_tokens(haystack)
    if compact_query and compact_query in compact_haystack:
        return max(1, len(query_tokens)) + 2
    return len(query_tokens & item_tokens)


def _matches_query(item: dict[str, Any], query: str) -> bool:
    if not query:
        return True
    return _query_match_score(item, query) > 0


def list_catalog_skills(
    *,
    q: str | None = None,
    domain: str | None = None,
    subdomain: str | None = None,
    stage: str | None = None,
    function: str | None = None,
    readiness: str | None = None,
    limit: int = 24,
    offset: int = 0,
) -> dict[str, Any]:
    payload, _ = _load_catalog()
    query = (q or "").strip().casefold()
    expected = {
        "domain": (domain or "").strip(),
        "subdomain": (subdomain or "").strip(),
        "stage": (stage or "").strip(),
        "function": (function or "").strip(),
        "readiness": (readiness or "").strip(),
    }
    matches = [
        item
        for item in payload["skills"]
        if _matches_query(item, query)
        and all(not value or str(item.get(key) or "") == value for key, value in expected.items())
    ]
    matches.sort(
        key=lambda item: (
            -_query_match_score(item, query),
            READINESS_ORDER.get(str(item.get("readiness") or ""), 9),
            SOURCE_REVIEW_ORDER.get(str(item.get("review_status") or ""), 9),
            -int(item.get("quality_score") or 0),
            str(item.get("name") or item.get("id") or "").casefold(),
        )
    )
    safe_limit = max(1, min(int(limit), 100))
    safe_offset = max(0, int(offset))
    return {
        "list": matches[safe_offset : safe_offset + safe_limit],
        "total": len(matches),
        "limit": safe_limit,
        "offset": safe_offset,
    }


def get_catalog_skill(canonical_id: str) -> dict[str, Any]:
    payload, _ = _load_catalog()
    for item in payload["skills"]:
        if item.get("id") == canonical_id:
            return item
    raise HTTPException(status_code=404, detail="科研 Skill 不存在")
