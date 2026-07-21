"""AgentScope-assisted routing over the built-in science skill catalog."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from dataclasses import dataclass
from functools import lru_cache
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any, Awaitable, Callable

from app.services.science_skill_catalog import get_catalog_items, get_catalog_meta


logger = logging.getLogger(__name__)
DEFAULT_MODEL = "GLM-5.2"
DEFAULT_SCNET_BASE_URL = "https://api.scnet.cn/api/llm/v1"
DEFAULT_FIND_SKILL_DIRS = (
    Path("/opt/critic/tashan-research-skills/skills/find-science-skills"),
    Path.home()
    / "work"
    / "tashan-skills-maintain"
    / "tashan-research-skills"
    / "skills"
    / "find-science-skills",
)
GENERIC_QUERY_TOKENS = frozenset(
    {
        "一个",
        "使用",
        "分析",
        "处理",
        "工具",
        "帮我",
        "帮助",
        "技能",
        "数据",
        "方法",
        "查找",
        "结果",
        "需要",
        "任务",
        "研究",
        "科研",
        "analysis",
        "analyze",
        "data",
        "find",
        "help",
        "method",
        "need",
        "research",
        "result",
        "skill",
        "tool",
        "use",
        "using",
        "want",
    }
)
EVIDENCE_FIELDS = ("name", "id", "task", "summary", "subdomain", "domain", "stage", "function")
READINESS_ORDER = {"trusted": 0, "provisional": 1, "restricted": 2}
SOURCE_REVIEW_ORDER = {
    "manual_confirmed": 0,
    "model_assisted_full_source_review": 0,
    "metadata_reviewed": 1,
    "needs_source_review": 2,
}
RANKING_CRITERIA = [
    {"key": "semantic_match", "label": "需求语义匹配"},
    {"key": "task_match", "label": "任务匹配"},
    {"key": "function_match", "label": "功能偏好"},
    {"key": "quality_score", "label": "质量分"},
]
LOCAL_RANKING_CRITERIA = [
    {"key": "task_match", "label": "任务匹配"},
    {"key": "function_match", "label": "功能偏好"},
    {"key": "quality_score", "label": "质量分"},
]
FinderEventCallback = Callable[[str, dict[str, Any]], Awaitable[None]]


async def _emit_finder_event(
    callback: FinderEventCallback | None,
    event: str,
    payload: dict[str, Any],
) -> None:
    if callback is not None:
        await callback(event, payload)


@dataclass(frozen=True)
class FinderConfig:
    base_url: str
    api_key: str
    model: str
    protocol: str
    desktop_config: bool

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.api_key)


def get_finder_config() -> FinderConfig:
    return FinderConfig(
        base_url=DEFAULT_SCNET_BASE_URL,
        api_key=os.getenv("skillhub_scnet_api_key", "").strip(),
        model=DEFAULT_MODEL,
        protocol="openai",
        desktop_config=False,
    )


def _resolve_find_skill_source() -> tuple[Path, str]:
    for source in DEFAULT_FIND_SKILL_DIRS:
        skill_file = source.resolve() / "SKILL.md"
        if not skill_file.is_file():
            continue
        content = skill_file.read_bytes()
        if b"name: find-science-skills" in content:
            return skill_file.parent, hashlib.sha256(content).hexdigest()
    raise FileNotFoundError("find-science-skills source is unavailable")


def get_finder_capabilities() -> dict[str, Any]:
    config = get_finder_config()
    try:
        agentscope_version = version("agentscope")
    except PackageNotFoundError:
        agentscope_version = "unavailable"
    try:
        _, skill_sha = _resolve_find_skill_source()
    except (OSError, ValueError):
        skill_sha = None
    return {
        "orchestrator": "AgentScope",
        "orchestrator_version": agentscope_version,
        "provider": "SCNet",
        "model": config.model,
        "configured": config.configured and agentscope_version != "unavailable",
        "skill_available": skill_sha is not None,
        "skill_sha256": skill_sha,
        "desktop_config": config.desktop_config,
        "fallback_available": True,
    }


def _response_text(response: Any) -> str:
    blocks = getattr(response, "content", []) or []
    return "".join(str(getattr(block, "text", "")) for block in blocks).strip()


def _parse_json_object(text: str) -> dict[str, Any]:
    value = text.strip()
    if value.startswith("```"):
        value = re.sub(r"^```(?:json)?\s*|\s*```$", "", value, flags=re.IGNORECASE)
    try:
        parsed = json.loads(value)
    except ValueError:
        decoder = json.JSONDecoder()
        objects: list[tuple[int, dict[str, Any]]] = []
        for match in re.finditer(r"\{", value):
            try:
                candidate, consumed = decoder.raw_decode(value[match.start() :])
            except ValueError:
                continue
            if isinstance(candidate, dict):
                objects.append((consumed, candidate))
        if not objects:
            raise ValueError("model response did not contain a JSON object")
        parsed = max(objects, key=lambda item: item[0])[1]
    if not isinstance(parsed, dict):
        raise ValueError("model response must be a JSON object")
    return parsed


async def _route_with_agentscope(
    query: str,
    dimensions: dict[str, list[str]],
    config: FinderConfig,
) -> dict[str, Any]:
    from agentscope.agent import Agent
    from agentscope.agent._config import ReActConfig
    from agentscope.message import UserMsg
    from agentscope.middleware import MiddlewareBase
    from agentscope.tool import ToolChoice, Toolkit

    if config.protocol == "anthropic":
        from agentscope.credential import AnthropicCredential
        from agentscope.model import AnthropicChatModel

        model = AnthropicChatModel(
            credential=AnthropicCredential(api_key=config.api_key, base_url=config.base_url),
            model=config.model,
            stream=False,
            max_retries=0,
            parameters=AnthropicChatModel.Parameters(max_tokens=2000, temperature=0),
            client_kwargs={"timeout": 30.0, "max_retries": 0},
        )
    else:
        from agentscope.credential import OpenAICredential
        from agentscope.model import OpenAIChatModel

        model = OpenAIChatModel(
            credential=OpenAICredential(api_key=config.api_key, base_url=config.base_url),
            model=config.model,
            stream=False,
            max_retries=0,
            parameters=OpenAIChatModel.Parameters(
                max_tokens=2000,
                thinking_enable=False,
                reasoning_effort="none",
                temperature=0,
            ),
            client_kwargs={"timeout": 30.0, "max_retries": 0},
        )

    prompt = f"""把科研需求路由到目录的三个正交维度。只输出 JSON，不要输出 Skill 名称或 ID。

