"""Preset moderator modes for roundtable discussions."""

from __future__ import annotations

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Skill files directory for moderator mode prompts
_MODERATOR_SKILLS_DIR = Path(__file__).parent.parent.parent / "skills" / "moderator"
_META_FILE = _MODERATOR_SKILLS_DIR / "meta.json"


def _load_preset_modes() -> dict:
    """Load preset moderator modes from skills/moderator/meta.json."""
    if not _META_FILE.exists():
        logger.error(f"Moderator modes meta file not found: {_META_FILE}")
        return {}
    
    try:
        content = _META_FILE.read_text(encoding="utf-8")
        data = json.loads(content)
        modes = data.get("modes", {})
        
        # Validate and clean up the modes data
        valid_modes = {}
        for mode_id, mode_data in modes.items():
            if all(key in mode_data for key in ["id", "name", "description", "num_rounds", "convergence_strategy"]):
                valid_modes[mode_id] = {
                    "id": mode_data["id"],
                    "name": mode_data["name"],
                    "description": mode_data["description"],
                    "num_rounds": mode_data["num_rounds"],
                    "convergence_strategy": mode_data["convergence_strategy"],
                }
            else:
                logger.warning(f"Skipping invalid mode '{mode_id}': missing required fields")
        
        return valid_modes
    except (json.JSONDecodeError, OSError, KeyError) as e:
        logger.error(f"Failed to load moderator modes from meta file: {e}")
        return {}


def _load_mode_prompt(mode_id: str) -> str:
    """Load moderator prompt template from skills/moderator/ directory.
    
    First checks meta.json for the prompt_file, then falls back to <mode_id>.md.
    """
    # Try to get prompt file from meta first
    try:
        if _META_FILE.exists():
            content = _META_FILE.read_text(encoding="utf-8")
            data = json.loads(content)
            modes = data.get("modes", {})
            if mode_id in modes and "prompt_file" in modes[mode_id]:
                skill_file = _MODERATOR_SKILLS_DIR / modes[mode_id]["prompt_file"]
                if skill_file.exists():
                    return skill_file.read_text(encoding="utf-8")
    except Exception as e:
        logger.debug(f"Could not load prompt from meta for mode {mode_id}: {e}")
    
    # Fall back to default naming
    skill_file = _MODERATOR_SKILLS_DIR / f"{mode_id}.md"
    if not skill_file.exists():
        raise FileNotFoundError(f"Moderator skill file not found: {skill_file}")
    return skill_file.read_text(encoding="utf-8")


# Preset moderator modes (loaded from skills/moderator/meta.json)
PRESET_MODES = _load_preset_modes()


def load_moderator_mode_config(ws_path: Path) -> dict:
    """Load moderator mode configuration from config/moderator_mode.json.

    Returns:
        dict with structure: {"mode_id": "standard", "num_rounds": 5, "custom_prompt": null}
        If file doesn't exist, returns default standard mode config.
    """
    config_file = ws_path / "config" / "moderator_mode.json"

    if not config_file.exists():
        return {
            "mode_id": "standard",
            "num_rounds": 5,
            "custom_prompt": None,
        }

    try:
        content = config_file.read_text(encoding="utf-8")
        return json.loads(content)
    except (json.JSONDecodeError, OSError) as e:
        logger.error(f"Failed to load moderator mode config: {e}")
        return {
            "mode_id": "standard",
            "num_rounds": 5,
            "custom_prompt": None,
        }


def save_moderator_mode_config(ws_path: Path, config: dict):
    """Save moderator mode configuration to config/moderator_mode.json."""
    config_file = ws_path / "config" / "moderator_mode.json"
    config_file.parent.mkdir(parents=True, exist_ok=True)

    try:
        content = json.dumps(config, indent=2, ensure_ascii=False)
        config_file.write_text(content, encoding="utf-8")
        logger.info(f"Saved moderator mode config to {config_file}")
    except OSError as e:
        logger.error(f"Failed to save moderator mode config: {e}")
        raise


def _fill_skill_template(template: str, **kwargs) -> str:
    """Replace only known {key} placeholders, leaving unknown ones (e.g. {轮次}) intact."""
    for key, value in kwargs.items():
        template = template.replace("{" + key + "}", str(value))
    return template


def prepare_moderator_skill(ws_path: Path, topic: str, expert_names: list[str], num_rounds: int | None = None) -> Path:
    """Format the moderator skill and save it to config/moderator_skill.md in the workspace.

    This ensures the agent reads its skill from the topic workspace, consistent
    with how expert skills are stored per-topic.

    Returns:
        Path to the saved skill file.
    """
    config = load_moderator_mode_config(ws_path)
    mode_id = config.get("mode_id", "standard")
    # num_rounds: explicit override wins over workspace config
    num_rounds = num_rounds if num_rounds is not None else config.get("num_rounds", 5)
    custom_prompt = config.get("custom_prompt")

    params = dict(
        topic=topic,
        ws_abs=str(ws_path.resolve()),
        expert_names_str="、".join(expert_names),
        num_experts=len(expert_names),
        num_rounds=num_rounds,
    )

    if mode_id == "custom" and custom_prompt:
        skill_content = _fill_skill_template(custom_prompt, **params)
    else:
        if mode_id not in PRESET_MODES:
            logger.warning(f"Unknown mode_id: {mode_id}, falling back to standard")
            mode_id = "standard"
        template = _load_mode_prompt(mode_id)
        skill_content = _fill_skill_template(template, **params)

    skill_file = ws_path / "config" / "moderator_skill.md"
    skill_file.parent.mkdir(parents=True, exist_ok=True)
    skill_file.write_text(skill_content, encoding="utf-8")
    logger.info(f"Saved moderator skill to {skill_file} (mode={mode_id}, rounds={num_rounds})")
    return skill_file


def get_moderator_prompt(ws_path: Path) -> str:
    """Return the short prompt that instructs the moderator to read its skill file.

    Must be called after prepare_moderator_skill() has written config/moderator_skill.md.
    """
    return "请阅读 config/moderator_skill.md 获取你的主持技能指南，然后严格按照其中的要求主持本次讨论。"
