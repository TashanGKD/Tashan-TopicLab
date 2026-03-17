"""Generate 4 discussion roles from topic using AI_GENERATION_MODEL."""

from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Any

import httpx

_NUM_ROLES = 4

# 4 个角色分别覆盖不同维度，并发请求
_ROLE_DIMENSIONS = [
    "技术视角：技术实现、架构、工程实践",
    "产业视角：商业、市场、产业链",
    "研究视角：学术、方法论、前沿探索",
    "治理视角：政策、伦理、合规",
]

_SINGLE_ROLE_SYSTEM_PROMPT = (
    "你是讨论角色设计专家。根据话题内容，生成 1 个讨论角色。"
    "输出严格为 JSON 对象，格式："
    '{"name": "英文slug如industry_analyst", "label": "中文显示名", "description": "一句话描述", "role_content": "Markdown格式的角色定义，包含## Identity、## Expertise、## Thinking Style 三部分"}'
    "name 仅用英文、数字、下划线；label 为中文；role_content 为完整 role.md 正文，不含一级标题（如 # Industry Analyst）。"
)

_SINGLE_ROLE_USER_PROMPT_TEMPLATE = """请基于以下话题，生成 1 个讨论角色。

话题标题：{title}

话题正文：
{body}

要求：该角色聚焦于「{dimension}」。输出单个 JSON 对象。"""


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ValueError(f"{name} is not set")
    return value


def _safe_text(value: Any, *, fallback: str = "") -> str:
    text = str(value or "").strip()
    return text or fallback


def _slugify(name: str) -> str:
    """Convert to valid expert name slug: alphanumeric + underscore."""
    s = re.sub(r"[^a-zA-Z0-9_]", "_", name)
    return s.strip("_").lower() or "expert"


def _parse_json_array(raw: str) -> list[dict]:
    """Extract JSON array from model output, handling markdown fences."""
    content = raw.strip()
    if content.startswith("```"):
        lines = content.splitlines()
        if len(lines) > 1 and lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        content = "\n".join(lines)
    try:
        data = json.loads(content)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _parse_json_object(raw: str) -> dict | None:
    """Extract JSON object from model output, handling markdown fences."""
    content = raw.strip()
    if content.startswith("```"):
        lines = content.splitlines()
        if len(lines) > 1 and lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        content = "\n".join(lines)
    try:
        data = json.loads(content)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


async def _generate_single_role(
    client: httpx.AsyncClient,
    base_url: str,
    api_key: str,
    model: str,
    title: str,
    body: str,
    dimension: str,
    role_index: int,
) -> dict[str, str] | None:
    """Generate one role via AI. Returns dict or None on failure."""
    user_prompt = _SINGLE_ROLE_USER_PROMPT_TEMPLATE.format(
        title=title, body=body, dimension=dimension
    )
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": _SINGLE_ROLE_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.3,
    }
    try:
        response = await client.post(
            f"{base_url.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        response.raise_for_status()
        data = response.json()
        raw_content = str(data["choices"][0]["message"]["content"])
        parsed = _parse_json_object(raw_content)
    except Exception:
        return None

    if not parsed or not isinstance(parsed, dict):
        return None

    raw_name = _safe_text(parsed.get("name") or parsed.get("id"), fallback=f"role_{role_index + 1}")
    name = _slugify(raw_name)
    label = _safe_text(parsed.get("label"), fallback=name)
    description = _safe_text(parsed.get("description"), fallback=label)
    role_content = _safe_text(parsed.get("role_content"), fallback=description)

    if not role_content:
        role_content = f"# {label}\n\n## Identity\n\n{description}\n\n## Expertise\n\n- {description}\n\n## Thinking Style\n\n- 从本领域视角出发，提供有洞见的观点"

    return {
        "name": name,
        "label": label,
        "description": description,
        "role_content": role_content,
    }


async def generate_roles_from_topic(
    topic_title: str,
    topic_body: str,
    *,
    article: dict[str, Any] | None = None,
) -> list[dict[str, str]]:
    """Generate 4 role definitions from topic using AI_GENERATION_MODEL.

    Uses 4 concurrent AI requests (one per dimension) for faster completion.
    Returns list of {"name", "label", "description", "role_content"}.
    Falls back to empty list if env not configured or generation fails.
    """
    try:
        base_url = _required_env("AI_GENERATION_BASE_URL")
        api_key = _required_env("AI_GENERATION_API_KEY")
        model = _required_env("AI_GENERATION_MODEL")
    except ValueError:
        return []

    title = _safe_text(topic_title, fallback="未命名话题")
    body = _safe_text(topic_body, fallback="")
    if article:
        desc = _safe_text(article.get("description"), fallback="")
        if desc and len(body) < 200:
            body = f"{body}\n\n原文摘要：{desc}".strip()

    body_truncated = body[:8000]

    async with httpx.AsyncClient(timeout=60.0) as client:
        tasks = [
            _generate_single_role(
                client, base_url, api_key, model,
                title, body_truncated, _ROLE_DIMENSIONS[i], i,
            )
            for i in range(_NUM_ROLES)
        ]
        results = await asyncio.gather(*tasks, return_exceptions=False)

    result: list[dict[str, str]] = []
    seen_names: set[str] = set()
    for i, role in enumerate(results):
        if role is None:
            continue
        name = role.get("name") or ""
        if not name or name in seen_names:
            name = f"role_{i + 1}" if f"role_{i + 1}" not in seen_names else f"role_{i}_{hash(str(role)) % 10000}"
            role = {**role, "name": name}
        seen_names.add(name)
        result.append(role)

    return result[: _NUM_ROLES]
