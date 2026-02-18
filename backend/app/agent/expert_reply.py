"""Expert reply agent: respond to @mention questions using claude_agent_sdk."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

from claude_agent_sdk import AssistantMessage, ClaudeAgentOptions, ResultMessage, query

from .config import get_agent_config
from .experts import EXPERT_SECURITY_SUFFIX
from .posts import make_post, save_post

logger = logging.getLogger(__name__)

_PROMPTS_DIR = Path(__file__).resolve().parent.parent.parent / "prompts"


def _extract_reply_body(text: str) -> str:
    """Best-effort extraction of plain reply text from raw agent output.

    Handles several failure modes observed in practice:
    1. Agent returned a bare JSON object  → extract "body" field
    2. Agent wrapped JSON in a code block → strip fences then extract "body"
    3. Agent returned a markdown code block containing plain text → strip fences
    4. Leading/trailing whitespace        → strip
    5. Empty result after all above       → return original so caller can decide
    """
    import re

    stripped = text.strip()
    if not stripped:
        return text

    # Helper: try to parse a string as JSON and pull out "body"
    def _try_json_body(s: str) -> str | None:
        try:
            parsed = json.loads(s)
            if isinstance(parsed, dict):
                return str(parsed.get("body", "")) or None
        except (json.JSONDecodeError, ValueError):
            pass
        return None

    # 1. Bare JSON object
    if stripped.startswith("{"):
        extracted = _try_json_body(stripped)
        if extracted:
            return extracted.strip()

    # 2. Code-fenced JSON  (```json ... ``` or ``` ... ```)
    fence_match = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", stripped)
    if fence_match:
        extracted = _try_json_body(fence_match.group(1))
        if extracted:
            return extracted.strip()
        # If the fenced block wasn't JSON, fall through and strip fences below

    # 3. Generic code fence wrapping plain text
    plain_fence = re.fullmatch(r"```[^\n]*\n([\s\S]*?)```", stripped)
    if plain_fence:
        inner = plain_fence.group(1).strip()
        if inner:
            return inner

    # 4. Nothing matched – return stripped original
    return stripped


def _load_expert_reply_skill() -> str:
    return (_PROMPTS_DIR / "expert_reply_skill.md").read_text(encoding="utf-8")


def _load_user_prompt(topic_title: str, user_author: str, expert_label: str, user_question: str) -> str:
    template = (_PROMPTS_DIR / "expert_reply_user_message.md").read_text(encoding="utf-8")
    return template.format(
        topic_title=topic_title,
        user_author=user_author,
        expert_label=expert_label,
        user_question=user_question,
    )


async def run_expert_reply(
    ws_path: Path,
    topic_id: str,
    topic_title: str,
    expert_name: str,
    expert_label: str,
    user_post_id: str,
    user_author: str,
    user_question: str,
    reply_post_id: str,
    reply_created_at: str,
    max_turns: int = 100,
    max_budget_usd: float = 10.0,
) -> dict[str, Any]:
    """Launch an expert agent that reads workspace context and writes its reply.

    The agent is given Read + Glob tools only — it explores the workspace
    autonomously to understand discussion context, then outputs its reply as
    the final result text (ResultMessage.result).  The Python side writes the
    reply post JSON to disk so the format is always correct.
    """
    config = get_agent_config()

    role_file = ws_path / "agents" / expert_name / "role.md"
    role_content = (
        role_file.read_text(encoding="utf-8")
        if role_file.exists()
        else f"# {expert_label}\n\n你是 {expert_label}，请以该专家身份回答问题。"
    )

    reply_skill = _load_expert_reply_skill()
    system_prompt = f"{role_content}\n\n{reply_skill}{EXPERT_SECURITY_SUFFIX}"

    user_prompt = _load_user_prompt(
        topic_title=topic_title,
        user_author=user_author,
        expert_label=expert_label,
        user_question=user_question,
    )

    ws_abs = str(ws_path.resolve())
    env = {"ANTHROPIC_API_KEY": config["api_key"]}
    if config.get("base_url"):
        env["ANTHROPIC_BASE_URL"] = config["base_url"]
    model = config.get("model") or None
    if model:
        env["ANTHROPIC_MODEL"] = model

    os.environ.pop("CLAUDECODE", None)

    options = ClaudeAgentOptions(
        allowed_tools=["Read", "Glob"],
        permission_mode="acceptEdits",
        system_prompt=system_prompt,
        cwd=ws_abs,
        add_dirs=[ws_abs],
        max_turns=max_turns,
        max_budget_usd=max_budget_usd,
        env=env,
        model=model,
    )

    result_info: dict[str, Any] = {"num_turns": 0, "total_cost_usd": None}
    reply_text = ""
    last_assistant_text = ""  # fallback if ResultMessage.result is None

    logger.info(f"Starting expert_reply agent: {expert_name} → reply {reply_post_id}")
    try:
        async for message in query(prompt=user_prompt, options=options):
            if isinstance(message, AssistantMessage):
                # Collect the last text block as fallback
                for block in (message.content or []):
                    if hasattr(block, "text") and block.text:
                        last_assistant_text = block.text
            elif isinstance(message, ResultMessage):
                result_info["num_turns"] = message.num_turns
                result_info["total_cost_usd"] = message.total_cost_usd
                logger.info(
                    f"ResultMessage: is_error={message.is_error}, "
                    f"subtype={message.subtype}, result_len={len(message.result or '')}"
                )
                reply_text = message.result or last_assistant_text
    except Exception as e:
        logger.error(f"Expert reply agent failed: {e}", exc_info=True)
        # Overwrite the pending placeholder with a failed status
        failed = make_post(
            topic_id=topic_id,
            author=expert_name,
            author_type="agent",
            body="（专家回复生成失败，请稍后重试）",
            expert_name=expert_name,
            expert_label=expert_label,
            in_reply_to_id=user_post_id,
            status="failed",
        )
        failed["id"] = reply_post_id
        failed["created_at"] = reply_created_at
        save_post(ws_path, failed)
        raise

    reply_body = _extract_reply_body(reply_text)
    if reply_body != reply_text:
        logger.info(f"Extracted reply body from raw result (original len={len(reply_text)}, extracted len={len(reply_body)})")

    # Write the completed reply post (overwrites the pending placeholder)
    completed = make_post(
        topic_id=topic_id,
        author=expert_name,
        author_type="agent",
        body=reply_body,
        expert_name=expert_name,
        expert_label=expert_label,
        in_reply_to_id=user_post_id,
        status="completed",
    )
    completed["id"] = reply_post_id
    completed["created_at"] = reply_created_at
    save_post(ws_path, completed)

    logger.info(
        f"Expert reply saved: turns={result_info['num_turns']}, "
        f"cost={result_info['total_cost_usd']}, chars={len(reply_text)}"
    )
    return result_info
