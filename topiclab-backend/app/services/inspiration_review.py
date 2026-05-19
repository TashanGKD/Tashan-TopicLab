"""LLM-assisted review for Inspiration Co-Creation demands."""

from __future__ import annotations

import json
import re
from copy import deepcopy
from pathlib import Path
from typing import Any

from app.services.inspiration_llm import InspirationLLMNotConfigured, InspirationLLMRequestError, request_inspiration_llm

PROMPT_DIR = Path(__file__).resolve().parents[1] / "prompts" / "inspiration"
STAGE_PROMPTS = {
    "submitted": "stage_submitted.md",
    "defined": "stage_defined.md",
    "tooling": "stage_tooling.md",
    "demo": "stage_demo.md",
    "mvp": "stage_mvp.md",
}


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


def _short_title(value: Any, fallback: str = "") -> str:
    text = re.sub(r"\s+", "", str(value or ""))
    text = text.strip("《》“”\"'：:，,。.!！?？、；;（）()[]【】")
    return (text or fallback)[:10]


def _load_prompt(filename: str) -> str:
    return (PROMPT_DIR / filename).read_text(encoding="utf-8")


def _previous_snapshot(context: dict[str, Any]) -> dict[str, Any]:
    previous = context.get("previous_assistant") if isinstance(context.get("previous_assistant"), dict) else {}
    snapshot = previous.get("snapshot") if isinstance(previous.get("snapshot"), dict) else {}
    return deepcopy(snapshot) if isinstance(snapshot, dict) else {}


def _parse_json_object(raw: str) -> dict[str, Any]:
    parsed = json.loads(_strip_fenced_json(raw))
    return parsed if isinstance(parsed, dict) else {}


def _string_list(value: Any, fallback: list[str] | None = None, limit: int = 6) -> list[str]:
    if not isinstance(value, list):
        return (fallback or [])[:limit]
    return [str(item).strip() for item in value if str(item).strip()][:limit]


def _stage_key_from_context(context: dict[str, Any]) -> str:
    trigger_update = context.get("trigger_update") if isinstance(context.get("trigger_update"), dict) else {}
    stage_key = str(trigger_update.get("stage_key") or context.get("stage_key") or "").strip()
    return stage_key if stage_key in STAGE_PROMPTS else "submitted"


