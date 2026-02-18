"""AI-assisted generation of experts and moderator modes."""

import logging
import re
from pathlib import Path

import openai

from app.core.config import (
    AI_GENERATION_API_KEY,
    AI_GENERATION_BASE_URL,
    AI_GENERATION_MODEL,
)

logger = logging.getLogger(__name__)

# Prompt file paths (in prompts directory, separate from agent skills)
PROMPTS_DIR = Path(__file__).parent.parent.parent / "prompts"
EXPERT_GENERATION_PROMPT = PROMPTS_DIR / "expert_generation.md"
EXPERT_USER_MESSAGE = PROMPTS_DIR / "expert_user_message.md"
EXPERT_STANDARD_SECTIONS_FILE = PROMPTS_DIR / "expert_standard_sections.md"
MODERATOR_GENERATION_PROMPT = PROMPTS_DIR / "moderator_generation.md"
MODERATOR_USER_MESSAGE = PROMPTS_DIR / "moderator_user_message.md"


def load_prompt(prompt_file: Path) -> str:
    """Load prompt from file."""
    if not prompt_file.exists():
        raise FileNotFoundError(f"Prompt file not found: {prompt_file}")
    return prompt_file.read_text(encoding="utf-8")


async def call_model(system_prompt: str, user_message: str) -> str:
    """Call the AI model and return the response content.

    Uses OpenAI-compatible SDK configured via AI_GENERATION_* env vars.

    Raises:
        ValueError: On API errors or connection failures.
    """
    client = openai.AsyncOpenAI(
        api_key=AI_GENERATION_API_KEY,
        base_url=AI_GENERATION_BASE_URL,
    )
    try:
        response = await client.chat.completions.create(
            model=AI_GENERATION_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            temperature=0.7,
        )
        return response.choices[0].message.content
    except openai.APIStatusError as e:
        error_detail = f"HTTP {e.status_code}"
        try:
            body = e.response.json()
            msg = body.get("error", {})
            error_detail += f": {msg.get('message', str(msg)) if isinstance(msg, dict) else msg}"
        except Exception:
            error_detail += f": {e.message}"
        logger.error(f"API error: {error_detail}")
        raise ValueError(f"AI 生成失败 - {error_detail}")
    except openai.APIConnectionError as e:
        logger.error(f"Connection error: {e}")
        raise ValueError(f"网络请求失败: {str(e)}")


async def generate_expert(
    expert_name: str | None,
    expert_label: str,
    description: str,
) -> tuple[str, str, str]:
    """Generate an expert role definition using AI.

    Returns:
        tuple of (expert_name, expert_label, role_content)
    """
    system_prompt = load_prompt(EXPERT_GENERATION_PROMPT)
    user_message = load_prompt(EXPERT_USER_MESSAGE).format(
        expert_name=expert_name or "(由AI自动生成)",
        expert_label=expert_label,
        description=description,
    )

    content = await call_model(system_prompt, user_message)

    name_match = re.search(r'EXPERT_NAME:\s*([a-z_]+)', content, re.IGNORECASE)
    label_match = re.search(r'EXPERT_LABEL:\s*(.+)', content)
    if not name_match or not label_match:
        raise ValueError("Could not extract expert name or label from generated content")

    expert_name = name_match.group(1).lower()
    expert_label = label_match.group(1).strip()

    main_content = re.sub(r'EXPERT_NAME:.*\n?', '', content)
    main_content = re.sub(r'EXPERT_LABEL:.*\n?', '', main_content)
    main_content = re.sub(r'^```[a-zA-Z0-9_]*\s*\n?', '', main_content.strip(), flags=re.MULTILINE)
    main_content = re.sub(r'\n?```\s*$', '', main_content, flags=re.MULTILINE)
    main_content = re.sub(r'```', '', main_content).strip()

    standard_sections = load_prompt(EXPERT_STANDARD_SECTIONS_FILE).format(expert_name=expert_name)
    role_content = main_content + standard_sections

    logger.info(f"Generated expert: {expert_name} ({expert_label})")
    return expert_name, expert_label, role_content


async def generate_moderator_mode(user_prompt: str) -> str:
    """Generate a moderator mode prompt using AI.

    Returns:
        str: Complete moderator prompt template
    """
    system_prompt = load_prompt(MODERATOR_GENERATION_PROMPT)
    user_message = load_prompt(MODERATOR_USER_MESSAGE).format(user_prompt=user_prompt)

    content = await call_model(system_prompt, user_message)

    content = content.strip()
    if content.startswith("---"):
        content = content[3:].strip()
    if content.endswith("---"):
        content = content[:-3].strip()

    logger.info(f"Generated moderator mode prompt ({len(content)} characters)")
    return content
