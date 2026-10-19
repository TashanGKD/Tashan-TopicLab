"""Database-backed first-party SSO. No extra service, cache, or signing key."""
from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import json
import re
import secrets
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit

from fastapi import HTTPException
from sqlalchemy import text, inspect
from sqlalchemy.exc import IntegrityError

from app.storage.database.postgres_client import get_db_session

CODE_TTL = 120
SESSION_TTL = 8 * 3600
RECHECK_SECONDS = 60
EXTENDED_PROFILE_FIELDS = {'department':300,'major_code':80,'major':300,'research_interest':2000,'research_direction':2000,'job_position':300,'identity_description':2000,'personal_introduction':5000,'education_stage':500,'major_research_direction':2000,'postdoc_station':2000,'discipline_field':2000,'supervisor':2000,'professional_title_level':2000,'specific_title':2000}


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def challenge(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')


def apply_schema(session):
    # Epoch timestamps and integer status flags behave identically in SQLite and PostgreSQL.
    if session.bind.dialect.name=='postgresql':
        length=session.execute(text("""SELECT character_maximum_length FROM information_schema.columns
            WHERE table_schema=current_schema() AND table_name='users' AND column_name='username'""")).scalar()
        if length is not None and length<80:
            session.execute(text('ALTER TABLE users ALTER COLUMN username TYPE VARCHAR(80)'))
    statements = [
        '''CREATE TABLE IF NOT EXISTS user_profiles (
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          version INTEGER NOT NULL DEFAULT 1, real_name VARCHAR(80), email VARCHAR(180),
          organization VARCHAR(160), identities TEXT NOT NULL DEFAULT '[]',
          city VARCHAR(80), bio VARCHAR(200), avatar_url TEXT)''',
        '''CREATE TABLE IF NOT EXISTS sso_profile_writes (
          client_id VARCHAR(64) NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          request_key VARCHAR(128) NOT NULL, request_hash VARCHAR(64) NOT NULL,
          applied_version INTEGER NOT NULL, PRIMARY KEY(client_id,user_id,request_key))''',
        '''CREATE TABLE IF NOT EXISTS sso_clients_v2 (
          client_id VARCHAR(64) PRIMARY KEY, name VARCHAR(100) NOT NULL,
          origin TEXT NOT NULL UNIQUE, redirect_uri TEXT NOT NULL,
          secret_hash VARCHAR(64) NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
          version INTEGER NOT NULL DEFAULT 1, created_at BIGINT NOT NULL)''',
        '''CREATE TABLE IF NOT EXISTS sso_user_policy (
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          enabled INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1)''',
        '''CREATE TABLE IF NOT EXISTS sso_codes_v2 (
          code_hash VARCHAR(64) PRIMARY KEY, client_id VARCHAR(64) NOT NULL,
          client_version INTEGER NOT NULL, user_id INTEGER NOT NULL,
          user_version INTEGER NOT NULL, redirect_uri TEXT NOT NULL,
          challenge VARCHAR(43) NOT NULL, expires_at BIGINT NOT NULL, used_at BIGINT)''',
        '''CREATE TABLE IF NOT EXISTS sso_sessions_v2 (
          token_hash VARCHAR(64) PRIMARY KEY, client_id VARCHAR(64) NOT NULL,
          client_version INTEGER NOT NULL, user_id INTEGER NOT NULL,
          user_version INTEGER NOT NULL, expires_at BIGINT NOT NULL)''',
        'CREATE INDEX IF NOT EXISTS idx_sso_v2_code_expiry ON sso_codes_v2(expires_at)',
        'CREATE INDEX IF NOT EXISTS idx_sso_v2_session_expiry ON sso_sessions_v2(expires_at)',
    ]
    for statement in statements:
        session.execute(text(statement))
    existing={column['name'] for column in inspect(session.connection()).get_columns('user_profiles')}
    for name,length in EXTENDED_PROFILE_FIELDS.items():
        if name not in existing:
            session.execute(text(f'ALTER TABLE user_profiles ADD COLUMN {name} VARCHAR({length})'))


def origin(value: str) -> str:
    value = value.strip().rstrip('/')
    try:
        u = urlsplit(value)
        port = u.port
    except ValueError:
        raise HTTPException(400, '网站地址无效')
    if u.scheme != 'https' or not u.hostname or u.username or u.password or u.path or u.query or u.fragment or '*' in value or '\\' in value or any(c.isspace() or ord(c) < 32 for c in value):
        raise HTTPException(400, '请输入 HTTPS 网站地址，例如 https://tools.example.com，不要带页面路径')
    try:
        host = u.hostname.encode('idna').decode().lower()
        if ':' in host:
            host = f'[{ipaddress.IPv6Address(host)}]'
        elif len(host) > 253 or not all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', part) for part in host.split('.')):
            raise ValueError('Invalid hostname')
        if port == 0:
            raise ValueError('Invalid port')
    except (UnicodeError, ValueError):
        raise HTTPException(400, '网站域名或端口无效')
    return f'https://{host}' + (f':{port}' if port and port != 443 else '')


def _public(row) -> dict:
    return {k: row[k] for k in ('client_id', 'name', 'origin', 'redirect_uri', 'enabled', 'version', 'created_at')}


def create_client(name: str, website: str) -> dict:
    website = origin(website)
    secret = secrets.token_urlsafe(32)
    data = dict(client_id='site-' + secrets.token_hex(12), name=name.strip(), origin=website,
                redirect_uri=website + '/auth/callback', secret_hash=digest(secret), created_at=int(time.time()))
    if not data['name']:
        raise HTTPException(400, '请填写网站名称')
    try:
        with get_db_session() as db:
            db.execute(text('''INSERT INTO sso_clients_v2 (client_id,name,origin,redirect_uri,secret_hash,created_at)
                VALUES (:client_id,:name,:origin,:redirect_uri,:secret_hash,:created_at)'''), data)
    except IntegrityError:
        raise HTTPException(409, '这个网站已接入，请在列表中管理；若配置丢失，可重新生成配置')
    return {**{k: v for k, v in data.items() if k != 'secret_hash'}, 'enabled': 1, 'version': 1,
            'client_secret': secret, 'session_secret': secrets.token_urlsafe(32)}


def list_clients() -> list[dict]:
    with get_db_session() as db:
        return [_public(r) for r in db.execute(text('SELECT * FROM sso_clients_v2 ORDER BY created_at DESC,client_id')).mappings()]


def _client(db, client_id: str, secret: str | None = None):
    row = db.execute(text('SELECT * FROM sso_clients_v2 WHERE client_id=:id'), {'id': client_id}).mappings().first()
    if not row or not row['enabled'] or (secret is not None and not hmac.compare_digest(row['secret_hash'], digest(secret))):
        raise HTTPException(401, '网站未接入、已停用或接入凭据无效')
    return row


def update_client(client_id: str, enabled: bool) -> dict:
    with get_db_session() as db:
        row = db.execute(text('''UPDATE sso_clients_v2 SET enabled=:enabled,version=version+1
          WHERE client_id=:id RETURNING *'''), {'id': client_id, 'enabled': int(enabled)}).mappings().first()
        if not row:
            raise HTTPException(404, '网站不存在')
        return _public(row)


def rotate_client(client_id: str) -> dict:
    secret = secrets.token_urlsafe(32)
    with get_db_session() as db:
        row = db.execute(text('''UPDATE sso_clients_v2 SET secret_hash=:secret,version=version+1
            WHERE client_id=:id RETURNING *'''), {'id': client_id, 'secret': digest(secret)}).mappings().first()
        if not row:
            raise HTTPException(404, '网站不存在')
        return {**_public(row), 'client_secret': secret, 'session_secret': secrets.token_urlsafe(32)}


def _user(db, user_id: int):
    row = db.execute(text('''SELECT u.id,u.username,u.phone,u.is_guest,
        COALESCE(up.version,1) AS profile_version,up.real_name,up.email,up.organization,
        up.identities,up.city,up.bio,up.department,up.major_code,up.major,up.research_interest,up.research_direction,
        up.job_position,up.identity_description,up.personal_introduction,up.education_stage,up.major_research_direction,up.postdoc_station,up.discipline_field,up.supervisor,up.professional_title_level,up.specific_title,up.avatar_url AS profile_avatar_url,
        (SELECT o.avatar_url FROM oauth_accounts o WHERE o.user_id=u.id
         AND o.avatar_url IS NOT NULL AND o.avatar_url<>''
         ORDER BY o.updated_at DESC,o.id DESC LIMIT 1) AS avatar_url,
        COALESCE(p.enabled,1) AS enabled, COALESCE(p.version,1) AS version
        FROM users u LEFT JOIN sso_user_policy p ON p.user_id=u.id
        LEFT JOIN user_profiles up ON up.user_id=u.id WHERE u.id=:id'''), {'id': user_id}).mappings().first()
    if not row or row['is_guest'] or not row['enabled']:
        raise HTTPException(403, '该账号不能使用跨站登录')
    return row


def _identity(row):
    avatar = row.get('profile_avatar_url') or row.get('avatar_url')
    if isinstance(avatar, str):
        try:
            parsed = urlsplit(avatar)
            if (len(avatar)>2048 or parsed.scheme!='https' or not parsed.hostname
                    or parsed.username or parsed.password or any(c.isspace() or c=='\\' for c in avatar)):
                avatar = None
        except ValueError:
            avatar = None
    else:
        avatar = None
    # Display name reuses users.username; identity/role flags are never writable profile fields.
    profile = {key: row.get(key) for key in ('real_name','email','organization','city','bio')}
    profile.update({key:row.get(key) for key in EXTENDED_PROFILE_FIELDS})
    profile.update(display_name=row['username'], avatar_url=avatar,
                   identities=json.loads(row.get('identities') or '[]'), version=row.get('profile_version',1))
    phone=row.get('phone')
    profile['phone']=phone if isinstance(phone,str) and re.fullmatch(r'(?:\+86)?1[0-9]{10}',phone) else None
    return {'user_id': row['id'], 'username': row['username'], 'is_guest': False,
            'avatar_url': avatar, 'profile': profile}


def user_policy(user_id: int, enabled: bool | None = None) -> dict:
    with get_db_session() as db:
        if not db.execute(text('SELECT id FROM users WHERE id=:id'), {'id': user_id}).first():
            raise HTTPException(404, '用户不存在')
        db.execute(text('''INSERT INTO sso_user_policy (user_id) VALUES (:id)
            ON CONFLICT (user_id) DO NOTHING'''), {'id': user_id})
        if enabled is None:
            db.execute(text('UPDATE sso_user_policy SET version=version+1 WHERE user_id=:id'), {'id': user_id})
        else:
            db.execute(text('UPDATE sso_user_policy SET version=version+1,enabled=:enabled WHERE user_id=:id'), {'id': user_id, 'enabled': int(enabled)})
    return {'ok': True, 'recheck_seconds': RECHECK_SECONDS}


def authorize(user_id: int, client_id: str, redirect_uri: str, code_challenge: str) -> dict:
    now = int(time.time())
    with get_db_session() as db:
        c = _client(db, client_id)
        if redirect_uri != c['redirect_uri']:
            raise HTTPException(400, '回调地址不属于该网站')
        u = _user(db, user_id)
        code = secrets.token_urlsafe(32)
        db.execute(text('DELETE FROM sso_codes_v2 WHERE expires_at<:now'), {'now': now})
        db.execute(text('DELETE FROM sso_sessions_v2 WHERE expires_at<:now'), {'now': now})
        db.execute(text('''INSERT INTO sso_codes_v2
          (code_hash,client_id,client_version,user_id,user_version,redirect_uri,challenge,expires_at)
          VALUES (:hash,:cid,:cv,:uid,:uv,:redirect,:challenge,:expires)'''),
          dict(hash=digest(code), cid=client_id, cv=c['version'], uid=user_id, uv=u['version'],
               redirect=redirect_uri, challenge=code_challenge, expires=now+CODE_TTL))
    return {'code': code, 'expires_in': CODE_TTL}


def exchange(client_id: str, client_secret: str, code: str, redirect_uri: str, verifier: str) -> dict:
    now = int(time.time())
    with get_db_session() as db:
        c = _client(db, client_id, client_secret)
        if redirect_uri != c['redirect_uri']:
            raise HTTPException(400, '回调地址不属于该网站')
        # Single conditional write: concurrent requests cannot both redeem a code.
        record = db.execute(text('''UPDATE sso_codes_v2 SET used_at=:now
          WHERE code_hash=:hash AND client_id=:cid AND client_version=:cv
          AND redirect_uri=:redirect AND challenge=:challenge AND used_at IS NULL AND expires_at>:now
          RETURNING user_id,user_version'''), dict(now=now, hash=digest(code), cid=client_id,
              cv=c['version'], redirect=redirect_uri, challenge=challenge(verifier))).mappings().first()
        if not record:
            raise HTTPException(400, '授权码无效、已使用或登录校验不匹配')
        u = _user(db, record['user_id'])
        if u['version'] != record['user_version']:
            raise HTTPException(400, '登录请求已撤销，请重新登录')
        token = secrets.token_urlsafe(32)
        db.execute(text('''INSERT INTO sso_sessions_v2
          (token_hash,client_id,client_version,user_id,user_version,expires_at)
          VALUES (:hash,:cid,:cv,:uid,:uv,:expires)'''), dict(hash=digest(token), cid=client_id,
            cv=c['version'], uid=u['id'], uv=u['version'], expires=now+SESSION_TTL))
    return {'user': _identity(u), 'session_token': token, 'expires_at': now+SESSION_TTL,
            'recheck_seconds': RECHECK_SECONDS}


def _session_user(db, client_id, client_secret, token):
    c = _client(db, client_id, client_secret)
    record = db.execute(text('''SELECT * FROM sso_sessions_v2 WHERE token_hash=:hash
      AND client_id=:cid AND client_version=:cv AND expires_at>:now'''),
      dict(hash=digest(token), cid=client_id, cv=c['version'], now=int(time.time()))).mappings().first()
    if not record:
        raise HTTPException(401, '统一认证会话已失效')
    u = _user(db, record['user_id'])
    if u['version'] != record['user_version']:
        raise HTTPException(401, '统一认证会话已撤销')
    return u, record


def validate_session(client_id: str, client_secret: str, token: str) -> dict:
    with get_db_session() as db:
        # Invalid client credentials still fail closed rather than looking like logout.
        _client(db, client_id, client_secret)
        try:
            u, record = _session_user(db, client_id, client_secret, token)
        except HTTPException:
            return {'active': False}
        return {'active': True, 'user': _identity(u), 'expires_at': record['expires_at']}


def update_profile(client_id, client_secret, token, expected_version, request_key, changes, context_hash='', *, profile_source='tashan-world'):
    from app.services import profile_hub_service as hub

    profile_source = profile_source or 'tashan-world'
    request_hash = digest(json.dumps({'version':expected_version,'changes':changes,'context':context_hash},sort_keys=True,ensure_ascii=False))
    with get_db_session() as db:
        u, record = _session_user(db, client_id, client_secret, token)
        uid = u['id']
        phone = hub.normalize_phone(u.get('phone'))
        if phone and db.bind.dialect.name == 'postgresql':
            db.execute(text('SELECT pg_advisory_xact_lock(:key)'),
                {'key': int.from_bytes(hashlib.sha256(phone.encode()).digest()[:8], 'big', signed=True)})
        db.execute(text('INSERT INTO user_profiles(user_id) VALUES (:uid) ON CONFLICT(user_id) DO NOTHING'),dict(uid=uid))
        # Serialize writes before checking the idempotency key, including simultaneous retries.
        db.execute(text('UPDATE user_profiles SET version=version WHERE user_id=:uid'),dict(uid=uid))
        prior = db.execute(text('''SELECT request_hash,applied_version FROM sso_profile_writes
            WHERE client_id=:cid AND user_id=:uid AND request_key=:key'''),dict(cid=client_id,uid=uid,key=request_key)).mappings().first()
        if prior:
            if prior['request_hash'] != request_hash:
                raise HTTPException(409, 'IDEMPOTENCY_CONFLICT')
            applied = prior['applied_version']
        else:
            # Only explicit allowed fields reach SQL. No phone, role or credential changes.
            allowed = {'real_name','email','organization','identities','city','bio','display_name'} | set(EXTENDED_PROFILE_FIELDS)
            if set(changes)-allowed:
                raise HTTPException(422, '不支持的统一资料字段')
            updates = {key:value for key,value in changes.items() if key!='display_name'}
            if 'identities' in updates: updates['identities']=json.dumps(updates['identities'],ensure_ascii=False)
            assignments = ''.join(', '+key+'=:'+key for key in updates)
            applied = db.execute(text('UPDATE user_profiles SET version=version+1'+assignments+
                ' WHERE user_id=:uid AND version=:expected RETURNING version'),
                dict(uid=uid,expected=expected_version,**updates)).scalar()
            if applied is None: raise HTTPException(409, 'VERSION_CONFLICT')
            if 'display_name' in changes:
                db.execute(text('UPDATE users SET username=:name WHERE id=:uid'),dict(uid=uid,name=changes['display_name']))
            db.execute(text('''INSERT INTO sso_profile_writes(client_id,user_id,request_key,request_hash,applied_version)
                VALUES (:cid,:uid,:key,:hash,:version)'''),dict(cid=client_id,uid=uid,key=request_key,hash=request_hash,version=applied))
            # Every SSO editor shares these profile fields, including the
            # original endpoint. Retries retain the first write's freshness.
            stamp = datetime.fromtimestamp(time.time(), timezone.utc).isoformat()
            event = digest(client_id+':'+str(uid)+':'+request_key)
            for field, value in changes.items():
                if field not in hub.PROFILE_FIELDS or not isinstance(value,str) or not value.strip():
                    continue
                if phone:
                    hub.upsert_candidate(db,user_id=uid,source_system=profile_source,source_user_id=event,
                        field=field,value=value.strip(),source_updated_at=stamp,batch_id=event[:32],phone=phone,phone_verified=True)
                db.execute(text('''INSERT INTO profile_hub_provenance(owner_key,field,source,source_updated_at,adopted_at)
                    VALUES (:owner,:field,:source,:stamp,:now) ON CONFLICT(owner_key,field)
                    DO UPDATE SET source=:source,source_updated_at=:stamp,candidate_id=NULL,adopted_at=:now'''),
                    {'owner':'central:'+str(uid),'field':field,'source':profile_source,'stamp':stamp,'now':int(time.time())})
        return {'active':True,'user':_identity(_user(db,uid)),'expires_at':record['expires_at'],'applied_version':applied}


def revoke_session(client_id: str, client_secret: str, token: str) -> dict:
    with get_db_session() as db:
        _client(db, client_id, client_secret)
        db.execute(text('DELETE FROM sso_sessions_v2 WHERE token_hash=:hash AND client_id=:cid'), {'hash': digest(token), 'cid': client_id})
    return {'ok': True}


def search_users(query: str) -> list[dict]:
    query = query.strip()
    if not query:
        return []
    with get_db_session() as db:
        rows = db.execute(text("""SELECT u.id,u.username,COALESCE(p.enabled,1) AS enabled
          FROM users u LEFT JOIN sso_user_policy p ON u.id=p.user_id
          WHERE u.is_guest=false AND (LOWER(u.username) LIKE :q OR u.phone=:phone OR u.id=:id)
          ORDER BY u.id LIMIT 20"""), dict(q='%'+query.lower()+'%', phone=query, id=int(query) if query.isdigit() and len(query)<10 else -1)).mappings()
        return [dict(row) for row in rows]
