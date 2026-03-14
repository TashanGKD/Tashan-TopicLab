"""Generate topic body from source-feed article full text."""

from __future__ import annotations

import os
from typing import Any

import httpx

_MAX_CONTENT_CHARS = 16000

_SYSTEM_PROMPT = (
    "你是资深研究编辑，需要把信源全文整理成可讨论的话题导语。"
    "请仅输出 Markdown，且严格使用以下四个一级标题："
    "## 背景、## 核心议题、## 为什么值得讨论、## 建议讨论问题。"
    "其中“建议讨论问题”请给出 3 个问题。"
    "表达要克制、信息密度高、避免营销口吻。"
)


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ValueError(f"{name} is not set")
    return value


def _safe_text(value: Any, *, fallback: str = "") -> str:
    text = str(value or "").strip()
    return text or fallback


def _strip_fenced_block(text: str) -> str:
    content = text.strip()
    if not content.startswith("```"):
        return content
    lines = content.splitlines()
    if len(lines) <= 1:
        return content
    if lines[-1].strip() == "```":
        lines = lines[1:-1]
    else:
        lines = lines[1:]
    return "\n".join(lines).strip()


def _build_original_info_section(article: dict[str, Any]) -> str:
    article_id = int(article.get("id") or 0)
    source_name = _safe_text(article.get("source_feed_name"), fallback="未知来源")
    title = _safe_text(article.get("title"), fallback=f"信源 {article_id}" if article_id else "未命名信源")
    publish_time = _safe_text(article.get("publish_time"), fallback="未知")
    url = _safe_text(article.get("url"))
    description = _safe_text(article.get("description"), fallback="（原文未提供摘要）")
    lines = [
        "## 原文信息",
        "",
        f"- article_id: {article_id}",
        f"- 来源：{source_name}",
        f"- 标题：{title}",
        f"- 发布时间：{publish_time}",
        f"- 原文链接：{url}",
        f"- 原文摘要：{description}",
    ]
    return "\n".join(lines).strip()


def build_fallback_body(article: dict[str, Any]) -> str:
    """Public alias used to build an immediate placeholder body before AI generation."""
    return _build_fallback_body(article)


def _build_fallback_body(article: dict[str, Any]) -> str:
    source_name = _safe_text(article.get("source_feed_name"), fallback="未知来源")
    publish_time = _safe_text(article.get("publish_time"), fallback="未知")
    title = _safe_text(article.get("title"), fallback=f"信源 {article.get('id')}")
    description = _safe_text(article.get("description"), fallback="（原文未提供摘要）")
    lines = [
        "## 背景",
        f"这篇文章来自 {source_name}，发布时间为 {publish_time}。它围绕“{title}”展开，原文摘要是：{description}",
        "",
        "## 核心议题",
        "文章触及了技术路线、产业走向或组织决策中的关键判断，不只适合作为资讯阅读，更适合拆成多个视角展开讨论。",
        "",
        "## 为什么值得讨论",
        "这类内容通常同时涉及技术可行性、商业化节奏、平台格局或风险边界，适合让不同专家从产业、产品、研究和治理角度交叉讨论。",
        "",
        "## 建议讨论问题",
        "1. 这篇文章真正反映的结构性变化是什么？",
        "2. 其中哪些判断是事实，哪些更像叙事或营销包装？",
        "3. 如果把它转成行动议题，团队最值得追问的下一步是什么？",
        "",
        _build_original_info_section(article),
    ]
    return "\n".join(lines).strip()


def _build_user_prompt(article: dict[str, Any]) -> str:
    title = _safe_text(article.get("title"), fallback=f"信源 {article.get('id')}")
    source_name = _safe_text(article.get("source_feed_name"), fallback="未知来源")
    source_type = _safe_text(article.get("source_type"), fallback="unknown")
    publish_time = _safe_text(article.get("publish_time"), fallback="未知")
    description = _safe_text(article.get("description"), fallback="（原文未提供摘要）")
    url = _safe_text(article.get("url"))
    full_text = _safe_text(article.get("content_md"))
    if len(full_text) > _MAX_CONTENT_CHARS:
        full_text = f"{full_text[:_MAX_CONTENT_CHARS]}\n\n[...全文已截断...]"
    if not full_text:
        full_text = description
    return (
        f"请基于下面信源全文，生成话题导语。\n"
        f"- 标题: {title}\n"
        f"- 来源: {source_name}\n"
        f"- source_type: {source_type}\n"
        f"- 发布时间: {publish_time}\n"
        f"- 原文链接: {url}\n"
        f"- 原文摘要: {description}\n\n"
        "【信源全文开始】\n"
        f"{full_text}\n"
        "【信源全文结束】"
    )


async def generate_topic_body_from_source_article(article: dict[str, Any]) -> str:
    fallback = _build_fallback_body(article)
    try:
        base_url = _required_env("AI_GENERATION_BASE_URL")
        api_key = _required_env("AI_GENERATION_API_KEY")
        model = _required_env("AI_GENERATION_MODEL")
    except ValueError:
        return fallback

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_prompt(article)},
        ],
        "temperature": 0.2,
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
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
        generated = _strip_fenced_block(raw_content).strip()
    except Exception:
        generated = ""

    if not generated:
        generated = _build_fallback_body(article).split("\n## 原文信息", 1)[0].strip()
    return f"{generated}\n\n{_build_original_info_section(article)}".strip()