def _fallback_redaction(payload: dict[str, Any], review: dict[str, Any]) -> dict[str, Any]:
    problem = _redact_text(str(payload.get("problem") or ""), payload)
    category = _redact_text(str(payload.get("category") or ""), payload)
    tags = [item.strip() for item in category.split(",") if item.strip()]
    if not tags and str(payload.get("category_extra") or "").strip():
        tags = [_redact_text(str(payload.get("category_extra") or ""), payload)]
    if str(payload.get("participation_mode") or "").strip():
        tags.append(_redact_text(str(payload.get("participation_mode") or ""), payload))
    return {
        "method": "pending_llm",
        "status": "needs_review" if payload.get("allow_public", True) else "draft",
        "title": "生成中",
        "summary": "智能助手正在生成脱敏摘要。",
        "tags": tags[:4],
        "stuck": "等待智能助手生成公开描述。",
        "notes": [
            "公开标题和摘要会由智能助手完成脱敏改写。",
            "完整原文仅在有权限查看完整表单信息时展示。",
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


async def run_initial_submission_agent(context: dict[str, Any]) -> dict[str, Any]:
    """Generate the first assistant snapshot and public redaction fields."""
    private_payload = context.get("private") if isinstance(context.get("private"), dict) else {}
    public_payload = context.get("public") if isinstance(context.get("public"), dict) else {}
    fallback = _fallback_review(private_payload)
    prompt = {
        "trigger_update": context.get("trigger_update"),
        "public": public_payload,
        "private": private_payload,
        "path_progress": context.get("path_progress") or [],
        "updates": context.get("updates") or [],
        "previous_assistant": context.get("previous_assistant") or {},
    }
    try:
        raw = await request_inspiration_llm(
            [
                {
                    "role": "system",
                    "content": _load_prompt("initial_submission.md"),
                },
                {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
            ],
            temperature=0.2,
        )
        parsed = _parse_json_object(raw)
        if not parsed:
            return fallback
        parsed["source"] = "llm"
        parsed["title"] = _short_title(_redact_text(str(parsed.get("title") or ""), private_payload), str(public_payload.get("title") or ""))
        parsed["summary"] = _truncate(_redact_text(str(parsed.get("summary") or ""), private_payload), 180)
        parsed["public_stuck"] = _truncate(_redact_text(str(parsed.get("public_stuck") or ""), private_payload), 120)
        result = {**fallback, **parsed}
        result["stages"] = {
            "submitted": {
                "status": "needs_input" if result.get("follow_up_questions") else "ready",
                "ai_draft_answer": str(parsed.get("ai_draft_answer") or ""),
                "follow_up_questions": _string_list(result.get("follow_up_questions")),
                "next_step": str(result.get("next_step") or ""),
                "confidence": str(parsed.get("confidence") or "medium"),
            }
        }
        return result
    except (InspirationLLMNotConfigured, InspirationLLMRequestError, json.JSONDecodeError):
        fallback["stages"] = {
            "submitted": {
                "status": "needs_input",
                "ai_draft_answer": "",
                "follow_up_questions": _string_list(fallback.get("follow_up_questions")),
                "next_step": str(fallback.get("next_step") or ""),
                "confidence": "fallback",
            }
        }
        return fallback


async def _run_stage_agent(context: dict[str, Any], *, stage_key: str, prompt_filename: str) -> dict[str, Any]:
    private_payload = context.get("private") if isinstance(context.get("private"), dict) else {}
    previous = _previous_snapshot(context)
    trigger_update = context.get("trigger_update") if isinstance(context.get("trigger_update"), dict) else {}
    fallback_questions = _string_list(previous.get("follow_up_questions"), _fallback_review(private_payload).get("follow_up_questions"))
    prompt = {
        "stage_key": stage_key,
        "trigger_update": trigger_update,
        "public": context.get("public"),
        "private": private_payload,
        "path_progress": context.get("path_progress") or [],
        "updates": context.get("updates") or [],
        "previous_assistant": context.get("previous_assistant") or {},
    }
    try:
        raw = await request_inspiration_llm(
            [
                {"role": "system", "content": _load_prompt(prompt_filename)},
                {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
            ],
            temperature=0.2,
        )
        parsed = _parse_json_object(raw)
        if not parsed:
            raise json.JSONDecodeError("LLM did not return a JSON object", raw, 0)
        questions = _string_list(parsed.get("follow_up_questions"), fallback_questions)
        stage_snapshot = {
            "status": "needs_input" if questions else "ready",
            "ai_draft_answer": _truncate(_redact_text(str(parsed.get("ai_draft_answer") or ""), private_payload), 1000),
            "follow_up_questions": questions,
            "next_step": _truncate(_redact_text(str(parsed.get("next_step") or ""), private_payload), 300),
            "confidence": str(parsed.get("confidence") or "medium"),
        }
    except (InspirationLLMNotConfigured, InspirationLLMRequestError, json.JSONDecodeError):
        questions = fallback_questions[:3]
        stage_snapshot = {
            "status": "needs_input" if questions else "ready",
            "ai_draft_answer": _truncate(str(trigger_update.get("summary") or trigger_update.get("progress") or ""), 1000),
            "follow_up_questions": questions,
            "next_step": str(previous.get("next_step") or _fallback_review(private_payload).get("next_step") or ""),
            "confidence": "fallback",
        }

    result = previous or _fallback_review(private_payload)
    result = {**result}
    stages = result.get("stages") if isinstance(result.get("stages"), dict) else {}
    result["stages"] = {**stages, stage_key: stage_snapshot}
    result["source"] = "llm" if stage_snapshot.get("confidence") != "fallback" else "fallback"
    result["stage_key"] = stage_key
    result["follow_up_questions"] = stage_snapshot["follow_up_questions"]
    result["next_step"] = stage_snapshot["next_step"] or result.get("next_step") or ""
    return result


async def run_submitted_stage_agent(context: dict[str, Any]) -> dict[str, Any]:
    return await _run_stage_agent(context, stage_key="submitted", prompt_filename=STAGE_PROMPTS["submitted"])


async def run_defined_stage_agent(context: dict[str, Any]) -> dict[str, Any]:
    return await _run_stage_agent(context, stage_key="defined", prompt_filename=STAGE_PROMPTS["defined"])


async def run_tooling_stage_agent(context: dict[str, Any]) -> dict[str, Any]:
    return await _run_stage_agent(context, stage_key="tooling", prompt_filename=STAGE_PROMPTS["tooling"])


async def run_demo_stage_agent(context: dict[str, Any]) -> dict[str, Any]:
    return await _run_stage_agent(context, stage_key="demo", prompt_filename=STAGE_PROMPTS["demo"])


async def run_mvp_stage_agent(context: dict[str, Any]) -> dict[str, Any]:
    return await _run_stage_agent(context, stage_key="mvp", prompt_filename=STAGE_PROMPTS["mvp"])


async def generate_inspiration_assistant_snapshot(context: dict[str, Any]) -> dict[str, Any]:
    """Return the current intelligent assistant snapshot for an inspiration demand."""
    if context.get("trigger_type") == "initial_submission":
        return await run_initial_submission_agent(context)
    stage_key = _stage_key_from_context(context)
    if stage_key == "defined":
        return await run_defined_stage_agent(context)
    if stage_key == "tooling":
        return await run_tooling_stage_agent(context)
    if stage_key == "demo":
        return await run_demo_stage_agent(context)
    if stage_key == "mvp":
        return await run_mvp_stage_agent(context)
    return await run_submitted_stage_agent(context)


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
                        "字段必须包含 title, summary, tags, stuck, notes。title 必须在 10 个汉字以内。tags/notes 为字符串数组。"
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
        redacted["title"] = _short_title(_redact_text(str(redacted.get("title") or fallback["title"]), payload), fallback["title"])
        redacted["summary"] = _redact_text(str(redacted.get("summary") or fallback["summary"]), payload)
        redacted["stuck"] = _redact_text(str(redacted.get("stuck") or fallback["stuck"]), payload)
        redacted["tags"] = [_redact_text(str(tag), payload) for tag in (redacted.get("tags") or fallback["tags"])][:4]
        return redacted
    except (InspirationLLMNotConfigured, InspirationLLMRequestError, json.JSONDecodeError):
        return fallback
