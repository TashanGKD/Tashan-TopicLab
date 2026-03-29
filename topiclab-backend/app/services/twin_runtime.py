"""Twin runtime persistence, composition, and compatibility helpers."""

from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from app.services.openclaw_policy_pack import DEFAULT_SCENE, resolve_scene_from_category
from app.services.twin_merge import MERGE_STATUS_PENDING_REVIEW
from app.storage.database.postgres_client import get_db_session

SCENE_OVERLAY_DEFAULTS = {
    "forum.research": {
        "tone": "rigorous and evidence-aware",
        "emphasis": ["evidence", "limitations", "next_steps"],
    },
    "forum.request": {
        "tone": "action-oriented and collaborative",
        "emphasis": ["clarity", "resource matching", "next_steps"],
    },
    "forum.product": {
        "tone": "decision-oriented and structured",
        "emphasis": ["user value", "tradeoffs", "implementation cost"],
    },
    "forum.app": {
        "tone": "evaluation-oriented and practical",
        "emphasis": ["setup cost", "actual value", "limitations"],
    },
    "forum.arcade": {
        "tone": "iterative and constraint-aware",
        "emphasis": ["rules", "feedback", "next revision"],
    },
}

REQUIREMENT_OBSERVATION_TYPES = {
    "explicit_requirement",
    "behavioral_preference",
    "contextual_goal",
}
VALID_EXPLICITNESS = {"explicit", "inferred"}
VALID_SCOPE_VALUES = {"global", "scene", "thread"}
MAX_REQUIREMENT_STATEMENT_LENGTH = 1000
MAX_EVIDENCE_EXCERPT_LENGTH = 500

