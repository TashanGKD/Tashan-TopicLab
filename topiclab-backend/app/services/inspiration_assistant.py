"""Background execution for Inspiration Co-Creation intelligent assistant runs."""

from __future__ import annotations

from app.services.inspiration_review import generate_inspiration_assistant_snapshot
from app.storage.database.inspiration_store import (
    complete_assistant_run,
    fail_assistant_run,
    get_assistant_run,
    mark_assistant_run_running,
)


async def run_inspiration_assistant_once(run_id: str) -> None:
    """Execute one queued assistant run and persist its result."""

    run = mark_assistant_run_running(run_id)
    if not run:
        return
    try:
        current = get_assistant_run(run_id)
        if not current:
            return
        output = await generate_inspiration_assistant_snapshot(current.get("input_snapshot") or {})
        complete_assistant_run(run_id, output)
    except Exception as exc:
        fail_assistant_run(run_id, str(exc) or exc.__class__.__name__)
