"""Persistent receipts for retries; an ambiguous write is never repeated automatically."""
import hashlib
import json
import re

from fastapi import HTTPException, Request
from fastapi.responses import Response
from fastapi.routing import APIRoute
from sqlalchemy import text
from starlette.concurrency import run_in_threadpool

from app.storage.database.postgres_client import get_db_session


def ensure_receipts(session):
    session.execute(text('''CREATE TABLE IF NOT EXISTS agent_request_receipts (
        receipt_id VARCHAR(64) PRIMARY KEY, actor_uid VARCHAR(255) NOT NULL,
        request_hash VARCHAR(64) NOT NULL, state VARCHAR(32) NOT NULL,
        status_code INTEGER, response_json TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )'''))


def reserve(actor_uid, operation, key, body):
    receipt_id = hashlib.sha256(f'{actor_uid}\0{operation}\0{key}'.encode()).hexdigest()
    request_hash = hashlib.sha256(body).hexdigest()
    with get_db_session() as session:
        ensure_receipts(session)
        inserted = session.execute(text('''INSERT INTO agent_request_receipts
            (receipt_id, actor_uid, request_hash, state) VALUES (:id, :actor, :hash, 'pending')
            ON CONFLICT (receipt_id) DO NOTHING'''),
            {'id': receipt_id, 'actor': actor_uid, 'hash': request_hash}).rowcount
        row = session.execute(text('SELECT * FROM agent_request_receipts WHERE receipt_id = :id'), {'id': receipt_id}).fetchone()
        if row.request_hash != request_hash:
            raise HTTPException(409, detail={'code': 'idempotency_conflict', 'message': 'This key was used with different input'})
        if inserted:
            return receipt_id, None
        if row.state == 'completed':
            return receipt_id, Response(row.response_json, status_code=row.status_code,
                                       media_type='application/json', headers={'Idempotency-Replayed': 'true'})
        raise HTTPException(409, detail={'code': 'write_outcome_unknown',
            'message': 'A write with this key is pending or interrupted. Reconcile its resource before starting another write.',
            'retryable': False, 'receipt_id': receipt_id})


def finish(receipt_id, response):
    with get_db_session() as session:
        session.execute(text('''UPDATE agent_request_receipts SET state = 'completed',
            status_code = :status, response_json = :body WHERE receipt_id = :id'''),
            {'id': receipt_id, 'status': response.status_code, 'body': response.body.decode()})


class AgentMutationRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handle(request: Request):
            key = request.headers.get('Idempotency-Key')
            if not key or request.method not in {'POST', 'PATCH', 'DELETE'}:
                return await original(request)
            # Receipts never retain credentials, claim links, media uploads or admin payloads.
            if not re.search(r'/(topics|agent-tasks|twins)(/|$)', request.url.path) or any(
                part in request.url.path for part in ['/internal/', '/keys', '/media', '/bind']
            ):
                return await original(request)
            if not re.fullmatch(r'[A-Za-z0-9_.:-]{8,128}', key):
                raise HTTPException(400, detail='Invalid Idempotency-Key')
            from app.api.auth import resolve_access_token
            token = request.headers.get('Authorization', '').removeprefix('Bearer ').strip()
            actor = await resolve_access_token(token) if token else None
            if not actor:
                raise HTTPException(401, detail='Authentication required for idempotent writes')
            from app.services.agent_credentials import check_scope
            check_scope(actor, request.method, request.url.path)
            raw_body = await request.body()
            if len(raw_body) > 1024 * 1024:
                raise HTTPException(413, detail='Idempotent JSON body exceeds 1 MiB')
            try:
                body = json.dumps(json.loads(raw_body), sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode() if raw_body else b''
            except ValueError:
                return await original(request)
            operation = request.method + ' ' + request.url.path.replace('/api/v1/agents/', '/api/v1/openclaw/')
            uid = actor.get('agent_uid') or 'user:' + str(actor['sub'])
            receipt_id, cached = await run_in_threadpool(reserve, uid, operation, key, body)
            if cached is not None:
                return cached
            # A thrown exception leaves a pending receipt. Repeating a potentially committed
            # write after a crash or a lost executor response would be unsafe.
            response = await original(request)
            if 'application/json' in response.headers.get('content-type', '') and len(response.body) <= 1024 * 1024:
                await run_in_threadpool(finish, receipt_id, response)
            return response

        return handle
