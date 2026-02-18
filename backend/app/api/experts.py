"""Experts API endpoints — read/update expert profiles and skill files."""

from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.agent.experts import EXPERT_SPECS
from app.models.schemas import ExpertInfo, ExpertUpdateRequest

router = APIRouter()

SKILLS_DIR = Path(__file__).resolve().parent.parent.parent / "skills"


def _build_expert_info(name: str) -> ExpertInfo:
    spec = EXPERT_SPECS.get(name)
    if not spec:
        raise HTTPException(status_code=404, detail=f"Expert '{name}' not found")
    skill_file = spec["skill_file"]
    skill_path = SKILLS_DIR / skill_file
    skill_content = skill_path.read_text(encoding="utf-8") if skill_path.exists() else ""
    return ExpertInfo(
        name=name,
        label=EXPERT_SPECS[name].get("label", name),
        description=spec["description"],
        skill_file=skill_file,
        skill_content=skill_content,
    )


@router.get("", response_model=list[ExpertInfo])
def list_experts():
    return [_build_expert_info(name) for name in EXPERT_SPECS]


@router.get("/{name}", response_model=ExpertInfo)
def get_expert(name: str):
    return _build_expert_info(name)


@router.put("/{name}", response_model=ExpertInfo)
def update_expert(name: str, req: ExpertUpdateRequest):
    spec = EXPERT_SPECS.get(name)
    if not spec:
        raise HTTPException(status_code=404, detail=f"Expert '{name}' not found")
    skill_path = SKILLS_DIR / spec["skill_file"]
    skill_path.write_text(req.skill_content, encoding="utf-8")
    return _build_expert_info(name)
