"""SkillHub domain service for OpenClaw-facing research skills."""

from __future__ import annotations

import functools
import json
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import HTTPException, UploadFile
from sqlalchemy import bindparam, text

from app.services.openclaw_runtime import (
    apply_points_delta,
    apply_rule_points,
    create_or_rotate_openclaw_key_for_user,
    ensure_primary_openclaw_agent,
    get_openclaw_key_record,
    get_primary_openclaw_agent_for_user,
    get_wallet_by_agent_id,
    record_activity_event,
)
from app.services.resonnet_client import get_resonnet_base_url
from app.storage.database.postgres_client import get_db_session

logger = logging.getLogger(__name__)

DISCIPLINES: list[dict[str, str]] = [
    {"key": "01", "name": "哲学", "summary": "问题定义、方法反思与概念辨析。"},
    {"key": "02", "name": "经济学", "summary": "政策、博弈、产业与量化分析。"},
    {"key": "03", "name": "法学", "summary": "法规条文、案例研究与制度比较。"},
    {"key": "04", "name": "教育学", "summary": "教学设计、学习分析与评估反馈。"},
    {"key": "05", "name": "文学", "summary": "文本细读、语义分析与写作辅助。"},
    {"key": "06", "name": "历史学", "summary": "史料梳理、脉络追踪与叙事校对。"},
    {"key": "07", "name": "理学", "summary": "理论推导、数据分析与实验解释。"},
    {"key": "ast", "name": "天文学", "summary": "观测资料、星表与天体研究辅助。"},
    {"key": "08", "name": "工学", "summary": "工程实现、系统设计与实验优化。"},
    {"key": "09", "name": "农学", "summary": "农业数据、育种、生态与田间研究。"},
    {"key": "10", "name": "医学", "summary": "临床、影像、生信与医学研究支持。"},
    {"key": "11", "name": "军事学", "summary": "战略推演、情报研判与体系分析。"},
    {"key": "12", "name": "管理学", "summary": "组织、运营、决策与管理评估。"},
    {"key": "13", "name": "艺术学", "summary": "风格研究、策展叙事与创作辅助。"},
]

RESEARCH_CLUSTERS: list[dict[str, str]] = [
    {"key": "bio", "title": "生物与生命科学", "summary": "覆盖单细胞、多组学、基因组学、蛋白质组学等研究型技能。"},
    {"key": "pharma", "title": "药物研发", "summary": "围绕分子对接、化学信息学、药理分析与药物设计展开。"},
    {"key": "med", "title": "医学与临床", "summary": "适合临床研究、医学影像、精准医疗与疾病分析。"},
    {"key": "labos", "title": "实验室自动化", "summary": "实验协议、机器人控制、LabOS 与实验流程编排。"},
    {"key": "vision", "title": "视觉与 XR", "summary": "图像分割、姿态估计、手势追踪与空间感知能力。"},
    {"key": "ai", "title": "AI 与大模型", "summary": "围绕大模型架构、训练、推理、RAG、Agent 与模型工程。"},
    {"key": "general", "title": "数据科学", "summary": "统计学、机器学习、数据清洗、可视化与模型分析。"},
    {"key": "literature", "title": "文献检索", "summary": "学术搜索、数据库访问、文献筛选与知识整理。"},
]

LEGACY_RESEARCH_DREAM_ID = "research-dream:research-dream"
RESEARCH_DREAM_SLUG = "research-dream"
RESEARCH_DREAM_INSTALL_COMMAND = "topiclab skills install research-dream"
ASSIGNABLE_SOURCES_TO_IMPORT: tuple[str, ...] = ("ai-research", "claude-scientific")
ASSIGNABLE_SOURCE_URLS: dict[str, str] = {
    "ai-research": "https://github.com/Orchestra-Research/AI-Research-SKILLs",
    "claude-scientific": "https://github.com/K-Dense-AI/claude-scientific-skills",
}
AI_RESEARCH_ENGINEERING_CATEGORIES = {
    "08-distributed-training",
    "09-infrastructure",
    "12-inference-serving",
    "13-mlops",
}
AI_RESEARCH_LITERATURE_CATEGORIES = {"20-ml-paper-writing", "21-research-ideation"}
CLAUDE_SCIENTIFIC_CLUSTER_RULES: tuple[tuple[str, str], ...] = (
    ("pharma", "pharma"),
    ("medic", "med"),
    ("clinic", "med"),
    ("imaging", "vision"),
    ("image", "vision"),
    ("vision", "vision"),
    ("microscopy", "vision"),
    ("segment", "vision"),
    ("benchling", "labos"),
    ("protocol", "labos"),
    ("lab", "labos"),
    ("robot", "labos"),
    ("automation", "labos"),
    ("workflow", "labos"),
    ("genom", "bio"),
    ("prote", "bio"),
    ("rna", "bio"),
    ("single-cell", "bio"),
    ("bioinformatics", "bio"),
    ("biolog", "bio"),
    ("omics", "bio"),
    ("chem", "pharma"),
    ("drug", "pharma"),
    ("molecul", "pharma"),
    ("compound", "pharma"),
    ("docking", "pharma"),
    ("citation", "literature"),
    ("paper", "literature"),
    ("pubmed", "literature"),
    ("scholar", "literature"),
    ("search", "literature"),
    ("lookup", "literature"),
    ("zotero", "literature"),
    ("literature", "literature"),
)
DEMO_SKILL_SLUGS = (
    "scanpy-pipeline",
    "literature-map",
    "rdkit-docking-lab",
    "clinical-protocol-studio",
    "lab-robot-playbook",
    "handxr-vision-kit",
)
DEFAULT_TASK_DEFS: tuple[dict[str, Any], ...] = (
    {
        "task_key": "publish_first_skill",
        "title": "发布第一个 Skill",
        "description": "上传带正文或附件的 Skill，完成第一条可用作品发布。",
        "reason_code": "skill_publish",
        "points_reward": 10,
        "daily_limit": 1,
        "goal_count": 1,
    },
    {
        "task_key": "review_a_skill",
        "title": "提交一条评测",
        "description": "为已体验过的 Skill 提交一条结构化评测。",
        "reason_code": "skill_review_create",
        "points_reward": 5,
        "daily_limit": 3,
        "goal_count": 1,
    },
    {
        "task_key": "helpful_feedback",
        "title": "收到 Helpful 反馈",
        "description": "你的评测被其他用户标记为 Helpful。",
        "reason_code": "skill_review_helpful_received",
        "points_reward": 3,
        "daily_limit": 5,
        "goal_count": 1,
    },
    {
        "task_key": "wish_for_a_skill",
        "title": "写下一条技能心愿",
        "description": "在许愿墙发布一个明确的 Skill 需求。",
        "reason_code": "skill_wish_create",
        "points_reward": 2,
        "daily_limit": 2,
        "goal_count": 1,
    },
)
DEFAULT_COLLECTION_DEFS: tuple[dict[str, Any], ...] = (
    {
        "slug": "openclaw-starters",
        "title": "OpenClaw 入门精选",
        "description": "当前默认公开的 OpenClaw 可用 Skill 集合，适合先从本地记忆与科研陪伴能力开始。",
        "accent": "#0f766e",
        "skill_slugs": (RESEARCH_DREAM_SLUG,),
    },
)
EMBEDDED_RESEARCH_DREAM_CONTENT = """---
name: research-dream
description: Research Dream。面向科研场景的记忆巩固技能，帮助 OpenClaw 在长期陪伴过程中把高价值科研信号沉淀到原生工作区记忆文件。
user-invocable: true
metadata: {"openclaw":{"always":true,"skillKey":"research-dream"}}
---

# Research Dream

把科研对话中的高价值信息逐步整理到 `USER.md`、`SOUL.md`、`MEMORY.md` 与 `memory/YYYY-MM-DD.md`，形成更稳定的长期科研数字分身。

## 工作原则

- 只在 OpenClaw 原生工作区内维护记忆
- 日常对话中做小步更新
- 周期性做更深的 consolidation
- 让研究方向、工作方式、当前卡点与长期偏好逐步稳定下来
"""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _to_iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return value.isoformat()


def _json_dumps(value: Any) -> str:
    return json.dumps(value or [], ensure_ascii=False)


def _json_loads(value: Any, default: Any):
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return default


def _slugify(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.strip().lower())
    normalized = re.sub(r"-+", "-", normalized).strip("-")
    return normalized[:96] or f"skill-{secrets.token_hex(4)}"


def _coerce_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _has_skill_payload(*, content_markdown: str | None = None, file: UploadFile | None = None) -> bool:
    return bool((content_markdown or "").strip()) or file is not None


def _storage_dir() -> Path:
    configured = os.getenv("SKILL_HUB_STORAGE_DIR", "").strip()
    if configured:
        base = Path(configured)
    else:
        base = Path(__file__).resolve().parents[2] / "storage" / "skill_hub_uploads"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _save_upload(upload: UploadFile, *, prefix: str) -> dict[str, Any]:
    payload = upload.file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="上传文件不能为空")
    original_name = upload.filename or f"{prefix}.zip"
    safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "-", original_name).strip("-") or f"{prefix}.zip"
    object_name = f"{prefix}-{secrets.token_hex(8)}-{safe_name}"
    target = _storage_dir() / object_name
    target.write_bytes(payload)
    return {
        "filename": safe_name,
        "storage_path": str(target),
        "content_type": upload.content_type or "application/octet-stream",
        "size_bytes": len(payload),
    }


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _research_dream_skill_path() -> Path:
    return _repo_root() / "backend" / "libs" / "assignable_skills" / "_submodules" / "research-dream" / "SKILL.md"


def _research_dream_meta_path() -> Path:
    return _repo_root() / "backend" / "libs" / "assignable_skills" / "research-dream" / "meta.json"


def _assignable_skills_root() -> Path:
    configured = os.getenv("ASSIGNABLE_SKILLS_ROOT", "").strip()
    candidates = []
    if configured:
        candidates.append(Path(configured))
    candidates.extend(
        [
            _repo_root() / "backend" / "libs" / "assignable_skills",
            Path("/app/libs/assignable_skills"),
        ]
    )
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def _assignable_source_meta_path(source: str) -> Path:
    return _assignable_skills_root() / source / "meta.json"


def _split_assignable_skill_id(skill_id: str) -> tuple[str | None, str]:
    raw = skill_id.removesuffix(".md") if skill_id.endswith(".md") else skill_id
    if ":" in raw:
        source, slug = raw.split(":", 1)
        return source, slug
    return None, raw


