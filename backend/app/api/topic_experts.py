"""Topic-level experts management API endpoints."""

import json
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.agent.experts import EXPERT_SPECS
from app.agent.generation import generate_expert
from app.agent.workspace import (
    add_expert_metadata,
    get_topic_experts,
    remove_expert_metadata,
)
from app.core.config import get_workspace_base
from app.models.schemas import (
    AddExpertRequest,
    GenerateExpertActionResponse,
    GenerateExpertRequest,
    TopicExpert,
    TopicExpertResponse,
    UpdateTopicExpertRequest,
)
from app.models.schemas import TopicUpdate
from app.models.store import get_topic, update_topic

router = APIRouter()


def _get_skills_dir() -> Path:
    """Get global skills directory."""
    return Path(__file__).resolve().parent.parent.parent / "skills"


@router.get("/{topic_id}/experts", response_model=list[TopicExpert])
def list_topic_experts(topic_id: str):
    """Get list of experts for this topic from workspace/agents/ directory."""
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    ws_base = get_workspace_base()
    ws_path = ws_base / "topics" / topic_id

    if not ws_path.exists():
        return []

    experts = get_topic_experts(ws_path)
    return [TopicExpert(**e) for e in experts]


@router.post("/{topic_id}/experts", response_model=TopicExpertResponse, status_code=201)
def add_expert_to_topic(topic_id: str, req: AddExpertRequest):
    """Add an expert to the topic.

    Supports three sources:
    - preset: Copy from global skills/
    - custom: Create with user-provided content
    - ai_generated: (handled by separate generate endpoint)
    """
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    ws_base = get_workspace_base()
    ws_path = ws_base / "topics" / topic_id
    agents_dir = ws_path / "agents"

    if req.source == "preset":
        if not req.preset_name:
            raise HTTPException(status_code=400, detail="preset_name is required for preset source")

        if req.preset_name not in EXPERT_SPECS:
            raise HTTPException(status_code=400, detail=f"Unknown preset expert: {req.preset_name}")

        # Copy from global skills
        spec = EXPERT_SPECS[req.preset_name]
        skills_dir = _get_skills_dir()
        global_skill_file = skills_dir / spec["skill_file"]

        if not global_skill_file.exists():
            raise HTTPException(status_code=404, detail=f"Skill file not found: {spec['skill_file']}")

        expert_dir = agents_dir / req.preset_name
        expert_dir.mkdir(parents=True, exist_ok=True)

        role_file = expert_dir / "role.md"
        shutil.copy2(global_skill_file, role_file)

        # Add metadata
        add_expert_metadata(
            ws_path,
            expert_name=req.preset_name,
            label=EXPERT_SPECS.get(req.preset_name, {}).get("label", req.preset_name),
            description=spec["description"],
            source="preset",
            is_from_topic_creation=False,
        )

        # Sync expert_names in topic
        if req.preset_name not in topic.expert_names:
            update_topic(topic_id, TopicUpdate(expert_names=topic.expert_names + [req.preset_name]))

        return {"message": "Expert added from preset", "expert_name": req.preset_name}

    elif req.source == "custom":
        if not all([req.name, req.label, req.description, req.role_content]):
            raise HTTPException(
                status_code=400,
                detail="name, label, description, and role_content are required for custom source"
            )

        # Validate expert name
        if not req.name.replace("_", "").isalnum():
            raise HTTPException(
                status_code=400,
                detail="Expert name must contain only alphanumeric characters and underscores"
            )

        expert_dir = agents_dir / req.name
        if expert_dir.exists():
            raise HTTPException(status_code=400, detail=f"Expert already exists: {req.name}")

        expert_dir.mkdir(parents=True, exist_ok=True)
        role_file = expert_dir / "role.md"
        role_file.write_text(req.role_content, encoding="utf-8")

        # Add metadata
        add_expert_metadata(
            ws_path,
            expert_name=req.name,
            label=req.label,
            description=req.description,
            source="custom",
            is_from_topic_creation=False,
        )

        # Sync expert_names in topic
        if req.name not in topic.expert_names:
            update_topic(topic_id, TopicUpdate(expert_names=topic.expert_names + [req.name]))

        return {"message": "Custom expert created", "expert_name": req.name}

    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported source: {req.source}. Use 'preset' or 'custom'"
        )


