"""Authenticated run and write receipts for general Agent clients."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from app.api.auth import get_current_user
from app.services import agent_runs, agent_requests
from app.storage.database.postgres_client import get_db_session

router = APIRouter(prefix='/agents', tags=['agent-runs'])

class RunStatus(BaseModel):
    run_id: str
    topic_id: str
    actor_uid: str
    status: str
    error_code: str | None
    created_at: float
    updated_at: float
    status_url: str
    result_url: str
    poll_after_seconds: int
    retryable: bool

async def owned_run(run_id: str, user: dict):
    row = agent_runs.get_run(run_id)
    if not row:
        raise HTTPException(404, 'Run not found')
    uid = user.get('agent_uid') or 'user:' + str(user['sub'])
    if row['actor_uid'] != uid and not user.get('is_admin'):
        raise HTTPException(403, 'No permission to read this run')
    return await agent_runs.reconcile_run(row)

@router.get('/runs/{run_id}', response_model=RunStatus)
async def read_run(run_id: str, user: dict = Depends(get_current_user)):
    return agent_runs.public_run(await owned_run(run_id, user))

@router.get('/runs/{run_id}/result')
async def read_run_result(run_id: str, user: dict = Depends(get_current_user)):
    row = await owned_run(run_id, user)
    if row['status'] != 'completed':
        raise HTTPException(409, detail={'code': 'result_not_ready', 'status': row['status'],
                                       'retryable': False, 'status_url': agent_runs.public_run(row)['status_url']})
    from app.storage.database.topic_store import get_topic, list_discussion_turns
    topic = get_topic(row['topic_id'])
    return {'run': agent_runs.public_run(row), 'result': topic.get('discussion_result'),
            'turns': list_discussion_turns(row['topic_id'])}

@router.get('/requests/{receipt_id}')
def read_write_receipt(receipt_id: str, user: dict = Depends(get_current_user)):
    with get_db_session() as session:
        agent_requests.ensure_receipts(session)
        row = session.execute(text('SELECT * FROM agent_request_receipts WHERE receipt_id = :id'), {'id': receipt_id}).fetchone()
        if not row:
            raise HTTPException(404, 'Receipt not found')
        uid = user.get('agent_uid') or 'user:' + str(user['sub'])
        if row.actor_uid != uid:
            raise HTTPException(403, 'No permission to read this receipt')
        import json
        return {'receipt_id': receipt_id, 'state': row.state, 'status_code': row.status_code,
                'response': json.loads(row.response_json) if row.response_json else None, 'retryable': False}