def _extract_frontmatter_value(content: str, key: str) -> str | None:
    match = re.search(rf"^{re.escape(key)}:\s*(.+)$", content, re.MULTILINE)
    if not match:
        return None
    return match.group(1).strip()


def _load_research_dream_from_files() -> dict[str, Any]:
    meta_payload: dict[str, Any] = {}
    meta_path = _research_dream_meta_path()
    if meta_path.exists():
        meta_payload = json.loads(meta_path.read_text(encoding="utf-8"))
    skills = meta_payload.get("skills") if isinstance(meta_payload, dict) else None
    detail = skills.get(LEGACY_RESEARCH_DREAM_ID, {}) if isinstance(skills, dict) else {}
    skill_path = _research_dream_skill_path()
    if skill_path.exists():
        content = skill_path.read_text(encoding="utf-8")
    else:
        content = EMBEDDED_RESEARCH_DREAM_CONTENT
    description = str(detail.get("description") or _extract_frontmatter_value(content, "description") or "").strip()
    summary = str(detail.get("introduction") or "面向科研场景的记忆巩固技能。").strip()
    name = str(detail.get("name") or _extract_frontmatter_value(content, "name") or RESEARCH_DREAM_SLUG).strip()
    return {
        "slug": RESEARCH_DREAM_SLUG,
        "legacy_id": LEGACY_RESEARCH_DREAM_ID,
        "name": "Research-Dream" if name.lower() == RESEARCH_DREAM_SLUG else name,
        "summary": summary,
        "description": description,
        "content_markdown": content,
        "source_url": "https://github.com/TashanGKD/Research-Dream",
        "source_name": "GitHub",
        "docs_url": "https://github.com/TashanGKD/Research-Dream",
        "category_key": "07",
        "category_name": "理学",
        "cluster_key": "general",
        "cluster_name": "数据科学",
        "tags": ["research", "memory", "digital-twin", "workflow"],
        "capabilities": ["USER.md 更新", "SOUL.md 更新", "记忆巩固", "长期科研画像"],
        "framework": "openclaw",
        "compatibility_level": "install",
        "pricing_status": "free",
        "price_points": 0,
        "license": "MIT",
        "install_command": RESEARCH_DREAM_INSTALL_COMMAND,
        "latest_version": "1.0.0",
        "openclaw_ready": True,
        "featured": True,
        "hero_note": "把长期科研陪伴中的零散信号整理成稳定的本地记忆结构。",
    }


def _load_research_dream_from_upstream() -> dict[str, Any] | None:
    base_url = get_resonnet_base_url()
    detail_url = f"{base_url}/skills/assignable/{LEGACY_RESEARCH_DREAM_ID}"
    content_url = f"{base_url}/skills/assignable/{LEGACY_RESEARCH_DREAM_ID}/content"
    try:
        with httpx.Client(timeout=15.0, follow_redirects=True) as client:
            detail_resp = client.get(detail_url)
            detail_resp.raise_for_status()
            content_resp = client.get(content_url)
            content_resp.raise_for_status()
        detail = detail_resp.json() if detail_resp.content else {}
        content_payload = content_resp.json() if content_resp.content else {}
    except Exception:
        return None
    content = str(content_payload.get("content") or "").strip()
    if not content:
        return None
    fallback = _load_research_dream_from_files()
    return {
        **fallback,
        "name": str(detail.get("name") or fallback["name"]).strip() or fallback["name"],
        "summary": str(detail.get("introduction") or fallback["summary"]).strip() or fallback["summary"],
        "description": str(detail.get("description") or fallback["description"]).strip() or fallback["description"],
        "content_markdown": content,
    }


def _load_research_dream_source() -> dict[str, Any]:
    upstream = _load_research_dream_from_upstream()
    if upstream is not None:
        return upstream
    return _load_research_dream_from_files()


def _resolve_assignable_skill_path(source: str, skill_id: str, *, category: str, skills_dir: str) -> Path | None:
    _, slug = _split_assignable_skill_id(skill_id)
    base_dir = _assignable_skills_root()
    submodules = base_dir / "_submodules" / source
    if not submodules.exists():
        return None
    candidates: list[Path] = []
    if category and category != "general":
        candidates.append(submodules / skills_dir / category / slug / "SKILL.md")
    else:
        if skills_dir == ".":
            candidates.append(submodules / "SKILL.md")
        candidates.append(submodules / skills_dir / slug / "SKILL.md")
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def _map_category_name(category: str, categories: dict[str, Any]) -> str:
    entry = categories.get(category) if isinstance(categories, dict) else None
    if isinstance(entry, dict):
        return str(entry.get("name") or category).strip() or category
    return category


def _discipline_name_for(key: str) -> str:
    return next((item["name"] for item in DISCIPLINES if item["key"] == key), key)


def _cluster_title_for(key: str) -> str:
    return next((item["title"] for item in RESEARCH_CLUSTERS if item["key"] == key), key)


def _infer_ai_research_taxonomy(category: str) -> tuple[str, str]:
    if category in AI_RESEARCH_ENGINEERING_CATEGORIES:
        return "08", "ai"
    if category in AI_RESEARCH_LITERATURE_CATEGORIES:
        return "07", "literature"
    return "07", "ai"


def _infer_claude_scientific_cluster(*, slug: str, description: str, category_name: str) -> str:
    haystack = " ".join([slug.lower(), description.lower(), category_name.lower()])
    for needle, cluster_key in CLAUDE_SCIENTIFIC_CLUSTER_RULES:
        if needle in haystack:
            return cluster_key
    return "general"


def _infer_claude_scientific_taxonomy(*, slug: str, description: str, category_name: str) -> tuple[str, str]:
    cluster_key = _infer_claude_scientific_cluster(slug=slug, description=description, category_name=category_name)
    if cluster_key in {"med", "pharma"}:
        return "10", cluster_key
    if cluster_key in {"vision", "labos"}:
        return "08", cluster_key
    if cluster_key == "literature":
        return "07", cluster_key
    if cluster_key == "bio":
        return "07", cluster_key
    if cluster_key == "ai":
        return "08", cluster_key
    return "07", "general"


def _claude_scientific_taxonomy_path() -> Path:
    return Path(__file__).resolve().parents[1] / "data" / "claude_scientific_taxonomy.json"


@functools.lru_cache(maxsize=1)
def _claude_scientific_taxonomy_table() -> dict[str, tuple[str, str]]:
    path = _claude_scientific_taxonomy_path()
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(payload, dict):
        return {}
    out: dict[str, tuple[str, str]] = {}
    for slug, entry in payload.items():
        if not isinstance(entry, dict):
            continue
        ck = str(entry.get("category_key") or "").strip()
        sk = str(entry.get("cluster_key") or "").strip()
        if ck and sk:
            out[str(slug).strip()] = (ck, sk)
    return out


def _resolve_claude_scientific_taxonomy(*, slug: str, description: str, category_name: str) -> tuple[str, str]:
    table = _claude_scientific_taxonomy_table()
    hit = table.get(slug)
    if hit is not None:
        return hit
    logger.warning(
        "claude-scientific skill %r missing from claude_scientific_taxonomy.json; using heuristic taxonomy",
        slug,
    )
    return _infer_claude_scientific_taxonomy(slug=slug, description=description, category_name=category_name)


def _normalize_assignable_skill_source(
    *,
    source: str,
    skill_id: str,
    skill_info: dict[str, Any],
    categories: dict[str, Any],
    skills_dir: str,
    source_name: str,
    source_url: str,
) -> dict[str, Any] | None:
    category = str(skill_info.get("category") or "").strip()
    category_name = _map_category_name(category, categories)
    source_path = _resolve_assignable_skill_path(source, skill_id, category=category, skills_dir=skills_dir)
    if source_path is None or not source_path.exists():
        return None
    content = source_path.read_text(encoding="utf-8")
    _, legacy_slug = _split_assignable_skill_id(skill_id)
    frontmatter_name = _extract_frontmatter_value(content, "name")
    raw_name = str(skill_info.get("name") or frontmatter_name or legacy_slug).strip() or legacy_slug
    description = str(skill_info.get("description") or _extract_frontmatter_value(content, "description") or "").strip()
    summary = str(skill_info.get("introduction") or description or raw_name).strip()
    if source == "ai-research":
        discipline_key, cluster_key = _infer_ai_research_taxonomy(category)
    else:
        discipline_key, cluster_key = _resolve_claude_scientific_taxonomy(
            slug=legacy_slug,
            description=description,
            category_name=category_name,
        )
    tags = [source, legacy_slug]
    if category:
        tags.append(category)
    if category_name and category_name != category:
        tags.append(category_name)
    tags.append(_cluster_title_for(cluster_key))
    deduped_tags = list(dict.fromkeys(tag for tag in tags if tag))
    return {
        "slug": _slugify(f"{source}-{legacy_slug}"),
        "legacy_id": skill_id,
        "name": raw_name,
        "summary": summary,
        "description": description or summary,
        "content_markdown": content,
        "source_url": source_url,
        "source_name": source_name,
        "docs_url": source_url,
        "category_key": discipline_key,
        "category_name": _discipline_name_for(discipline_key),
        "cluster_key": cluster_key,
        "cluster_name": _cluster_title_for(cluster_key),
        "tags": deduped_tags,
        "capabilities": [category_name] if category_name else [],
        "framework": "openclaw",
        "compatibility_level": "install",
        "pricing_status": "free",
        "price_points": 0,
        "license": None,
        "install_command": f"topiclab skills install {_slugify(f'{source}-{legacy_slug}')}",
        "latest_version": "1.0.0",
        "openclaw_ready": True,
        "featured": False,
        "hero_note": f"来自 {source_name} 技能库。",
    }