允许领域：{json.dumps(dimensions['domains'], ensure_ascii=False)}
允许研究阶段：{json.dumps(dimensions['stages'], ensure_ascii=False)}
允许功能分工：{json.dumps(dimensions['functions'], ensure_ascii=False)}

科研需求：{query}

研究阶段判定：
- 发现获取：寻找论文、数据库、已有数据或现成资源。
- 构思设计：形成问题、假设、方案、实验或分析计划。
- 执行采集：运行方法、生成预测、开展实验或产出新的原始结果。
- 分析验证：分析已有结果、比较指标、检验假设或验证可靠性。
- 表达发表：写作、制图、投稿、评审或传播成果。
按主要动作和主要产物选择阶段；次要的“比较、检查”不得覆盖主要产物的生成阶段。

输出格式：
{{
  "domain": "允许领域中的一项或 null",
  "stage": "允许研究阶段中的一项或 null",
  "function": "允许功能分工中的一项或 null",
  "search_terms": ["最多5个来自需求的科研术语"],
  "rationale": "一句话说明主要产物和路由依据"
}}
"""
    skill_source, _ = _resolve_find_skill_source()

    class ForceFindSkillFirst(MiddlewareBase):
        def __init__(self) -> None:
            self.selection_count = 0

        async def on_reasoning(self, agent, input_kwargs, next_handler):
            forwarded = dict(input_kwargs)
            if self.selection_count == 0:
                forwarded["tool_choice"] = ToolChoice(mode="Skill")
                self.selection_count = 1
            else:
                forwarded["tool_choice"] = ToolChoice(mode="none")
            async for item in next_handler(**forwarded):
                yield item

    middleware = ForceFindSkillFirst()
    agent = Agent(
        name="science-skill-finder",
        system_prompt=(
            "先且仅调用一次挂载的 find-science-skills Skill，读取完整工作流后再回答。"
            "不得运行脚本、创造 Skill ID 或输出工程配置；只依据用户需求和给定合法维度输出 JSON。"
        ),
        model=model,
        toolkit=Toolkit(skills_or_loaders=[str(skill_source)]),
        middlewares=[middleware],
        react_config=ReActConfig(max_iters=3),
    )
    response = await agent.reply(UserMsg(name="user", content=prompt))
    context = [message.model_dump(mode="json") for message in agent.state.context]
    skill_calls = sum(
        block.get("type") == "tool_call" and block.get("name") == "Skill"
        for message in context
        for block in message.get("content", [])
        if isinstance(block, dict)
    )
    if skill_calls != 1:
        raise RuntimeError("find-science-skills was not mounted exactly once")
    payload = _parse_json_object(_response_text(response))
    payload["__skill_mounted"] = True
    return payload


async def _recommend_with_agentscope(
    query: str,
    route: dict[str, Any],
    candidates: list[dict[str, Any]],
    config: FinderConfig,
    limit: int,
) -> list[dict[str, str]]:
    from agentscope.message import SystemMsg, UserMsg

    if config.protocol == "anthropic":
        from agentscope.credential import AnthropicCredential
        from agentscope.model import AnthropicChatModel

        model = AnthropicChatModel(
            credential=AnthropicCredential(api_key=config.api_key, base_url=config.base_url),
            model=config.model,
            stream=False,
            max_retries=0,
            parameters=AnthropicChatModel.Parameters(max_tokens=2500, temperature=0),
            client_kwargs={"timeout": 30.0, "max_retries": 0},
        )
    else:
        from agentscope.credential import OpenAICredential
        from agentscope.model import OpenAIChatModel

        model = OpenAIChatModel(
            credential=OpenAICredential(api_key=config.api_key, base_url=config.base_url),
            model=config.model,
            stream=False,
            max_retries=0,
            parameters=OpenAIChatModel.Parameters(
                max_tokens=2500,
                thinking_enable=False,
                reasoning_effort="none",
                temperature=0,
            ),
            client_kwargs={"timeout": 30.0, "max_retries": 0},
        )

    candidate_payload = [
        {
            "id": item["id"],
            "name": item["name"],
            "task": str(item.get("task") or "")[:120],
            "summary": str(item.get("summary") or "")[:220],
            "domain": item.get("domain") or "",
            "subdomain": item.get("subdomain") or "",
            "stage": item.get("stage") or "",
            "function": item.get("function") or "",
        }
        for item in candidates
    ]
    prompt = f"""从给定候选中推荐最直接满足科研需求的 Skill。只输出 JSON。

