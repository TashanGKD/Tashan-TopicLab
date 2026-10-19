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
from datetime import datetime, timezone
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
SOURCE_SYSTEMS = ('tashan-association', 'tashan-world', 'tashan-community', 'panshi-camp', 'panshi-forum')
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
    # Additive migration: retain the first implementation's tables for rollback.
    # Historical candidates must not depend on owning a central login account.
    for statement in [
        '''CREATE TABLE IF NOT EXISTS profile_hub_source_people (
          source_system VARCHAR(32) NOT NULL, source_user_id VARCHAR(256) NOT NULL,
          phone VARCHAR(20), phone_verified BOOLEAN, central_user_id INTEGER REFERENCES users(id),
          source_updated_at VARCHAR(40), imported_at BIGINT NOT NULL, batch_id VARCHAR(32) NOT NULL,
          PRIMARY KEY(source_system,source_user_id))''',
        '''CREATE TABLE IF NOT EXISTS profile_hub_candidates (
          id VARCHAR(32) PRIMARY KEY, user_id INTEGER REFERENCES users(id), phone VARCHAR(20),
          phone_verified BOOLEAN, source_system VARCHAR(32) NOT NULL,
          source_user_id VARCHAR(256) NOT NULL, field VARCHAR(32) NOT NULL,
          value TEXT NOT NULL, value_hash VARCHAR(64) NOT NULL,
          source_updated_at VARCHAR(40), field_note VARCHAR(32), imported_at BIGINT NOT NULL,
          batch_id VARCHAR(32) NOT NULL,
          UNIQUE(source_system, source_user_id, field, value_hash))''',
        '''CREATE TABLE IF NOT EXISTS profile_hub_external_profiles (
          id VARCHAR(32) PRIMARY KEY, phone VARCHAR(20) NOT NULL UNIQUE,
          version INTEGER NOT NULL DEFAULT 1, real_name TEXT, organization TEXT,
          major TEXT, research_direction TEXT)''',
        '''CREATE TABLE IF NOT EXISTS profile_hub_confirmations (
          owner_key VARCHAR(64) NOT NULL, idempotency_key VARCHAR(128) NOT NULL,
          request_hash VARCHAR(64) NOT NULL, applied_version INTEGER NOT NULL,
          response_json TEXT NOT NULL, created_at BIGINT NOT NULL,
          PRIMARY KEY(owner_key,idempotency_key))''',
        '''CREATE TABLE IF NOT EXISTS profile_hub_provenance (
          owner_key VARCHAR(64) NOT NULL, field VARCHAR(32) NOT NULL,
          source VARCHAR(32) NOT NULL, source_updated_at VARCHAR(40),
          candidate_id VARCHAR(32), adopted_at BIGINT NOT NULL,
          PRIMARY KEY(owner_key,field))''',
        'CREATE INDEX IF NOT EXISTS idx_hub_candidates_phone ON profile_hub_candidates(phone,field)',
        '''INSERT INTO profile_hub_candidates
          (id,user_id,phone,source_system,source_user_id,field,value,value_hash,
           source_updated_at,field_note,imported_at,batch_id)
          SELECT c.id,c.user_id,u.phone,c.source_system,c.source_user_id,c.field,c.value,c.value_hash,
           c.source_updated_at,c.field_note,c.imported_at,c.batch_id
          FROM profile_source_candidates c JOIN users u ON u.id=c.user_id WHERE true
          ON CONFLICT DO NOTHING''',
        '''INSERT INTO profile_hub_provenance(owner_key,field,source,source_updated_at,adopted_at)
          SELECT 'central:' || CAST(user_id AS TEXT),field,source,source_updated_at,adopted_at
          FROM profile_field_sources WHERE true ON CONFLICT DO NOTHING''',
    ]:
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


