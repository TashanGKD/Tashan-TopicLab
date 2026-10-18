"""Unified profile hub: candidate aggregation, phone lookup and confirmed profile writes.

Design notes
------------
* A phone number only finds candidate material. It never merges accounts, never
  transfers business records and never becomes the identity key.
* Imported candidates live in their own table and are never treated as confirmed
  values. Only an explicit user confirmation writes ``user_profiles``.
* Every write carries the caller (source site), the profile version and an
  idempotency key; provenance and source time are decided on the server.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import time
from urllib.parse import urlsplit

from fastapi import HTTPException
from sqlalchemy import text, inspect

from app.storage.database.postgres_client import get_db_session

PROFILE_FIELDS = ('real_name', 'organization', 'major', 'research_direction')
FIELD_LABELS = {
    'real_name': '姓名',
    'organization': '单位',
    'major': '专业',
    'research_direction': '研究方向',
}
FIELD_LIMITS = {'real_name': 80, 'organization': 160, 'major': 300, 'research_direction': 2000}
CANDIDATE_FIELDS = PROFILE_FIELDS
SOURCE_SYSTEMS = ('panshi-camp', 'panshi-forum')
CLOCK_SKEW = 300
PHONE = re.compile(r'^1[3-9][0-9]{9}$')


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def normalize_phone(value) -> str | None:
    """Return the 11-digit mainland mobile number, or None when it is not a valid number."""
    if not isinstance(value, str):
        return None
    cleaned = re.sub(r'[\s-]', '', value.strip())
    if cleaned.startswith('+86'):
        cleaned = cleaned[3:]
    elif cleaned.startswith('0086'):
        cleaned = cleaned[4:]
    return cleaned if PHONE.fullmatch(cleaned) else None


def apply_schema(session):
    statements = [
        '''CREATE TABLE IF NOT EXISTS profile_source_candidates (
          id VARCHAR(32) PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          source_system VARCHAR(32) NOT NULL,
          source_user_id VARCHAR(64) NOT NULL,
          field VARCHAR(32) NOT NULL,
          value TEXT NOT NULL,
          value_hash VARCHAR(64) NOT NULL,
          source_updated_at VARCHAR(40),
          field_note VARCHAR(32),
          imported_at BIGINT NOT NULL,
          batch_id VARCHAR(32) NOT NULL,
          UNIQUE (user_id, source_system, source_user_id, field, value_hash))''',
        '''CREATE TABLE IF NOT EXISTS profile_import_batches (
          id VARCHAR(32) PRIMARY KEY,
          source_system VARCHAR(32) NOT NULL,
          mode VARCHAR(16) NOT NULL,
          started_at BIGINT NOT NULL,
          finished_at BIGINT,
          summary TEXT NOT NULL DEFAULT '{}')''',
        '''CREATE TABLE IF NOT EXISTS profile_hub_events (
          id VARCHAR(32) PRIMARY KEY,
          user_id INTEGER,
          requester VARCHAR(32) NOT NULL,
          action VARCHAR(16) NOT NULL,
          result VARCHAR(32) NOT NULL,
          field_names TEXT NOT NULL DEFAULT '[]',
          phone_hash VARCHAR(64),
          created_at BIGINT NOT NULL)''',
        '''CREATE TABLE IF NOT EXISTS profile_hub_writes (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          idempotency_key VARCHAR(128) NOT NULL,
          request_hash VARCHAR(64) NOT NULL,
          applied_version INTEGER NOT NULL,
          created_at BIGINT NOT NULL,
          PRIMARY KEY(user_id, idempotency_key))''',
        '''CREATE TABLE IF NOT EXISTS profile_field_sources (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          field VARCHAR(32) NOT NULL,
          source VARCHAR(32) NOT NULL,
          source_updated_at VARCHAR(40),
          adopted_at BIGINT NOT NULL,
          PRIMARY KEY(user_id, field))''',
        'CREATE INDEX IF NOT EXISTS idx_profile_candidates_user ON profile_source_candidates(user_id, field)',
        'CREATE INDEX IF NOT EXISTS idx_profile_candidates_source ON profile_source_candidates(source_system, imported_at)',
    ]
    for statement in statements:
        session.execute(text(statement))


def _now() -> int:
    return int(time.time())


def _event(db, *, user_id, requester, action, result, fields=(), phone_hash=None):
    """Audit keeps field names and outcomes; never values or full phone numbers."""
    db.execute(text('''INSERT INTO profile_hub_events
        (id,user_id,requester,action,result,field_names,phone_hash,created_at)
        VALUES (:id,:uid,:requester,:action,:result,:fields,:phone_hash,:now)'''),
        dict(id=secrets.token_hex(16), uid=user_id, requester=requester, action=action, result=result,
             fields=json.dumps(list(fields), ensure_ascii=False), phone_hash=phone_hash, now=_now()))


# --------------------------------------------------------------------------- import


def record_import_batch(session, source_system: str, mode: str, summary: dict) -> str:
    batch_id = secrets.token_hex(16)
    session.execute(text('''INSERT INTO profile_import_batches (id,source_system,mode,started_at,finished_at,summary)
        VALUES (:id,:source,:mode,:now,:now,:summary)'''),
        dict(id=batch_id, source=source_system, mode=mode, now=_now(),
             summary=json.dumps(summary, ensure_ascii=False)))
    return batch_id


def upsert_candidate(session, *, user_id: int, source_system: str, source_user_id: str, field: str,
                     value: str, source_updated_at: str | None, batch_id: str,
                     field_note: str | None = None) -> bool:
    """Insert one candidate; returns False when the same value already exists (idempotent)."""
    if field not in CANDIDATE_FIELDS:
        raise ValueError(f'unsupported field {field}')
    value = (value or '').strip()
    if not value:
        return False
    result = session.execute(text('''INSERT INTO profile_source_candidates
        (id,user_id,source_system,source_user_id,field,value,value_hash,source_updated_at,field_note,imported_at,batch_id)
        VALUES (:id,:uid,:source,:source_user,:field,:value,:hash,:updated,:note,:now,:batch)
        ON CONFLICT (user_id,source_system,source_user_id,field,value_hash) DO NOTHING'''),
        dict(id=secrets.token_hex(16), uid=user_id, source=source_system, source_user=source_user_id,
             field=field, value=value[:FIELD_LIMITS[field]], hash=digest(value), updated=source_updated_at,
             note=field_note, now=_now(), batch=batch_id))
    return bool(result.rowcount)


def find_user_for_import(session, *, phone: str | None, subject: str | None):
    """Resolve a central account by binding subject first, then by verified phone."""
    if subject:
        row = session.execute(text('''SELECT id FROM users WHERE CAST(id AS TEXT)=:subject AND is_guest=false'''),
                              {'subject': subject}).mappings().first()
        if row:
            return row['id'], 'binding'
    if phone:
        row = session.execute(text('SELECT id FROM users WHERE phone=:phone AND is_guest=false'),
                              {'phone': phone}).mappings().first()
        if row:
            return row['id'], 'phone'
    return None, None


def import_summary(session, source_system: str) -> dict:
    rows = session.execute(text('''SELECT field,COUNT(*) AS n,COUNT(DISTINCT user_id) AS users,
        SUM(CASE WHEN source_updated_at IS NULL THEN 1 ELSE 0 END) AS unknown_time
        FROM profile_source_candidates WHERE source_system=:source GROUP BY field'''),
        {'source': source_system}).mappings()
    return {row['field']: {'rows': row['n'], 'users': row['users'], 'unknown_time': row['unknown_time']}
            for row in rows}


# --------------------------------------------------------------------------- lookup


def _confirmed(db, user_id: int) -> dict:
    row = db.execute(text('''SELECT COALESCE(up.version,1) AS version, up.real_name, up.organization,
        up.major, up.research_direction FROM users u
        LEFT JOIN user_profiles up ON up.user_id=u.id WHERE u.id=:uid'''), {'uid': user_id}).mappings().first()
    if not row:
        raise HTTPException(404, '用户不存在')
    sources = db.execute(text('''SELECT field,source,source_updated_at,adopted_at FROM profile_field_sources
        WHERE user_id=:uid'''), {'uid': user_id}).mappings()
    provenance = {item['field']: dict(item) for item in sources}
    return {
        'version': row['version'],
        'fields': {field: row[field] for field in PROFILE_FIELDS},
        'sources': {field: provenance.get(field) for field in PROFILE_FIELDS if field in provenance},
    }


def lookup_by_phone(phone_value, requester: str) -> dict:
    phone = normalize_phone(phone_value)
    phone_hash = digest(phone) if phone else None
    if not phone:
        raise HTTPException(422, '手机号格式不正确')
    with get_db_session() as db:
        user = db.execute(text('''SELECT id,phone,is_guest FROM users WHERE phone=:phone'''),
                          {'phone': phone}).mappings().first()
        if not user or user['is_guest']:
            _event(db, user_id=None, requester=requester, action='lookup', result='not_found', phone_hash=phone_hash)
            return {'found': False, 'confirmed': None, 'candidates': []}
        confirmed = _confirmed(db, user['id'])
        rows = db.execute(text('''SELECT source_system,source_user_id,field,value,source_updated_at,
            field_note,imported_at FROM profile_source_candidates WHERE user_id=:uid
            ORDER BY field, source_updated_at DESC NULLS LAST, imported_at DESC'''),
            {'uid': user['id']}).mappings()
        candidates = [dict(row) for row in rows]
        _event(db, user_id=user['id'], requester=requester, action='lookup', result='found', phone_hash=phone_hash)
    return {'found': True, 'confirmed': confirmed, 'candidates': candidates,
            'phone_verified': True}


# --------------------------------------------------------------------------- confirm


def _clean_changes(changes) -> dict:
    if not isinstance(changes, dict):
        raise HTTPException(422, '资料格式不正确')
    cleaned = {}
    for field, value in changes.items():
        if field not in PROFILE_FIELDS:
            raise HTTPException(422, '不支持的资料字段')
        if not isinstance(value, str):
            raise HTTPException(422, '资料格式不正确')
        value = value.strip()
        if not value:
            continue
        if len(value) > FIELD_LIMITS[field]:
            raise HTTPException(422, '部分资料超出字段长度限制')
        cleaned[field] = value
    if not cleaned:
        raise HTTPException(422, '没有可保存的内容')
    return cleaned


def confirm_by_phone(phone_value, requester: str, body: dict) -> dict:
    phone = normalize_phone(phone_value)
    phone_hash = digest(phone) if phone else None
    if not phone:
        raise HTTPException(422, '手机号格式不正确')
    expected = body.get('expected_version')
    key = body.get('idempotency_key')
    if not isinstance(expected, int) or isinstance(expected, bool) or expected < 1:
        raise HTTPException(422, '资料版本无效，请重新加载')
    if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{8,128}', key):
        raise HTTPException(422, '请求标识无效')
    changes = _clean_changes(body.get('changes'))
    request_hash = digest(json.dumps({'version': expected, 'changes': changes}, sort_keys=True, ensure_ascii=False))
    now = _now()
    with get_db_session() as db:
        user = db.execute(text('SELECT id,is_guest FROM users WHERE phone=:phone'), {'phone': phone}).mappings().first()
        if not user or user['is_guest']:
            _event(db, user_id=None, requester=requester, action='confirm', result='not_found', phone_hash=phone_hash)
            raise HTTPException(404, '没有找到对应的统一账号')
        uid = user['id']
        prior = db.execute(text('''SELECT request_hash,applied_version FROM profile_hub_writes
            WHERE user_id=:uid AND idempotency_key=:key'''), {'uid': uid, 'key': key}).mappings().first()
        if prior:
            if prior['request_hash'] != request_hash:
                _event(db, user_id=uid, requester=requester, action='confirm', result='idempotency_conflict',
                       fields=changes.keys(), phone_hash=phone_hash)
                raise HTTPException(409, 'IDEMPOTENCY_CONFLICT')
            return {'version': prior['applied_version'], **_confirmed(db, uid), 'replay': True}
        db.execute(text('INSERT INTO user_profiles(user_id) VALUES (:uid) ON CONFLICT(user_id) DO NOTHING'), {'uid': uid})
        assignments = ''.join(', ' + field + '=:' + field for field in changes)
        applied = db.execute(text('UPDATE user_profiles SET version=version+1' + assignments +
                                  ' WHERE user_id=:uid AND version=:expected RETURNING version'),
                             dict(uid=uid, expected=expected, **changes)).scalar()
        if applied is None:
            _event(db, user_id=uid, requester=requester, action='confirm', result='version_conflict',
                   fields=changes.keys(), phone_hash=phone_hash)
            raise HTTPException(409, 'VERSION_CONFLICT')
        for field in changes:
            db.execute(text('''INSERT INTO profile_field_sources(user_id,field,source,source_updated_at,adopted_at)
                VALUES (:uid,:field,:source,:at,:now)
                ON CONFLICT(user_id,field) DO UPDATE SET source=:source,source_updated_at=:at,adopted_at=:now'''),
                dict(uid=uid, field=field, source=requester, at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now)), now=now))
        db.execute(text('''INSERT INTO profile_hub_writes(user_id,idempotency_key,request_hash,applied_version,created_at)
            VALUES (:uid,:key,:hash,:version,:now)'''),
            dict(uid=uid, key=key, hash=request_hash, version=applied, now=now))
        _event(db, user_id=uid, requester=requester, action='confirm', result='saved',
               fields=changes.keys(), phone_hash=phone_hash)
        return {'version': applied, **_confirmed(db, uid), 'replay': False}


# --------------------------------------------------------------------------- request auth


def hub_secret_for(requester: str) -> str | None:
    env = {'panshi-forum': 'PROFILE_HUB_FORUM_SECRET', 'panshi-camp': 'PROFILE_HUB_CAMP_SECRET'}.get(requester)
    value = (os.getenv(env) or '').strip() if env else ''
    return value or None


def verify_request(requester: str, raw_body: str, headers: dict, now: int | None = None) -> bool:
    secret = hub_secret_for(requester)
    if not secret:
        return False
    version = headers.get('x-tashan-hub-version')
    timestamp = headers.get('x-tashan-timestamp')
    nonce = headers.get('x-tashan-nonce')
    signature = headers.get('x-tashan-hub-signature')
    if version != '1' or not timestamp or not nonce or not signature:
        return False
    if not re.fullmatch(r'[0-9]{1,12}', timestamp) or not re.fullmatch(r'[a-f0-9]{16,64}', nonce):
        return False
    if abs((now or _now()) - int(timestamp)) > CLOCK_SKEW:
        return False
    expected = 'v1=' + hmac.new(secret.encode(), f'{timestamp}.{nonce}.{raw_body}'.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def sign_request(secret: str, raw_body: str, timestamp: str | None = None, nonce: str | None = None) -> dict:
    """Used by tests and the importer to build a signed request."""
    timestamp = timestamp or str(_now())
    nonce = nonce or secrets.token_hex(16)
    signature = 'v1=' + hmac.new(secret.encode(), f'{timestamp}.{nonce}.{raw_body}'.encode(), hashlib.sha256).hexdigest()
    return {'X-Tashan-Hub-Version': '1', 'X-Tashan-Timestamp': timestamp,
            'X-Tashan-Nonce': nonce, 'X-Tashan-Hub-Signature': signature}


def source_allowed(url: str) -> bool:
    """Only HTTPS endpoints (or an explicit loopback switch for local evidence)."""
    try:
        parsed = urlsplit(url)
    except ValueError:
        return False
    if parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.password:
        return True
    return (os.getenv('PROFILE_HUB_ALLOW_LOOPBACK_HTTP') == '1' and parsed.scheme == 'http'
            and parsed.hostname in {'127.0.0.1', 'localhost', '::1'})
