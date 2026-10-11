"""Persist accepted runs and reconcile executor receipts without repeating computation."""
import asyncio
import json
import time
from uuid import uuid4
from sqlalchemy import text
from fastapi import HTTPException
from app.storage.database.postgres_client import get_db_session

TERMINAL = {'completed', 'failed', 'cancelled', 'interrupted'}


def ensure_runs(session):
    session.execute(text('''CREATE TABLE IF NOT EXISTS agent_runs (
        run_id VARCHAR(36) PRIMARY KEY, topic_id VARCHAR(255) NOT NULL,
        actor_uid VARCHAR(255) NOT NULL, status VARCHAR(32) NOT NULL,
        active_key VARCHAR(255) UNIQUE, input_json TEXT NOT NULL,
        error_code VARCHAR(64), updated_at DOUBLE PRECISION NOT NULL,
        created_at DOUBLE PRECISION NOT NULL
    )'''))


def create_run(topic_id, actor_uid, payload):
    run_id = 'run_' + uuid4().hex
    now = time.time()
    with get_db_session() as session:
        ensure_runs(session)
        changed = session.execute(text('''INSERT INTO agent_runs
            (run_id, topic_id, actor_uid, status, active_key, input_json, updated_at, created_at)
            VALUES (:id, :topic, :actor, 'running', :topic, :input, :now, :now)
            ON CONFLICT (active_key) DO NOTHING'''),
            {'id': run_id, 'topic': topic_id, 'actor': actor_uid,
             'input': json.dumps(payload, sort_keys=True), 'now': now}).rowcount
        row = session.execute(text('SELECT * FROM agent_runs WHERE active_key = :topic'), {'topic': topic_id}).fetchone()
        if not changed and (row.actor_uid != actor_uid or json.loads(row.input_json) != payload):
            raise HTTPException(409, detail='A different run is already active on this topic')
        return dict(row._mapping), bool(changed)


def get_run(run_id):
    with get_db_session() as session:
        ensure_runs(session)
        row = session.execute(text('SELECT * FROM agent_runs WHERE run_id = :id'), {'id': run_id}).fetchone()
        return dict(row._mapping) if row else None


def latest_run(topic_id):
    with get_db_session() as session:
        ensure_runs(session)
        row = session.execute(text('SELECT * FROM agent_runs WHERE topic_id = :topic ORDER BY created_at DESC LIMIT 1'), {'topic': topic_id}).fetchone()
        return dict(row._mapping) if row else None


def update_run(run_id, status, error_code=None):
    with get_db_session() as session:
        ensure_runs(session)
        session.execute(text('''UPDATE agent_runs SET status = :status, updated_at = :now,
            error_code = :error, active_key = CASE WHEN :terminal THEN NULL ELSE topic_id END WHERE run_id = :id
            AND status NOT IN ('completed', 'failed', 'cancelled', 'interrupted')'''),
            {'status': status, 'now': time.time(), 'error': error_code,
             'terminal': status in TERMINAL, 'id': run_id})


def public_run(row):
    return {key: row[key] for key in ['run_id', 'topic_id', 'actor_uid', 'status', 'error_code', 'created_at', 'updated_at']} | {
        'status_url': f"/api/v1/agents/runs/{row['run_id']}",
        'result_url': f"/api/v1/agents/runs/{row['run_id']}/result",
        'poll_after_seconds': 2, 'retryable': False}


async def reconcile_run(row):
    from app.api import topics
    if row['status'] in TERMINAL:
        return row
    try:
        receipt = await topics.request_json('GET', f"/executor/runs/{row['run_id']}", timeout=10.0)
    except Exception:
        # Missing/unreachable executor is an unknown outcome, never a cue to restart it.
        return row
    status = receipt.get('status')
    if status == 'completed':
        topics._apply_snapshot_to_db(row['topic_id'], receipt['result'])
        update_run(row['run_id'], 'completed')
    elif status in {'failed', 'cancelled', 'interrupted'}:
        topics.set_discussion_status(row['topic_id'], 'failed')
        update_run(row['run_id'], status, receipt.get('error_code'))
    return get_run(row['run_id'])


async def recovery_loop():
    while True:
        with get_db_session() as session:
            ensure_runs(session)
            rows = session.execute(text("SELECT * FROM agent_runs WHERE status = 'running' AND updated_at < :cutoff LIMIT 20"),
                                   {'cutoff': time.time() - 90}).fetchall()
        for row in rows:
            await reconcile_run(dict(row._mapping))
        await asyncio.sleep(15)
