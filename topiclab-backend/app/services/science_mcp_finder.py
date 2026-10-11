"""AgentScope-assisted routing over the active science MCP catalog."""

from __future__ import annotations

import logging
import re
from functools import lru_cache
from typing import Any

from starlette.concurrency import run_in_threadpool

from app.services.science_mcp_catalog import (
    get_mcp_catalog_items,
    get_mcp_catalog_meta,
    hydrate_mcp_catalog_results,
)
from app.services.science_skill_finder import (
    GENERIC_QUERY_TOKENS,
    FinderEventCallback,
    _apply_semantic_recommendations,
    _clean_route,
    _compact_text,
    _recommend_with_agentscope,
    _route_with_agentscope,
    _text_tokens,
    get_finder_capabilities,
    get_finder_config,
)


logger = logging.getLogger(__name__)
EVIDENCE_FIELDS = (
    "name",
    "id",
    "task",
    "summary",
    "description",
    "tags",
    "capabilities",
    "subdomain",
    "domain",
    "stage",
    "function",
)
READINESS_ORDER = {"trusted": 0, "provisional": 1, "restricted": 2}
SOURCE_REVIEW_ORDER = {"source_reviewed": 0, "fast_metadata_triage": 1}
RANKING_CRITERIA = [
    {"key": "semantic_match", "label": "需求语义匹配"},
    {"key": "task_match", "label": "任务匹配"},
    {"key": "function_match", "label": "功能偏好"},
    {"key": "quality_score", "label": "资料完整度"},
]
LOCAL_RANKING_CRITERIA = [
    {"key": "task_match", "label": "任务匹配"},
    {"key": "function_match", "label": "功能偏好"},
    {"key": "quality_score", "label": "资料完整度"},
]