def _load_assignable_source_entries(source: str) -> list[dict[str, Any]]:
    meta_path = _assignable_source_meta_path(source)
    if not meta_path.exists():
        return []
    payload = json.loads(meta_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        return []
    categories = payload.get("categories") if isinstance(payload.get("categories"), dict) else {}
    skills = payload.get("skills") if isinstance(payload.get("skills"), dict) else {}
    skills_dir = str(payload.get("skills_dir") or ".").strip() or "."
    source_url = ASSIGNABLE_SOURCE_URLS.get(source, "")
    source_name = source.replace("-", " ").title()
    entries: list[dict[str, Any]] = []
    for skill_id, skill_info in skills.items():
        if not isinstance(skill_info, dict):
            continue
        normalized = _normalize_assignable_skill_source(
            source=source,
            skill_id=skill_id,
            skill_info=skill_info,
            categories=categories,
            skills_dir=skills_dir,
            source_name=source_name,
            source_url=source_url,
        )
        if normalized is not None:
            entries.append(normalized)
    entries.sort(key=lambda item: item["slug"])
    return entries


def _build_skill_summary(row, *, viewer_favorited: bool = False) -> dict[str, Any]:
    return {
        "id": int(row.id),
        "slug": row.slug,
        "name": row.name,
        "tagline": getattr(row, "tagline", None),
        "summary": row.summary,
        "description": row.description,
        "category_key": row.category_key,
        "category_name": row.category_name,
        "cluster_key": row.cluster_key,
        "cluster_name": row.cluster_name,
        "tags": _json_loads(getattr(row, "tags_json", None), []),
        "capabilities": _json_loads(getattr(row, "capabilities_json", None), []),
        "framework": row.framework,
        "compatibility_level": row.compatibility_level,
        "pricing_status": row.pricing_status,
        "price_points": int(row.price_points or 0),
        "license": row.license,
        "source_url": getattr(row, "source_url", None),
        "source_name": getattr(row, "source_name", None),
        "docs_url": getattr(row, "docs_url", None),
        "install_command": getattr(row, "install_command", None),
        "latest_version": getattr(row, "latest_version", None),
        "openclaw_ready": bool(getattr(row, "openclaw_ready", False)),
        "featured": bool(getattr(row, "featured", False)),
        "hero_note": getattr(row, "hero_note", None),
        "total_reviews": int(getattr(row, "total_reviews", 0) or 0),
        "avg_rating": float(getattr(row, "avg_rating", 0) or 0),
        "total_favorites": int(getattr(row, "total_favorites", 0) or 0),
        "total_downloads": int(getattr(row, "total_downloads", 0) or 0),
        "weekly_downloads": int(getattr(row, "weekly_downloads", 0) or 0),
        "viewer_favorited": bool(viewer_favorited),
        "author_openclaw_agent_id": int(row.author_openclaw_agent_id) if getattr(row, "author_openclaw_agent_id", None) is not None else None,
        "created_at": _to_iso(row.created_at),
        "updated_at": _to_iso(row.updated_at),
        "published_at": _to_iso(getattr(row, "published_at", None)),
    }


def _resolve_viewer_favorites(session, *, user_agent_id: int | None, skill_ids: list[int]) -> set[int]:
    if not user_agent_id or not skill_ids:
        return set()
    stmt = text(
        """
        SELECT skill_id
        FROM skill_hub_favorites
        WHERE openclaw_agent_id = :agent_id
          AND skill_id IN :skill_ids
        """
    ).bindparams(bindparam("skill_ids", expanding=True))
    rows = session.execute(stmt, {"agent_id": user_agent_id, "skill_ids": skill_ids}).fetchall()
    return {int(row.skill_id) for row in rows}


def _upsert_seeded_skill(session, *, source: dict[str, Any], now: datetime) -> int:
    existing = session.execute(
        text("SELECT id FROM skill_hub_skills WHERE slug = :slug LIMIT 1"),
        {"slug": source["slug"]},
    ).fetchone()
    skill_params = {
        "slug": source["slug"],
        "name": source["name"],
        "tagline": source.get("summary"),
        "summary": source["summary"],
        "description": source["description"],
        "category_key": source["category_key"],
        "category_name": source["category_name"],
        "cluster_key": source["cluster_key"],
        "cluster_name": source["cluster_name"],
        "tags_json": _json_dumps(source.get("tags")),
        "capabilities_json": _json_dumps(source.get("capabilities")),
        "framework": source["framework"],
        "compatibility_level": source["compatibility_level"],
        "pricing_status": source["pricing_status"],
        "price_points": int(source.get("price_points") or 0),
        "license": source.get("license"),
        "source_url": source.get("source_url"),
        "source_name": source.get("source_name"),
        "docs_url": source.get("docs_url"),
        "install_command": source["install_command"],
        "latest_version": source["latest_version"],
        "openclaw_ready": bool(source.get("openclaw_ready", True)),
        "featured": bool(source.get("featured", False)),
        "hero_note": source.get("hero_note"),
        "updated_at": now,
        "published_at": now,
    }
    if existing is None:
        inserted = session.execute(
            text(
                """
                INSERT INTO skill_hub_skills (
                    slug, name, tagline, summary, description,
                    category_key, category_name, cluster_key, cluster_name,
                    tags_json, capabilities_json, framework, compatibility_level,
                    pricing_status, price_points, license, source_url, source_name,
                    docs_url, install_command, latest_version, openclaw_ready, featured,
                    hero_note, total_reviews, avg_rating, total_favorites, total_downloads,
                    weekly_downloads, status, created_at, updated_at, published_at
                ) VALUES (
                    :slug, :name, :tagline, :summary, :description,
                    :category_key, :category_name, :cluster_key, :cluster_name,
                    :tags_json, :capabilities_json, :framework, :compatibility_level,
                    :pricing_status, :price_points, :license, :source_url, :source_name,
                    :docs_url, :install_command, :latest_version, :openclaw_ready, :featured,
                    :hero_note, 0, 0, 0, 0,
                    0, 'published', :created_at, :updated_at, :published_at
                )
                RETURNING id
                """
            ),
            {**skill_params, "created_at": now},
        ).fetchone()
        skill_id = int(inserted.id)
    else:
        skill_id = int(existing.id)
        session.execute(
            text(
                """
                UPDATE skill_hub_skills
                SET name = :name,
                    tagline = :tagline,
                    summary = :summary,
                    description = :description,
                    category_key = :category_key,
                    category_name = :category_name,
                    cluster_key = :cluster_key,
                    cluster_name = :cluster_name,
                    tags_json = :tags_json,
                    capabilities_json = :capabilities_json,
                    framework = :framework,
                    compatibility_level = :compatibility_level,
                    pricing_status = :pricing_status,
                    price_points = :price_points,
                    license = :license,
                    source_url = :source_url,
                    source_name = :source_name,
                    docs_url = :docs_url,
                    install_command = :install_command,
                    latest_version = :latest_version,
                    openclaw_ready = :openclaw_ready,
                    featured = :featured,
                    hero_note = :hero_note,
                    updated_at = :updated_at,
                    published_at = :published_at
                WHERE id = :skill_id
                """
            ),
            {**skill_params, "skill_id": skill_id},
        )
    session.execute(text("UPDATE skill_hub_skill_versions SET is_latest = FALSE WHERE skill_id = :skill_id"), {"skill_id": skill_id})
    version_row = session.execute(
        text(
            """
            SELECT id
            FROM skill_hub_skill_versions
            WHERE skill_id = :skill_id AND version = :version
            LIMIT 1
            """
        ),
        {"skill_id": skill_id, "version": source["latest_version"]},
    ).fetchone()
    version_params = {
        "skill_id": skill_id,
        "version": source["latest_version"],
        "changelog": f"Imported from {source.get('source_name') or 'legacy assignable'} source.",
        "content_markdown": source["content_markdown"],
        "install_command": source["install_command"],
        "manifest_json": _json_dumps(
            {
                "slug": source["slug"],
                "legacy_id": source["legacy_id"],
                "name": source["name"],
                "framework": source["framework"],
                "compatibility_level": source["compatibility_level"],
                "source_name": source.get("source_name"),
            }
        ),
        "created_at": now,
    }
    if version_row is None:
        session.execute(
            text(
                """
                INSERT INTO skill_hub_skill_versions (
                    skill_id, version, changelog, content_markdown, artifact_filename, artifact_path,
                    artifact_content_type, artifact_size, install_command, manifest_json,
                    is_latest, created_at
                ) VALUES (
                    :skill_id, :version, :changelog, :content_markdown, NULL, NULL,
                    NULL, 0, :install_command, :manifest_json,
                    TRUE, :created_at
                )
                """
            ),
            version_params,
        )
    else:
        session.execute(
            text(
                """
                UPDATE skill_hub_skill_versions
                SET changelog = :changelog,
                    content_markdown = :content_markdown,
                    install_command = :install_command,
                    manifest_json = :manifest_json,
                    is_latest = TRUE
                WHERE id = :version_id
                """
            ),
            {**version_params, "version_id": int(version_row.id)},
        )
    return skill_id


def ensure_skill_hub_seed_data(session=None) -> None:
    owns_session = session is None
    if owns_session:
        ctx = get_db_session()
        session = ctx.__enter__()
    try:
        session.execute(
            text(
                """
                DELETE FROM skill_hub_skills
                WHERE slug IN :slugs
                """
            ).bindparams(bindparam("slugs", expanding=True)),
            {"slugs": list(DEMO_SKILL_SLUGS)},
        )
        session.execute(text("DELETE FROM skill_hub_collection_items"))
        session.execute(text("DELETE FROM skill_hub_collections"))
        session.execute(text("DELETE FROM skill_hub_task_events"))
        session.execute(text("DELETE FROM skill_hub_task_defs"))

        now = _now()
        seeded_sources = [_load_research_dream_source()]
        for source_name in ASSIGNABLE_SOURCES_TO_IMPORT:
            seeded_sources.extend(_load_assignable_source_entries(source_name))
        slug_to_skill_id: dict[str, int] = {}
        for source in seeded_sources:
            slug_to_skill_id[source["slug"]] = _upsert_seeded_skill(session, source=source, now=now)
        for task in DEFAULT_TASK_DEFS:
            session.execute(
                text(
                    """
                    INSERT INTO skill_hub_task_defs (
                        task_key, title, description, reason_code, points_reward,
                        daily_limit, goal_count, created_at, updated_at
                    ) VALUES (
                        :task_key, :title, :description, :reason_code, :points_reward,
                        :daily_limit, :goal_count, :created_at, :updated_at
                    )
                    """
                ),
                {
                    **task,
                    "created_at": now,
                    "updated_at": now,
                },
            )
        for collection in DEFAULT_COLLECTION_DEFS:
            inserted_collection = session.execute(
                text(
                    """
                    INSERT INTO skill_hub_collections (
                        slug, title, description, accent, created_at
                    ) VALUES (
                        :slug, :title, :description, :accent, :created_at
                    )
                    RETURNING id
                    """
                ),
                {
                    "slug": collection["slug"],
                    "title": collection["title"],
                    "description": collection["description"],
                    "accent": collection["accent"],
                    "created_at": now,
                },
            ).fetchone()
            for position, collection_skill_slug in enumerate(collection["skill_slugs"]):
                skill_id = slug_to_skill_id.get(collection_skill_slug)
                if skill_id is None:
                    continue
                session.execute(
                    text(
                        """
                        INSERT INTO skill_hub_collection_items (
                            collection_id, skill_id, position, created_at
                        ) VALUES (
                            :collection_id, :skill_id, :position, :created_at
                        )
                        """
                    ),
                    {
                        "collection_id": int(inserted_collection.id),
                        "skill_id": skill_id,
                        "position": position,
                        "created_at": now,
                    },
                )
    finally:
        if owns_session:
            ctx.__exit__(None, None, None)


def list_categories() -> dict[str, Any]:
    return {"disciplines": DISCIPLINES, "clusters": RESEARCH_CLUSTERS}


def list_skills(
    *,
    user_id: int | None = None,
    q: str | None = None,
    category: str | None = None,
    cluster: str | None = None,
    sort: str = "hot",
    featured_only: bool = False,
    openclaw_ready_only: bool = False,
    limit: int = 20,
    offset: int = 0,
) -> dict[str, Any]:
    safe_limit = max(1, min(limit, 100))
    safe_offset = max(0, offset)
    order_by = {
        "new": "featured DESC, published_at DESC, id DESC",
        "downloads": "featured DESC, total_downloads DESC, avg_rating DESC, id DESC",
        "stars": "featured DESC, avg_rating DESC, total_reviews DESC, id DESC",
        "top": "featured DESC, avg_rating DESC, total_downloads DESC, id DESC",
        "hot": "featured DESC, (weekly_downloads * 2 + total_favorites + total_reviews) DESC, avg_rating DESC, id DESC",
    }.get(sort, "featured DESC, (weekly_downloads * 2 + total_favorites + total_reviews) DESC, avg_rating DESC, id DESC")
    clean_q = (q or "").strip().lower()
    params: dict[str, Any] = {
        "q": clean_q,
        "like_q": f"%{clean_q}%",
        "category": (category or "").strip(),
        "cluster": (cluster or "").strip(),
        "featured_only": bool(featured_only),
        "openclaw_ready_only": bool(openclaw_ready_only),
        "limit": safe_limit,
        "offset": safe_offset,
    }
    where_sql = """
        WHERE status = 'published'
          AND (:q = '' OR LOWER(name) LIKE :like_q OR LOWER(summary) LIKE :like_q OR LOWER(description) LIKE :like_q OR LOWER(COALESCE(tags_json, '')) LIKE :like_q)
          AND (:category = '' OR category_key = :category)
          AND (:cluster = '' OR cluster_key = :cluster)
          AND (:featured_only = FALSE OR featured = TRUE)
          AND (:openclaw_ready_only = FALSE OR openclaw_ready = TRUE)
    """
    with get_db_session() as session:
        viewer_agent = get_primary_openclaw_agent_for_user(user_id) if user_id else None
        total = int(session.execute(text(f"SELECT COUNT(*) FROM skill_hub_skills {where_sql}"), params).scalar_one())
        rows = session.execute(
            text(
                f"""
                SELECT *
                FROM skill_hub_skills
                {where_sql}
                ORDER BY {order_by}
                LIMIT :limit OFFSET :offset
                """
            ),
            params,
        ).fetchall()
        favorites = _resolve_viewer_favorites(
            session,
            user_agent_id=int(viewer_agent["id"]) if viewer_agent else None,
            skill_ids=[int(row.id) for row in rows],
        )
        payload = [_build_skill_summary(row, viewer_favorited=int(row.id) in favorites) for row in rows]
    return {"list": payload, "total": total, "limit": safe_limit, "offset": safe_offset}


def _resolve_skill_row(session, id_or_slug: str):
    row = session.execute(
        text(
            """
            SELECT *
            FROM skill_hub_skills
            WHERE CAST(id AS TEXT) = :needle OR slug = :needle
            LIMIT 1
            """
        ),
        {"needle": id_or_slug},
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Skill 不存在")
    return row


def get_skill_detail(id_or_slug: str, *, user_id: int | None = None) -> dict[str, Any]:
    with get_db_session() as session:
        viewer_agent = get_primary_openclaw_agent_for_user(user_id) if user_id else None
        row = _resolve_skill_row(session, id_or_slug)
        favorites = _resolve_viewer_favorites(
            session,
            user_agent_id=int(viewer_agent["id"]) if viewer_agent else None,
            skill_ids=[int(row.id)],
        )
        versions = session.execute(
            text(
                """
                SELECT *
                FROM skill_hub_skill_versions
                WHERE skill_id = :skill_id
                ORDER BY created_at DESC, id DESC
                """
            ),
            {"skill_id": int(row.id)},
        ).fetchall()
        reviews = session.execute(
            text(
                """
                SELECT
                    r.*,
                    a.display_name AS author_display_name,
                    a.handle AS author_handle
                FROM skill_hub_reviews r
                LEFT JOIN openclaw_agents a ON a.id = r.author_openclaw_agent_id
                WHERE r.skill_id = :skill_id
                ORDER BY r.helpful_count DESC, r.created_at DESC
                LIMIT 20
                """
            ),
            {"skill_id": int(row.id)},
        ).fetchall()
        related = session.execute(
            text(
                """
                SELECT *
                FROM skill_hub_skills
                WHERE id <> :skill_id
                  AND status = 'published'
                  AND (cluster_key = :cluster_key OR category_key = :category_key)
                ORDER BY (weekly_downloads * 2 + total_favorites + total_reviews) DESC, avg_rating DESC
                LIMIT 4
                """
            ),
            {"skill_id": int(row.id), "cluster_key": row.cluster_key, "category_key": row.category_key},
        ).fetchall()
        summary = _build_skill_summary(row, viewer_favorited=int(row.id) in favorites)
        summary["versions"] = [
            {
                "id": int(version.id),
                "version": version.version,
                "changelog": version.changelog,
                "artifact_filename": version.artifact_filename,
                "artifact_size": int(version.artifact_size or 0),
                "install_command": version.install_command,
                "is_latest": bool(version.is_latest),
                "has_content": bool((version.content_markdown or "").strip()),
                "created_at": _to_iso(version.created_at),
            }
            for version in versions
        ]
        summary["reviews"] = [
            {
                "id": int(review.id),
                "skill_id": int(review.skill_id),
                "rating": int(review.rating),
                "title": review.title,
                "content": review.content,
                "model": review.model,
                "pros": _json_loads(review.pros_json, []),
                "cons": _json_loads(review.cons_json, []),
                "dimensions": _json_loads(review.dimensions_json, {}),
                "helpful_count": int(review.helpful_count or 0),
                "author": {
                    "id": int(review.author_openclaw_agent_id) if review.author_openclaw_agent_id is not None else None,
                    "display_name": review.author_display_name,
                    "handle": review.author_handle,
                },
                "created_at": _to_iso(review.created_at),
                "updated_at": _to_iso(review.updated_at),
            }
            for review in reviews
        ]
        summary["related_skills"] = [_build_skill_summary(item) for item in related]
        return summary


def get_skill_content(id_or_slug: str) -> dict[str, Any]:
    with get_db_session() as session:
        skill = _resolve_skill_row(session, id_or_slug)
        version = session.execute(
            text(
                """
                SELECT *
                FROM skill_hub_skill_versions
                WHERE skill_id = :skill_id
                ORDER BY
                    CASE WHEN TRIM(COALESCE(content_markdown, '')) <> '' THEN 0 ELSE 1 END ASC,
                    is_latest DESC,
                    created_at DESC,
                    id DESC
                LIMIT 1
                """
            ),
            {"skill_id": int(skill.id)},
        ).fetchone()
        if version is None or not str(version.content_markdown or "").strip():
            raise HTTPException(status_code=404, detail="Skill 正文不存在")
        return {
            "skill": {
                "id": int(skill.id),
                "slug": skill.slug,
                "name": skill.name,
                "summary": skill.summary,
                "description": skill.description,
                "category_key": skill.category_key,
                "category_name": skill.category_name,
                "latest_version": skill.latest_version,
            },
            "version": {
                "id": int(version.id),
                "version": version.version,
                "created_at": _to_iso(version.created_at),
            },
            "content": version.content_markdown,
            "content_type": "text/markdown",
            "format": "skill_md",
        }


def list_collections(*, user_id: int | None = None) -> dict[str, Any]:
    with get_db_session() as session:
        viewer_agent = get_primary_openclaw_agent_for_user(user_id) if user_id else None
        rows = session.execute(
            text(
                """
                SELECT *
                FROM skill_hub_collections
                ORDER BY id ASC
                """
            )
        ).fetchall()
        items = []
        for row in rows:
            skill_rows = session.execute(
                text(
                    """
                    SELECT s.*
                    FROM skill_hub_collection_items ci
                    JOIN skill_hub_skills s ON s.id = ci.skill_id
                    WHERE ci.collection_id = :collection_id
                    ORDER BY ci.position ASC, s.id ASC
                    """
                ),
                {"collection_id": int(row.id)},
            ).fetchall()
            favorites = _resolve_viewer_favorites(
                session,
                user_agent_id=int(viewer_agent["id"]) if viewer_agent else None,
                skill_ids=[int(skill.id) for skill in skill_rows],
            )
            items.append(
                {
                    "id": int(row.id),
                    "slug": row.slug,
                    "title": row.title,
                    "description": row.description,
                    "accent": row.accent,
                    "skills": [_build_skill_summary(skill, viewer_favorited=int(skill.id) in favorites) for skill in skill_rows],
                    "created_at": _to_iso(row.created_at),
                }
            )
        return {"list": items}


def list_reviews(*, skill_id: str, sort: str = "helpful") -> dict[str, Any]:
    with get_db_session() as session:
        skill = session.execute(
            text("SELECT id FROM skill_hub_skills WHERE CAST(id AS TEXT) = :needle OR slug = :needle LIMIT 1"),
            {"needle": skill_id},
        ).fetchone()
        if skill is None:
            raise HTTPException(status_code=404, detail="Skill 不存在")
        order_sql = "r.helpful_count DESC, r.created_at DESC" if sort == "helpful" else "r.rating DESC, r.created_at DESC"
        rows = session.execute(
            text(
                f"""
                SELECT r.*, a.display_name AS author_display_name, a.handle AS author_handle
                FROM skill_hub_reviews r
                LEFT JOIN openclaw_agents a ON a.id = r.author_openclaw_agent_id
                WHERE r.skill_id = :skill_id
                ORDER BY {order_sql}
                """
            ),
            {"skill_id": int(skill.id)},
        ).fetchall()
    reviews = [
        {
            "id": int(row.id),
            "skill_id": int(row.skill_id),
            "rating": int(row.rating),
            "title": row.title,
            "content": row.content,
            "model": row.model,
            "pros": _json_loads(row.pros_json, []),
            "cons": _json_loads(row.cons_json, []),
            "dimensions": _json_loads(row.dimensions_json, {}),
            "helpful_count": int(row.helpful_count or 0),
            "author": {
                "id": int(row.author_openclaw_agent_id) if row.author_openclaw_agent_id is not None else None,
                "display_name": row.author_display_name,
                "handle": row.author_handle,
            },
            "created_at": _to_iso(row.created_at),
            "updated_at": _to_iso(row.updated_at),
        }
        for row in rows
    ]
    avg_rating = round(sum(item["rating"] for item in reviews) / len(reviews), 2) if reviews else 0
    return {"reviews": reviews, "summary": {"total": len(reviews), "avg_rating": avg_rating}}


def _recompute_skill_aggregates(session, *, skill_id: int) -> None:
    review_row = session.execute(
        text(
            """
            SELECT COUNT(*) AS total_reviews, COALESCE(AVG(rating), 0) AS avg_rating
            FROM skill_hub_reviews
            WHERE skill_id = :skill_id
            """
        ),
        {"skill_id": skill_id},
    ).fetchone()
    favorite_count = int(
        session.execute(
            text("SELECT COUNT(*) FROM skill_hub_favorites WHERE skill_id = :skill_id"),
            {"skill_id": skill_id},
        ).scalar_one()
    )
    download_count = int(
        session.execute(
            text("SELECT COUNT(*) FROM skill_hub_downloads WHERE skill_id = :skill_id"),
            {"skill_id": skill_id},
        ).scalar_one()
    )
    weekly_count = int(
        session.execute(
            text(
                """
                SELECT COUNT(*)
                FROM skill_hub_downloads
                WHERE skill_id = :skill_id
                  AND created_at >= :cutoff
                """
            ),
            {"skill_id": skill_id, "cutoff": _now() - timedelta(days=7)},
        ).scalar_one()
    )
    session.execute(
        text(
            """
            UPDATE skill_hub_skills
            SET total_reviews = :total_reviews,
                avg_rating = :avg_rating,
                total_favorites = :total_favorites,
                total_downloads = :total_downloads,
                weekly_downloads = :weekly_downloads,
                updated_at = :updated_at
            WHERE id = :skill_id
            """
        ),
        {
            "skill_id": skill_id,
            "total_reviews": int(review_row.total_reviews or 0),
            "avg_rating": float(review_row.avg_rating or 0),
            "total_favorites": favorite_count,
            "total_downloads": download_count,
            "weekly_downloads": weekly_count,
            "updated_at": _now(),
        },
    )


def _record_task_event(session, *, openclaw_agent_id: int, task_key: str, target_id: str) -> None:
    task_row = session.execute(
        text("SELECT id FROM skill_hub_task_defs WHERE task_key = :task_key LIMIT 1"),
        {"task_key": task_key},
    ).fetchone()
    if task_row is None:
        return
    session.execute(
        text(
            """
            INSERT INTO skill_hub_task_events (
                task_def_id, openclaw_agent_id, target_id, created_at
            ) VALUES (
                :task_def_id, :openclaw_agent_id, :target_id, :created_at
            )
            """
        ),
        {
            "task_def_id": int(task_row.id),
            "openclaw_agent_id": openclaw_agent_id,
            "target_id": target_id,
            "created_at": _now(),
        },
    )


def create_skill(
    *,
    user: dict[str, Any],
    name: str,
    summary: str,
    description: str,
    category_key: str,
    cluster_key: str,
    tagline: str | None = None,
    slug: str | None = None,
    tags: list[str] | None = None,
    capabilities: list[str] | None = None,
    framework: str = "openclaw",
    compatibility_level: str = "metadata",
    pricing_status: str = "free",
    price_points: int = 0,
    install_command: str | None = None,
    source_url: str | None = None,
    source_name: str | None = None,
    docs_url: str | None = None,
    license: str | None = None,
    hero_note: str | None = None,
    version: str = "0.1.0",
    changelog: str | None = None,
    content_markdown: str | None = None,
    file: UploadFile | None = None,
) -> dict[str, Any]:
    if not _has_skill_payload(content_markdown=content_markdown, file=file):
        raise HTTPException(status_code=400, detail="发布 Skill 时至少需要提供正文 content_markdown 或附件 file")
    user_id = int(user["sub"])
    agent = ensure_primary_openclaw_agent(user_id, username=user.get("username"), phone=user.get("phone"))
    skill_slug = _slugify(slug or name)
    category_name = next((item["name"] for item in DISCIPLINES if item["key"] == category_key), category_key)
    cluster_name = next((item["title"] for item in RESEARCH_CLUSTERS if item["key"] == cluster_key), cluster_key)
    upload_meta = _save_upload(file, prefix=skill_slug) if file else None
    with get_db_session() as session:
        existing = session.execute(text("SELECT id FROM skill_hub_skills WHERE slug = :slug"), {"slug": skill_slug}).fetchone()
        if existing is not None:
            raise HTTPException(status_code=409, detail="Skill slug 已存在")
        inserted = session.execute(
            text(
                """
                INSERT INTO skill_hub_skills (
                    slug, name, tagline, summary, description,
                    category_key, category_name, cluster_key, cluster_name,
                    tags_json, capabilities_json, framework, compatibility_level,
                    pricing_status, price_points, license, source_url, source_name,
                    docs_url, install_command, latest_version, openclaw_ready, featured,
                    hero_note, status, author_openclaw_agent_id, created_at, updated_at, published_at
                ) VALUES (
                    :slug, :name, :tagline, :summary, :description,
                    :category_key, :category_name, :cluster_key, :cluster_name,
                    :tags_json, :capabilities_json, :framework, :compatibility_level,
                    :pricing_status, :price_points, :license, :source_url, :source_name,
                    :docs_url, :install_command, :latest_version, :openclaw_ready, FALSE,
                    :hero_note, 'published', :author_openclaw_agent_id, :created_at, :updated_at, :published_at
                )
                RETURNING id
                """
            ),
            {
                "slug": skill_slug,
                "name": name.strip(),
                "tagline": (tagline or "").strip() or None,
                "summary": summary.strip(),
                "description": description.strip(),
                "category_key": category_key,
                "category_name": category_name,
                "cluster_key": cluster_key,
                "cluster_name": cluster_name,
                "tags_json": _json_dumps(tags or []),
                "capabilities_json": _json_dumps(capabilities or []),
                "framework": framework,
                "compatibility_level": compatibility_level,
                "pricing_status": pricing_status,
                "price_points": max(0, int(price_points)),
                "license": license,
                "source_url": source_url,
                "source_name": source_name,
                "docs_url": docs_url,
                "install_command": install_command,
                "latest_version": version,
                "openclaw_ready": compatibility_level in {"install", "runtime_partial", "runtime_full"},
                "hero_note": hero_note,
                "author_openclaw_agent_id": int(agent["id"]),
                "created_at": _now(),
                "updated_at": _now(),
                "published_at": _now(),
            },
        ).fetchone()
        session.execute(
            text(
                """
                INSERT INTO skill_hub_skill_versions (
                    skill_id, version, changelog, content_markdown, artifact_filename, artifact_path,
                    artifact_content_type, artifact_size, install_command, manifest_json,
                    is_latest, created_at, uploaded_by_openclaw_agent_id
                ) VALUES (
                    :skill_id, :version, :changelog, :content_markdown, :artifact_filename, :artifact_path,
                    :artifact_content_type, :artifact_size, :install_command, :manifest_json,
                    TRUE, :created_at, :uploaded_by_openclaw_agent_id
                )
                """
            ),
            {
                "skill_id": int(inserted.id),
                "version": version,
                "changelog": (changelog or "").strip() or "Initial publish.",
                "content_markdown": (content_markdown or "").strip(),
                "artifact_filename": upload_meta["filename"] if upload_meta else None,
                "artifact_path": upload_meta["storage_path"] if upload_meta else None,
                "artifact_content_type": upload_meta["content_type"] if upload_meta else None,
                "artifact_size": upload_meta["size_bytes"] if upload_meta else 0,
                "install_command": install_command,
                "manifest_json": _json_dumps(
                    {
                        "slug": skill_slug,
                        "name": name,
                        "framework": framework,
                        "compatibility_level": compatibility_level,
                        "pricing_status": pricing_status,
                        "price_points": max(0, int(price_points)),
                    }
                ),
                "created_at": _now(),
                "uploaded_by_openclaw_agent_id": int(agent["id"]),
            },
        )
        event = record_activity_event(
            openclaw_agent_id=int(agent["id"]),
            bound_user_id=user_id,
            event_type="skill.created",
            action_name="create_skill_hub_skill",
            target_type="skill_hub_skill",
            target_id=skill_slug,
            success=True,
            status_code=200,
            payload={"name": name, "slug": skill_slug},
            result={"skill_id": int(inserted.id)},
            session=session,
        )
        apply_rule_points(
            openclaw_agent_id=int(agent["id"]),
            reason_code="skill_publish",
            related_event_id=int(event["id"]),
            target_type="skill_hub_skill",
            target_id=str(inserted.id),
            metadata={"slug": skill_slug},
            session=session,
        )
        _record_task_event(session, openclaw_agent_id=int(agent["id"]), task_key="publish_first_skill", target_id=str(inserted.id))
        _recompute_skill_aggregates(session, skill_id=int(inserted.id))
    return get_skill_detail(skill_slug, user_id=user_id)


def add_skill_version(
    *,
    skill_id_or_slug: str,
    user: dict[str, Any],
    version: str,
    changelog: str | None = None,
    install_command: str | None = None,
    content_markdown: str | None = None,
    file: UploadFile | None = None,
) -> dict[str, Any]:
    if not _has_skill_payload(content_markdown=content_markdown, file=file):
        raise HTTPException(status_code=400, detail="发布新版本时至少需要提供正文 content_markdown 或附件 file")
    user_id = int(user["sub"])
    agent = ensure_primary_openclaw_agent(user_id, username=user.get("username"), phone=user.get("phone"))
    upload_meta = _save_upload(file, prefix=_slugify(version)) if file else None
    with get_db_session() as session:
        skill = session.execute(
            text("SELECT * FROM skill_hub_skills WHERE CAST(id AS TEXT) = :needle OR slug = :needle LIMIT 1"),
            {"needle": skill_id_or_slug},
        ).fetchone()
        if skill is None:
            raise HTTPException(status_code=404, detail="Skill 不存在")
        if skill.author_openclaw_agent_id != int(agent["id"]):
            raise HTTPException(status_code=403, detail="只有作者可以上传新版本")
        session.execute(
            text("UPDATE skill_hub_skill_versions SET is_latest = FALSE WHERE skill_id = :skill_id"),
            {"skill_id": int(skill.id)},
        )
        inserted = session.execute(
            text(
                """
                INSERT INTO skill_hub_skill_versions (
                    skill_id, version, changelog, content_markdown, artifact_filename, artifact_path,
                    artifact_content_type, artifact_size, install_command, manifest_json,
                    is_latest, created_at, uploaded_by_openclaw_agent_id
                ) VALUES (
                    :skill_id, :version, :changelog, :content_markdown, :artifact_filename, :artifact_path,
                    :artifact_content_type, :artifact_size, :install_command, :manifest_json,
                    TRUE, :created_at, :uploaded_by_openclaw_agent_id
                )
                RETURNING id
                """
            ),
            {
                "skill_id": int(skill.id),
                "version": version,
                "changelog": (changelog or "").strip() or "Version update.",
                "content_markdown": (content_markdown or "").strip(),
                "artifact_filename": upload_meta["filename"] if upload_meta else None,
                "artifact_path": upload_meta["storage_path"] if upload_meta else None,
                "artifact_content_type": upload_meta["content_type"] if upload_meta else None,
                "artifact_size": upload_meta["size_bytes"] if upload_meta else 0,
                "install_command": install_command or skill.install_command,
                "manifest_json": _json_dumps({"version": version, "slug": skill.slug}),
                "created_at": _now(),
                "uploaded_by_openclaw_agent_id": int(agent["id"]),
            },
        ).fetchone()
        session.execute(
            text(
                """
                UPDATE skill_hub_skills
                SET latest_version = :latest_version,
                    install_command = COALESCE(:install_command, install_command),
                    updated_at = :updated_at
                WHERE id = :skill_id
                """
            ),
            {
                "skill_id": int(skill.id),
                "latest_version": version,
                "install_command": install_command,
                "updated_at": _now(),
            },
        )
        event = record_activity_event(
            openclaw_agent_id=int(agent["id"]),
            bound_user_id=user_id,
            event_type="skill.version_created",
            action_name="add_skill_hub_version",
            target_type="skill_hub_skill",
            target_id=skill.slug,
            success=True,
            status_code=200,
            payload={"version": version},
            result={"version_id": int(inserted.id)},
            session=session,
        )
        apply_rule_points(
            openclaw_agent_id=int(agent["id"]),
            reason_code="skill_version_publish",
            related_event_id=int(event["id"]),
            target_type="skill_hub_skill_version",
            target_id=str(inserted.id),
            metadata={"skill_slug": skill.slug, "version": version},
            session=session,
        )
    return get_skill_detail(skill.slug, user_id=user_id)


def toggle_favorite(*, skill_id_or_slug: str, user: dict[str, Any], enabled: bool) -> dict[str, Any]:
    user_id = int(user["sub"])
    agent = ensure_primary_openclaw_agent(user_id, username=user.get("username"), phone=user.get("phone"))
    with get_db_session() as session:
        skill = session.execute(
            text("SELECT id, slug FROM skill_hub_skills WHERE CAST(id AS TEXT) = :needle OR slug = :needle LIMIT 1"),
            {"needle": skill_id_or_slug},
        ).fetchone()
        if skill is None:
            raise HTTPException(status_code=404, detail="Skill 不存在")
        if enabled:
            session.execute(
                text(
                    """
                    INSERT INTO skill_hub_favorites (skill_id, openclaw_agent_id, created_at)
                    VALUES (:skill_id, :agent_id, :created_at)
                    ON CONFLICT (skill_id, openclaw_agent_id) DO NOTHING
                    """
                ),
                {"skill_id": int(skill.id), "agent_id": int(agent["id"]), "created_at": _now()},
            )
        else:
            session.execute(
                text("DELETE FROM skill_hub_favorites WHERE skill_id = :skill_id AND openclaw_agent_id = :agent_id"),
                {"skill_id": int(skill.id), "agent_id": int(agent["id"])},
            )
        _recompute_skill_aggregates(session, skill_id=int(skill.id))
        total = int(
            session.execute(text("SELECT COUNT(*) FROM skill_hub_favorites WHERE skill_id = :skill_id"), {"skill_id": int(skill.id)}).scalar_one()
        )
        return {"skill_id": int(skill.id), "favorited": bool(enabled), "total_favorites": total}


def create_review(
    *,
    user: dict[str, Any],
    skill_id_or_slug: str,
    rating: int,
    content: str,
    model: str | None = None,
    title: str | None = None,
    pros: list[str] | None = None,
    cons: list[str] | None = None,
    dimensions: dict[str, Any] | None = None,
) -> dict[str, Any]:
    user_id = int(user["sub"])
    agent = ensure_primary_openclaw_agent(user_id, username=user.get("username"), phone=user.get("phone"))
    clean_content = content.strip()
    if len(clean_content) < 20:
        raise HTTPException(status_code=400, detail="评测内容至少 20 字")
    with get_db_session() as session:
        skill = session.execute(
            text("SELECT id, slug FROM skill_hub_skills WHERE CAST(id AS TEXT) = :needle OR slug = :needle LIMIT 1"),
            {"needle": skill_id_or_slug},
        ).fetchone()
        if skill is None:
            raise HTTPException(status_code=404, detail="Skill 不存在")
        existing = session.execute(
            text(
                """
                SELECT id
                FROM skill_hub_reviews
                WHERE skill_id = :skill_id AND author_openclaw_agent_id = :agent_id
                LIMIT 1
                """
            ),
            {"skill_id": int(skill.id), "agent_id": int(agent["id"])},
        ).fetchone()
        if existing is not None:
            raise HTTPException(status_code=409, detail="你已经评测过这个 Skill")
        inserted = session.execute(
            text(
                """
                INSERT INTO skill_hub_reviews (
                    skill_id, author_openclaw_agent_id, rating, title, content, model,
                    dimensions_json, pros_json, cons_json, helpful_count, created_at, updated_at
                ) VALUES (
                    :skill_id, :author_openclaw_agent_id, :rating, :title, :content, :model,
                    :dimensions_json, :pros_json, :cons_json, 0, :created_at, :updated_at
                )
                RETURNING id
                """
            ),
            {
                "skill_id": int(skill.id),
                "author_openclaw_agent_id": int(agent["id"]),
                "rating": max(1, min(5, int(rating))),
                "title": (title or "").strip() or None,
                "content": clean_content,
                "model": (model or "").strip() or None,
                "dimensions_json": _json_dumps(dimensions or {}),
                "pros_json": _json_dumps(pros or []),
                "cons_json": _json_dumps(cons or []),
                "created_at": _now(),
                "updated_at": _now(),
            },
        ).fetchone()
        event = record_activity_event(
            openclaw_agent_id=int(agent["id"]),
            bound_user_id=user_id,
            event_type="skill.review_created",
            action_name="create_skill_hub_review",
            target_type="skill_hub_review",
            target_id=str(inserted.id),
            success=True,
            status_code=200,
            payload={"skill_id": int(skill.id)},
            result={},
            session=session,
        )
        apply_rule_points(
            openclaw_agent_id=int(agent["id"]),
            reason_code="skill_review_create",
            related_event_id=int(event["id"]),
            target_type="skill_hub_review",
            target_id=str(inserted.id),
            metadata={"skill_id": int(skill.id)},
            session=session,
        )
        _record_task_event(session, openclaw_agent_id=int(agent["id"]), task_key="review_a_skill", target_id=str(inserted.id))
        _recompute_skill_aggregates(session, skill_id=int(skill.id))
        row = session.execute(
            text(
                """
                SELECT r.*, a.display_name AS author_display_name, a.handle AS author_handle
                FROM skill_hub_reviews r
                LEFT JOIN openclaw_agents a ON a.id = r.author_openclaw_agent_id
                WHERE r.id = :review_id
                LIMIT 1
                """
            ),
            {"review_id": int(inserted.id)},
        ).fetchone()
    return {
        "id": int(row.id),
        "skill_id": int(row.skill_id),
        "rating": int(row.rating),
        "title": row.title,
        "content": row.content,
        "model": row.model,
        "pros": _json_loads(row.pros_json, []),
        "cons": _json_loads(row.cons_json, []),
        "dimensions": _json_loads(row.dimensions_json, {}),
        "helpful_count": int(row.helpful_count or 0),
        "author": {
            "id": int(row.author_openclaw_agent_id) if row.author_openclaw_agent_id is not None else None,
            "display_name": row.author_display_name,
            "handle": row.author_handle,
        },
        "created_at": _to_iso(row.created_at),
        "updated_at": _to_iso(row.updated_at),
    }


def vote_review_helpful(*, review_id: int, user: dict[str, Any], enabled: bool = True) -> dict[str, Any]:
    user_id = int(user["sub"])
    agent = ensure_primary_openclaw_agent(user_id, username=user.get("username"), phone=user.get("phone"))
    with get_db_session() as session:
        review = session.execute(
            text("SELECT id, skill_id, author_openclaw_agent_id FROM skill_hub_reviews WHERE id = :review_id LIMIT 1"),
            {"review_id": review_id},
        ).fetchone()
        if review is None:
            raise HTTPException(status_code=404, detail="评测不存在")
        if int(review.author_openclaw_agent_id or 0) == int(agent["id"]):
            raise HTTPException(status_code=400, detail="不能给自己的评测投 helpful")
        exists = session.execute(
            text(
                """
                SELECT id
                FROM skill_hub_review_votes
                WHERE review_id = :review_id AND voter_openclaw_agent_id = :agent_id
                LIMIT 1
                """
            ),
            {"review_id": review_id, "agent_id": int(agent["id"])},
        ).fetchone()
        if enabled and exists is None:
            session.execute(
                text(
                    """
                    INSERT INTO skill_hub_review_votes (review_id, voter_openclaw_agent_id, created_at)
                    VALUES (:review_id, :agent_id, :created_at)
                    """
                ),
                {"review_id": review_id, "agent_id": int(agent["id"]), "created_at": _now()},
            )
            session.execute(
                text("UPDATE skill_hub_reviews SET helpful_count = helpful_count + 1, updated_at = :updated_at WHERE id = :review_id"),
                {"review_id": review_id, "updated_at": _now()},
            )
            event = record_activity_event(
                openclaw_agent_id=int(review.author_openclaw_agent_id),
                bound_user_id=None,
                event_type="skill.review_helpful_received",
                action_name="vote_skill_hub_review_helpful",
                target_type="skill_hub_review",
                target_id=str(review_id),
                success=True,
                status_code=200,
                payload={"voter_agent_id": int(agent["id"])},
                result={},
                session=session,
            )
            apply_rule_points(
                openclaw_agent_id=int(review.author_openclaw_agent_id),
                reason_code="skill_review_helpful_received",
                related_event_id=int(event["id"]),
                target_type="skill_hub_review",
                target_id=str(review_id),
                metadata={"voter_agent_id": int(agent["id"])},
                session=session,
            )
            _record_task_event(
                session,
                openclaw_agent_id=int(review.author_openclaw_agent_id),
                task_key="helpful_feedback",
                target_id=str(review_id),
            )
        elif not enabled and exists is not None:
            session.execute(
                text("DELETE FROM skill_hub_review_votes WHERE id = :id"),
                {"id": int(exists.id)},
            )
            session.execute(
                text(
                    """
                    UPDATE skill_hub_reviews
                    SET helpful_count = CASE WHEN helpful_count > 0 THEN helpful_count - 1 ELSE 0 END,
                        updated_at = :updated_at
                    WHERE id = :review_id
                    """
                ),
                {"review_id": review_id, "updated_at": _now()},
            )
        helpful_count = int(
            session.execute(text("SELECT helpful_count FROM skill_hub_reviews WHERE id = :review_id"), {"review_id": review_id}).scalar_one()
        )
        _recompute_skill_aggregates(session, skill_id=int(review.skill_id))
        return {"review_id": review_id, "helpful_count": helpful_count, "enabled": enabled}


def create_download(*, skill_id_or_slug: str, user: dict[str, Any], referrer: str | None = None) -> dict[str, Any]:
    user_id = int(user["sub"])
    agent = ensure_primary_openclaw_agent(user_id, username=user.get("username"), phone=user.get("phone"))
    with get_db_session() as session:
        skill = session.execute(
            text("SELECT * FROM skill_hub_skills WHERE CAST(id AS TEXT) = :needle OR slug = :needle LIMIT 1"),
            {"needle": skill_id_or_slug},
        ).fetchone()
        if skill is None:
            raise HTTPException(status_code=404, detail="Skill 不存在")
        latest_version = session.execute(
            text(
                """
                SELECT *
                FROM skill_hub_skill_versions
                WHERE skill_id = :skill_id
                  AND is_latest = TRUE
                ORDER BY id DESC
                LIMIT 1
                """
            ),
            {"skill_id": int(skill.id)},
        ).fetchone()
        if latest_version is None:
            raise HTTPException(status_code=404, detail="Skill 暂无可下载版本")
        price_points = int(skill.price_points or 0) if skill.pricing_status in {"pro", "paid"} else 0
        wallet = get_wallet_by_agent_id(int(agent["id"]))
        if price_points > 0 and int(wallet["balance"]) < price_points:
            raise HTTPException(status_code=402, detail="OpenClaw 点数不足，无法下载该 Skill")
        inserted = session.execute(
            text(
                """
                INSERT INTO skill_hub_downloads (
                    skill_id, version_id, openclaw_agent_id, referrer, points_spent, created_at
                ) VALUES (
                    :skill_id, :version_id, :openclaw_agent_id, :referrer, :points_spent, :created_at
                )
                RETURNING id
                """
            ),
            {
                "skill_id": int(skill.id),
                "version_id": int(latest_version.id),
                "openclaw_agent_id": int(agent["id"]),
                "referrer": (referrer or "").strip() or None,
                "points_spent": price_points,
                "created_at": _now(),
            },
        ).fetchone()
        event = record_activity_event(
            openclaw_agent_id=int(agent["id"]),
            bound_user_id=user_id,
            event_type="skill.downloaded",
            action_name="download_skill_hub_skill",
            target_type="skill_hub_skill",
            target_id=str(skill.slug),
            success=True,
            status_code=200,
            payload={"referrer": referrer, "price_points": price_points},
            result={"download_id": int(inserted.id)},
            session=session,
        )
        if price_points > 0:
            apply_points_delta(
                openclaw_agent_id=int(agent["id"]),
                delta=-price_points,
                reason_code="skill_download_spend",
                target_type="skill_hub_skill",
                target_id=str(skill.id),
                related_event_id=int(event["id"]),
                metadata={"slug": skill.slug, "version": latest_version.version},
                session=session,
            )
        _recompute_skill_aggregates(session, skill_id=int(skill.id))
        return {
            "skill_id": int(skill.id),
            "download_id": int(inserted.id),
            "version": latest_version.version,
            "points_spent": price_points,
            "install_command": latest_version.install_command or skill.install_command,
            "download_url": f"/api/v1/skill-hub/assets/{int(latest_version.id)}" if latest_version.artifact_path else None,
            "artifact_filename": latest_version.artifact_filename,
        }


def get_asset_path(version_id: int) -> dict[str, Any]:
    with get_db_session() as session:
        row = session.execute(
            text(
                """
                SELECT artifact_path, artifact_filename, artifact_content_type
                FROM skill_hub_skill_versions
                WHERE id = :version_id
                LIMIT 1
                """
            ),
            {"version_id": version_id},
        ).fetchone()
        if row is None or not row.artifact_path:
            raise HTTPException(status_code=404, detail="附件不存在")
        return {
            "path": row.artifact_path,
            "filename": row.artifact_filename or f"skill-{version_id}.zip",
            "content_type": row.artifact_content_type or "application/octet-stream",
        }


def list_wishes(*, limit: int = 50) -> dict[str, Any]:
    with get_db_session() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    w.*,
                    a.display_name AS author_display_name,
                    a.handle AS author_handle
                FROM skill_hub_wishes w
                LEFT JOIN openclaw_agents a ON a.id = w.author_openclaw_agent_id
                ORDER BY w.votes_count DESC, w.created_at DESC
                LIMIT :limit
                """
            ),
            {"limit": max(1, min(limit, 100))},
        ).fetchall()
    return {
        "list": [
            {
                "id": int(row.id),
                "title": row.title,
                "content": row.content,
                "category_key": row.category_key,
                "status": row.status,
                "votes_count": int(row.votes_count or 0),
                "author": {
                    "id": int(row.author_openclaw_agent_id) if row.author_openclaw_agent_id is not None else None,
                    "display_name": row.author_display_name,
                    "handle": row.author_handle,
                },
                "created_at": _to_iso(row.created_at),
            }
            for row in rows
        ]
    }


def create_wish(*, user: dict[str, Any], title: str, content: str, category_key: str | None = None) -> dict[str, Any]:
    user_id = int(user["sub"])
    agent = ensure_primary_openclaw_agent(user_id, username=user.get("username"), phone=user.get("phone"))
    with get_db_session() as session:
        inserted = session.execute(
            text(
                """
                INSERT INTO skill_hub_wishes (
                    title, content, category_key, status, votes_count, author_openclaw_agent_id, created_at, updated_at
                ) VALUES (
                    :title, :content, :category_key, 'open', 0, :author_openclaw_agent_id, :created_at, :updated_at
                )
                RETURNING id
                """
            ),
            {
                "title": title.strip(),
                "content": content.strip(),
                "category_key": (category_key or "").strip() or None,
                "author_openclaw_agent_id": int(agent["id"]),
                "created_at": _now(),
                "updated_at": _now(),
            },
        ).fetchone()
        event = record_activity_event(
            openclaw_agent_id=int(agent["id"]),
            bound_user_id=user_id,
            event_type="skill.wish_created",
            action_name="create_skill_hub_wish",
            target_type="skill_hub_wish",
            target_id=str(inserted.id),
            success=True,
            status_code=200,
            payload={"title": title},
            result={},
            session=session,
        )
        apply_rule_points(
            openclaw_agent_id=int(agent["id"]),
            reason_code="skill_wish_create",
            related_event_id=int(event["id"]),
            target_type="skill_hub_wish",
            target_id=str(inserted.id),
            metadata={"category_key": category_key},
            session=session,
        )
        _record_task_event(session, openclaw_agent_id=int(agent["id"]), task_key="wish_for_a_skill", target_id=str(inserted.id))
        row = session.execute(
            text(
                """
                SELECT
                    w.*,
                    a.display_name AS author_display_name,
                    a.handle AS author_handle
                FROM skill_hub_wishes w
                LEFT JOIN openclaw_agents a ON a.id = w.author_openclaw_agent_id
                WHERE w.id = :wish_id
                LIMIT 1
                """
            ),
            {"wish_id": int(inserted.id)},
        ).fetchone()
    return {
        "id": int(row.id),
        "title": row.title,
        "content": row.content,
        "category_key": row.category_key,
        "status": row.status,
        "votes_count": int(row.votes_count or 0),
        "author": {
            "id": int(row.author_openclaw_agent_id) if row.author_openclaw_agent_id is not None else None,
            "display_name": row.author_display_name,
            "handle": row.author_handle,
        },
        "created_at": _to_iso(row.created_at),
    }


def vote_wish(*, wish_id: int, user: dict[str, Any], enabled: bool = True) -> dict[str, Any]:
    user_id = int(user["sub"])
    agent = ensure_primary_openclaw_agent(user_id, username=user.get("username"), phone=user.get("phone"))
    with get_db_session() as session:
        wish = session.execute(
            text("SELECT id FROM skill_hub_wishes WHERE id = :wish_id LIMIT 1"),
            {"wish_id": wish_id},
        ).fetchone()
        if wish is None:
            raise HTTPException(status_code=404, detail="许愿不存在")
        exists = session.execute(
            text(
                """
                SELECT id FROM skill_hub_wish_votes
                WHERE wish_id = :wish_id AND voter_openclaw_agent_id = :agent_id
                LIMIT 1
                """
            ),
            {"wish_id": wish_id, "agent_id": int(agent["id"])},
        ).fetchone()
        if enabled and exists is None:
            session.execute(
                text(
                    """
                    INSERT INTO skill_hub_wish_votes (wish_id, voter_openclaw_agent_id, created_at)
                    VALUES (:wish_id, :agent_id, :created_at)
                    """
                ),
                {"wish_id": wish_id, "agent_id": int(agent["id"]), "created_at": _now()},
            )
            session.execute(
                text("UPDATE skill_hub_wishes SET votes_count = votes_count + 1, updated_at = :updated_at WHERE id = :wish_id"),
                {"wish_id": wish_id, "updated_at": _now()},
            )
        elif not enabled and exists is not None:
            session.execute(text("DELETE FROM skill_hub_wish_votes WHERE id = :id"), {"id": int(exists.id)})
            session.execute(
                text(
                    """
                    UPDATE skill_hub_wishes
                    SET votes_count = CASE WHEN votes_count > 0 THEN votes_count - 1 ELSE 0 END,
                        updated_at = :updated_at
                    WHERE id = :wish_id
                    """
                ),
                {"wish_id": wish_id, "updated_at": _now()},
            )
        votes_count = int(session.execute(text("SELECT votes_count FROM skill_hub_wishes WHERE id = :wish_id"), {"wish_id": wish_id}).scalar_one())
        return {"wish_id": wish_id, "votes_count": votes_count, "enabled": enabled}


def get_leaderboard() -> dict[str, Any]:
    with get_db_session() as session:
        users = session.execute(
            text(
                """
                SELECT
                    a.id,
                    a.agent_uid,
                    a.display_name,
                    a.handle,
                    COALESCE(w.balance, 0) AS balance,
                    COALESCE(COUNT(DISTINCT s.id), 0) AS total_skills,
                    COALESCE(COUNT(DISTINCT r.id), 0) AS total_reviews,
                    COALESCE(COUNT(DISTINCT d.id), 0) AS total_downloads
                FROM openclaw_agents a
                LEFT JOIN openclaw_wallets w ON w.openclaw_agent_id = a.id
                LEFT JOIN skill_hub_skills s ON s.author_openclaw_agent_id = a.id
                LEFT JOIN skill_hub_reviews r ON r.author_openclaw_agent_id = a.id
                LEFT JOIN skill_hub_downloads d ON d.openclaw_agent_id = a.id
                GROUP BY a.id, a.agent_uid, a.display_name, a.handle, w.balance
                ORDER BY balance DESC, total_skills DESC, total_reviews DESC
                LIMIT 20
                """
            )
        ).fetchall()
        skills = session.execute(
            text(
                """
                SELECT *
                FROM skill_hub_skills
                WHERE status = 'published'
                ORDER BY total_downloads DESC, avg_rating DESC, total_reviews DESC
                LIMIT 20
                """
            )
        ).fetchall()
        weekly = session.execute(
            text(
                """
                SELECT *
                FROM skill_hub_skills
                WHERE status = 'published'
                ORDER BY weekly_downloads DESC, total_downloads DESC
                LIMIT 20
                """
            )
        ).fetchall()
    return {
        "users": [
            {
                "id": int(row.id),
                "agent_uid": row.agent_uid,
                "display_name": row.display_name,
                "handle": row.handle,
                "balance": int(row.balance or 0),
                "total_skills": int(row.total_skills or 0),
                "total_reviews": int(row.total_reviews or 0),
                "total_downloads": int(row.total_downloads or 0),
            }
            for row in users
        ],
        "skills": [_build_skill_summary(row) for row in skills],
        "weekly": [_build_skill_summary(row) for row in weekly],
    }


def get_profile(*, user: dict[str, Any]) -> dict[str, Any]:
    user_id = int(user["sub"])
    with get_db_session() as session:
        agent = get_primary_openclaw_agent_for_user(user_id)
        key = get_openclaw_key_record(user_id)
        if agent is None:
            return {
                "has_agent": False,
                "openclaw_agent": None,
                "wallet": None,
                "key": key,
                "my_skills": [],
                "my_reviews": [],
                "my_downloads": [],
                "my_favorites": [],
            }
        wallet = get_wallet_by_agent_id(int(agent["id"]))
        skills = session.execute(
            text("SELECT * FROM skill_hub_skills WHERE author_openclaw_agent_id = :agent_id ORDER BY created_at DESC"),
            {"agent_id": int(agent["id"])},
        ).fetchall()
        reviews = session.execute(
            text(
                """
                SELECT r.*, s.name AS skill_name, s.slug AS skill_slug
                FROM skill_hub_reviews r
                JOIN skill_hub_skills s ON s.id = r.skill_id
                WHERE r.author_openclaw_agent_id = :agent_id
                ORDER BY r.created_at DESC
                """
            ),
            {"agent_id": int(agent["id"])},
        ).fetchall()
        downloads = session.execute(
            text(
                """
                SELECT d.*, s.name AS skill_name, s.slug AS skill_slug, v.version
                FROM skill_hub_downloads d
                JOIN skill_hub_skills s ON s.id = d.skill_id
                LEFT JOIN skill_hub_skill_versions v ON v.id = d.version_id
                WHERE d.openclaw_agent_id = :agent_id
                ORDER BY d.created_at DESC
                """
            ),
            {"agent_id": int(agent["id"])},
        ).fetchall()
        favorites = session.execute(
            text(
                """
                SELECT s.*
                FROM skill_hub_favorites f
                JOIN skill_hub_skills s ON s.id = f.skill_id
                WHERE f.openclaw_agent_id = :agent_id
                ORDER BY f.created_at DESC
                """
            ),
            {"agent_id": int(agent["id"])},
        ).fetchall()
        return {
            "has_agent": True,
            "openclaw_agent": agent,
            "wallet": wallet,
            "key": key,
            "my_skills": [_build_skill_summary(row) for row in skills],
            "my_reviews": [
                {
                    "id": int(row.id),
                    "skill_id": int(row.skill_id),
                    "skill_name": row.skill_name,
                    "skill_slug": row.skill_slug,
                    "rating": int(row.rating),
                    "title": row.title,
                    "content": row.content,
                    "helpful_count": int(row.helpful_count or 0),
                    "created_at": _to_iso(row.created_at),
                }
                for row in reviews
            ],
            "my_downloads": [
                {
                    "id": int(row.id),
                    "skill_id": int(row.skill_id),
                    "skill_name": row.skill_name,
                    "skill_slug": row.skill_slug,
                    "version": row.version,
                    "points_spent": int(row.points_spent or 0),
                    "created_at": _to_iso(row.created_at),
                }
                for row in downloads
            ],
            "my_favorites": [_build_skill_summary(row, viewer_favorited=True) for row in favorites],
        }


def create_or_rotate_skill_hub_key(*, user: dict[str, Any]) -> dict[str, Any]:
    user_id = int(user["sub"])
    return create_or_rotate_openclaw_key_for_user(user_id, username=user.get("username"), phone=user.get("phone"))


def list_tasks(*, user: dict[str, Any]) -> dict[str, Any]:
    user_id = int(user["sub"])
    agent = get_primary_openclaw_agent_for_user(user_id)
    with get_db_session() as session:
        if agent is None:
            rows = session.execute(
                text(
                    """
                    SELECT d.*, 0 AS progress_count
                    FROM skill_hub_task_defs d
                    ORDER BY d.id ASC
                    """
                )
            ).fetchall()
        else:
            rows = session.execute(
                text(
                    """
                    SELECT d.*, COUNT(e.id) AS progress_count
                    FROM skill_hub_task_defs d
                    LEFT JOIN skill_hub_task_events e
                      ON e.task_def_id = d.id
                     AND e.openclaw_agent_id = :agent_id
                    GROUP BY d.id
                    ORDER BY d.id ASC
                    """
                ),
                {"agent_id": int(agent["id"])},
            ).fetchall()
    return {
        "tasks": [
            {
                "task_key": row.task_key,
                "title": row.title,
                "description": row.description,
                "reason_code": row.reason_code,
                "points_reward": int(row.points_reward or 0),
                "daily_limit": int(row.daily_limit or 0),
                "goal_count": int(row.goal_count or 1),
                "progress_count": int(row.progress_count or 0),
                "completed": int(row.progress_count or 0) >= int(row.goal_count or 1),
            }
            for row in rows
        ]
    }


def get_guide_markdown() -> str:
    return """# TopicLab SkillHub Guide

TopicLab SkillHub 提供面向 OpenClaw / TopicLab CLI 的科研 Skill 市场。

## 主要接口

- `GET /api/v1/skill-hub/skills`
- `GET /api/v1/skill-hub/skills/{id_or_slug}`
- `GET /api/v1/skill-hub/skills/{id_or_slug}/content`
- `POST /api/v1/skill-hub/skills`
- `POST /api/v1/skill-hub/skills/{id_or_slug}/versions`
- `GET /api/v1/skill-hub/skills/{id_or_slug}/download`
- `GET /api/v1/skill-hub/categories`
- `GET /api/v1/skill-hub/search`
- `GET /api/v1/skill-hub/reviews?skill_id=...`
- `POST /api/v1/skill-hub/reviews`
- `POST /api/v1/skill-hub/reviews/{review_id}/helpful`
- `GET /api/v1/skill-hub/leaderboard`
- `GET /api/v1/skill-hub/wishes`
- `POST /api/v1/skill-hub/wishes`
- `POST /api/v1/skill-hub/wishes/{wish_id}/vote`
- `GET /api/v1/skill-hub/profile`
- `POST /api/v1/skill-hub/profile/openclaw-key`
- `GET /api/v1/skill-hub/tasks`
- `GET /api/v1/skill-hub/collections`

## 鉴权

- 浏览类接口允许匿名访问。
- 发布、评测、收藏、许愿、下载等写操作需要 TopicLab 登录 JWT。
- 写操作会自动解析或创建当前用户对应的 OpenClaw Agent。

## Skill manifest 建议

SkillHub 当前在版本记录中保存了基础 manifest 元数据，建议至少包含：

- `slug`
- `name`
- `framework`
- `compatibility_level`
- `pricing_status`
- `price_points`
"""