CATEGORY_PROFILE_DEFAULTS = {
    "research": {
        "category_name": "科研",
        "category_description": "适合论文、实验、方法和研究路线相关的话题。",
        "tone": "严谨、可验证、重视证据。",
        "reply_style": "answer with evidence, caveats, and next-step suggestions",
    },
    "request": {
        "category_name": "需求",
        "category_description": "发布需求、寻找协作、对接资源，把想法变成合作。",
        "tone": "直接、合作导向、强调可执行性。",
        "reply_style": "confirm needs, constraints, and next concrete action",
    },
    "product": {
        "category_name": "产品",
        "category_description": "适合功能设计、用户反馈和产品判断。",
        "tone": "结构化、决策导向、关注取舍。",
        "reply_style": "state recommendation, tradeoffs, and implementation cost",
    },
    "app": {
        "category_name": "应用",
        "category_description": "适合围绕应用、插件、工具能力与使用体验展开讨论。",
        "tone": "务实、体验导向、强调限制条件。",
        "reply_style": "explain actual usage value, setup cost, and limitations",
    },
    "arcade": {
        "category_name": "Arcade",
        "category_description": "面向评测与迭代优化的竞技题目板块。",
        "tone": "执行导向、围绕反馈快速迭代。",
        "reply_style": "focus on current result, constraints, and next revision",
    },
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _to_iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return value.isoformat()


def _json_dumps(value: Any) -> str:
    return json.dumps(value or {}, ensure_ascii=False)


def _json_loads(value: Any, default: Any):
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return default


def _validate_short_string(value: Any, *, field_name: str, max_length: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be a non-empty string")
    normalized = value.strip()
    if len(normalized) > max_length:
        raise ValueError(f"{field_name} must be at most {max_length} characters")
    return normalized


def _validate_requirement_evidence(evidence: Any) -> Any:
    if evidence is None:
        return None
    if isinstance(evidence, dict):
        items = [evidence]
    elif isinstance(evidence, list):
        items = evidence
    else:
        raise ValueError("payload.evidence must be an object or array")

    normalized_items: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("payload.evidence items must be objects")
        if any(key in item for key in ("raw_text", "full_text", "transcript", "message")):
            raise ValueError("payload.evidence may not include full raw text")
        normalized_item = dict(item)
        excerpt = normalized_item.get("excerpt")
        if excerpt is not None:
            normalized_item["excerpt"] = _validate_short_string(
                excerpt,
                field_name="payload.evidence[].excerpt",
                max_length=MAX_EVIDENCE_EXCERPT_LENGTH,
            )
        normalized_items.append(normalized_item)

    if isinstance(evidence, dict):
        return normalized_items[0]
    return normalized_items


def validate_observation_payload(observation_type: str, payload: dict | None) -> dict[str, Any]:
    normalized_payload = dict(payload or {})
    if observation_type not in REQUIREMENT_OBSERVATION_TYPES:
        return normalized_payload

    topic = _validate_short_string(
        normalized_payload.get("topic"),
        field_name="payload.topic",
        max_length=128,
    )
    explicitness = _validate_short_string(
        normalized_payload.get("explicitness"),
        field_name="payload.explicitness",
        max_length=32,
    )
    if explicitness not in VALID_EXPLICITNESS:
        raise ValueError("payload.explicitness must be one of: explicit, inferred")

    scope = _validate_short_string(
        normalized_payload.get("scope"),
        field_name="payload.scope",
        max_length=32,
    )
    if scope not in VALID_SCOPE_VALUES:
        raise ValueError("payload.scope must be one of: global, scene, thread")

    normalized = normalized_payload.get("normalized")
    statement = normalized_payload.get("statement")
    if statement is not None:
        statement = _validate_short_string(
            statement,
            field_name="payload.statement",
            max_length=MAX_REQUIREMENT_STATEMENT_LENGTH,
        )
    if normalized is not None and not isinstance(normalized, dict):
        raise ValueError("payload.normalized must be an object")

    if observation_type == "explicit_requirement":
        if statement is None:
            raise ValueError("explicit_requirement requires payload.statement")
        if not isinstance(normalized, dict) or not normalized:
            raise ValueError("explicit_requirement requires payload.normalized")
    elif observation_type == "behavioral_preference":
        if not isinstance(normalized, dict) or not normalized:
            raise ValueError("behavioral_preference requires payload.normalized")
    elif observation_type == "contextual_goal":
        if statement is None and not isinstance(normalized, dict):
            raise ValueError("contextual_goal requires payload.statement or payload.normalized")

    scene = normalized_payload.get("scene")
    if scene is not None:
        scene = _validate_short_string(
            scene,
            field_name="payload.scene",
            max_length=64,
        )

    evidence = _validate_requirement_evidence(normalized_payload.get("evidence"))
    normalized_payload["topic"] = topic
    normalized_payload["explicitness"] = explicitness
    normalized_payload["scope"] = scope
    if statement is not None:
        normalized_payload["statement"] = statement
    if scene is not None:
        normalized_payload["scene"] = scene
    if evidence is not None:
        normalized_payload["evidence"] = evidence
    return normalized_payload


def _generate_twin_id() -> str:
    return f"twin_{secrets.token_hex(8)}"


def _generate_snapshot_id() -> str:
    return f"snap_{secrets.token_hex(8)}"


def _generate_observation_id() -> str:
    return f"obs_{secrets.token_hex(8)}"


def _get_topic_category_profile_safe(category: str | None) -> dict[str, Any] | None:
    if not category:
        return None
    normalized = (category or "").strip().lower()
    return CATEGORY_PROFILE_DEFAULTS.get(normalized)


def _extract_markdown_sections(markdown: str | None) -> dict[str, str]:
    text_value = (markdown or "").strip()
    if not text_value:
        return {}
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for raw_line in text_value.splitlines():
        line = raw_line.rstrip()
        if line.startswith("## "):
            current = line[3:].strip().lower().replace(" ", "_")
            sections[current] = []
            continue
        if current:
            sections[current].append(raw_line)
    return {key: "\n".join(lines).strip() for key, lines in sections.items()}


def _build_base_profile_json(markdown: str | None) -> dict[str, Any]:
    sections = _extract_markdown_sections(markdown)
    summary = next((line[2:].strip() for line in (markdown or "").splitlines() if line.startswith("# ")), "")
    return {
        "summary": summary,
        "sections": sections,
    }


def _row_to_twin_core(row) -> dict[str, Any]:
    return {
        "twin_id": row.twin_id,
        "owner_user_id": int(row.owner_user_id),
        "source_agent_name": getattr(row, "source_agent_name", None),
        "display_name": row.display_name,
        "expert_name": row.expert_name,
        "visibility": row.visibility,
        "exposure": row.exposure,
        "base_profile_json": _json_loads(row.base_profile_json, {}),
        "base_profile_markdown": row.base_profile_markdown,
        "version": int(row.version or 1),
        "is_active": bool(row.is_active),
        "created_at": _to_iso(row.created_at),
        "updated_at": _to_iso(row.updated_at),
    }


def _row_to_runtime_state(row) -> dict[str, Any]:
    return {
        "twin_id": row.twin_id,
        "instance_id": row.instance_id,
        "active_scene": row.active_scene,
        "current_focus": _json_loads(row.current_focus_json, {}),
        "recent_threads": _json_loads(row.recent_threads_json, []),
        "recent_style_shift": _json_loads(row.recent_style_shift_json, {}),
        "version": int(row.version or 1),
        "created_at": _to_iso(row.created_at),
        "updated_at": _to_iso(row.updated_at),
    }


def ensure_scene_overlays_for_twin(twin_id: str, *, session=None) -> None:
    owns_session = session is None
    if owns_session:
        ctx = get_db_session()
        session = ctx.__enter__()
    try:
        now = _now()
        for scene_name, overlay in SCENE_OVERLAY_DEFAULTS.items():
            exists = session.execute(
                text(
                    """
                    SELECT 1
                    FROM twin_scene_overlays
                    WHERE twin_id = :twin_id AND scene_name = :scene_name
                    LIMIT 1
                    """
                ),
                {"twin_id": twin_id, "scene_name": scene_name},
            ).fetchone()
            if exists:
                continue
            session.execute(
                text(
                    """
                    INSERT INTO twin_scene_overlays (
                        overlay_id, twin_id, scene_name, overlay_json, overlay_markdown, version, created_at, updated_at
                    ) VALUES (
                        :overlay_id, :twin_id, :scene_name, :overlay_json, :overlay_markdown, 1, :created_at, :updated_at
                    )
                    """
                ),
                {
                    "overlay_id": f"ovl_{secrets.token_hex(8)}",
                    "twin_id": twin_id,
                    "scene_name": scene_name,
                    "overlay_json": _json_dumps(overlay),
                    "overlay_markdown": (
                        f"# {scene_name}\n\n"
                        f"- tone: {overlay['tone']}\n"
                        f"- emphasis: {', '.join(overlay['emphasis'])}\n"
                    ),
                    "created_at": now,
                    "updated_at": now,
                },
            )
    finally:
        if owns_session:
            ctx.__exit__(None, None, None)


def get_active_twin_for_user(user_id: int, *, session=None) -> dict[str, Any] | None:
    owns_session = session is None
    if owns_session:
        ctx = get_db_session()
        session = ctx.__enter__()
    try:
        row = session.execute(
            text(
                """
                SELECT *
                FROM twin_core
                WHERE owner_user_id = :user_id AND is_active = TRUE
                LIMIT 1
                """
            ),
            {"user_id": user_id},
        ).fetchone()
        if not row:
            return None
        return _row_to_twin_core(row)
    finally:
        if owns_session:
            ctx.__exit__(None, None, None)


def get_twin_by_id(twin_id: str, *, session=None) -> dict[str, Any] | None:
    owns_session = session is None
    if owns_session:
        ctx = get_db_session()
        session = ctx.__enter__()
    try:
        row = session.execute(
            text("SELECT * FROM twin_core WHERE twin_id = :twin_id LIMIT 1"),
            {"twin_id": twin_id},
        ).fetchone()
        if not row:
            return None
        return _row_to_twin_core(row)
    finally:
        if owns_session:
            ctx.__exit__(None, None, None)


def _insert_snapshot(
    *,
    session,
    twin_id: str,
    source: str,
    source_agent_name: str | None,
    profile_markdown: str,
    profile_json: dict[str, Any],
) -> None:
    session.execute(
        text(
            """
            INSERT INTO twin_snapshots (
                snapshot_id, twin_id, source, source_agent_name, profile_markdown, profile_json, created_at
            ) VALUES (
                :snapshot_id, :twin_id, :source, :source_agent_name, :profile_markdown, :profile_json, :created_at
            )
            """
        ),
        {
            "snapshot_id": _generate_snapshot_id(),
            "twin_id": twin_id,
            "source": source,
            "source_agent_name": source_agent_name,
            "profile_markdown": profile_markdown,
            "profile_json": _json_dumps(profile_json),
            "created_at": _now(),
        },
    )


def create_or_update_active_twin_for_user(
    user_id: int,
    *,
    source_agent_name: str | None,
    display_name: str,
    expert_name: str | None,
    visibility: str,
    exposure: str,
    base_profile_markdown: str | None,
    source: str = "profile_twin",
    session=None,
) -> dict[str, Any]:
    owns_session = session is None
    if owns_session:
        ctx = get_db_session()
        session = ctx.__enter__()
    try:
        current = get_active_twin_for_user(user_id, session=session)
        now = _now()
        profile_json = _build_base_profile_json(base_profile_markdown)
        if current is None:
            twin_id = _generate_twin_id()
            session.execute(
                text(
                    """
                    INSERT INTO twin_core (
                        twin_id, owner_user_id, source_agent_name, display_name, expert_name,
                        visibility, exposure, base_profile_json, base_profile_markdown,
                        version, is_active, created_at, updated_at
                    ) VALUES (
                        :twin_id, :owner_user_id, :source_agent_name, :display_name, :expert_name,
                        :visibility, :exposure, :base_profile_json, :base_profile_markdown,
                        1, TRUE, :created_at, :updated_at
                    )
                    """
                ),
                {
                    "twin_id": twin_id,
                    "owner_user_id": user_id,
                    "source_agent_name": source_agent_name,
                    "display_name": display_name,
                    "expert_name": expert_name,
                    "visibility": visibility,
                    "exposure": exposure,
                    "base_profile_json": _json_dumps(profile_json),
                    "base_profile_markdown": base_profile_markdown,
                    "created_at": now,
                    "updated_at": now,
                },
            )
        else:
            twin_id = current["twin_id"]
            session.execute(
                text(
                    """
                    UPDATE twin_core
                    SET source_agent_name = :source_agent_name,
                        display_name = :display_name,
                        expert_name = :expert_name,
                        visibility = :visibility,
                        exposure = :exposure,
                        base_profile_json = :base_profile_json,
                        base_profile_markdown = :base_profile_markdown,
                        version = version + 1,
                        is_active = TRUE,
                        updated_at = :updated_at
                    WHERE twin_id = :twin_id
                    """
                ),
                {
                    "twin_id": twin_id,
                    "source_agent_name": source_agent_name,
                    "display_name": display_name,
                    "expert_name": expert_name,
                    "visibility": visibility,
                    "exposure": exposure,
                    "base_profile_json": _json_dumps(profile_json),
                    "base_profile_markdown": base_profile_markdown,
                    "updated_at": now,
                },
            )
        ensure_scene_overlays_for_twin(twin_id, session=session)
        _insert_snapshot(
            session=session,
            twin_id=twin_id,
            source=source,
            source_agent_name=source_agent_name,
            profile_markdown=base_profile_markdown or "",
            profile_json=profile_json,
        )
        refreshed = get_twin_by_id(twin_id, session=session)
        return refreshed or {}
    finally:
        if owns_session:
            ctx.__exit__(None, None, None)


def backfill_active_twin_from_legacy(user_id: int, *, session=None) -> dict[str, Any] | None:
    owns_session = session is None
    if owns_session:
        ctx = get_db_session()
        session = ctx.__enter__()
    try:
        current = get_active_twin_for_user(user_id, session=session)
        if current is not None:
            return current
        rows = session.execute(
            text(
                """
                SELECT agent_name, display_name, expert_name, visibility, exposure, source, role_content, created_at, updated_at
                FROM digital_twins
                WHERE user_id = :user_id
                ORDER BY updated_at DESC, created_at DESC
                """
            ),
            {"user_id": user_id},
        ).fetchall()
        if not rows:
            return None
        latest = rows[0]
        twin = create_or_update_active_twin_for_user(
            user_id,
            source_agent_name=latest.agent_name,
            display_name=latest.display_name or "我的数字分身",
            expert_name=latest.expert_name,
            visibility=latest.visibility or "private",
            exposure=latest.exposure or "brief",
            base_profile_markdown=latest.role_content or "",
            source=latest.source or "profile_twin",
            session=session,
        )
        twin_id = twin["twin_id"]
        # Add older legacy rows as snapshots too.
        for row in rows[1:]:
            _insert_snapshot(
                session=session,
                twin_id=twin_id,
                source=row.source or "profile_twin",
                source_agent_name=row.agent_name,
                profile_markdown=row.role_content or "",
                profile_json=_build_base_profile_json(row.role_content or ""),
            )
        return get_twin_by_id(twin_id, session=session)
    finally:
        if owns_session:
            ctx.__exit__(None, None, None)


def get_or_backfill_active_twin_for_user(user_id: int, *, session=None) -> dict[str, Any] | None:
    current = get_active_twin_for_user(user_id, session=session)
    if current is not None:
        return current
    return backfill_active_twin_from_legacy(user_id, session=session)


def _list_legacy_twin_user_ids(*, session, offset: int = 0, limit: int = 500) -> list[int]:
    rows = session.execute(
        text(
            """
            SELECT DISTINCT user_id
            FROM digital_twins
            ORDER BY user_id ASC
            LIMIT :limit OFFSET :offset
            """
        ),
        {"offset": max(0, int(offset)), "limit": max(1, int(limit))},
    ).fetchall()
    return [int(row[0]) for row in rows]


def backfill_twins_from_legacy(
    *,
    user_id: int | None = None,
    all_users: bool = False,
    offset: int = 0,
    limit: int = 500,
    session=None,
) -> dict[str, Any]:
    owns_session = session is None
    if owns_session:
        ctx = get_db_session()
        session = ctx.__enter__()
    try:
        if user_id is not None:
            candidate_user_ids = [int(user_id)]
        elif all_users:
            rows = session.execute(
                text(
                    """
                    SELECT DISTINCT user_id
                    FROM digital_twins
                    ORDER BY user_id ASC
                    """
                )
            ).fetchall()
            candidate_user_ids = [int(row[0]) for row in rows]
        else:
            candidate_user_ids = _list_legacy_twin_user_ids(session=session, offset=offset, limit=limit)

        summary = {
            "candidate_user_ids": candidate_user_ids,
            "total_candidates": len(candidate_user_ids),
            "backfilled": 0,
            "skipped_existing": 0,
            "missing_legacy": 0,
            "results": [],
        }
        for target_user_id in candidate_user_ids:
            current = get_active_twin_for_user(target_user_id, session=session)
            if current is not None:
                summary["skipped_existing"] += 1
                summary["results"].append(
                    {
                        "user_id": target_user_id,
                        "status": "skipped_existing",
                        "twin_id": current["twin_id"],
                    }
                )
                continue
            twin = backfill_active_twin_from_legacy(target_user_id, session=session)
            if twin is None:
                summary["missing_legacy"] += 1
                summary["results"].append(
                    {
                        "user_id": target_user_id,
                        "status": "missing_legacy",
                        "twin_id": None,
                    }
                )
                continue
            summary["backfilled"] += 1
            summary["results"].append(
                {
                    "user_id": target_user_id,
                    "status": "backfilled",
                    "twin_id": twin["twin_id"],
                }
            )
        return summary
    finally:
        if owns_session:
            ctx.__exit__(None, None, None)


def get_scene_overlay(twin_id: str, scene_name: str, *, session=None) -> dict[str, Any] | None:
    owns_session = session is None
    if owns_session:
        ctx = get_db_session()
        session = ctx.__enter__()
    try:
        row = session.execute(
            text(
                """
                SELECT scene_name, overlay_json, overlay_markdown, version, updated_at
                FROM twin_scene_overlays
                WHERE twin_id = :twin_id AND scene_name = :scene_name
                LIMIT 1
                """
            ),
            {"twin_id": twin_id, "scene_name": scene_name},
        ).fetchone()
        if not row:
            return None
        return {
            "scene_name": row.scene_name,
            "overlay": _json_loads(row.overlay_json, {}),
            "overlay_markdown": row.overlay_markdown,
            "version": int(row.version or 1),
            "updated_at": _to_iso(row.updated_at),
        }
    finally:
        if owns_session:
            ctx.__exit__(None, None, None)


def get_runtime_state(twin_id: str, instance_id: str, *, session=None) -> dict[str, Any] | None:
    owns_session = session is None
    if owns_session:
        ctx = get_db_session()
        session = ctx.__enter__()
    try:
        row = session.execute(
            text(
                """
                SELECT *
                FROM twin_runtime_states
                WHERE twin_id = :twin_id AND instance_id = :instance_id
                LIMIT 1
                """
            ),
            {"twin_id": twin_id, "instance_id": instance_id},
        ).fetchone()
        if not row:
            return None
        return _row_to_runtime_state(row)
    finally:
        if owns_session:
            ctx.__exit__(None, None, None)


def upsert_runtime_state(
    *,
    twin_id: str,
    owner_user_id: int,
    instance_id: str,
    active_scene: str | None,
    current_focus: dict | None,
    recent_threads: list | None,
    recent_style_shift: dict | None,
    session=None,
) -> dict[str, Any]:
    owns_session = session is None
    if owns_session:
        ctx = get_db_session()
        session = ctx.__enter__()
    try:
        twin = get_twin_by_id(twin_id, session=session)
        if not twin or int(twin["owner_user_id"]) != owner_user_id:
            raise PermissionError("Twin not found or not owned by current user")
        now = _now()
        existing = get_runtime_state(twin_id, instance_id, session=session)
        if existing is None:
            session.execute(
                text(
                    """
                    INSERT INTO twin_runtime_states (
                        twin_id, instance_id, active_scene, current_focus_json, recent_threads_json,
                        recent_style_shift_json, version, created_at, updated_at
                    ) VALUES (
                        :twin_id, :instance_id, :active_scene, :current_focus_json, :recent_threads_json,
                        :recent_style_shift_json, 1, :created_at, :updated_at
                    )
                    """
                ),
                {
                    "twin_id": twin_id,
                    "instance_id": instance_id,
                    "active_scene": active_scene,
                    "current_focus_json": _json_dumps(current_focus or {}),
                    "recent_threads_json": _json_dumps(recent_threads or []),
                    "recent_style_shift_json": _json_dumps(recent_style_shift or {}),
                    "created_at": now,
                    "updated_at": now,
                },
            )
        else:
            session.execute(
                text(
                    """
                    UPDATE twin_runtime_states
                    SET active_scene = :active_scene,
                        current_focus_json = :current_focus_json,
                        recent_threads_json = :recent_threads_json,
                        recent_style_shift_json = :recent_style_shift_json,
                        version = version + 1,
                        updated_at = :updated_at
                    WHERE twin_id = :twin_id AND instance_id = :instance_id
                    """
                ),
                {
                    "twin_id": twin_id,
                    "instance_id": instance_id,
                    "active_scene": active_scene,
                    "current_focus_json": _json_dumps(current_focus or {}),
                    "recent_threads_json": _json_dumps(recent_threads or []),
                    "recent_style_shift_json": _json_dumps(recent_style_shift or {}),
                    "updated_at": now,
                },
            )
        return get_runtime_state(twin_id, instance_id, session=session) or {}
    finally:
        if owns_session:
            ctx.__exit__(None, None, None)


def append_observation(
    *,
    twin_id: str,
    owner_user_id: int,
    instance_id: str,
    source: str,
    observation_type: str,
    confidence: float | None,
    payload: dict | None,
    session=None,
) -> dict[str, Any]:
    owns_session = session is None
    if owns_session:
        ctx = get_db_session()
        session = ctx.__enter__()
    try:
        twin = get_twin_by_id(twin_id, session=session)
        if not twin or int(twin["owner_user_id"]) != owner_user_id:
            raise PermissionError("Twin not found or not owned by current user")
        validated_payload = validate_observation_payload(observation_type, payload)
        observation_id = _generate_observation_id()
        session.execute(
            text(
                """
                INSERT INTO twin_observations (
                    observation_id, twin_id, instance_id, source, observation_type,
                    confidence, payload_json, merge_status, created_at
                ) VALUES (
                    :observation_id, :twin_id, :instance_id, :source, :observation_type,
                    :confidence, :payload_json, :merge_status, :created_at
                )
                """
            ),
            {
                "observation_id": observation_id,
                "twin_id": twin_id,
                "instance_id": instance_id,
                "source": source,
                "observation_type": observation_type,
                "confidence": confidence,
                "payload_json": _json_dumps(validated_payload),
                "merge_status": MERGE_STATUS_PENDING_REVIEW,
                "created_at": _now(),
            },
        )
        return {
            "observation_id": observation_id,
            "merge_status": MERGE_STATUS_PENDING_REVIEW,
        }
    finally:
        if owns_session:
            ctx.__exit__(None, None, None)


def list_observations(
    *,
    twin_id: str,
    requester_user_id: int | None,
    is_admin: bool,
    observation_type: str | None = None,
    explicitness: str | None = None,
    scope: str | None = None,
    scene: str | None = None,
    limit: int = 50,
    offset: int = 0,
    session=None,
) -> dict[str, Any]:
    owns_session = session is None
    if owns_session:
        ctx = get_db_session()
        session = ctx.__enter__()
    try:
        twin = get_twin_by_id(twin_id, session=session)
        if not twin:
            raise LookupError("Twin not found")
        if not is_admin and requester_user_id != int(twin["owner_user_id"]):
            raise PermissionError("Twin not accessible")

        rows = session.execute(
            text(
                """
                SELECT observation_id, twin_id, instance_id, source, observation_type,
                       confidence, payload_json, merge_status, created_at
                FROM twin_observations
                WHERE twin_id = :twin_id
                ORDER BY created_at DESC, id DESC
                """
            ),
            {"twin_id": twin_id},
        ).fetchall()

        items: list[dict[str, Any]] = []
        for row in rows:
            payload = _json_loads(row.payload_json, {})
            if observation_type and row.observation_type != observation_type:
                continue
            if explicitness and payload.get("explicitness") != explicitness:
                continue
            if scope and payload.get("scope") != scope:
                continue
            if scene and payload.get("scene") != scene:
                continue
            items.append(
                {
                    "observation_id": row.observation_id,
                    "twin_id": row.twin_id,
                    "instance_id": row.instance_id,
                    "source": row.source,
                    "observation_type": row.observation_type,
                    "confidence": row.confidence,
                    "payload": payload,
                    "merge_status": row.merge_status,
                    "created_at": _to_iso(row.created_at),
                }
            )

        total = len(items)
        start = max(0, int(offset))
        end = start + max(1, int(limit))
        return {
            "twin_id": twin_id,
            "total": total,
            "items": items[start:end],
        }
    finally:
        if owns_session:
            ctx.__exit__(None, None, None)


def build_runtime_profile(
    *,
    twin_id: str,
    owner_user_id: int,
    scene: str | None,
    topic_category: str | None,
    topic_id: str | None,
    thread_id: str | None,
    instance_id: str | None,
    session=None,
) -> dict[str, Any]:
    owns_session = session is None
    if owns_session:
        ctx = get_db_session()
        session = ctx.__enter__()
    try:
        twin = get_twin_by_id(twin_id, session=session)
        if not twin or int(twin["owner_user_id"]) != owner_user_id:
            raise PermissionError("Twin not found or not owned by current user")
        resolved_scene = scene or resolve_scene_from_category(topic_category)
        ensure_scene_overlays_for_twin(twin_id, session=session)
        overlay = get_scene_overlay(twin_id, resolved_scene, session=session)
        runtime_state = get_runtime_state(twin_id, instance_id, session=session) if instance_id else None
        category_profile = _get_topic_category_profile_safe(topic_category)
        base_json = dict(twin.get("base_profile_json") or {})
        sections = dict(base_json.get("sections") or {})
        runtime_profile = {
            "display_name": twin["display_name"],
            "identity": {"summary": sections.get("identity") or base_json.get("summary") or twin["display_name"]},
            "expertise": {
                "summary": sections.get("expertise") or "",
                "primary_domains": [],
                "methods": [],
            },
            "thinking_style": {
                "summary": sections.get("thinking_style") or "",
                "mode": sections.get("thinking_style") or "",
                "risk_bias": "moderate",
            },
            "discussion_style": {
                "summary": sections.get("discussion_style") or "",
                "tone": (category_profile or {}).get("tone") or ((overlay or {}).get("overlay") or {}).get("tone") or "balanced",
                "reply_shape": (category_profile or {}).get("reply_style") or "respond_then_extend",
            },
            "scene_adjustments": {
                "scene_name": resolved_scene,
                "emphasis": ((overlay or {}).get("overlay") or {}).get("emphasis", []),
            },
            "current_focus": (runtime_state or {}).get("current_focus", {}),
            "guardrails": [
                "avoid overclaiming certainty",
                "prioritize thread continuity",
            ],
        }
        summary_lines = [
            f"# {twin['display_name']}",
            "",
            f"- twin_id: `{twin_id}`",
            f"- resolved_scene: `{resolved_scene}`",
        ]
        if topic_category:
            summary_lines.append(f"- topic_category: `{topic_category}`")
        if topic_id:
            summary_lines.append(f"- topic_id: `{topic_id}`")
        if thread_id:
            summary_lines.append(f"- thread_id: `{thread_id}`")
        summary_lines += [
            "",
            "## Identity",
            "",
            runtime_profile["identity"]["summary"] or "N/A",
            "",
            "## Expertise",
            "",
            runtime_profile["expertise"]["summary"] or "N/A",
            "",
            "## Thinking Style",
            "",
            runtime_profile["thinking_style"]["summary"] or "N/A",
            "",
            "## Discussion Style",
            "",
            runtime_profile["discussion_style"]["summary"] or runtime_profile["discussion_style"]["tone"],
        ]
        return {
            "twin_id": twin_id,
            "version": twin["version"],
            "resolved_scene": resolved_scene,
            "composition": {
                "base_version": twin["version"],
                "overlay_version": int((overlay or {}).get("version") or 0),
                "category_profile_version": 1 if category_profile else 0,
                "runtime_state_version": int((runtime_state or {}).get("version") or 0),
            },
            "runtime_profile": runtime_profile,
            "markdown_summary": "\n".join(summary_lines) + "\n",
        }
    finally:
        if owns_session:
            ctx.__exit__(None, None, None)


def get_twin_version_payload(*, twin_id: str, owner_user_id: int, instance_id: str | None, session=None) -> dict[str, Any]:
    owns_session = session is None
    if owns_session:
        ctx = get_db_session()
        session = ctx.__enter__()
    try:
        twin = get_twin_by_id(twin_id, session=session)
        if not twin or int(twin["owner_user_id"]) != owner_user_id:
            raise PermissionError("Twin not found or not owned by current user")
        runtime_state = get_runtime_state(twin_id, instance_id, session=session) if instance_id else None
        latest_snapshot_version = session.execute(
            text("SELECT COUNT(*) FROM twin_snapshots WHERE twin_id = :twin_id"),
            {"twin_id": twin_id},
        ).scalar() or 0
        return {
            "twin_id": twin_id,
            "core_version": int(twin["version"]),
            "runtime_state_version": int((runtime_state or {}).get("version") or 0),
            "latest_snapshot_version": int(latest_snapshot_version),
            "updated_at": twin["updated_at"],
        }
    finally:
        if owns_session:
            ctx.__exit__(None, None, None)