def _load_finder_catalog() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Load catalog state outside the async event loop."""

    return get_mcp_catalog_meta(), get_mcp_catalog_items()


async def _emit_finder_event(
    callback: FinderEventCallback | None,
    event: str,
    payload: dict[str, Any],
) -> None:
    if callback is not None:
        await callback(event, payload)


def get_mcp_finder_capabilities() -> dict[str, Any]:
    """Expose the SkillHub model/fallback contract for MCP discovery."""
    capabilities = dict(get_finder_capabilities())
    capabilities["agent_api"] = {
        "read_only": True,
        "catalog_scope": "taxonomy_reviewed_only",
        "retired_archive_excluded": True,
        "search": {
            "method": "POST",
            "path": "/api/v1/mcp-hub/science-catalog/find",
            "request": {"query": "string", "limit": "integer<=12"},
            "response": ["query", "route", "results", "total", "ranking", "driver"],
        },
        "stream": {
            "method": "POST",
            "path": "/api/v1/mcp-hub/science-catalog/find/stream",
            "events": ["status", "route", "result", "done"],
        },
    }
    return capabilities


@lru_cache(maxsize=1)
def _catalog_token_document_frequency() -> tuple[int, dict[str, int]]:
    frequencies: dict[str, int] = {}
    items = get_mcp_catalog_items()
    for item in items:
        item_tokens: set[str] = set()
        for field in EVIDENCE_FIELDS:
            item_tokens.update(_text_tokens(str(item.get(field) or "")))
        for token in item_tokens:
            frequencies[token] = frequencies.get(token, 0) + 1
    return len(items), frequencies


def _has_distinctive_catalog_evidence(
    query: str,
    dimensions: dict[str, list[str]],
    items: list[dict[str, Any]],
) -> bool:
    compact_query = _compact_text(query)
    if not compact_query:
        return False
    labels = {
        _compact_text(label)
        for values in dimensions.values()
        for label in values
        if label
    }
    if any(
        label and (label in compact_query or (len(compact_query) >= 2 and compact_query in label))
        for label in labels
    ):
        return True
    for item in items:
        if compact_query in {
            _compact_text(str(item.get("name") or "")),
            _compact_text(str(item.get("id") or "")),
        }:
            return True
        if len(compact_query) >= 4 and compact_query in _compact_text(str(item.get("task") or "")):
            return True
    catalog_size, frequencies = _catalog_token_document_frequency()
    max_frequency = max(2, catalog_size // 20)
    for token in _text_tokens(query):
        if token in GENERIC_QUERY_TOKENS:
            continue
        frequency = frequencies.get(token, 0)
        if 2 <= frequency <= max_frequency:
            return True
    return False


def _item_score(item: dict[str, Any], query_tokens: set[str]) -> int:
    weighted_fields = (
        ("name", 6),
        ("id", 6),
        ("task", 5),
        ("summary", 4),
        ("description", 3),
        ("tags", 3),
        ("capabilities", 3),
        ("subdomain", 2),
        ("domain", 1),
        ("stage", 1),
        ("function", 1),
    )
    return sum(
        len(query_tokens & _text_tokens(str(item.get(key) or ""))) * weight
        for key, weight in weighted_fields
    )


def _local_route(
    query: str,
    dimensions: dict[str, list[str]],
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    query_tokens = _text_tokens(query)
    scored = [(_item_score(item, query_tokens), item) for item in items]
    scored = [pair for pair in scored if pair[0] > 0]
    scored.sort(
        key=lambda pair: (
            -pair[0],
            -int(pair[1].get("quality_score") or 0),
            str(pair[1].get("id")),
        )
    )
    if not scored:
        return {
            "domain": None,
            "stage": None,
            "function": None,
            "search_terms": [],
            "rationale": "当前描述不足以形成可靠路径，请补充研究对象、所处阶段与预期产物。",
        }
    leaders = scored[:12]
    route: dict[str, Any] = {}
    for key, dimension_key in (("domain", "domains"), ("stage", "stages"), ("function", "functions")):
        votes: dict[str, int] = {}
        for score, item in leaders:
            value = str(item.get(key) or "")
            if value in dimensions[dimension_key]:
                votes[value] = votes.get(value, 0) + score * score
        route[key] = max(votes, key=votes.get) if votes else None
    route["search_terms"] = []
    route["rationale"] = "已根据研究对象、阶段线索与预期产物匹配科研 MCP 路径。"
    return route


def _rank_results(
    query: str,
    route: dict[str, Any],
    items: list[dict[str, Any]],
    limit: int,
) -> tuple[list[dict[str, Any]], int]:
    combined = " ".join([query, *route.get("search_terms", [])])
    query_tokens = _text_tokens(combined)
    candidates = [
        item
        for item in items
        if all(not route.get(key) or item.get(key) == route[key] for key in ("domain", "stage"))
    ]
    scored = [
        (
            _item_score(item, query_tokens),
            int(bool(route.get("function") and item.get("function") == route["function"])),
            item,
        )
        for item in candidates
    ]
    scored.sort(
        key=lambda pair: (
            -pair[0],
            -pair[1],
            READINESS_ORDER.get(str(pair[2].get("readiness")), 9),
            SOURCE_REVIEW_ORDER.get(str(pair[2].get("evidence_scope")), 9),
            -int(pair[2].get("quality_score") or 0),
            str(pair[2].get("id")),
        )
    )
    ranked: list[dict[str, Any]] = []
    for rank, (task_match, function_match, item) in enumerate(scored[:limit], start=1):
        enriched = dict(item)
        enriched["rank"] = rank
        enriched["recommendation_reason"] = "研究对象、科研动作或预期产物与当前需求相符。"
        enriched["ranking_signals"] = {
            "task_match": task_match,
            "function_match": function_match,
            "readiness": str(item.get("readiness") or ""),
            "source_review": str(item.get("evidence_scope") or ""),
            "quality_score": int(item.get("quality_score") or 0),
        }
        ranked.append(enriched)
    return ranked, len(candidates)


async def find_science_mcps(
    query: str,
    *,
    limit: int = 8,
    on_event: FinderEventCallback | None = None,
    allow_model: bool = True,
) -> dict[str, Any]:
    clean_query = query.strip()
    if not clean_query:
        raise ValueError("科研需求不能为空")
    meta, items = await run_in_threadpool(_load_finder_catalog)
    dimensions = meta["dimensions"]
    config = get_finder_config()
    mode = "local_fallback"
    message = "本地三维路由已完成"
    route: dict[str, Any] | None = None
    skill_mounted = False
    has_catalog_evidence = await run_in_threadpool(
        _has_distinctive_catalog_evidence,
        clean_query,
        dimensions,
        items,
    )
    if allow_model and config.configured:
        try:
            raw_route = await _route_with_agentscope(clean_query, dimensions, config)
            skill_mounted = raw_route.get("__skill_mounted") is True
            route = _clean_route(raw_route, dimensions)
            if any(route.get(key) for key in ("domain", "stage", "function")):
                mode = "model"
                message = "AgentScope 已完成三维路由"
        except Exception as exc:
            logger.warning("Science MCP finder model route failed: %s", type(exc).__name__)
            message = "模型搜索暂不可用，已使用目录匹配"
    if route is None and not has_catalog_evidence:
        route = {
            "domain": None,
            "stage": None,
            "function": None,
            "search_terms": [],
            "rationale": "当前描述不足以形成可靠路径，请补充研究对象、所处阶段与预期产物。",
        }
        message = "需要补充更具体的科研需求"
    if route is None and has_catalog_evidence:
        route = await run_in_threadpool(_local_route, clean_query, dimensions, items)
    assert route is not None
    await _emit_finder_event(on_event, "route", route)
    safe_limit = max(1, min(int(limit), 12))
    has_route_evidence = any(route.get(key) for key in ("domain", "stage", "function")) or bool(route.get("search_terms"))
    candidate_limit = max(16, safe_limit * 3)
    candidates, total = (
        await run_in_threadpool(_rank_results, clean_query, route, items, candidate_limit)
        if has_route_evidence
        else ([], 0)
    )
    results = candidates[:safe_limit]
    ranking_criteria = LOCAL_RANKING_CRITERIA
    if mode == "model" and candidates:
        await _emit_finder_event(on_event, "status", {"message": "正在复核候选 MCP"})
        try:
            recommendations = await _recommend_with_agentscope(
                clean_query,
                route,
                candidates,
                config,
                safe_limit,
                entity_label="MCP",
            )
            results = _apply_semantic_recommendations(candidates, recommendations)
            ranking_criteria = RANKING_CRITERIA
            message = "AgentScope 已完成三维路由与 MCP 候选推荐"
        except Exception as exc:
            logger.warning("Science MCP finder model recommendation failed: %s", type(exc).__name__)
            mode = "model_route_local_rank"
            message = "三维路径已识别，候选暂按目录规则排序"
    results = await run_in_threadpool(hydrate_mcp_catalog_results, results)
    for item in results:
        await _emit_finder_event(on_event, "result", item)
    return {
        "query": clean_query,
        "route": route,
        "results": results,
        "total": total,
        "ranking": {"criteria": ranking_criteria},
        "driver": {
            "orchestrator": "AgentScope",
            "provider": "SCNet",
            "model": config.model,
            "mode": mode,
            "configured": config.configured,
            "skill_mounted": skill_mounted,
            "message": message,
        },
    }
