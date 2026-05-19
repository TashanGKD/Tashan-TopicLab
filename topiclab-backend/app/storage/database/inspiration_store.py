"""Storage helpers for Inspiration Co-Creation demand paths."""

from __future__ import annotations

import json
import os
import re
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from sqlalchemy import bindparam, text

from app.storage.database.postgres_client import _is_sqlite_session, get_db_session


SEED_PATH = Path(__file__).resolve().parents[2] / "resources" / "inspiration_co_creation_seed.json"
DEFAULT_STAGE = "模糊想法"
PATH_STAGES = [
    {"key": "submitted", "label": "留下线索"},
    {"key": "defined", "label": "问题定义"},
    {"key": "tooling", "label": "工具选择"},
    {"key": "demo", "label": "Demo 验证"},
    {"key": "mvp", "label": "MVP/复盘"},
]
_SCHEMA_READY_KEYS: set[str] = set()
_SCHEMA_READY_LOCK = threading.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _json_loads(value: Any, default: Any) -> Any:
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return default


def _slugify(value: str, *, fallback: str) -> str:
    ascii_slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    ascii_slug = re.sub(r"-+", "-", ascii_slug)
    return (ascii_slug or fallback)[:80].strip("-") or fallback


def _clue_number(slug: str) -> int:
    match = re.match(r"^need-(\d+)", slug or "")
    return int(match.group(1)) if match else 10**9