@router.put("/{topic_id}/experts/{expert_name}", response_model=TopicExpertResponse)
def update_topic_expert(topic_id: str, expert_name: str, req: UpdateTopicExpertRequest):
    """Update expert's role content."""
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    ws_base = get_workspace_base()
    ws_path = ws_base / "topics" / topic_id
    expert_dir = ws_path / "agents" / expert_name

    if not expert_dir.exists():
        raise HTTPException(status_code=404, detail=f"Expert not found: {expert_name}")

    role_file = expert_dir / "role.md"
    role_file.write_text(req.role_content, encoding="utf-8")

    return {"message": "Expert updated", "expert_name": expert_name}


@router.delete("/{topic_id}/experts/{expert_name}", response_model=TopicExpertResponse)
def delete_topic_expert(topic_id: str, expert_name: str):
    """Delete an expert from the topic."""
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    ws_base = get_workspace_base()
    ws_path = ws_base / "topics" / topic_id
    expert_dir = ws_path / "agents" / expert_name

    if not expert_dir.exists():
        raise HTTPException(status_code=404, detail=f"Expert not found: {expert_name}")

    # Check if at least 1 expert will remain
    current_experts = get_topic_experts(ws_path)
    if len(current_experts) <= 1:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete the last expert. At least one expert must remain."
        )

    # Delete directory
    shutil.rmtree(expert_dir)

    # Remove from metadata
    remove_expert_metadata(ws_path, expert_name)

    # Sync expert_names in topic
    update_topic(topic_id, TopicUpdate(expert_names=[n for n in topic.expert_names if n != expert_name]))

    return {"message": "Expert deleted", "expert_name": expert_name}


@router.get("/{topic_id}/experts/{expert_name}/content")
def get_topic_expert_content(topic_id: str, expert_name: str):
    """Get the role content of a topic expert."""
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    ws_base = get_workspace_base()
    ws_path = ws_base / "topics" / topic_id
    role_file = ws_path / "agents" / expert_name / "role.md"

    if not role_file.exists():
        raise HTTPException(status_code=404, detail=f"Expert not found: {expert_name}")

    return {"role_content": role_file.read_text(encoding="utf-8")}


@router.post("/{topic_id}/experts/{expert_name}/share", response_model=TopicExpertResponse)
def share_expert_to_platform(topic_id: str, expert_name: str):
    """Share a topic-level expert to the platform preset library."""
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    # Bug fix 1: reject if name already exists in global preset library
    if expert_name in EXPERT_SPECS:
        raise HTTPException(
            status_code=409,
            detail=f"全局专家库中已存在名为「{expert_name}」的专家，无法覆盖"
        )

    ws_base = get_workspace_base()
    ws_path = ws_base / "topics" / topic_id
    role_file = ws_path / "agents" / expert_name / "role.md"

    if not role_file.exists():
        raise HTTPException(status_code=404, detail=f"Expert not found: {expert_name}")

    experts = get_topic_experts(ws_path)
    expert_meta = next((e for e in experts if e["name"] == expert_name), None)
    if not expert_meta:
        raise HTTPException(status_code=404, detail="Expert metadata not found")

    # Write role file to global skills/experts/
    skills_dir = _get_skills_dir()
    experts_dir = skills_dir / "experts"
    skill_file_name = f"{expert_name}.md"
    (experts_dir / skill_file_name).write_text(role_file.read_text(encoding="utf-8"), encoding="utf-8")

    # Update meta.json (store filename only, _load_expert_specs adds "experts/" prefix)
    meta_path = experts_dir / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["experts"][expert_name] = {
        "name": expert_name,
        "label": expert_meta["label"],
        "skill_file": skill_file_name,
        "description": expert_meta["description"],
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    # Bug fix 3: must include "experts/" prefix to match how _load_expert_specs formats it
    EXPERT_SPECS[expert_name] = {
        "skill_file": f"experts/{skill_file_name}",
        "description": expert_meta["description"],
        "label": expert_meta["label"],
    }

    return {"message": "Expert shared to platform successfully", "expert_name": expert_name}


@router.post("/{topic_id}/experts/generate", response_model=GenerateExpertActionResponse)
async def generate_expert_for_topic(topic_id: str, req: GenerateExpertRequest):
    """AI-generate an expert role definition.

    Returns the generated content for user preview without creating the expert yet.
    """
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    try:
        expert_name, expert_label, role_content = await generate_expert(
            req.expert_name,  # 可以为 None，由 AI 自动生成
            req.expert_label,
            req.description
        )
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Return generated content for user preview (don't create expert yet)
    return {
        "message": "Expert generated successfully",
        "expert_name": expert_name,
        "expert_label": expert_label,
        "role_content": role_content,
    }
