"""Moderator modes API endpoints."""

from fastapi import APIRouter, HTTPException

from app.agent.generation import generate_moderator_mode
from app.agent.moderator_modes import (
    PRESET_MODES,
    load_moderator_mode_config,
    save_moderator_mode_config,
)
from app.core.config import get_workspace_base
from app.models.schemas import (
    GenerateModeratorModeRequest,
    GenerateModeratorModeResponse,
    ModeratorModeConfig,
    ModeratorModeInfo,
    SetModeratorModeRequest,
)
from app.models.store import get_topic

router = APIRouter()


@router.get("/moderator-modes", response_model=list[ModeratorModeInfo])
def list_moderator_modes():
    """Get list of preset moderator modes."""
    modes = []
    for mode_id, mode_data in PRESET_MODES.items():
        modes.append(
            ModeratorModeInfo(
                id=mode_data["id"],
                name=mode_data["name"],
                description=mode_data["description"],
                num_rounds=mode_data["num_rounds"],
                convergence_strategy=mode_data["convergence_strategy"],
            )
        )
    return modes


@router.get("/topics/{topic_id}/moderator-mode", response_model=ModeratorModeConfig)
def get_topic_moderator_mode(topic_id: str):
    """Get moderator mode configuration for this topic."""
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    ws_base = get_workspace_base()
    ws_path = ws_base / "topics" / topic_id

    config = load_moderator_mode_config(ws_path)
    return ModeratorModeConfig(**config)


@router.put("/topics/{topic_id}/moderator-mode", response_model=ModeratorModeConfig)
def set_topic_moderator_mode(topic_id: str, req: SetModeratorModeRequest):
    """Set moderator mode for this topic."""
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    # Validate mode_id
    if req.mode_id not in PRESET_MODES and req.mode_id != "custom":
        raise HTTPException(
            status_code=400,
            detail=f"Invalid mode_id. Must be one of: {', '.join(PRESET_MODES.keys())}, custom"
        )

    # If custom mode, require custom_prompt
    if req.mode_id == "custom" and not req.custom_prompt:
        raise HTTPException(
            status_code=400,
            detail="custom_prompt is required when mode_id is 'custom'"
        )

    ws_base = get_workspace_base()
    ws_path = ws_base / "topics" / topic_id

    config = {
        "mode_id": req.mode_id,
        "num_rounds": req.num_rounds,
        "custom_prompt": req.custom_prompt,
    }

    save_moderator_mode_config(ws_path, config)

    return ModeratorModeConfig(**config)


@router.post("/topics/{topic_id}/moderator-mode/generate", response_model=GenerateModeratorModeResponse)
async def generate_moderator_mode_endpoint(topic_id: str, req: GenerateModeratorModeRequest):
    """AI-generate a moderator mode based on user's description."""
    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    try:
        custom_prompt = await generate_moderator_mode(req.prompt)
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Automatically save as custom mode
    ws_base = get_workspace_base()
    ws_path = ws_base / "topics" / topic_id

    config = {
        "mode_id": "custom",
        "num_rounds": 5,  # Default, user can adjust
        "custom_prompt": custom_prompt,
    }

    save_moderator_mode_config(ws_path, config)

    return {
        "message": "Moderator mode generated successfully",
        "custom_prompt": custom_prompt,
        "config": config,
    }
