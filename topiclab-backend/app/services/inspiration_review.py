"""LLM-assisted review for Inspiration Co-Creation demands."""

from __future__ import annotations

import json
import re
from typing import Any

from app.services.inspiration_llm import InspirationLLMNotConfigured, InspirationLLMRequestError, request_inspiration_llm


def _fallback_review(payload: dict[str, Any]) -> dict[str, Any]:
    problem = str(payload.get("problem") or "").strip()
    blockers = str(payload.get("current_blockers") or "").strip()
    category = str(payload.get("category") or "").strip()
    clarity = "较清晰" if len(problem) >= 80 else "偏模糊"
    if "不知道怎么把问题拆成项目" in blockers:
        next_step = "先把目标用户、使用场景和一次可观察的验证动作写清楚。"
    elif "缺真实用户反馈" in blockers:
        next_step = "先找 3-5 个真实对象试用，记录具体阻力。"
    elif "缺一个能一起做的人" in blockers:
        next_step = "先明确需要产品、技术、运营还是领域专家，再发起组队。"
    else:
        next_step = "先收敛成一个一周内能完成的小验证。"
    return {
        "source": "fallback",
        "clarity": clarity,
        "verifiability": "可以继续补充场景、对象和验证动作" if problem else "需要补充问题描述",
        "suggested_stage": "问题定义中" if len(problem) >= 40 else "模糊想法",
        "suggested_roles": _suggest_roles(category),
        "recommended_tools": _suggest_tools(category, problem),
        "follow_up_questions": [
            "这个问题最真实的使用对象是谁？",
            "如果只做一周验证，最小可交付结果是什么？",
            "你现在已有的数据、Demo 或资源是什么？",
        ],
        "next_step": next_step,
        "risk_notes": [
            "不要先做完整系统，先验证一个具体场景。",
            "涉及个人联系方式或学校内部数据时，需要先做权限和隐私边界确认。",
        ],
    }


def _suggest_roles(category: str) -> list[str]:
    roles = ["真实问题提出者", "AI 应用开发者"]
    if "教育" in category:
        roles.append("教育场景共创者")
    if "科研" in category:
        roles.append("科研方法顾问")
    if "内容创作" in category:
        roles.append("产品与设计伙伴")
    if "生活效率" in category:
        roles.append("真实用户反馈者")
    return roles


def _suggest_tools(category: str, problem: str) -> list[str]:
    tools = ["场景记录", "低保真原型", "Demo 反馈表"]
    text = f"{category}\n{problem}"
    if "文献" in text or "科研" in text:
        tools.append("文献检索 Agent")
    if "小程序" in text or "平台" in text:
        tools.append("Web / 小程序原型")
    if "数据" in text or "JSON" in text:
        tools.append("数据样例与解析脚本")
    return tools


def _redact_text(value: str, payload: dict[str, Any]) -> str:
    text = str(value or "")
    replacements = [
        (r"1[3-9]\d{9}", "联系方式已隐藏"),
        (r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "邮箱已隐藏"),
        (r"(微信|VX|vx|Wechat|wechat|QQ|qq)[:：]?\s*[A-Za-z0-9_-]{5,}", "联系方式已隐藏"),
    ]
    for pattern, repl in replacements:
        text = re.sub(pattern, repl, text)
    for key in ("submitter_name", "contact", "submitter_account", "account_phone", "account_username"):
        raw = str(payload.get(key) or "").strip()
        if len(raw) >= 3:
            text = text.replace(raw, "个人信息已隐藏")
    return text


def _truncate(value: str, max_length: int) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= max_length:
        return text
    return f"{text[: max_length - 1]}…"


def _fallback_redaction(payload: dict[str, Any], review: dict[str, Any]) -> dict[str, Any]:
    problem = _redact_text(str(payload.get("problem") or ""), payload)
    category = _redact_text(str(payload.get("category") or ""), payload)
    tags = [item.strip() for item in category.split(",") if item.strip()]
    if not tags and str(payload.get("category_extra") or "").strip():
        tags = [_redact_text(str(payload.get("category_extra") or ""), payload)]
    if str(payload.get("participation_mode") or "").strip():
        tags.append(_redact_text(str(payload.get("participation_mode") or ""), payload))
    title = _truncate(problem, 28)
    if tags:
        title = _truncate(f"{tags[0]}：{title}", 34)
    return {
        "method": "rule_only",
        "status": "published" if payload.get("allow_public", True) else "draft",
        "title": title or "未命名共创线索",
        "summary": _truncate(problem, 180),
        "tags": tags[:4],
        "stuck": _redact_text(str(payload.get("current_blockers") or review.get("next_step") or ""), payload),
        "notes": [
            "已隐藏称呼、联系方式、账号等可识别信息。",
            "公开版保留场景、问题、卡点和可参与方向。",
        ],
    }