def upsert_candidate(session, *, user_id: int | None, source_system: str, source_user_id: str, field: str,
                     value: str, source_updated_at: str | None, batch_id: str,
                     field_note: str | None = None, phone: str | None = None,
                     phone_verified: bool | None = None) -> bool:
    """Insert one candidate; returns False when the same value already exists (idempotent)."""
    if field not in CANDIDATE_FIELDS:
        raise ValueError(f'unsupported field {field}')
    value = (value or '').strip()
    if not value:
        return False
    if not source_user_id or len(source_user_id) > 256:
        raise ValueError('source_user_id is required and must be at most 256 characters')
    if not phone and user_id:
        phone = session.execute(text('SELECT phone FROM users WHERE id=:uid'), {'uid': user_id}).scalar()
    value = value[:FIELD_LIMITS[field]]
    result = session.execute(text('''INSERT INTO profile_hub_candidates
        (id,user_id,phone,phone_verified,source_system,source_user_id,field,value,value_hash,source_updated_at,field_note,imported_at,batch_id)
        VALUES (:id,:uid,:phone,:verified,:source,:source_user,:field,:value,:hash,:updated,:note,:now,:batch)
        ON CONFLICT (source_system,source_user_id,field,value_hash) DO NOTHING'''),
        dict(id=secrets.token_hex(16), uid=user_id, source=source_system, source_user=source_user_id,
             field=field, value=value[:FIELD_LIMITS[field]], hash=digest(value), updated=source_updated_at,
             note=field_note, now=_now(), batch=batch_id, phone=normalize_phone(phone), verified=phone_verified))
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
        FROM profile_hub_candidates WHERE source_system=:source GROUP BY field'''),
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


def _owner(db, phone, create=False):
    # Once an external profile exists it stays stable. A later central registration
    # must not silently merge identities or hide that profile.
    external = db.execute(text('SELECT id FROM profile_hub_external_profiles WHERE phone=:phone'),
                          {'phone': phone}).scalar()
    if external:
        return None, external, 'external:' + external
    uid = db.execute(text('SELECT id FROM users WHERE phone=:phone AND is_guest=false'),
                     {'phone': phone}).scalar()
    if uid:
        return uid, None, 'central:' + str(uid)
    if create:
        db.execute(text('''INSERT INTO profile_hub_external_profiles(id,phone) VALUES (:id,:phone)
            ON CONFLICT(phone) DO NOTHING'''), {'id': secrets.token_hex(16), 'phone': phone})
        external = db.execute(text('SELECT id FROM profile_hub_external_profiles WHERE phone=:phone'),
                              {'phone': phone}).scalar_one()
        return None, external, 'external:' + external
    return None, None, None


def _profile(db, uid, external, owner_key):
    if uid:
        result = _confirmed(db, uid)
    elif external:
        row = db.execute(text('SELECT * FROM profile_hub_external_profiles WHERE id=:id'),
                         {'id': external}).mappings().one()
        result = {'version': row['version'], 'fields': {f: row[f] for f in PROFILE_FIELDS}, 'sources': {}}
    else:
        return None
    rows = db.execute(text('''SELECT field,source,source_updated_at,candidate_id,adopted_at
        FROM profile_hub_provenance WHERE owner_key=:owner'''), {'owner': owner_key}).mappings()
    result['sources'].update({r['field']: dict(r) for r in rows})
    return result


def _candidates(db, phone):
    # Explicitly unverified source numbers remain in the private inventory, but
    # are not disclosed to a phone holder. Unknown status remains visibly unknown.
    return [dict(r) for r in db.execute(text('''SELECT id,source_system,source_user_id,field,value,
        source_updated_at,field_note,imported_at,phone_verified FROM profile_hub_candidates
        WHERE phone=:phone AND (phone_verified IS NULL OR phone_verified=true)
        ORDER BY field,source_updated_at DESC NULLS LAST,imported_at DESC'''), {'phone': phone}).mappings()]


def lookup_by_phone(phone_value, requester: str) -> dict:
    phone = normalize_phone(phone_value)
    phone_hash = digest(phone) if phone else None
    if not phone:
        raise HTTPException(422, '手机号格式不正确')
    with get_db_session() as db:
        uid, external, key = _owner(db, phone)
        confirmed = _profile(db, uid, external, key)
        candidates = _candidates(db, phone)
        found = bool(confirmed or candidates)
        _event(db, user_id=uid, requester=requester, action='lookup',
               result='found' if found else 'not_found', phone_hash=phone_hash)
    return {'found': found, 'confirmed': confirmed, 'candidates': candidates}


SOURCE_PRIORITY = {source: index for index, source in enumerate(
    ['tashan-association', 'tashan-world', 'tashan-community', 'panshi-camp', 'panshi-forum'])}


def latest_fields(current, candidates):
    """Choose each nonempty field by source time, never by import time."""
    options = list(candidates)
    for field, value in (current or {}).get('fields', {}).items():
        if isinstance(value, str) and value.strip():
            provenance = (current or {}).get('sources', {}).get(field) or {}
            options.append({'field': field, 'value': value, 'source_system': provenance.get('source', 'tashan-world'),
                            'source_updated_at': provenance.get('source_updated_at'), 'id': provenance.get('candidate_id')})
    def rank(item):
        try:
            stamp = datetime.fromisoformat(str(item.get('source_updated_at')).replace('Z', '+00:00'))
            if stamp.tzinfo is None:
                stamp = stamp.replace(tzinfo=timezone.utc)
            timestamp = stamp.timestamp()
        except (ValueError, TypeError, OverflowError):
            timestamp = float('-inf')
        return (timestamp, SOURCE_PRIORITY.get(item.get('source_system'), -1),
                item.get('field_note') != 'combined_field', str(item.get('id') or ''), item.get('value', ''))
    result = {}
    for item in options:
        field, value = item.get('field'), item.get('value')
        if field not in PROFILE_FIELDS or not isinstance(value, str) or not value.strip():
            continue
        if field not in result or rank(item) > rank(result[field]):
            result[field] = {**item, 'value': value.strip()}
    return result


def sync_by_identity(phone_value, requester, body):
    """Trusted login identity -> latest profile, with optional successful registration writeback."""
    phone = normalize_phone(phone_value)
    if not phone:
        raise HTTPException(422, '手机号格式不正确')
    subject = body.get('subject')
    if subject is not None and (not isinstance(subject, str) or not re.fullmatch(r'topiclab:[1-9][0-9]*', subject)):
        raise HTTPException(422, '账号标识无效')
    changes = _clean_changes(body['changes']) if body.get('changes') else {}
    event_id = body.get('event_id')
    if changes and (not isinstance(event_id, str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{8,128}', event_id)):
        raise HTTPException(422, '同步记录标识无效')
    stamp = body.get('source_updated_at')
    if changes:
        try:
            parsed = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
            if parsed.tzinfo is None or parsed.timestamp() > time.time() + 300:
                raise ValueError()
        except (AttributeError, TypeError, ValueError):
            raise HTTPException(422, '同步记录时间无效')
    with get_db_session() as db:
        if db.bind.dialect.name == 'postgresql':
            db.execute(text('SELECT pg_advisory_xact_lock(:key)'),
                       {'key': int.from_bytes(hashlib.sha256(phone.encode()).digest()[:8], 'big', signed=True)})
        if subject:
            uid = int(subject.split(':')[1])
            user = db.execute(text('SELECT phone FROM users WHERE id=:uid AND is_guest=false'), {'uid': uid}).first()
            if not user or normalize_phone(user.phone) != phone:
                raise HTTPException(403, '账号与手机号不匹配')
            external, owner_key = None, 'central:' + str(uid)
        else:
            uid, external, owner_key = _owner(db, phone)
        current = _profile(db, uid, external, owner_key)
        if changes:
            for field, value in changes.items():
                upsert_candidate(db, user_id=uid, source_system=requester, source_user_id=event_id,
                                 field=field, value=value, source_updated_at=stamp, batch_id=digest(event_id)[:32],
                                 phone=phone, phone_verified=True)
        latest = latest_fields(current, _candidates(db, phone))
        if not latest:
            return {'found': False, 'profile': {}, 'version': (current or {}).get('version', 1)}
        if not owner_key:
            uid, external, owner_key = _owner(db, phone, create=True)
        if uid:
            db.execute(text('INSERT INTO user_profiles(user_id) VALUES (:uid) ON CONFLICT(user_id) DO NOTHING'), {'uid': uid})
        table, column, identifier = ('user_profiles', 'user_id', uid) if uid else ('profile_hub_external_profiles', 'id', external)
        values = {field: item['value'] for field, item in latest.items()}
        changed = {field: value for field, value in values.items() if (current or {}).get('fields', {}).get(field) != value}
        if changed:
            assignments = ','.join(field + '=:' + field for field in changed)
            db.execute(text(f'UPDATE {table} SET {assignments},version=version+1 WHERE {column}=:identifier'),
                       {'identifier': identifier, **changed})
        for field, item in latest.items():
            db.execute(text('''INSERT INTO profile_hub_provenance(owner_key,field,source,source_updated_at,candidate_id,adopted_at)
                VALUES (:owner,:field,:source,:at,:candidate,:now)
                ON CONFLICT(owner_key,field) DO UPDATE SET source=:source,source_updated_at=:at,candidate_id=:candidate'''),
                {'owner': owner_key, 'field': field, 'source': item['source_system'], 'at': item.get('source_updated_at'),
                 'candidate': item.get('id'), 'now': _now()})
        profile = _profile(db, uid, external, owner_key)
        _event(db, user_id=uid, requester=requester, action='sync', result='saved' if changed else 'unchanged',
               fields=changed, phone_hash=digest(phone))
        return {'found': True, 'profile': values, 'version': profile['version']}


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
    # Failures must be audited after the failed transaction has rolled back.
    try:
        return _confirm_by_phone(phone_value, requester, body)
    except HTTPException as exc:
        phone = normalize_phone(phone_value)
        with get_db_session() as db:
            uid, _, _ = _owner(db, phone) if phone else (None, None, None)
            _event(db, user_id=uid, requester=requester, action='confirm',
                   result={409: 'conflict', 422: 'invalid'}.get(exc.status_code, 'failed'),
                   fields=[f for f in (body.get('changes') or {}) if f in PROFILE_FIELDS]
                   if isinstance(body.get('changes'), dict) else [],
                   phone_hash=digest(phone) if phone else None)
        raise


def _confirm_by_phone(phone_value, requester: str, body: dict) -> dict:
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
    adoptions = body.get('adoptions', {})
    if not isinstance(adoptions, dict) or any(f not in changes or not isinstance(v, str) for f, v in adoptions.items()):
        raise HTTPException(422, '来源选择无效')
    request_hash = digest(json.dumps({'version': expected, 'changes': changes, 'adoptions': adoptions},
                                     sort_keys=True, ensure_ascii=False))
    now = _now()
    with get_db_session() as db:
        # Serialize confirmations for a phone in PostgreSQL, including first save.
        if db.bind.dialect.name == 'postgresql':
            db.execute(text('SELECT pg_advisory_xact_lock(:key)'),
                       {'key': int.from_bytes(hashlib.sha256(phone.encode()).digest()[:8], 'big', signed=True)})
        uid, external, owner_key = _owner(db, phone, create=True)
        previous = _profile(db, uid, external, owner_key)
        prior = db.execute(text('''SELECT request_hash,response_json FROM profile_hub_confirmations
            WHERE owner_key=:owner AND idempotency_key=:key'''), {'owner': owner_key, 'key': key}).mappings().first()
        if prior:
            if prior['request_hash'] != request_hash:
                raise HTTPException(409, 'IDEMPOTENCY_CONFLICT')
            return {**json.loads(prior['response_json']), 'replay': True}
        available = {c['id']: c for c in _candidates(db, phone)}
        for field, candidate_id in adoptions.items():
            candidate = available.get(candidate_id)
            if not candidate or candidate['field'] != field or candidate['value'] != changes[field]:
                raise HTTPException(422, '来源资料已变化，请重新选择')
        if uid:
            db.execute(text('INSERT INTO user_profiles(user_id) VALUES (:uid) ON CONFLICT(user_id) DO NOTHING'), {'uid': uid})
        table, id_column, identifier = ('user_profiles', 'user_id', uid) if uid else ('profile_hub_external_profiles', 'id', external)
        assignments = ''.join(', ' + field + '=:' + field for field in changes)
        applied = db.execute(text(f'UPDATE {table} SET version=version+1' + assignments +
                                  f' WHERE {id_column}=:identifier AND version=:expected RETURNING version'),
                             dict(identifier=identifier, expected=expected, **changes)).scalar()
        if applied is None:
            raise HTTPException(409, 'VERSION_CONFLICT')
        for field in changes:
            candidate = available.get(adoptions.get(field))
            if not candidate and previous and previous['fields'].get(field) == changes[field] and field in previous['sources']:
                continue
            db.execute(text('''INSERT INTO profile_hub_provenance
                (owner_key,field,source,source_updated_at,candidate_id,adopted_at)
                VALUES (:owner,:field,:source,:at,:candidate,:now)
                ON CONFLICT(owner_key,field) DO UPDATE SET source=:source,source_updated_at=:at,
                candidate_id=:candidate,adopted_at=:now'''),
                dict(owner=owner_key, field=field, source=candidate['source_system'] if candidate else requester,
                     at=candidate['source_updated_at'] if candidate else time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now)),
                     candidate=candidate['id'] if candidate else None, now=now))
        response = {**_profile(db, uid, external, owner_key), 'replay': False}
        db.execute(text('''INSERT INTO profile_hub_confirmations
            (owner_key,idempotency_key,request_hash,applied_version,response_json,created_at)
            VALUES (:owner,:key,:hash,:version,:response,:now)'''),
            dict(owner=owner_key, key=key, hash=request_hash, version=applied,
                 response=json.dumps(response, ensure_ascii=False), now=now))
        _event(db, user_id=uid, requester=requester, action='confirm', result='saved',
               fields=changes.keys(), phone_hash=phone_hash)
        return response


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
