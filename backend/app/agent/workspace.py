"""Topic workspace: workspace/topics/{topic_id}/shared/ structure."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)


def validate_topic_id(topic_id: str) -> str:
    """Validate topic_id to prevent path traversal attacks.

    Only allows alphanumeric characters, hyphens, and underscores.
    Rejects '..' sequences, '/' or '\\' separators, and any other
    characters that could be used for directory traversal.
    """
    if not topic_id or not re.match(r'^[a-zA-Z0-9_-]+$', topic_id):
        raise ValueError(
            f"Invalid topic_id: '{topic_id}'. "
            "Only alphanumeric characters, hyphens, and underscores are allowed."
        )
    return topic_id


def ensure_topic_workspace(workspace_base: Path | str, topic_id: str) -> Path:
    """Ensure workspace/topics/{topic_id}/shared/turns/ exists. Return topic workspace path.

    Validates topic_id and verifies the resolved path stays inside workspace_base.
    Also creates agents/<name>/ directories with default role.md for each expert.
    Creates config/ directory for metadata storage.
    """
    validate_topic_id(topic_id)

    base = Path(workspace_base).resolve()
    ws = base / "topics" / topic_id

    # Double-check: resolved path must be under workspace_base/topics/
    if not str(ws.resolve()).startswith(str(base / "topics")):
        raise ValueError(f"Path traversal detected for topic_id: '{topic_id}'")

    (ws / "shared" / "turns").mkdir(parents=True, exist_ok=True)
    (ws / "config").mkdir(exist_ok=True)  # Create config directory

    # Create agents/ structure with default roles
    _ensure_agents_structure(ws)

    return ws


def init_discussion_history(ws_path: Path, topic_title: str, topic_body: str) -> Path:
    """Ensure shared/turns/ directory exists. History is built dynamically from turn files."""
    turns_dir = ws_path / "shared" / "turns"
    turns_dir.mkdir(parents=True, exist_ok=True)
    return turns_dir


def _get_expert_label(expert_key: str, ws_path: Path) -> str:
    """Map expert key to display label.

    Priority:
    1. Workspace config/experts_metadata.json  (topic-level override)
    2. Global skills/experts/meta.json via EXPERT_SPECS  (single source of truth)
    3. expert_key itself as fallback
    """
    from .experts import EXPERT_SPECS

    # 1. Topic-level override
    meta_file = ws_path / "config" / "experts_metadata.json"
    if meta_file.exists():
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
            if expert_key in meta:
                return meta[expert_key].get("label", expert_key)
        except Exception:
            pass

    # 2. Global meta.json (maintained alongside expert skills)
    if expert_key in EXPERT_SPECS:
        return EXPERT_SPECS[expert_key].get("label", expert_key)

    return expert_key


def read_discussion_history(ws_path: Path) -> str:
    """Build discussion history dynamically from shared/turns/*.md files.

    Each turn is formatted as '## 第N轮 - 专家标签' so the frontend can parse
    individual posts. discussion_history.md is no longer generated or read.
    """
    turns_dir = ws_path / "shared" / "turns"
    if not turns_dir.exists():
        return ""

    turn_files = sorted(turns_dir.glob("*.md"))
    if not turn_files:
        return ""

    parts = []
    for turn_file in turn_files:
        stem = turn_file.stem  # e.g. round1_physicist
        m = re.match(r"round(\d+)_(.+)", stem)
        if m:
            round_num = m.group(1)
            expert_key = m.group(2)
            label = _get_expert_label(expert_key, ws_path)
            heading = f"## 第{round_num}轮 - {label}"
        else:
            heading = f"## {stem}"
        content = turn_file.read_text(encoding="utf-8").strip()
        parts.append(f"{heading}\n\n{content}\n\n---")

    return "\n\n".join(parts)


def read_discussion_summary(ws_path: Path) -> str:
    """Read shared/discussion_summary.md content."""
    f = ws_path / "shared" / "discussion_summary.md"
    if not f.exists():
        return ""
    return f.read_text(encoding="utf-8")


def _ensure_agents_structure(ws_path: Path):
    """Create agents/<name>/ directories and copy default role.md if not exists.

    For each system-supported expert, creates an agents/<name>/ directory.
    If role.md doesn't exist, copies from global skills/ as default content.
    Existing role.md files are never overwritten (preserves user customization).
    """
    from .experts import EXPERT_SPECS

    agents_dir = ws_path / "agents"
    agents_dir.mkdir(exist_ok=True)

    # skills/ directory is at backend/skills/
    skills_dir = Path(__file__).resolve().parent.parent.parent / "skills"

    for expert_name, spec in EXPERT_SPECS.items():
        expert_dir = agents_dir / expert_name
        expert_dir.mkdir(exist_ok=True)

        role_file = expert_dir / "role.md"

        # Only copy if role.md doesn't exist (idempotent, preserves customization)
        if not role_file.exists():
            global_skill_file = skills_dir / spec["skill_file"]
            if global_skill_file.exists():
                logger.info(
                    f"Creating default role for {expert_name} from {global_skill_file.name}"
                )
                role_file.write_text(
                    global_skill_file.read_text(encoding="utf-8"),
                    encoding="utf-8"
                )
            else:
                logger.warning(
                    f"Global skill file not found for {expert_name}: {global_skill_file}"
                )
                # Create a minimal placeholder
                role_file.write_text(
                    f"# {expert_name}\n\n{spec['description']}\n",
                    encoding="utf-8"
                )


# --- Expert Metadata Management ---

def load_experts_metadata(ws_path: Path) -> dict:
    """Load experts metadata from config/experts_metadata.json.

    Returns:
        dict with structure: {"experts": [{"name": "physicist", "label": "...", ...}, ...]}
        If file doesn't exist, returns empty structure.
    """
    metadata_file = ws_path / "config" / "experts_metadata.json"

    if not metadata_file.exists():
        return {"experts": []}

    try:
        content = metadata_file.read_text(encoding="utf-8")
        return json.loads(content)
    except (json.JSONDecodeError, OSError) as e:
        logger.error(f"Failed to load experts metadata: {e}")
        return {"experts": []}


def save_experts_metadata(ws_path: Path, metadata: dict):
    """Save experts metadata to config/experts_metadata.json.

    Args:
        ws_path: Topic workspace path
        metadata: dict with structure: {"experts": [...]}
    """
    metadata_file = ws_path / "config" / "experts_metadata.json"
    metadata_file.parent.mkdir(parents=True, exist_ok=True)

    try:
        content = json.dumps(metadata, indent=2, ensure_ascii=False)
        metadata_file.write_text(content, encoding="utf-8")
        logger.info(f"Saved experts metadata to {metadata_file}")
    except OSError as e:
        logger.error(f"Failed to save experts metadata: {e}")
        raise


def get_topic_experts(ws_path: Path) -> list[dict]:
    """Get list of experts for this topic by reading workspace/agents/ directory.

    Returns list of expert dicts with metadata merged from experts_metadata.json.
    """
    agents_dir = ws_path / "agents"
    if not agents_dir.exists():
        return []

    # Load metadata
    metadata = load_experts_metadata(ws_path)
    metadata_map = {e["name"]: e for e in metadata.get("experts", [])}

    experts = []
    for expert_dir in sorted(agents_dir.iterdir()):
        if not expert_dir.is_dir():
            continue

        role_file = expert_dir / "role.md"
        if not role_file.exists():
            continue

        expert_name = expert_dir.name
        meta = metadata_map.get(expert_name, {})

        experts.append({
            "name": expert_name,
            "label": meta.get("label", expert_name),
            "description": meta.get("description", ""),
            "source": meta.get("source", "unknown"),
            "role_file": f"agents/{expert_name}/role.md",
            "added_at": meta.get("added_at", ""),
            "is_from_topic_creation": meta.get("is_from_topic_creation", False),
        })

    return experts


def add_expert_metadata(ws_path: Path, expert_name: str, label: str, description: str,
                        source: str, is_from_topic_creation: bool = False):
    """Add or update expert metadata entry."""
    metadata = load_experts_metadata(ws_path)
    experts = metadata.get("experts", [])

    # Remove existing entry if present
    experts = [e for e in experts if e["name"] != expert_name]

    # Add new entry
    experts.append({
        "name": expert_name,
        "label": label,
        "description": description,
        "source": source,
        "added_at": datetime.now(timezone.utc).isoformat(),
        "is_from_topic_creation": is_from_topic_creation,
    })

    metadata["experts"] = experts
    save_experts_metadata(ws_path, metadata)


def remove_expert_metadata(ws_path: Path, expert_name: str):
    """Remove expert from metadata."""
    metadata = load_experts_metadata(ws_path)
    experts = metadata.get("experts", [])

    experts = [e for e in experts if e["name"] != expert_name]

    metadata["experts"] = experts
    save_experts_metadata(ws_path, metadata)