def _time_sort_value(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    if value in (None, ""):
        return datetime.min.replace(tzinfo=timezone.utc)
    normalized = str(value).replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return datetime.min.replace(tzinfo=timezone.utc)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _session_schema_cache_key(session) -> str:
    return str(session.bind.url)


def _context_update_limit() -> int:
    raw = os.getenv("INSPIRATION_ASSISTANT_CONTEXT_UPDATE_LIMIT", "12").strip()
    try:
        value = int(raw)
    except ValueError:
        value = 12
    return max(3, min(value, 50))


def _next_seed_slug(index: int, title: str) -> str:
    # Stable readable paths for seeded historical cards.
    hints = {
        1: "ai-english-reading-assistant",
        2: "campus-career-service-workbench",
        3: "counselor-low-code-management",
        4: "intangible-heritage-design-demo",
        5: "game-theory-model-agent",
        6: "travel-planning-agent",
        7: "ai-tool-brain",
        8: "cold-seep-data-prediction",
        9: "information-curation-feedback",
        10: "ai-culture-tour-guide",
    }
    return f"need-{index:02d}-{hints.get(index) or _slugify(title, fallback='case')}"


def build_new_slug(title: str) -> str:
    return f"{_slugify(title, fallback='demand')}-{uuid4().hex[:8]}"


def _column_exists(session, table_name: str, column_name: str) -> bool:
    if _is_sqlite_session(session):
        rows = session.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
        return any(row[1] == column_name for row in rows)
    row = session.execute(
        text(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = :table_name AND column_name = :column_name
            LIMIT 1
            """
        ),
        {"table_name": table_name, "column_name": column_name},
    ).first()
    return row is not None


def _ensure_column(session, table_name: str, column_name: str, sqlite_def: str, pg_def: str) -> None:
    if _column_exists(session, table_name, column_name):
        return
    session.execute(
        text(
            f"ALTER TABLE {table_name} ADD COLUMN {column_name} {sqlite_def}"
            if _is_sqlite_session(session)
            else f"ALTER TABLE {table_name} ADD COLUMN {column_name} {pg_def}"
        )
    )


def _apply_inspiration_ddl(session) -> None:
    is_sqlite = _is_sqlite_session(session)
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS inspiration_demands (
                id TEXT PRIMARY KEY,
                slug TEXT NOT NULL UNIQUE,
                clue_number INTEGER,
                status TEXT NOT NULL DEFAULT 'published',
                stage TEXT NOT NULL DEFAULT '模糊想法',
                owner_user_id INTEGER,
                public_title TEXT NOT NULL,
                public_summary TEXT NOT NULL,
                public_tags TEXT NOT NULL DEFAULT '[]',
                public_stuck TEXT NOT NULL DEFAULT '',
                allow_public INTEGER NOT NULL DEFAULT 1,
                private_json TEXT NOT NULL,
                llm_review_json TEXT NOT NULL DEFAULT '{}',
                assistant_status TEXT NOT NULL DEFAULT 'ready',
                assistant_snapshot_json TEXT NOT NULL DEFAULT '{}',
                assistant_version INTEGER NOT NULL DEFAULT 0,
                assistant_latest_run_id TEXT,
                assistant_updated_at TEXT,
                assistant_error_message TEXT,
                claim_token TEXT,
                claimed_at TEXT,
                redaction_method TEXT NOT NULL DEFAULT 'rule_only',
                redaction_status TEXT NOT NULL DEFAULT 'published',
                redaction_notes TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS inspiration_demands (
                id VARCHAR(255) PRIMARY KEY,
                slug VARCHAR(255) NOT NULL UNIQUE,
                clue_number INTEGER,
                status VARCHAR(32) NOT NULL DEFAULT 'published',
                stage VARCHAR(64) NOT NULL DEFAULT '模糊想法',
                owner_user_id INTEGER,
                public_title TEXT NOT NULL,
                public_summary TEXT NOT NULL,
                public_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
                public_stuck TEXT NOT NULL DEFAULT '',
                allow_public BOOLEAN NOT NULL DEFAULT TRUE,
                private_json JSONB NOT NULL,
                llm_review_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                assistant_status VARCHAR(32) NOT NULL DEFAULT 'ready',
                assistant_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                assistant_version INTEGER NOT NULL DEFAULT 0,
                assistant_latest_run_id VARCHAR(255),
                assistant_updated_at TIMESTAMPTZ,
                assistant_error_message TEXT,
                claim_token VARCHAR(128),
                claimed_at TIMESTAMPTZ,
                redaction_method VARCHAR(32) NOT NULL DEFAULT 'rule_only',
                redaction_status VARCHAR(32) NOT NULL DEFAULT 'published',
                redaction_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    _ensure_column(session, "inspiration_demands", "clue_number", "INTEGER", "INTEGER")
    session.execute(text("CREATE INDEX IF NOT EXISTS idx_inspiration_demands_status_created ON inspiration_demands(status, created_at DESC)"))
    session.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_inspiration_demands_public_updated "
            "ON inspiration_demands(status, allow_public, updated_at DESC, created_at DESC)"
        )
    )
    session.execute(text("CREATE INDEX IF NOT EXISTS idx_inspiration_demands_clue_number ON inspiration_demands(clue_number)"))
    session.execute(text("CREATE INDEX IF NOT EXISTS idx_inspiration_demands_owner ON inspiration_demands(owner_user_id)"))
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS inspiration_demand_updates (
                id TEXT PRIMARY KEY,
                demand_id TEXT NOT NULL REFERENCES inspiration_demands(id) ON DELETE CASCADE,
                week_label TEXT NOT NULL DEFAULT '',
                summary TEXT NOT NULL DEFAULT '',
                progress TEXT NOT NULL DEFAULT '',
                blockers TEXT NOT NULL DEFAULT '',
                next_steps TEXT NOT NULL DEFAULT '',
                stage_key TEXT NOT NULL DEFAULT '',
                stage_status TEXT NOT NULL DEFAULT '',
                emotion_note TEXT NOT NULL DEFAULT '',
                artifacts_json TEXT NOT NULL DEFAULT '[]',
                visibility TEXT NOT NULL DEFAULT 'public',
                created_by_user_id INTEGER,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS inspiration_demand_updates (
                id VARCHAR(255) PRIMARY KEY,
                demand_id VARCHAR(255) NOT NULL REFERENCES inspiration_demands(id) ON DELETE CASCADE,
                week_label TEXT NOT NULL DEFAULT '',
                summary TEXT NOT NULL DEFAULT '',
                progress TEXT NOT NULL DEFAULT '',
                blockers TEXT NOT NULL DEFAULT '',
                next_steps TEXT NOT NULL DEFAULT '',
                stage_key VARCHAR(64) NOT NULL DEFAULT '',
                stage_status VARCHAR(32) NOT NULL DEFAULT '',
                emotion_note TEXT NOT NULL DEFAULT '',
                artifacts_json JSONB NOT NULL DEFAULT '[]'::jsonb,
                visibility VARCHAR(32) NOT NULL DEFAULT 'public',
                created_by_user_id INTEGER,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    _ensure_column(session, "inspiration_demands", "claim_token", "TEXT", "VARCHAR(128)")
    _ensure_column(session, "inspiration_demands", "claimed_at", "TEXT", "TIMESTAMPTZ")
    _ensure_column(session, "inspiration_demands", "redaction_method", "TEXT NOT NULL DEFAULT 'rule_only'", "VARCHAR(32) NOT NULL DEFAULT 'rule_only'")
    _ensure_column(session, "inspiration_demands", "redaction_status", "TEXT NOT NULL DEFAULT 'published'", "VARCHAR(32) NOT NULL DEFAULT 'published'")
    _ensure_column(session, "inspiration_demands", "redaction_notes", "TEXT NOT NULL DEFAULT '[]'", "JSONB NOT NULL DEFAULT '[]'::jsonb")
    _ensure_column(session, "inspiration_demands", "assistant_status", "TEXT NOT NULL DEFAULT 'ready'", "VARCHAR(32) NOT NULL DEFAULT 'ready'")
    _ensure_column(session, "inspiration_demands", "assistant_snapshot_json", "TEXT NOT NULL DEFAULT '{}'", "JSONB NOT NULL DEFAULT '{}'::jsonb")
    _ensure_column(session, "inspiration_demands", "assistant_version", "INTEGER NOT NULL DEFAULT 0", "INTEGER NOT NULL DEFAULT 0")
    _ensure_column(session, "inspiration_demands", "assistant_latest_run_id", "TEXT", "VARCHAR(255)")
    _ensure_column(session, "inspiration_demands", "assistant_updated_at", "TEXT", "TIMESTAMPTZ")
    _ensure_column(session, "inspiration_demands", "assistant_error_message", "TEXT", "TEXT")
    _ensure_column(session, "inspiration_demand_updates", "stage_key", "TEXT NOT NULL DEFAULT ''", "VARCHAR(64) NOT NULL DEFAULT ''")
    _ensure_column(session, "inspiration_demand_updates", "stage_status", "TEXT NOT NULL DEFAULT ''", "VARCHAR(32) NOT NULL DEFAULT ''")
    _ensure_column(session, "inspiration_demand_updates", "emotion_note", "TEXT NOT NULL DEFAULT ''", "TEXT NOT NULL DEFAULT ''")
    if not _column_exists(session, "inspiration_demand_updates", "updated_at"):
        if is_sqlite:
            session.execute(text("ALTER TABLE inspiration_demand_updates ADD COLUMN updated_at TEXT"))
            session.execute(text("UPDATE inspiration_demand_updates SET updated_at = created_at WHERE updated_at IS NULL"))
        else:
            session.execute(text("ALTER TABLE inspiration_demand_updates ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP"))
    session.execute(text("CREATE INDEX IF NOT EXISTS idx_inspiration_updates_demand_created ON inspiration_demand_updates(demand_id, created_at DESC)"))
    session.execute(text("CREATE INDEX IF NOT EXISTS idx_inspiration_updates_demand_updated ON inspiration_demand_updates(demand_id, updated_at DESC)"))
    session.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_inspiration_updates_public_stage_latest "
            "ON inspiration_demand_updates(visibility, demand_id, stage_key, updated_at DESC, created_at DESC)"
        )
    )
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS inspiration_assistant_runs (
                id TEXT PRIMARY KEY,
                demand_id TEXT NOT NULL REFERENCES inspiration_demands(id) ON DELETE CASCADE,
                trigger_type TEXT NOT NULL,
                trigger_update_id TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                input_snapshot_json TEXT NOT NULL DEFAULT '{}',
                output_json TEXT NOT NULL DEFAULT '{}',
                error_message TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                started_at TEXT,
                completed_at TEXT
            )
            """
            if is_sqlite
            else
            """
            CREATE TABLE IF NOT EXISTS inspiration_assistant_runs (
                id VARCHAR(255) PRIMARY KEY,
                demand_id VARCHAR(255) NOT NULL REFERENCES inspiration_demands(id) ON DELETE CASCADE,
                trigger_type VARCHAR(64) NOT NULL,
                trigger_update_id VARCHAR(255),
                status VARCHAR(32) NOT NULL DEFAULT 'pending',
                input_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                output_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                error_message TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                started_at TIMESTAMPTZ,
                completed_at TIMESTAMPTZ
            )
            """
        )
    )
    session.execute(text("CREATE INDEX IF NOT EXISTS idx_inspiration_assistant_runs_demand_created ON inspiration_assistant_runs(demand_id, created_at DESC)"))
    session.execute(text("CREATE INDEX IF NOT EXISTS idx_inspiration_assistant_runs_status_created ON inspiration_assistant_runs(status, created_at DESC)"))


def _backfill_clue_numbers(session) -> None:
    rows = session.execute(
        text(
            """
            SELECT id, slug, clue_number
            FROM inspiration_demands
            ORDER BY created_at ASC, slug ASC
            """
        )
    ).fetchall()
    used = {int(row.clue_number) for row in rows if row.clue_number is not None}
    next_number = max(used or {0}) + 1
    for row in rows:
        if row.clue_number is not None:
            continue
        parsed = _clue_number(row.slug)
        if parsed == 10**9 or parsed in used:
            while next_number in used:
                next_number += 1
            clue_number = next_number
        else:
            clue_number = parsed
        used.add(clue_number)
        session.execute(
            text("UPDATE inspiration_demands SET clue_number = :clue_number WHERE id = :id"),
            {"clue_number": clue_number, "id": row.id},
        )


def _next_clue_number(session) -> int:
    row = session.execute(text("SELECT COALESCE(MAX(clue_number), 0) AS max_clue_number FROM inspiration_demands")).first()
    return int(row.max_clue_number or 0) + 1


def _seed_inspiration_demands(session) -> None:
    existing = session.execute(text("SELECT 1 FROM inspiration_demands LIMIT 1")).first()
    if existing or not SEED_PATH.exists():
        return
    items = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    is_sqlite = _is_sqlite_session(session)
    insert_sql = (
        """
        INSERT OR IGNORE INTO inspiration_demands (
            id, slug, clue_number, status, stage, owner_user_id, public_title, public_summary,
            public_tags, public_stuck, allow_public, private_json, llm_review_json,
            claim_token, claimed_at, redaction_method, redaction_status, redaction_notes, created_at, updated_at
        )
        VALUES (
            :id, :slug, :clue_number, :status, :stage, :owner_user_id, :public_title, :public_summary,
            :public_tags, :public_stuck, :allow_public, :private_json, :llm_review_json,
            :claim_token, :claimed_at, :redaction_method, :redaction_status, :redaction_notes, :created_at, :updated_at
        )
        """
        if is_sqlite
        else
        """
        INSERT INTO inspiration_demands (
            id, slug, clue_number, status, stage, owner_user_id, public_title, public_summary,
            public_tags, public_stuck, allow_public, private_json, llm_review_json,
            claim_token, claimed_at, redaction_method, redaction_status, redaction_notes, created_at, updated_at
        )
        VALUES (
            :id, :slug, :clue_number, :status, :stage, :owner_user_id, :public_title, :public_summary,
            CAST(:public_tags AS JSONB), :public_stuck, :allow_public, CAST(:private_json AS JSONB),
            CAST(:llm_review_json AS JSONB), :claim_token, :claimed_at, :redaction_method,
            :redaction_status, CAST(:redaction_notes AS JSONB), :created_at, :updated_at
        )
        ON CONFLICT (slug) DO NOTHING
        """
    )
    now = _now_iso()
    for index, item in enumerate(items, start=1):
        raw = item.get("raw") or {}
        review = {
            "source": "seed",
            "clarity": "待继续拆解",
            "verifiability": "已从历史表单导入，建议先补充场景、对象和验证证据。",
            "suggested_stage": DEFAULT_STAGE,
            "suggested_roles": ["真实问题提出者", "AI 应用开发者"],
            "recommended_tools": ["场景记录", "低保真原型"],
            "follow_up_questions": ["这个需求最小验证对象是谁？", "一周内可以交付什么证据？", "需要哪类伙伴？"],
            "next_step": item.get("stuck") or "先把问题边界和最小验证动作写清楚。",
            "risk_notes": ["历史表单内容需先确认公开授权和脱敏口径。"],
        }
        session.execute(
            text(insert_sql),
            {
                "id": f"seed-{index:02d}",
                "slug": _next_seed_slug(index, str(item.get("title") or "")),
                "clue_number": index,
                "status": "published",
                "stage": DEFAULT_STAGE,
                "owner_user_id": None,
                "public_title": item.get("title") or f"需求 {index:02d}",
                "public_summary": item.get("summary") or "",
                "public_tags": _json_dumps(item.get("tags") or []),
                "public_stuck": item.get("stuck") or "",
                "allow_public": True,
                "private_json": _json_dumps(raw),
                "llm_review_json": _json_dumps(review),
                "claim_token": None,
                "claimed_at": None,
                "redaction_method": "manual_review",
                "redaction_status": "published",
                "redaction_notes": _json_dumps(["历史表单已人工拆分为脱敏公开卡片。"]),
                "created_at": raw.get("submitted_at") or now,
                "updated_at": now,
            },
        )


def ensure_inspiration_schema_and_seed_for_session(session) -> None:
    cache_key = _session_schema_cache_key(session)
    if cache_key in _SCHEMA_READY_KEYS:
        return
    with _SCHEMA_READY_LOCK:
        if cache_key in _SCHEMA_READY_KEYS:
            return
        _apply_inspiration_ddl(session)
        _seed_inspiration_demands(session)
        _backfill_clue_numbers(session)
        _SCHEMA_READY_KEYS.add(cache_key)


def ensure_inspiration_schema_and_seed() -> None:
    with get_db_session() as session:
        ensure_inspiration_schema_and_seed_for_session(session)


def _serialize_public(row) -> dict[str, Any]:
    return {
        "id": row.id,
        "slug": row.slug,
        "clue_number": getattr(row, "clue_number", None) or _clue_number(row.slug),
        "status": row.status,
        "stage": row.stage,
        "title": row.public_title,
        "summary": row.public_summary,
        "tags": _json_loads(row.public_tags, []),
        "stuck": row.public_stuck,
        "redaction": {
            "method": getattr(row, "redaction_method", "rule_only"),
            "status": getattr(row, "redaction_status", "published"),
            "notes": _json_loads(getattr(row, "redaction_notes", "[]"), []),
        },
        "created_at": str(row.created_at),
        "updated_at": str(row.updated_at),
        "latest_update_at": str(getattr(row, "latest_update_at", row.created_at)),
    }


def _serialize_update(row) -> dict[str, Any]:
    return {
        "id": row.id,
        "week_label": row.week_label,
        "summary": row.summary,
        "progress": row.progress,
        "blockers": row.blockers,
        "next_steps": row.next_steps,
        "stage_key": getattr(row, "stage_key", "") or "",
        "stage_status": getattr(row, "stage_status", "") or "",
        "emotion_note": getattr(row, "emotion_note", "") or "",
        "artifacts": _json_loads(row.artifacts_json, []),
        "visibility": row.visibility,
        "created_at": str(row.created_at),
        "updated_at": str(getattr(row, "updated_at", row.created_at)),
    }


def _serialize_assistant(row) -> dict[str, Any]:
    fallback_snapshot = _json_loads(getattr(row, "llm_review_json", "{}"), {})
    snapshot = _json_loads(getattr(row, "assistant_snapshot_json", "{}"), {})
    if not snapshot:
        snapshot = fallback_snapshot
    status = getattr(row, "assistant_status", None) or ("ready" if snapshot else "pending")
    return {
        "status": status,
        "snapshot": snapshot,
        "version": int(getattr(row, "assistant_version", 0) or 0),
        "latest_run_id": getattr(row, "assistant_latest_run_id", None),
        "updated_at": str(getattr(row, "assistant_updated_at", "") or getattr(row, "updated_at", "")),
        "error_message": getattr(row, "assistant_error_message", None),
    }


def _serialize_run(row) -> dict[str, Any]:
    return {
        "id": row.id,
        "demand_id": row.demand_id,
        "trigger_type": row.trigger_type,
        "trigger_update_id": row.trigger_update_id,
        "status": row.status,
        "input_snapshot": _json_loads(row.input_snapshot_json, {}),
        "output": _json_loads(row.output_json, {}),
        "error_message": row.error_message,
        "created_at": str(row.created_at),
        "started_at": str(row.started_at) if row.started_at is not None else None,
        "completed_at": str(row.completed_at) if row.completed_at is not None else None,
    }


def _assistant_follow_up_questions(row) -> list[str]:
    assistant = _serialize_assistant(row)
    snapshot = assistant.get("snapshot") if isinstance(assistant.get("snapshot"), dict) else {}
    questions = snapshot.get("follow_up_questions") if isinstance(snapshot, dict) else []
    if not isinstance(questions, list):
        return []
    return [str(question).strip() for question in questions if str(question).strip()][:3]


def _short_public_title(value: Any, fallback: str = "") -> str:
    text_value = re.sub(r"\s+", "", str(value or ""))
    text_value = text_value.strip("《》“”\"'：:，,。.!！?？、；;（）()[]【】")
    return (text_value or fallback)[:10]


def _public_text(value: Any, *, fallback: str, max_length: int) -> str:
    text_value = " ".join(str(value or "").split())
    if not text_value:
        return fallback
    if len(text_value) <= max_length:
        return text_value
    return f"{text_value[: max_length - 1]}…"


def _can_view_private(row, user: dict[str, Any] | None) -> bool:
    if not user:
        return False
    if user.get("is_admin"):
        return True
    if row.owner_user_id is None or user.get("sub") is None:
        return False
    return int(row.owner_user_id) == int(user["sub"])


def _can_update(row, user: dict[str, Any] | None) -> bool:
    return _can_view_private(row, user)


def _build_path_progress(row, updates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    latest_by_stage = {}
    for update in updates:
        key = update.get("stage_key")
        if key and key not in latest_by_stage:
            latest_by_stage[key] = update
    current_seen = False
    result = []
    for index, stage in enumerate(PATH_STAGES):
        update = latest_by_stage.get(stage["key"])
        if stage["key"] == "submitted":
            if update:
                status = update.get("stage_status") or "done"
                summary = update.get("summary") or update.get("progress") or ""
                emotion = update.get("emotion_note") or ""
            else:
                questions = _assistant_follow_up_questions(row)
                if questions:
                    status = "needs_input"
                    summary = f"请补充：{' / '.join(questions)}"
                    current_seen = True
                else:
                    status = "done"
                    summary = ""
                emotion = ""
        elif update:
            status = update.get("stage_status") or "done"
            summary = update.get("summary") or update.get("progress") or "这一阶段已有进展。"
            emotion = update.get("emotion_note") or ""
        elif not current_seen and index > 0:
            status = "current"
            summary = ""
            emotion = ""
            current_seen = True
        else:
            status = "pending"
            summary = "尚未开始。"
            emotion = ""
        result.append({**stage, "status": status, "summary": summary, "emotion_note": emotion})
    return result


def list_public_demands() -> list[dict[str, Any]]:
    with get_db_session() as session:
        ensure_inspiration_schema_and_seed_for_session(session)
        rows = session.execute(
            text(
                """
                SELECT id, slug, clue_number, status, stage, public_title, public_summary, public_tags, public_stuck,
                       llm_review_json, assistant_status, assistant_snapshot_json, assistant_version,
                       assistant_latest_run_id, assistant_updated_at, assistant_error_message,
                       redaction_method, redaction_status, redaction_notes, created_at, updated_at,
                       COALESCE(
                           (
                               SELECT MAX(updated_at)
                               FROM inspiration_demand_updates
                               WHERE demand_id = inspiration_demands.id AND visibility = 'public'
                           ),
                           created_at
                       ) AS latest_update_at
                FROM inspiration_demands
                WHERE status = 'published' AND allow_public = :allow_public
                """
            ),
            {"allow_public": True},
        ).fetchall()
        demand_ids = [row.id for row in rows]
        updates_by_demand: dict[str, list[dict[str, Any]]] = {}
        if demand_ids:
            update_rows = session.execute(
                text(
                    """
                    SELECT id, demand_id, week_label, summary, progress, blockers, next_steps,
                           stage_key, stage_status, emotion_note, artifacts_json, visibility, created_at, updated_at
                    FROM (
                        SELECT id, demand_id, week_label, summary, progress, blockers, next_steps,
                               stage_key, stage_status, emotion_note, artifacts_json, visibility, created_at, updated_at,
                               ROW_NUMBER() OVER (
                                   PARTITION BY demand_id, stage_key
                                   ORDER BY updated_at DESC, created_at DESC
                               ) AS rn
                        FROM inspiration_demand_updates
                        WHERE visibility = 'public' AND demand_id IN :demand_ids
                    ) latest_updates
                    WHERE rn = 1
                    ORDER BY updated_at DESC, created_at DESC
                    """
                ).bindparams(bindparam("demand_ids", expanding=True)),
                {"demand_ids": demand_ids},
            ).fetchall()
            for update in update_rows:
                updates_by_demand.setdefault(update.demand_id, []).append(_serialize_update(update))
        items = [
            {**_serialize_public(row), "path_progress": _build_path_progress(row, updates_by_demand.get(row.id, []))}
            for row in rows
        ]
        items.sort(
            key=lambda item: (
                _time_sort_value(item.get("latest_update_at")),
                -int(item.get("clue_number") or _clue_number(item.get("slug", ""))),
            ),
            reverse=True,
        )
        return items


def get_demand_by_slug(slug: str, *, user: dict[str, Any] | None = None, include_private: bool = False) -> dict[str, Any] | None:
    with get_db_session() as session:
        ensure_inspiration_schema_and_seed_for_session(session)
        row = session.execute(
            text(
                """
                SELECT id, slug, clue_number, status, stage, owner_user_id, public_title, public_summary, public_tags,
                       public_stuck, private_json, llm_review_json, assistant_status, assistant_snapshot_json,
                       assistant_version, assistant_latest_run_id, assistant_updated_at, assistant_error_message,
                       claim_token, claimed_at,
                       redaction_method, redaction_status, redaction_notes, created_at, updated_at
                FROM inspiration_demands
                WHERE slug = :slug
                LIMIT 1
                """
            ),
            {"slug": slug},
        ).first()
        if not row:
            return None
        can_view_private = _can_view_private(row, user)
        update_rows = session.execute(
            text(
                """
                SELECT id, week_label, summary, progress, blockers, next_steps, stage_key, stage_status,
                       emotion_note, artifacts_json, visibility, created_at, updated_at
                FROM inspiration_demand_updates
                WHERE demand_id = :demand_id
                  AND (:include_private = 1 OR visibility = 'public')
                ORDER BY updated_at DESC, created_at DESC
                """
            ),
            {"demand_id": row.id, "include_private": 1 if can_view_private else 0},
        ).fetchall()
        updates = [_serialize_update(update) for update in update_rows]
        payload = _serialize_public(row)
        payload["updates"] = updates
        payload["path_progress"] = _build_path_progress(row, updates)
        payload["can_view_private"] = can_view_private
        payload["can_update"] = _can_update(row, user)
        payload["assistant"] = _serialize_assistant(row)
        payload["llm_review"] = payload["assistant"]["snapshot"] or _json_loads(row.llm_review_json, {})
        if include_private and can_view_private:
            payload["private"] = _json_loads(row.private_json, {})
        return payload


def create_demand(*, payload: dict[str, Any], public_payload: dict[str, Any], llm_review: dict[str, Any], owner_user_id: int | None) -> dict[str, Any]:
    slug = build_new_slug(str(public_payload.get("title") or "demand"))
    demand_id = f"dem_{uuid4().hex}"
    claim_token = None if owner_user_id is not None else secrets.token_urlsafe(24)
    now = _now_iso()
    with get_db_session() as session:
        ensure_inspiration_schema_and_seed_for_session(session)
        is_sqlite = _is_sqlite_session(session)
        insert_sql = (
            """
            INSERT INTO inspiration_demands (
                id, slug, clue_number, status, stage, owner_user_id, public_title, public_summary,
                public_tags, public_stuck, allow_public, private_json, llm_review_json,
                claim_token, claimed_at, redaction_method, redaction_status, redaction_notes, created_at, updated_at
            )
            VALUES (
                :id, :slug, :clue_number, :status, :stage, :owner_user_id, :public_title, :public_summary,
                :public_tags, :public_stuck, :allow_public, :private_json, :llm_review_json,
                :claim_token, :claimed_at, :redaction_method, :redaction_status, :redaction_notes, :created_at, :updated_at
            )
            """
            if is_sqlite
            else
            """
            INSERT INTO inspiration_demands (
                id, slug, clue_number, status, stage, owner_user_id, public_title, public_summary,
                public_tags, public_stuck, allow_public, private_json, llm_review_json,
                claim_token, claimed_at, redaction_method, redaction_status, redaction_notes, created_at, updated_at
            )
            VALUES (
                :id, :slug, :clue_number, :status, :stage, :owner_user_id, :public_title, :public_summary,
                CAST(:public_tags AS JSONB), :public_stuck, :allow_public, CAST(:private_json AS JSONB),
                CAST(:llm_review_json AS JSONB), :claim_token, :claimed_at, :redaction_method,
                :redaction_status, CAST(:redaction_notes AS JSONB), :created_at, :updated_at
            )
            """
        )
        session.execute(
            text(insert_sql),
            {
                "id": demand_id,
                "slug": slug,
                "clue_number": _next_clue_number(session),
                "status": "published" if public_payload.get("allow_public") else "private",
                "stage": str(llm_review.get("suggested_stage") or DEFAULT_STAGE),
                "owner_user_id": owner_user_id,
                "public_title": public_payload["title"],
                "public_summary": public_payload["summary"],
                "public_tags": _json_dumps(public_payload.get("tags") or []),
                "public_stuck": public_payload.get("stuck") or "",
                "allow_public": bool(public_payload.get("allow_public", True)),
                "private_json": _json_dumps(payload),
                "llm_review_json": _json_dumps(llm_review),
                "claim_token": claim_token,
                "claimed_at": None,
                "redaction_method": public_payload.get("redaction_method") or "rule_only",
                "redaction_status": public_payload.get("redaction_status") or ("published" if public_payload.get("allow_public") else "draft"),
                "redaction_notes": _json_dumps(public_payload.get("redaction_notes") or []),
                "created_at": now,
                "updated_at": now,
            },
        )
        row = session.execute(
            text(
                """
                SELECT id, slug, clue_number, status, stage, public_title, public_summary, public_tags, public_stuck,
                       redaction_method, redaction_status, redaction_notes, created_at, updated_at
                FROM inspiration_demands
                WHERE id = :id
                """
            ),
            {"id": demand_id},
        ).first()
        demand = _serialize_public(row)
        demand["path_progress"] = _build_path_progress(row, [])
        return {"demand": demand, "claim_token": claim_token}


def claim_demand(*, slug: str, claim_token: str, user_id: int) -> dict[str, Any] | None:
    now = _now_iso()
    with get_db_session() as session:
        ensure_inspiration_schema_and_seed_for_session(session)
        row = session.execute(
            text(
                """
                SELECT id, claim_token, owner_user_id
                FROM inspiration_demands
                WHERE slug = :slug
                LIMIT 1
                """
            ),
            {"slug": slug},
        ).first()
        if not row:
            return None
        if row.owner_user_id is not None and int(row.owner_user_id) == int(user_id):
            return get_demand_by_slug(slug, user={"sub": str(user_id)}, include_private=False)
        if not row.claim_token or not secrets.compare_digest(str(row.claim_token), str(claim_token)):
            return None
        session.execute(
            text(
                """
                UPDATE inspiration_demands
                SET owner_user_id = :owner_user_id, claim_token = NULL, claimed_at = :claimed_at, updated_at = :updated_at
                WHERE id = :id
                """
            ),
            {"owner_user_id": user_id, "claimed_at": now, "updated_at": now, "id": row.id},
        )
    return get_demand_by_slug(slug, user={"sub": str(user_id)}, include_private=False)


def update_demand_private(*, slug: str, private_payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any] | None:
    with get_db_session() as session:
        ensure_inspiration_schema_and_seed_for_session(session)
        row = session.execute(
            text(
                """
                SELECT id, owner_user_id, private_json
                FROM inspiration_demands
                WHERE slug = :slug
                LIMIT 1
                """
            ),
            {"slug": slug},
        ).first()
        if not row:
            return None
        if not _can_update(row, user):
            return {"error": "forbidden"}
        current_private = _json_loads(row.private_json, {})
        current_private.update(private_payload)
        now = _now_iso()
        is_sqlite = _is_sqlite_session(session)
        session.execute(
            text(
                """
                UPDATE inspiration_demands
                SET private_json = :private_json, updated_at = :updated_at
                WHERE id = :id
                """
                if is_sqlite
                else
                """
                UPDATE inspiration_demands
                SET private_json = CAST(:private_json AS JSONB), updated_at = :updated_at
                WHERE id = :id
                """
            ),
            {"private_json": _json_dumps(current_private), "updated_at": now, "id": row.id},
        )
    return get_demand_by_slug(slug, user=user, include_private=True)


def add_demand_update(*, slug: str, payload: dict[str, Any], created_by_user_id: int | None) -> dict[str, Any] | None:
    with get_db_session() as session:
        ensure_inspiration_schema_and_seed_for_session(session)
        demand = session.execute(text("SELECT id FROM inspiration_demands WHERE slug = :slug"), {"slug": slug}).first()
        if not demand:
            return None
        update_id = f"upd_{uuid4().hex}"
        now = _now_iso()
        is_sqlite = _is_sqlite_session(session)
        insert_sql = (
            """
            INSERT INTO inspiration_demand_updates (
                id, demand_id, week_label, summary, progress, blockers, next_steps,
                stage_key, stage_status, emotion_note, artifacts_json, visibility, created_by_user_id, created_at, updated_at
            )
            VALUES (
                :id, :demand_id, :week_label, :summary, :progress, :blockers, :next_steps,
                :stage_key, :stage_status, :emotion_note, :artifacts_json, :visibility, :created_by_user_id, :created_at, :updated_at
            )
            """
            if is_sqlite
            else
            """
            INSERT INTO inspiration_demand_updates (
                id, demand_id, week_label, summary, progress, blockers, next_steps,
                stage_key, stage_status, emotion_note, artifacts_json, visibility, created_by_user_id, created_at, updated_at
            )
            VALUES (
                :id, :demand_id, :week_label, :summary, :progress, :blockers, :next_steps,
                :stage_key, :stage_status, :emotion_note, CAST(:artifacts_json AS JSONB), :visibility, :created_by_user_id, :created_at, :updated_at
            )
            """
        )
        params = {
            "id": update_id,
            "demand_id": demand.id,
            "week_label": payload.get("week_label") or "",
            "summary": payload.get("summary") or "",
            "progress": payload.get("progress") or "",
            "blockers": payload.get("blockers") or "",
            "next_steps": payload.get("next_steps") or "",
            "stage_key": payload.get("stage_key") or "",
            "stage_status": payload.get("stage_status") or "",
            "emotion_note": payload.get("emotion_note") or "",
            "artifacts_json": _json_dumps(payload.get("artifacts") or []),
            "visibility": payload.get("visibility") or "public",
            "created_by_user_id": created_by_user_id,
            "created_at": now,
            "updated_at": now,
        }
        session.execute(text(insert_sql), params)
        session.execute(
            text("UPDATE inspiration_demands SET updated_at = :updated_at WHERE id = :id"),
            {"updated_at": now, "id": demand.id},
        )
        row = session.execute(
            text(
                """
                SELECT id, week_label, summary, progress, blockers, next_steps, stage_key, stage_status,
                       emotion_note, artifacts_json, visibility, created_at, updated_at
                FROM inspiration_demand_updates
                WHERE id = :id
                """
            ),
            {"id": update_id},
        ).first()
        return _serialize_update(row)


def update_demand_update(*, slug: str, update_id: str, payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any] | None:
    with get_db_session() as session:
        ensure_inspiration_schema_and_seed_for_session(session)
        demand = session.execute(
            text(
                """
                SELECT id, owner_user_id
                FROM inspiration_demands
                WHERE slug = :slug
                LIMIT 1
                """
            ),
            {"slug": slug},
        ).first()
        if not demand:
            return None
        if not _can_update(demand, user):
            return {"error": "forbidden"}
        existing = session.execute(
            text(
                """
                SELECT id
                FROM inspiration_demand_updates
                WHERE id = :id AND demand_id = :demand_id
                LIMIT 1
                """
            ),
            {"id": update_id, "demand_id": demand.id},
        ).first()
        if not existing:
            return None
        is_sqlite = _is_sqlite_session(session)
        now = _now_iso()
        session.execute(
            text(
                """
                UPDATE inspiration_demand_updates
                SET week_label = :week_label,
                    summary = :summary,
                    progress = :progress,
                    blockers = :blockers,
                    next_steps = :next_steps,
                    stage_key = :stage_key,
                    stage_status = :stage_status,
                    emotion_note = :emotion_note,
                    artifacts_json = :artifacts_json,
                    visibility = :visibility,
                    updated_at = :updated_at
                WHERE id = :id AND demand_id = :demand_id
                """
                if is_sqlite
                else
                """
                UPDATE inspiration_demand_updates
                SET week_label = :week_label,
                    summary = :summary,
                    progress = :progress,
                    blockers = :blockers,
                    next_steps = :next_steps,
                    stage_key = :stage_key,
                    stage_status = :stage_status,
                    emotion_note = :emotion_note,
                    artifacts_json = CAST(:artifacts_json AS JSONB),
                    visibility = :visibility,
                    updated_at = :updated_at
                WHERE id = :id AND demand_id = :demand_id
                """
            ),
            {
                "id": update_id,
                "demand_id": demand.id,
                "week_label": payload.get("week_label") or "",
                "summary": payload.get("summary") or "",
                "progress": payload.get("progress") or "",
                "blockers": payload.get("blockers") or "",
                "next_steps": payload.get("next_steps") or "",
                "stage_key": payload.get("stage_key") or "",
                "stage_status": payload.get("stage_status") or "",
                "emotion_note": payload.get("emotion_note") or "",
                "artifacts_json": _json_dumps(payload.get("artifacts") or []),
                "visibility": payload.get("visibility") or "public",
                "updated_at": now,
            },
        )
        session.execute(
            text("UPDATE inspiration_demands SET updated_at = :updated_at WHERE id = :id"),
            {"updated_at": now, "id": demand.id},
        )
        row = session.execute(
            text(
                """
                SELECT id, week_label, summary, progress, blockers, next_steps, stage_key, stage_status,
                       emotion_note, artifacts_json, visibility, created_at, updated_at
                FROM inspiration_demand_updates
                WHERE id = :id
                """
            ),
            {"id": update_id},
        ).first()
        return _serialize_update(row)


def _build_assistant_input_snapshot(session, demand_id: str, trigger_type: str, trigger_update_id: str | None) -> dict[str, Any]:
    update_limit = _context_update_limit()
    demand = session.execute(
        text(
            """
            SELECT id, slug, clue_number, status, stage, owner_user_id, public_title, public_summary,
                   public_tags, public_stuck, private_json, llm_review_json, assistant_status,
                   assistant_snapshot_json, assistant_version, assistant_latest_run_id,
                   assistant_updated_at, assistant_error_message, redaction_method,
                   redaction_status, redaction_notes, created_at, updated_at
            FROM inspiration_demands
            WHERE id = :id
            LIMIT 1
            """
        ),
        {"id": demand_id},
    ).first()
    if not demand:
        return {}
    update_rows = session.execute(
        text(
            """
            SELECT id, week_label, summary, progress, blockers, next_steps, stage_key, stage_status,
                   emotion_note, artifacts_json, visibility, created_at, updated_at
            FROM inspiration_demand_updates
            WHERE demand_id = :demand_id
            ORDER BY updated_at DESC, created_at DESC
            LIMIT :limit
            """
        ),
        {"demand_id": demand_id, "limit": update_limit},
    ).fetchall()
    updates = [_serialize_update(row) for row in update_rows]
    trigger_update = next((item for item in updates if item["id"] == trigger_update_id), None)
    public_payload = _serialize_public(demand)
    stage_key = str((trigger_update or {}).get("stage_key") or "submitted")
    return {
        "demand_id": demand.id,
        "slug": demand.slug,
        "trigger_type": trigger_type,
        "stage_key": stage_key,
        "public": public_payload,
        "private": _json_loads(demand.private_json, {}),
        "updates": updates,
        "path_progress": _build_path_progress(demand, updates),
        "trigger_update": trigger_update,
        "previous_assistant": _serialize_assistant(demand),
    }


def create_assistant_run(*, slug: str, trigger_type: str, trigger_update_id: str | None = None) -> dict[str, Any]:
    with get_db_session() as session:
        ensure_inspiration_schema_and_seed_for_session(session)
        demand = session.execute(
            text("SELECT id FROM inspiration_demands WHERE slug = :slug LIMIT 1"),
            {"slug": slug},
        ).first()
        if not demand:
            raise ValueError(f"Inspiration demand not found: {slug}")
        run_id = f"iar_{uuid4().hex}"
        now = _now_iso()
        snapshot = _build_assistant_input_snapshot(session, demand.id, trigger_type, trigger_update_id)
        is_sqlite = _is_sqlite_session(session)
        session.execute(
            text(
                """
                INSERT INTO inspiration_assistant_runs (
                    id, demand_id, trigger_type, trigger_update_id, status,
                    input_snapshot_json, output_json, error_message, created_at, started_at, completed_at
                )
                VALUES (
                    :id, :demand_id, :trigger_type, :trigger_update_id, 'pending',
                    :input_snapshot_json, '{}', NULL, :created_at, NULL, NULL
                )
                """
                if is_sqlite
                else
                """
                INSERT INTO inspiration_assistant_runs (
                    id, demand_id, trigger_type, trigger_update_id, status,
                    input_snapshot_json, output_json, error_message, created_at, started_at, completed_at
                )
                VALUES (
                    :id, :demand_id, :trigger_type, :trigger_update_id, 'pending',
                    CAST(:input_snapshot_json AS JSONB), '{}'::jsonb, NULL, :created_at, NULL, NULL
                )
                """
            ),
            {
                "id": run_id,
                "demand_id": demand.id,
                "trigger_type": trigger_type,
                "trigger_update_id": trigger_update_id,
                "input_snapshot_json": _json_dumps(snapshot),
                "created_at": now,
            },
        )
        session.execute(
            text(
                """
                UPDATE inspiration_demands
                SET assistant_status = 'pending',
                    assistant_latest_run_id = :run_id,
                    assistant_error_message = NULL,
                    updated_at = :updated_at
                WHERE id = :demand_id
                """
            ),
            {"run_id": run_id, "demand_id": demand.id, "updated_at": now},
        )
        row = session.execute(
            text(
                """
                SELECT id, demand_id, trigger_type, trigger_update_id, status, input_snapshot_json,
                       output_json, error_message, created_at, started_at, completed_at
                FROM inspiration_assistant_runs
                WHERE id = :id
                """
            ),
            {"id": run_id},
        ).first()
        return _serialize_run(row)


def get_assistant_run(run_id: str) -> dict[str, Any] | None:
    with get_db_session() as session:
        ensure_inspiration_schema_and_seed_for_session(session)
        row = session.execute(
            text(
                """
                SELECT id, demand_id, trigger_type, trigger_update_id, status, input_snapshot_json,
                       output_json, error_message, created_at, started_at, completed_at
                FROM inspiration_assistant_runs
                WHERE id = :id
                LIMIT 1
                """
            ),
            {"id": run_id},
        ).first()
        return _serialize_run(row) if row else None


def list_assistant_runs_for_demand(slug: str) -> list[dict[str, Any]]:
    with get_db_session() as session:
        ensure_inspiration_schema_and_seed_for_session(session)
        rows = session.execute(
            text(
                """
                SELECT runs.id, runs.demand_id, runs.trigger_type, runs.trigger_update_id, runs.status,
                       runs.input_snapshot_json, runs.output_json, runs.error_message,
                       runs.created_at, runs.started_at, runs.completed_at
                FROM inspiration_assistant_runs AS runs
                JOIN inspiration_demands AS demands ON demands.id = runs.demand_id
                WHERE demands.slug = :slug
                ORDER BY runs.created_at DESC, runs.id DESC
                """
            ),
            {"slug": slug},
        ).fetchall()
        return [_serialize_run(row) for row in rows]


def mark_assistant_run_running(run_id: str) -> dict[str, Any] | None:
    now = _now_iso()
    with get_db_session() as session:
        ensure_inspiration_schema_and_seed_for_session(session)
        run = session.execute(text("SELECT demand_id FROM inspiration_assistant_runs WHERE id = :id"), {"id": run_id}).first()
        if not run:
            return None
        session.execute(
            text("UPDATE inspiration_assistant_runs SET status = 'running', started_at = :started_at WHERE id = :id"),
            {"started_at": now, "id": run_id},
        )
        session.execute(
            text(
                """
                UPDATE inspiration_demands
                SET assistant_status = 'running',
                    assistant_latest_run_id = :run_id,
                    assistant_error_message = NULL,
                    updated_at = :updated_at
                WHERE id = :demand_id
                """
            ),
            {"run_id": run_id, "demand_id": run.demand_id, "updated_at": now},
        )
    return get_assistant_run(run_id)


def complete_assistant_run(run_id: str, output: dict[str, Any]) -> dict[str, Any] | None:
    now = _now_iso()
    with get_db_session() as session:
        ensure_inspiration_schema_and_seed_for_session(session)
        run = session.execute(text("SELECT demand_id, trigger_type FROM inspiration_assistant_runs WHERE id = :id"), {"id": run_id}).first()
        if not run:
            return None
        should_update_public = run.trigger_type == "initial_submission"
        public_title = _short_public_title(output.get("title")) if should_update_public else ""
        public_summary = _public_text(output.get("summary"), fallback="", max_length=180) if should_update_public else ""
        public_stuck = _public_text(output.get("public_stuck") or output.get("stuck"), fallback="", max_length=120) if should_update_public else ""
        is_sqlite = _is_sqlite_session(session)
        session.execute(
            text(
                """
                UPDATE inspiration_assistant_runs
                SET status = 'completed',
                    output_json = :output_json,
                    error_message = NULL,
                    completed_at = :completed_at
                WHERE id = :id
                """
                if is_sqlite
                else
                """
                UPDATE inspiration_assistant_runs
                SET status = 'completed',
                    output_json = CAST(:output_json AS JSONB),
                    error_message = NULL,
                    completed_at = :completed_at
                WHERE id = :id
                """
            ),
            {"output_json": _json_dumps(output), "completed_at": now, "id": run_id},
        )
        session.execute(
            text(
                """
                UPDATE inspiration_demands
                SET assistant_status = 'ready',
                    assistant_snapshot_json = :snapshot_json,
                    assistant_version = COALESCE(assistant_version, 0) + 1,
                    assistant_latest_run_id = :run_id,
                    assistant_updated_at = :assistant_updated_at,
                    assistant_error_message = NULL,
                    llm_review_json = :snapshot_json,
                    public_title = COALESCE(NULLIF(:public_title, ''), public_title),
                    public_summary = COALESCE(NULLIF(:public_summary, ''), public_summary),
                    public_stuck = COALESCE(NULLIF(:public_stuck, ''), public_stuck),
                    redaction_method = CASE WHEN NULLIF(:public_summary, '') IS NULL THEN redaction_method ELSE 'llm_rewrite' END,
                    redaction_status = CASE WHEN NULLIF(:public_summary, '') IS NULL THEN redaction_status ELSE 'published' END,
                    stage = COALESCE(NULLIF(:suggested_stage, ''), stage),
                    updated_at = :updated_at
                WHERE id = :demand_id
                """
                if is_sqlite
                else
                """
                UPDATE inspiration_demands
                SET assistant_status = 'ready',
                    assistant_snapshot_json = CAST(:snapshot_json AS JSONB),
                    assistant_version = COALESCE(assistant_version, 0) + 1,
                    assistant_latest_run_id = :run_id,
                    assistant_updated_at = :assistant_updated_at,
                    assistant_error_message = NULL,
                    llm_review_json = CAST(:snapshot_json AS JSONB),
                    public_title = COALESCE(NULLIF(:public_title, ''), public_title),
                    public_summary = COALESCE(NULLIF(:public_summary, ''), public_summary),
                    public_stuck = COALESCE(NULLIF(:public_stuck, ''), public_stuck),
                    redaction_method = CASE WHEN NULLIF(:public_summary, '') IS NULL THEN redaction_method ELSE 'llm_rewrite' END,
                    redaction_status = CASE WHEN NULLIF(:public_summary, '') IS NULL THEN redaction_status ELSE 'published' END,
                    stage = COALESCE(NULLIF(:suggested_stage, ''), stage),
                    updated_at = :updated_at
                WHERE id = :demand_id
                """
            ),
            {
                "snapshot_json": _json_dumps(output),
                "public_title": public_title,
                "public_summary": public_summary,
                "public_stuck": public_stuck,
                "suggested_stage": str(output.get("suggested_stage") or ""),
                "run_id": run_id,
                "assistant_updated_at": now,
                "updated_at": now,
                "demand_id": run.demand_id,
            },
        )
    return get_assistant_run(run_id)


def fail_assistant_run(run_id: str, error_message: str) -> dict[str, Any] | None:
    now = _now_iso()
    with get_db_session() as session:
        ensure_inspiration_schema_and_seed_for_session(session)
        run = session.execute(text("SELECT demand_id FROM inspiration_assistant_runs WHERE id = :id"), {"id": run_id}).first()
        if not run:
            return None
        session.execute(
            text(
                """
                UPDATE inspiration_assistant_runs
                SET status = 'failed',
                    error_message = :error_message,
                    completed_at = :completed_at
                WHERE id = :id
                """
            ),
            {"error_message": error_message[:1000], "completed_at": now, "id": run_id},
        )
        session.execute(
            text(
                """
                UPDATE inspiration_demands
                SET assistant_status = 'failed',
                    assistant_latest_run_id = :run_id,
                    assistant_error_message = :error_message,
                    updated_at = :updated_at
                WHERE id = :demand_id
                """
            ),
            {"run_id": run_id, "error_message": error_message[:1000], "updated_at": now, "demand_id": run.demand_id},
        )
    return get_assistant_run(run_id)
