"""Authorized import of activity-site profile fields into the unified profile.

Only four fields are imported (real name, organization, major, research direction).
Ownership comes from the server-side identity plus the source site's existing
account binding; a phone number is never accepted from the browser and never
used to merge accounts here.
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

import httpx
from fastapi import HTTPException
from sqlalchemy import text, inspect

from app.storage.database.postgres_client import get_db_session

IMPORT_FIELDS = ('real_name', 'organization', 'major', 'research_direction')
FIELD_LABELS = {
    'real_name': '姓名',
    'organization': '单位',
    'major': '专业',
    'research_direction': '研究方向',
}
FIELD_LIMITS = {'real_name': 80, 'organization': 160, 'major': 300, 'research_direction': 2000}
CONSENT_VERSION = 'profile-import-2026-10-v1'
CONSENT_TEXT = (
    '从你在已关联活动中的账号读取姓名、单位、专业和研究方向，用于核对后保存到他山个人资料。'
    '保存后，你授权的接入网站可以在其授权范围内预填这些资料。'
    '本次授权只用于这一次读取和导入，不会在后台持续同步。'
    '来源站点无法访问时，你可以重试或跳过，其他来源和登录不受影响。'
    '取消本次授权将停止后续读取和提交；已确认保存的个人资料和活动原记录不会被删除，'
    '个人资料的修改沿用个人资料页现有能力。'
)
AUTHZ_TTL = 600
PREVIEW_TTL = 600
CLOCK_SKEW = 300

SOURCES = {
    'panshi-camp': {
        'label': '磐石 AI4S 实训营',
        'url_env': 'PROFILE_SOURCE_CAMP_URL',
        'secret_env': 'PROFILE_SOURCE_CAMP_SECRET',
        'activity': '磐石 AI4S 实训营',
    },
    'panshi-forum': {
        'label': '磐石论坛',
        'url_env': 'PROFILE_SOURCE_FORUM_URL',
        'secret_env': 'PROFILE_SOURCE_FORUM_SECRET',
        'activity': '磐石论坛 2026',
    },
}


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def apply_schema(session):
    statements = [
        '''CREATE TABLE IF NOT EXISTS profile_import_authorizations (
          id VARCHAR(32) PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          source VARCHAR(32) NOT NULL, purpose VARCHAR(32) NOT NULL,
          field_scope TEXT NOT NULL, consent_version VARCHAR(64) NOT NULL,
          status VARCHAR(16) NOT NULL, granted_at BIGINT NOT NULL, expires_at BIGINT NOT NULL,
          cancelled_at BIGINT, completed_at BIGINT)''',
        '''CREATE TABLE IF NOT EXISTS profile_import_previews (
          id VARCHAR(32) PRIMARY KEY, authorization_id VARCHAR(32) NOT NULL,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          source VARCHAR(32) NOT NULL, base_version INTEGER NOT NULL, payload TEXT NOT NULL,
          token_hash VARCHAR(64) NOT NULL, created_at BIGINT NOT NULL,
          expires_at BIGINT NOT NULL, consumed_at BIGINT)''',
        '''CREATE TABLE IF NOT EXISTS profile_import_events (
          id VARCHAR(32) PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          source VARCHAR(32) NOT NULL, action VARCHAR(24) NOT NULL, authorization_id VARCHAR(32),
          field_names TEXT NOT NULL DEFAULT '[]', consent_version VARCHAR(64) NOT NULL DEFAULT '',
          result VARCHAR(48) NOT NULL, created_at BIGINT NOT NULL)''',
        '''CREATE TABLE IF NOT EXISTS profile_import_writes (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          idempotency_key VARCHAR(128) NOT NULL, request_hash VARCHAR(64) NOT NULL,
          applied_version INTEGER NOT NULL, created_at BIGINT NOT NULL,
          PRIMARY KEY(user_id, idempotency_key))''',
        '''CREATE TABLE IF NOT EXISTS profile_field_sources (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          field VARCHAR(32) NOT NULL, source VARCHAR(32) NOT NULL,
          source_updated_at VARCHAR(40), adopted_at BIGINT NOT NULL,
          PRIMARY KEY(user_id, field))''',
        'CREATE INDEX IF NOT EXISTS idx_profile_import_authorizations_user ON profile_import_authorizations(user_id, granted_at)',
        'CREATE INDEX IF NOT EXISTS idx_profile_import_previews_user ON profile_import_previews(user_id, created_at)',
    ]
    for statement in statements:
        session.execute(text(statement))


def _now() -> int:
    return int(time.time())


def _event(db, user_id: int, source: str, action: str, result: str, *, authorization_id: str | None = None,
           fields=(), consent_version: str = '') -> None:
    """Audit trail stores field names and outcomes, never the imported values."""
    db.execute(text('''INSERT INTO profile_import_events
        (id,user_id,source,action,authorization_id,field_names,consent_version,result,created_at)
        VALUES (:id,:uid,:source,:action,:authz,:fields,:consent,:result,:now)'''),
        dict(id=secrets.token_hex(16), uid=user_id, source=source, action=action, authz=authorization_id,
             fields=json.dumps(list(fields), ensure_ascii=False), consent=consent_version, result=result, now=_now()))


def _source_config(source: str) -> dict:
    meta = SOURCES.get(source)
    if not meta:
        raise HTTPException(422, '不支持这个来源')
    url = (os.getenv(meta['url_env']) or '').strip().rstrip('/')
    secret = (os.getenv(meta['secret_env']) or '').strip()
    available = False
    if url and secret:
        try:
            parsed = urlsplit(url)
            # HTTPS is required. Loopback HTTP is allowed only with an explicit local-evidence switch.
            loopback = os.getenv('PROFILE_SOURCE_ALLOW_LOOPBACK_HTTP') == '1' and parsed.hostname in {'127.0.0.1', 'localhost', '::1'}
            available = (parsed.scheme == 'https' or (parsed.scheme == 'http' and loopback)) \
                and bool(parsed.hostname) and not parsed.username and not parsed.password
        except ValueError:
            available = False
    return {'source': source, 'label': meta['label'], 'activity': meta['activity'],
            'url': url, 'secret': secret, 'available': available}


def list_sources() -> dict:
    return {
        'sources': [{k: cfg[k] for k in ('source', 'label', 'activity', 'available')}
                    for cfg in (_source_config(name) for name in SOURCES)],
        'consent': {'version': CONSENT_VERSION, 'text': CONSENT_TEXT},
        'fields': [{'field': f, 'label': FIELD_LABELS[f]} for f in IMPORT_FIELDS],
    }


def _profile_row(db, user_id: int):
    return db.execute(text('''SELECT COALESCE(up.version,1) AS version, up.real_name, up.organization,
        up.major, up.research_direction, u.is_guest
        FROM users u LEFT JOIN user_profiles up ON up.user_id=u.id WHERE u.id=:uid'''),
        {'uid': user_id}).mappings().first()


def _current_profile(db, user_id: int) -> dict:
    row = _profile_row(db, user_id)
    if not row or row['is_guest']:
        raise HTTPException(403, '请使用正式账号登录')
    return {'version': row['version'], **{f: row[f] for f in IMPORT_FIELDS}}


def current_profile(user_id: int) -> dict:
    """Current unified values for the four importable fields, with field provenance."""
    with get_db_session() as db:
        profile = _current_profile(db, user_id)
        stamps = db.execute(text('''SELECT field,source,source_updated_at,adopted_at FROM profile_field_sources
            WHERE user_id=:uid'''), {'uid': user_id}).mappings()
        sources = {row['field']: dict(row) for row in stamps}
    return {'profile': profile,
            'fields': [{'field': f, 'label': FIELD_LABELS[f], 'value': profile[f],
                        'source': sources.get(f, {}).get('source'),
                        'source_label': ('本人填写' if sources.get(f, {}).get('source') == 'user'
                                         else SOURCES.get(sources.get(f, {}).get('source', ''), {}).get('label')),
                        'source_updated_at': sources.get(f, {}).get('source_updated_at'),
                        'adopted_at': sources.get(f, {}).get('adopted_at')} for f in IMPORT_FIELDS]}


def create_authorization(user_id: int, source: str) -> dict:
    cfg = _source_config(source)
    if not cfg['available']:
        raise HTTPException(503, '这个来源暂时不可用，可以稍后重试或跳过')
    now = _now()
    authz_id = secrets.token_hex(16)
    with get_db_session() as db:
        if not db.execute(text('SELECT 1 FROM users WHERE id=:uid AND is_guest=false'), {'uid': user_id}).first():
            raise HTTPException(403, '请使用正式账号登录')
        db.execute(text('''INSERT INTO profile_import_authorizations
            (id,user_id,source,purpose,field_scope,consent_version,status,granted_at,expires_at)
            VALUES (:id,:uid,:source,'profile_import',:scope,:consent,'granted',:now,:expires)'''),
            dict(id=authz_id, uid=user_id, source=source,
                 scope=json.dumps(list(IMPORT_FIELDS)), consent=CONSENT_VERSION,
                 now=now, expires=now + AUTHZ_TTL))
        _event(db, user_id, source, 'authorize', 'granted', authorization_id=authz_id,
               fields=IMPORT_FIELDS, consent_version=CONSENT_VERSION)
    return {'authorization_id': authz_id, 'source': source, 'field_scope': list(IMPORT_FIELDS),
            'consent_version': CONSENT_VERSION, 'expires_at': now + AUTHZ_TTL}


def cancel_authorization(user_id: int, authorization_id: str) -> dict:
    now = _now()
    with get_db_session() as db:
        row = db.execute(text('''SELECT * FROM profile_import_authorizations
            WHERE id=:id AND user_id=:uid'''), {'id': authorization_id, 'uid': user_id}).mappings().first()
        if not row:
            raise HTTPException(404, '授权记录不存在')
        if row['status'] == 'completed':
            raise HTTPException(409, '这次导入已经保存，不能取消')
        if row['status'] == 'granted':
            db.execute(text('''UPDATE profile_import_authorizations SET status='cancelled',cancelled_at=:now
                WHERE id=:id AND user_id=:uid AND status='granted' '''), {'id': authorization_id, 'uid': user_id, 'now': now})
            _event(db, user_id, row['source'], 'cancel', 'cancelled', authorization_id=authorization_id,
                   consent_version=row['consent_version'])
        return {'authorization_id': authorization_id, 'status': 'cancelled', 'cancelled_at': now}


def _signed_headers(secret: str, body: str) -> dict:
    ts = str(_now())
    nonce = secrets.token_hex(16)
    signature = hmac.new(secret.encode(), f'{ts}.{nonce}.{body}'.encode(), hashlib.sha256).hexdigest()
    return {
        'Content-Type': 'application/json',
        'X-Tashan-Connector-Version': '1',
        'X-Tashan-Timestamp': ts,
        'X-Tashan-Nonce': nonce,
        'X-Tashan-Signature': f'v1={signature}',
    }


def _post_candidates(cfg: dict, subject: str) -> dict:
    body = json.dumps({'subject': subject, 'purpose': 'profile_import', 'fields': list(IMPORT_FIELDS)},
                      ensure_ascii=False, separators=(',', ':'))
    try:
        with httpx.Client(timeout=8.0, follow_redirects=False) as client:
            response = client.post(cfg['url'], content=body, headers=_signed_headers(cfg['secret'], body))
    except httpx.HTTPError:
        raise HTTPException(503, '来源站点暂时无法访问，可以重试或跳过')
    if response.status_code >= 400:
        raise HTTPException(503, '来源站点暂时无法访问，可以重试或跳过')
    try:
        return response.json()
    except ValueError:
        raise HTTPException(503, '来源站点返回了无法识别的数据，可以重试或跳过')


def _normalize_source_fields(payload: dict) -> tuple[dict, dict]:
    raw = payload.get('fields') if isinstance(payload.get('fields'), dict) else {}
    values, stamps = {}, {}
    for field in IMPORT_FIELDS:
        item = raw.get(field)
        if isinstance(item, dict):
            value = item.get('value')
            updated = item.get('updated_at')
            note = item.get('note')
        elif isinstance(item, str):
            value, updated, note = item, None, None
        else:
            value, updated, note = None, None, None
        value = value.strip() if isinstance(value, str) else ''
        if len(value) > FIELD_LIMITS[field]:
            value = value[:FIELD_LIMITS[field]]
        values[field] = value or None
        stamps[field] = {'updated_at': updated if isinstance(updated, str) and len(updated) <= 40 else None,
                         'note': note if isinstance(note, str) and len(note) <= 40 else None}
    return values, stamps


def create_preview(user_id: int, authorization_id: str) -> dict:
    now = _now()
    with get_db_session() as db:
        authz = db.execute(text('''SELECT * FROM profile_import_authorizations
            WHERE id=:id AND user_id=:uid'''), {'id': authorization_id, 'uid': user_id}).mappings().first()
        if not authz:
            raise HTTPException(404, '授权记录不存在')
        if authz['status'] == 'cancelled':
            raise HTTPException(409, '这次授权已取消，请重新授权')
        if authz['status'] == 'completed':
            raise HTTPException(409, '这次授权已经使用完成，请重新授权')
        if authz['expires_at'] <= now:
            db.execute(text("UPDATE profile_import_authorizations SET status='expired' WHERE id=:id"), {'id': authorization_id})
            raise HTTPException(409, '这次授权已过期，请重新授权')
        current = _current_profile(db, user_id)
        cfg = _source_config(authz['source'])
        if not cfg['available']:
            _event(db, user_id, authz['source'], 'preview', 'source_unavailable', authorization_id=authorization_id,
                   consent_version=authz['consent_version'])
            raise HTTPException(503, '这个来源暂时不可用，可以稍后重试或跳过')
        payload = _post_candidates(cfg, f'topiclab:{user_id}')
        _event(db, user_id, authz['source'], 'preview', 'ok', authorization_id=authorization_id,
               consent_version=authz['consent_version'])
    if payload.get('bound') is not True:
        return {'bound': False, 'source': authz['source'], 'label': cfg['label'],
                'message': '这个来源还没有关联你的他山账号，请先在该网站用原账号登录并关联'}
    values, stamps = _normalize_source_fields(payload)
    fields = []
    for field in IMPORT_FIELDS:
        fields.append({
            'field': field,
            'label': FIELD_LABELS[field],
            'current': current[field],
            'source_value': values[field],
            'source_updated_at': stamps[field]['updated_at'],
            'note': stamps[field]['note'],
        })
    token = secrets.token_urlsafe(32)
    preview_id = secrets.token_hex(16)
    expires = now + PREVIEW_TTL
    record = {'source': authz['source'], 'label': cfg['label'],
              'activity': (payload.get('activity') or {}).get('name') or cfg['activity'],
              'fields': fields, 'base_version': current['version'], 'consent_version': authz['consent_version']}
    with get_db_session() as db:
        db.execute(text('''INSERT INTO profile_import_previews
            (id,authorization_id,user_id,source,base_version,payload,token_hash,created_at,expires_at)
            VALUES (:id,:authz,:uid,:source,:base,:payload,:hash,:now,:expires)'''),
            dict(id=preview_id, authz=authorization_id, uid=user_id, source=authz['source'],
                 base=current['version'], payload=json.dumps(record, ensure_ascii=False),
                 hash=digest(token), now=now, expires=expires))
    return {'bound': True, 'preview_id': preview_id, 'preview_token': token, 'expires_at': expires,
            'base_version': current['version'], **record}


def _validate_selections(selections) -> dict:
    if not isinstance(selections, dict):
        raise HTTPException(422, '请选择要保存的资料')
    cleaned = {}
    for field, value in selections.items():
        if field not in IMPORT_FIELDS:
            raise HTTPException(422, '不支持的资料字段')
        if not isinstance(value, str):
            raise HTTPException(422, '资料内容格式不正确')
        value = value.strip()
        if not value:
            continue
        if len(value) > FIELD_LIMITS[field]:
            raise HTTPException(422, '部分资料超出个人资料字段长度限制')
        cleaned[field] = value
    if not cleaned:
        raise HTTPException(422, '没有可保存的内容')
    return cleaned


def commit_import(user_id: int, body: dict) -> dict:
    preview_id = body.get('preview_id')
    token = body.get('preview_token')
    expected_version = body.get('expected_version')
    idempotency_key = body.get('idempotency_key')
    origin = body.get('origin') if isinstance(body.get('origin'), dict) else {}
    if not isinstance(preview_id, str) or not re.fullmatch(r'[a-f0-9]{32}', preview_id):
        raise HTTPException(422, '预览无效，请重新核对')
    if not isinstance(token, str) or len(token) < 32:
        raise HTTPException(422, '预览无效，请重新核对')
    if not isinstance(expected_version, int) or isinstance(expected_version, bool) or expected_version < 1:
        raise HTTPException(422, '资料版本无效，请重新核对')
    if not isinstance(idempotency_key, str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{8,128}', idempotency_key):
        raise HTTPException(422, '请求标识无效')
    selections = _validate_selections(body.get('selections'))
    request_hash = digest(json.dumps({'preview': preview_id, 'version': expected_version,
                                      'selections': selections}, sort_keys=True, ensure_ascii=False))
    now = _now()
    with get_db_session() as db:
        prior = db.execute(text('''SELECT request_hash,applied_version FROM profile_import_writes
            WHERE user_id=:uid AND idempotency_key=:key'''), {'uid': user_id, 'key': idempotency_key}).mappings().first()
        if prior:
            if prior['request_hash'] != request_hash:
                raise HTTPException(409, 'IDEMPOTENCY_CONFLICT')
            return {'profile': _current_profile(db, user_id), 'applied_version': prior['applied_version'],
                    'idempotent_replay': True, 'imported': []}
        preview = db.execute(text('''SELECT * FROM profile_import_previews
            WHERE id=:id AND user_id=:uid'''), {'id': preview_id, 'uid': user_id}).mappings().first()
        if not preview or not hmac.compare_digest(preview['token_hash'], digest(token)):
            raise HTTPException(404, '预览不存在，请重新核对')
        if preview['consumed_at']:
            raise HTTPException(409, '这次预览已经保存过，请重新核对')
        if preview['expires_at'] <= now:
            raise HTTPException(409, '预览已过期，请重新核对')
        authz = db.execute(text('''SELECT * FROM profile_import_authorizations
            WHERE id=:id AND user_id=:uid'''), {'id': preview['authorization_id'], 'uid': user_id}).mappings().first()
        if not authz or authz['status'] != 'granted' or authz['expires_at'] <= now:
            raise HTTPException(409, '这次授权已失效，请重新授权')
        record = json.loads(preview['payload'])
        # Rebuild the version guard from the live row so concurrent writes cannot slip through.
        db.execute(text('INSERT INTO user_profiles(user_id) VALUES (:uid) ON CONFLICT(user_id) DO NOTHING'), {'uid': user_id})
        current = _current_profile(db, user_id)
        if current['version'] != expected_version:
            raise HTTPException(409, 'VERSION_CONFLICT')
        if current['version'] != record['base_version']:
            raise HTTPException(409, 'VERSION_CONFLICT')
        # Empty values never overwrite an existing value.
        updates = {f: v for f, v in selections.items() if v}
        assignments = ''.join(', ' + field + '=:' + field for field in updates)
        applied = db.execute(text('UPDATE user_profiles SET version=version+1' + assignments +
                                  ' WHERE user_id=:uid AND version=:expected RETURNING version'),
                             dict(uid=user_id, expected=expected_version, **updates)).scalar()
        if applied is None:
            raise HTTPException(409, 'VERSION_CONFLICT')
        imported = []
        for field in updates:
            source_value = origin.get(field)
            from_source = isinstance(source_value, str) and source_value == 'source'
            stamp = None
            if from_source:
                for item in record['fields']:
                    if item['field'] == field:
                        stamp = item['source_updated_at']
                        break
            db.execute(text('''INSERT INTO profile_field_sources(user_id,field,source,source_updated_at,adopted_at)
                VALUES (:uid,:field,:source,:stamp,:now)
                ON CONFLICT(user_id,field) DO UPDATE SET source=:source,source_updated_at=:stamp,adopted_at=:now'''),
                dict(uid=user_id, field=field, source=record['source'] if from_source else 'user',
                     stamp=stamp if from_source else None, now=now))
            imported.append({'field': field, 'from_source': from_source,
                             'source': record['source'] if from_source else 'user',
                             'source_updated_at': stamp if from_source else None})
        db.execute(text('UPDATE profile_import_previews SET consumed_at=:now WHERE id=:id'), {'id': preview_id, 'now': now})
        db.execute(text('''UPDATE profile_import_authorizations SET status='completed',completed_at=:now
            WHERE id=:id AND user_id=:uid'''), {'id': authz['id'], 'uid': user_id, 'now': now})
        db.execute(text('''INSERT INTO profile_import_writes(user_id,idempotency_key,request_hash,applied_version,created_at)
            VALUES (:uid,:key,:hash,:version,:now)'''),
            dict(uid=user_id, key=idempotency_key, hash=request_hash, version=applied, now=now))
        _event(db, user_id, record['source'], 'commit', 'saved', authorization_id=authz['id'],
               fields=list(updates), consent_version=authz['consent_version'])
        return {'profile': _current_profile(db, user_id), 'applied_version': applied,
                'idempotent_replay': False, 'imported': imported}


def history(user_id: int, limit: int = 20) -> dict:
    with get_db_session() as db:
        rows = db.execute(text('''SELECT id,source,status,consent_version,granted_at,expires_at,
            cancelled_at,completed_at,field_scope FROM profile_import_authorizations
            WHERE user_id=:uid ORDER BY granted_at DESC LIMIT :limit'''),
            {'uid': user_id, 'limit': max(1, min(limit, 50))}).mappings()
        items = []
        for row in rows:
            stamps = db.execute(text('''SELECT field,source,source_updated_at FROM profile_field_sources
                WHERE user_id=:uid'''), {'uid': user_id}).mappings()
            items.append({
                'authorization_id': row['id'], 'source': row['source'],
                'label': SOURCES.get(row['source'], {}).get('label', row['source']),
                'status': row['status'], 'consent_version': row['consent_version'],
                'field_scope': json.loads(row['field_scope'] or '[]'),
                'field_scope_labels': [FIELD_LABELS.get(f, f) for f in json.loads(row['field_scope'] or '[]')],
                'granted_at': row['granted_at'], 'expires_at': row['expires_at'],
                'cancelled_at': row['cancelled_at'], 'completed_at': row['completed_at'],
                'adopted_fields': [{'field': s['field'], 'label': FIELD_LABELS.get(s['field'], s['field']),
                                    'source': s['source'],
                                    'source_label': ('本人填写' if s['source'] == 'user'
                                                     else SOURCES.get(s['source'], {}).get('label', s['source'])),
                                    'source_updated_at': s['source_updated_at']} for s in stamps],
            })
        return {'items': items, 'sources': list_sources()['sources']}