科研需求：{query}
已确定路径：{json.dumps(route, ensure_ascii=False)}
候选：{json.dumps(candidate_payload, ensure_ascii=False)}

规则：
1. 只能返回候选中已有的 id，不得创造或改写 id。
2. 研究对象或数据、需要执行的动作、预期产物必须同时直接匹配。
3. 最多返回 {limit} 项；没有直接匹配时返回空数组。
4. reason 用一句中文说明对象、动作和产物为什么匹配。

输出格式：
{{"recommendations": [{{"id": "候选id", "reason": "一句话理由"}}]}}
"""
    response = await model(
        [
            SystemMsg("system", "你是科研 Skill 候选复核器，只能在给定候选中选择。"),
            UserMsg("user", prompt),
        ]
    )
    payload = _parse_json_object(_response_text(response))
    raw_recommendations = payload.get("recommendations")
    if not isinstance(raw_recommendations, list):
        raise ValueError("model recommendations must be a list")

    allowed_ids = {str(item["id"]) for item in candidates}
    seen: set[str] = set()
    recommendations: list[dict[str, str]] = []
    for raw in raw_recommendations[:limit]:
        if not isinstance(raw, dict):
            raise ValueError("model recommendation must be an object")
        skill_id = str(raw.get("id") or "").strip()
        reason = str(raw.get("reason") or "").strip()
        if skill_id not in allowed_ids or skill_id in seen:
            raise ValueError("model recommendation referenced an invalid candidate")
        if not 4 <= len(reason) <= 200:
            raise ValueError("model recommendation reason is invalid")
        seen.add(skill_id)
        recommendations.append({"id": skill_id, "reason": reason})
    return recommendations


def _clean_route(raw: dict[str, Any], dimensions: dict[str, list[str]]) -> dict[str, Any]:
    route: dict[str, Any] = {}
    for key, dimension_key in (("domain", "domains"), ("stage", "stages"), ("function", "functions")):
        value = str(raw.get(key) or "").strip()
        route[key] = value if value in dimensions[dimension_key] else None
    raw_terms = raw.get("search_terms") if isinstance(raw.get("search_terms"), list) else []
    route["search_terms"] = [
        str(term).strip()[:40]
        for term in raw_terms[:5]
        if 2 <= len(str(term).strip()) <= 40
    ]
    route["rationale"] = str(raw.get("rationale") or "").strip()[:240]
    return route


def _text_tokens(value: str) -> set[str]:
    normalized = value.casefold()
    tokens = set(re.findall(r"[a-z0-9][a-z0-9+._-]{1,}", normalized))
    for run in re.findall(r"[\u4e00-\u9fff]+", normalized):
        for width in (2, 3, 4):
            tokens.update(run[index : index + width] for index in range(max(0, len(run) - width + 1)))
    return tokens


def _compact_text(value: str) -> str:
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", value.casefold())


@lru_cache(maxsize=1)
def _catalog_token_document_frequency() -> tuple[int, dict[str, int]]:
    frequencies: dict[str, int] = {}
    items = get_catalog_items()
    for item in items:
        item_tokens: set[str] = set()
        for field in EVIDENCE_FIELDS:
            item_tokens.update(_text_tokens(str(item.get(field) or "")))
        for token in item_tokens:
            frequencies[token] = frequencies.get(token, 0) + 1
    return len(items), frequencies


def _has_distinctive_catalog_evidence(query: str, dimensions: dict[str, list[str]]) -> bool:
    compact_query = _compact_text(query)
    if not compact_query:
        return False

    labels = {
        _compact_text(label)
        for values in dimensions.values()
        for label in values
        if label
    }
    if any(label and label in compact_query for label in labels):
        return True

    for item in get_catalog_items():
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
        if not 2 <= frequency <= max_frequency:
            continue
        if re.fullmatch(r"[\u4e00-\u9fff]+", token) and len(token) < 2:
            continue
        return True
    return False


def _item_score(item: dict[str, Any], query_tokens: set[str]) -> int:
    weighted_fields = (
        ("name", 5),
        ("id", 5),
        ("task", 4),
        ("summary", 3),
        ("subdomain", 2),
        ("domain", 1),
        ("stage", 1),
        ("function", 1),
    )
    return sum(len(query_tokens & _text_tokens(str(item.get(key) or ""))) * weight for key, weight in weighted_fields)


def _local_route(query: str, dimensions: dict[str, list[str]]) -> dict[str, Any]:
    query_tokens = _text_tokens(query)
    scored = [(_item_score(item, query_tokens), item) for item in get_catalog_items()]
    scored = [pair for pair in scored if pair[0] > 0]
    scored.sort(key=lambda pair: (-pair[0], -int(pair[1].get("quality_score") or 0), str(pair[1].get("id"))))
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
                # Strong direct matches should outweigh several weak matches from nearby stages.
                votes[value] = votes.get(value, 0) + score * score
        route[key] = max(votes, key=votes.get) if votes else None
    route["search_terms"] = []
    route["rationale"] = "已根据研究对象、阶段线索与预期产物匹配目录中的技能路径。"
    return route


def _rank_results(query: str, route: dict[str, Any], limit: int) -> tuple[list[dict[str, Any]], int]:
    combined = " ".join([query, *route.get("search_terms", [])])
    query_tokens = _text_tokens(combined)
    candidates = [
        item
        for item in get_catalog_items()
        if all(not route.get(key) or item.get(key) == route[key] for key in ("domain", "stage"))
    ]
    scored = [(_item_score(item, query_tokens), int(bool(route.get("function") and item.get("function") == route["function"])), item) for item in candidates]
    scored.sort(
        key=lambda pair: (
            -pair[0],
            -pair[1],
            READINESS_ORDER.get(str(pair[2].get("readiness")), 9),
            SOURCE_REVIEW_ORDER.get(str(pair[2].get("review_status")), 9),
            -int(pair[2].get("quality_score") or 0),
            str(pair[2].get("id")),
        )
    )
    ranked: list[dict[str, Any]] = []
    for rank, (task_match, function_match, item) in enumerate(scored[:limit], start=1):
        enriched = dict(item)
        enriched["rank"] = rank
        enriched["ranking_signals"] = {
            "task_match": task_match,
            "function_match": function_match,
            "readiness": str(item.get("readiness") or ""),
            "source_review": str(item.get("review_status") or ""),
            "quality_score": int(item.get("quality_score") or 0),
        }
        ranked.append(enriched)
    return ranked, len(candidates)


def _apply_semantic_recommendations(
    candidates: list[dict[str, Any]],
    recommendations: list[dict[str, str]],
) -> list[dict[str, Any]]:
    by_id = {str(item["id"]): item for item in candidates}
    ranked: list[dict[str, Any]] = []
    total = len(recommendations)
    for rank, recommendation in enumerate(recommendations, start=1):
        item = dict(by_id[recommendation["id"]])
        signals = dict(item.get("ranking_signals") or {})
        signals["semantic_match"] = total - rank + 1
        item["rank"] = rank
        item["recommendation_reason"] = recommendation["reason"]
        item["ranking_signals"] = signals
        ranked.append(item)
    return ranked


async def find_science_skills(
    query: str,
    *,
    limit: int = 8,
    on_event: FinderEventCallback | None = None,
) -> dict[str, Any]:
    clean_query = query.strip()
    if not clean_query:
        raise ValueError("科研需求不能为空")
    meta = get_catalog_meta()
    dimensions = meta["dimensions"]
    config = get_finder_config()
    mode = "local_fallback"
    message = "本地三维路由已完成"
    route: dict[str, Any] | None = None
    skill_mounted = False
    has_catalog_evidence = _has_distinctive_catalog_evidence(clean_query, dimensions)
    if config.configured:
        try:
            raw_route = await _route_with_agentscope(clean_query, dimensions, config)
            skill_mounted = raw_route.get("__skill_mounted") is True
            route = _clean_route(raw_route, dimensions)
            if any(route.get(key) for key in ("domain", "stage", "function")):
                mode = "model"
                message = "AgentScope 已完成三维路由"
        except Exception as exc:
            logger.warning("Science skill finder model route failed: %s", type(exc).__name__)
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
        route = _local_route(clean_query, dimensions)
    assert route is not None
    await _emit_finder_event(on_event, "route", route)
    safe_limit = max(1, min(int(limit), 12))
    has_route_evidence = any(route.get(key) for key in ("domain", "stage", "function")) or bool(route.get("search_terms"))
    candidate_limit = max(16, safe_limit * 3)
    candidates, total = _rank_results(clean_query, route, candidate_limit) if has_route_evidence else ([], 0)
    results = candidates[:safe_limit]
    ranking_criteria = LOCAL_RANKING_CRITERIA
    if mode == "model" and candidates:
        await _emit_finder_event(on_event, "status", {"message": "正在复核候选技能"})
        try:
            recommendations = await _recommend_with_agentscope(
                clean_query,
                route,
                candidates,
                config,
                safe_limit,
            )
            results = _apply_semantic_recommendations(candidates, recommendations)
            ranking_criteria = RANKING_CRITERIA
            message = "AgentScope 已完成三维路由与候选推荐"
        except Exception as exc:
            logger.warning("Science skill finder model recommendation failed: %s", type(exc).__name__)
            mode = "model_route_local_rank"
            message = "三维路径已识别，候选暂按目录规则排序"
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
