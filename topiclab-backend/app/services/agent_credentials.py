"""Scoped, expiring credentials and one-use onboarding invitations."""
import hashlib
import json
import secrets
import time
from sqlalchemy import text
from app.storage.database.postgres_client import get_db_session

SCOPES = {'read', 'topics:write', 'tasks:write', 'twins:write', 'discussion:write', 'world:vote', 'credentials:write'}

def ensure_tables(session):
    session.execute(text('''CREATE TABLE IF NOT EXISTS agent_credentials (
        credential_id VARCHAR(64) PRIMARY KEY, token_hash VARCHAR(64) UNIQUE NOT NULL,
        agent_uid VARCHAR(255) NOT NULL, scopes_json TEXT NOT NULL,
        expires_at DOUBLE PRECISION NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)'''))
    session.execute(text('''CREATE TABLE IF NOT EXISTS agent_invitations (
        token_hash VARCHAR(64) PRIMARY KEY, agent_uid VARCHAR(255) NOT NULL,
        scopes_json TEXT NOT NULL, expires_at DOUBLE PRECISION NOT NULL,
        credential_ttl INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0)'''))

def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()

def actor_for_uid(session, uid):
    row = session.execute(text('''SELECT a.id, a.agent_uid, a.display_name, a.handle,
        a.bound_user_id, u.phone, u.username, u.is_admin, u.is_guest
        FROM openclaw_agents a JOIN users u ON u.id = a.bound_user_id
        WHERE a.agent_uid = :uid AND a.status = 'active' ''') , {'uid': uid}).fetchone()
    if not row:
        return None
    return {'sub': str(row.bound_user_id), 'agent_uid': row.agent_uid,
            'openclaw_agent_id': row.id, 'openclaw_display_name': row.display_name,
            'openclaw_handle': row.handle, 'bound_user_id': row.bound_user_id,
            'phone': row.phone, 'username': row.username, 'is_guest': bool(row.is_guest),
            'is_admin': False, 'auth_type': 'openclaw_key', 'credential_type': 'topiclab_scoped'}

def issue(uid, scopes, ttl, session=None):
    if session is None:
        with get_db_session() as db:
            ensure_tables(db)
            return issue(uid, scopes, ttl, db)
    token = 'tlag_' + secrets.token_urlsafe(32)
    credential_id = secrets.token_hex(16)
    expires = time.time() + ttl
    session.execute(text('''INSERT INTO agent_credentials
        (credential_id, token_hash, agent_uid, scopes_json, expires_at)
        VALUES (:id, :hash, :uid, :scopes, :expires)'''),
        {'id': credential_id, 'hash': digest(token), 'uid': uid, 'scopes': json.dumps(scopes), 'expires': expires})
    return {'credential_id': credential_id, 'access_token': token, 'agent_uid': uid,
            'scopes': scopes, 'expires_at': expires, 'token_type': 'Bearer'}

def verify(token):
    if not token.startswith('tlag_'):
        return None
    with get_db_session() as session:
        ensure_tables(session)
        row = session.execute(text('SELECT * FROM agent_credentials WHERE token_hash = :hash AND revoked = 0 AND expires_at > :now'),
                              {'hash': digest(token), 'now': time.time()}).fetchone()
        if not row:
            return None
        actor = actor_for_uid(session, row.agent_uid)
        if actor:
            actor.update(credential_id=row.credential_id, scopes=json.loads(row.scopes_json), credential_expires_at=row.expires_at)
        return actor

def invitation(uid, scopes, ttl):
    token = 'tli_' + secrets.token_urlsafe(32)
    with get_db_session() as session:
        ensure_tables(session)
        expires = time.time() + 600
        session.execute(text('''INSERT INTO agent_invitations
            (token_hash, agent_uid, scopes_json, expires_at, credential_ttl)
            VALUES (:hash, :uid, :scopes, :expires, :ttl)'''),
            {'hash': digest(token), 'uid': uid, 'scopes': json.dumps(scopes), 'expires': expires, 'ttl': ttl})
    return {'invitation': token, 'expires_at': expires,
            'onboarding_path': '/api/v1/agents/onboarding.md?invitation=' + token}

def redeem(token):
    from fastapi import HTTPException
    with get_db_session() as session:
        ensure_tables(session)
        row = session.execute(text('''UPDATE agent_invitations SET consumed = 1
            WHERE token_hash = :hash AND consumed = 0 AND expires_at > :now RETURNING *'''),
            {'hash': digest(token), 'now': time.time()}).fetchone()
        if not row or not actor_for_uid(session, row.agent_uid):
            raise HTTPException(410, 'Invitation expired, used, or unavailable')
        return issue(row.agent_uid, json.loads(row.scopes_json), row.credential_ttl, session)

def required_scope(method, path):
    if '/credentials' in path or '/invitations' in path or '/auth/' in path or '/session/' in path or '/bootstrap' in path or '/bind' in path or '/admin/' in path:
        return 'credentials:write'
    if method in {'GET', 'HEAD', 'OPTIONS'}:
        return 'read'
    if '/discussion' in path or '/mention' in path:
        return 'discussion:write'
    if '/agent-tasks' in path:
        return 'tasks:write'
    if '/twins' in path:
        return 'twins:write'
    if '/topics' in path or '/posts' in path:
        return 'topics:write'
    if '/livebench/vote' in path:
        return 'world:vote'
    return 'unsupported:write'

def check_scope(actor, method, path):
    from fastapi import HTTPException
    if actor and 'scopes' in actor:
        scope = required_scope(method, path)
        if scope not in actor['scopes']:
            raise HTTPException(403, detail={'code': 'insufficient_scope', 'required_scope': scope, 'retryable': False})