def build_initial_inspiration_review(payload: dict[str, Any]) -> dict[str, Any]:
    """Build a local first-pass review without waiting for model calls."""
    return _fallback_review(payload)


def build_initial_public_redaction(payload: dict[str, Any], review: dict[str, Any]) -> dict[str, Any]:
    """Build a local public-safe rewrite without waiting for model calls."""
    return _fallback_redaction(payload, review)


def _strip_fenced_json(text: str) -> str:
    value = text.strip()
    if not value.startswith("```"):
        return value
    lines = value.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


async def generate_inspiration_review(payload: dict[str, Any]) -> dict[str, Any]:
    """Return a structured review. Falls back locally if LLM env is not configured."""
    fallback = _fallback_review(payload)
    prompt = {
        "problem": payload.get("problem") or "",
        "category": payload.get("category") or "",
        "category_extra": payload.get("category_extra") or "",
        "current_blockers": payload.get("current_blockers") or "",
        "participation_mode": payload.get("participation_mode") or "",
        "note": payload.get("note") or "",
    }
    try:
        raw = await request_inspiration_llm(
            [
                {
                    "role": "system",
                    "content": (
                        "你是灵感共创队的需求预诊断助手。"
                        "请仅输出 JSON，不要 Markdown。字段必须包含："
                        "clarity, verifiability, suggested_stage, suggested_roles, recommended_tools, "
                        "follow_up_questions, next_step, risk_notes。"
                        "suggested_roles/recommended_tools/follow_up_questions/risk_notes 均为字符串数组。"
                    ),
                },
                {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
            ],
            temperature=0.2,
        )
        parsed = json.loads(_strip_fenced_json(raw))
        if not isinstance(parsed, dict):
            return fallback
        parsed["source"] = "llm"
        return {**fallback, **parsed}
    except (InspirationLLMNotConfigured, InspirationLLMRequestError, json.JSONDecodeError):
        return fallback


async def generate_public_redaction(payload: dict[str, Any], review: dict[str, Any]) -> dict[str, Any]:
    """Return a public-safe rewrite for the demand. Falls back to deterministic redaction."""
    fallback = _fallback_redaction(payload, review)
    prompt = {
        "raw": {
            "problem": payload.get("problem") or "",
            "category": payload.get("category") or "",
            "category_extra": payload.get("category_extra") or "",
            "current_blockers": payload.get("current_blockers") or "",
            "participation_mode": payload.get("participation_mode") or "",
            "note": payload.get("note") or "",
        },
        "review": review,
    }
    try:
        raw = await request_inspiration_llm(
            [
                {
                    "role": "system",
                    "content": (
                        "你是灵感共创队的需求脱敏改写助手。请仅输出 JSON，不要 Markdown。"
                        "目标是把需求、想法或参与意愿改写成公开可读但不可识别个人身份的共创线索。"
                        "必须保留真实场景、问题、卡点、参与方式和需要的伙伴，删除姓名、联系方式、账号、可识别单位或私人链接。"
                        "字段必须包含 title, summary, tags, stuck, notes。tags/notes 为字符串数组。"
                    ),
                },
                {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
            ],
            temperature=0.2,
        )
        parsed = json.loads(_strip_fenced_json(raw))
        if not isinstance(parsed, dict):
            return fallback
        redacted = {
            **fallback,
            **parsed,
            "method": "llm_rewrite",
            "status": "published" if payload.get("allow_public", True) else "draft",
        }
        redacted["title"] = _redact_text(str(redacted.get("title") or fallback["title"]), payload)
        redacted["summary"] = _redact_text(str(redacted.get("summary") or fallback["summary"]), payload)
        redacted["stuck"] = _redact_text(str(redacted.get("stuck") or fallback["stuck"]), payload)
        redacted["tags"] = [_redact_text(str(tag), payload) for tag in (redacted.get("tags") or fallback["tags"])][:4]
        return redacted
    except (InspirationLLMNotConfigured, InspirationLLMRequestError, json.JSONDecodeError):
        return fallback
