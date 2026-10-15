"""Exercises production routes and SQL with no production database or providers."""
import secrets
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import text
from app.api import sso, auth, admin
from app.services import sso_service as svc
from app.storage.database.postgres_client import init_auth_tables, get_db_session

@pytest.fixture
def setup():
    init_auth_tables()
    with get_db_session() as db:
        uid = db.execute(text('INSERT INTO users (phone,password,username,handle,is_guest) VALUES (:p,:pw,:n,:p,false) RETURNING id'),
                         dict(p=secrets.token_hex(10),pw='test-only',n='SSO test')).scalar_one()
    app = FastAPI()
    app.include_router(sso.router, prefix='/auth')
    app.include_router(sso.admin_router)
    client = TestClient(app)
    headers = {'Authorization':'Bearer '+admin._create_admin_panel_token()}
    c = client.post('/admin/sso/clients', headers=headers,json={'name':'Test','origin':'https://'+secrets.token_hex(6)+'.example'}).json()
    return client, headers, c, uid

def grant(c, uid):
    verifier = secrets.token_urlsafe(32)
    code = svc.authorize(uid,c['client_id'],c['redirect_uri'],svc.challenge(verifier))['code']
    return code, verifier

def redeem(c, code, verifier, **overrides):
    args = dict(client_id=c['client_id'],client_secret=c['client_secret'],code=code,redirect_uri=c['redirect_uri'],verifier=verifier)
    args.update(overrides)
    return svc.exchange(**args)

def test_admin_requires_panel_token_and_redacts_secrets(setup):
    client, h, c, uid = setup
    assert client.get('/admin/sso/clients').status_code in [401,403]
    assert client.get('/admin/sso/clients',headers={'Authorization':'Bearer '+auth.create_jwt_token(uid,'test',is_admin=True)}).status_code == 401
    listed=client.get('/admin/sso/clients',headers=h)
    assert listed.headers['cache-control']=='no-store'
    assert 'secret' not in listed.text
    assert client.post('/admin/sso/clients',headers=h,json={'name':'Duplicate','origin':c['origin']+'/'}).status_code == 409

@pytest.mark.parametrize('address',['http://example.com','https://x.example/path','https://x.example?q=1','https://u:p@x.example','https://*.example','https://x.example\\evil','https://bad host.example'])
def test_invalid_origins(address):
    with pytest.raises(HTTPException): svc.origin(address)

def test_callback_pkce_single_use_and_minimal_identity(setup):
    _,_,c,uid=setup
    other=svc.create_client('Other','https://'+secrets.token_hex(6)+'.example')
    with pytest.raises(HTTPException): svc.authorize(uid,c['client_id'],other['redirect_uri'],svc.challenge('x'*43))
    code,v=grant(c,uid)
    with pytest.raises(HTTPException): redeem(c,code,'y'*43)
    with pytest.raises(HTTPException): redeem(c,code,v,redirect_uri=other['redirect_uri'])
    with pytest.raises(HTTPException): redeem(other,code,v)
    data=redeem(c,code,v)
    assert set(data['user'])=={'user_id','username','is_guest','avatar_url','profile'}
    assert svc.validate_session(c['client_id'],c['client_secret'],data['session_token'])['active']
    with pytest.raises(HTTPException): redeem(c,code,v)
    svc.revoke_session(c['client_id'],c['client_secret'],data['session_token'])
    assert not svc.validate_session(c['client_id'],c['client_secret'],data['session_token'])['active']

def test_api_requires_pkce_and_human_jwt(setup):
    client,h,c,uid=setup
    user={'Authorization':'Bearer '+auth.create_jwt_token(uid,'test')}
    payload=dict(client_id=c['client_id'],redirect_uri=c['redirect_uri'],state='x'*43)
    assert client.post('/auth/sso/authorize',headers=user,json=payload).status_code==422
    payload.update(code_challenge=svc.challenge('a'*43),code_challenge_method='S256')
    assert client.post('/auth/sso/authorize',headers=user,json=payload).status_code==200
    client.app.dependency_overrides[auth.get_current_user]=lambda: {'sub':str(uid),'auth_type':'openclaw'}
    assert client.post('/auth/sso/authorize',headers=user,json=payload).status_code==403

def test_revocations_and_expiry(setup,monkeypatch):
    _,_,c,uid=setup
    code,v=grant(c,uid); data=redeem(c,code,v)
    check=lambda: svc.validate_session(c['client_id'],c['client_secret'],data['session_token'])['active']
    assert check()
    svc.user_policy(uid)
    assert not check()
    code,v=grant(c,uid)
    svc.user_policy(uid,False)
    with pytest.raises(HTTPException): redeem(c,code,v)
    with pytest.raises(HTTPException): grant(c,uid)
    svc.user_policy(uid,True)
    code,v=grant(c,uid); data=redeem(c,code,v)
    rotated=svc.rotate_client(c['client_id'])
    with pytest.raises(HTTPException): check()
    c=rotated
    assert not check()
    code,v=grant(c,uid); data=redeem(c,code,v)
    monkeypatch.setattr(svc.time,'time',lambda:data['expires_at']+1)
    assert not check()

def test_expired_code_and_disabled_client(setup,monkeypatch):
    _,_,c,uid=setup
    code,v=grant(c,uid)
    now=svc.time.time()
    monkeypatch.setattr(svc.time,'time',lambda:now+121)
    with pytest.raises(HTTPException): redeem(c,code,v)
    svc.update_client(c['client_id'],False)
    with pytest.raises(HTTPException): grant(c,uid)

def test_concurrent_redemption_only_one_wins(setup):
    from concurrent.futures import ThreadPoolExecutor
    _,_,c,uid=setup
    code,v=grant(c,uid)
    def attempt(_):
        try: redeem(c,code,v); return True
        except HTTPException: return False
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sum(pool.map(attempt,range(2)))==1

def test_search_policy_guest_and_deleted_user(setup):
    client,h,c,uid=setup
    found=client.get('/admin/sso/users?q='+str(uid),headers=h).json()['users']
    assert any(u['id']==uid and u['enabled']==1 for u in found)
    assert client.patch(f'/admin/sso/users/{uid}',headers=h,json={'enabled':False}).status_code==200
    assert not next(u for u in svc.search_users(str(uid)) if u['id']==uid)['enabled']
    svc.user_policy(uid,True)
    code,v=grant(c,uid); data=redeem(c,code,v)
    with get_db_session() as db: db.execute(text('UPDATE users SET is_guest=true WHERE id=:id'),{'id':uid})
    assert not svc.validate_session(c['client_id'],c['client_secret'],data['session_token'])['active']
    with pytest.raises(HTTPException): grant(c,uid)
    with get_db_session() as db: db.execute(text('DELETE FROM users WHERE id=:id'),{'id':uid})
    assert not svc.validate_session(c['client_id'],c['client_secret'],data['session_token'])['active']

def test_sensitive_sso_fields_are_redacted_from_audit():
    from app.services.request_audit import sanitize_for_audit
    fields=['code','code_verifier','client_secret','session_secret','session_token']
    clean=sanitize_for_audit({field:'never-log-this' for field in fields})
    assert 'never-log-this' not in str(clean)

def test_validation_errors_do_not_echo_credentials(setup):
    client,_,c,_=setup
    response=client.post('/auth/sso/token',json=dict(client_id=c['client_id'],client_secret='private',code='sensitive-code',redirect_uri=c['redirect_uri'],code_verifier='private-verifier'))
    assert response.status_code==422
    assert response.headers['cache-control']=='no-store'
    assert 'private' not in response.text and 'sensitive-code' not in response.text


def test_sso_profile_returns_existing_avatar_without_private_provider_fields(setup):
    _,_,c,uid=setup
    with get_db_session() as db:
        db.execute(text('''INSERT INTO oauth_accounts
            (user_id,provider,provider_user_id,nickname,avatar_url,email,phone,access_token)
            VALUES (:uid,'synthetic',:pid,'Provider nickname',:avatar,'private@example.invalid','private-phone','private-token')'''),
            dict(uid=uid,pid=secrets.token_hex(8),avatar='https://images.example/avatar.png'))
    code,v=grant(c,uid)
    data=redeem(c,code,v)
    assert data['user']['avatar_url']=='https://images.example/avatar.png'
    assert data['user']['profile']['display_name']=='SSO test'
    assert data['user']['profile']['email'] is None
    assert svc.validate_session(c['client_id'],c['client_secret'],data['session_token'])['user']==data['user']
    assert 'private-' not in str(data)


@pytest.mark.parametrize('avatar',['javascript:alert(1)','http://images.example/a','https://user:pass@images.example/a','https://[invalid','https://images.example/a\\b'])
def test_sso_ignores_invalid_avatar_without_blocking_identity(avatar):
    result=svc._identity(dict(id=42,username='Synthetic',avatar_url=avatar))
    assert result['user_id']==42
    assert result['avatar_url'] is None


def test_shared_profile_write_version_idempotency_and_client_isolation(setup):
    client,_,c,uid=setup
    code,v=grant(c,uid); login=redeem(c,code,v)
    payload=dict(client_id=c['client_id'],client_secret=c['client_secret'],session_token=login['session_token'],
                 expected_version=1,idempotency_key=secrets.token_hex(16),changes={'real_name':'Synthetic Name','display_name':'Unified nickname',
                 'email':'profile@example.invalid','organization':'Synthetic Lab','identities':['学生'],'city':'测试城市','bio':'Synthetic bio','department':'Synthetic Department','major_code':'0702','major':'Physics','research_interest':'Synthetic interest','research_direction':'Synthetic direction','job_position':'Researcher','identity_description':'Synthetic identity','personal_introduction':'x'*5000})
    result=client.post('/auth/sso/profile/update',json=payload)
    assert result.status_code==200, result.text
    profile=result.json()['user']['profile']
    assert profile['version']==2 and profile['real_name']=='Synthetic Name'
    assert profile['display_name']=='Unified nickname'
    assert profile['department']=='Synthetic Department' and len(profile['personal_introduction'])==5000
    again=client.post('/auth/sso/profile/update',json=payload)
    assert again.status_code==200 and again.json()['user']['profile']['version']==2
    assert client.post('/auth/sso/profile/update',json={**payload,'changes':{'real_name':'Different'}}).status_code==409
    assert client.post('/auth/sso/profile/update',json={**payload,'idempotency_key':secrets.token_hex(16)}).status_code==409
    assert client.post('/auth/sso/profile/update',json={**payload,'changes':{'phone':'13800000000'}}).status_code==422
    other=svc.create_client('Other profile site','https://'+secrets.token_hex(6)+'.example')
    assert client.post('/auth/sso/profile/update',json={**payload,'client_id':other['client_id'],'client_secret':other['client_secret']}).status_code==401
    code2,v2=grant(other,uid); login2=redeem(other,code2,v2)
    assert login2['user']['profile']==profile
    changed=client.post('/auth/sso/profile/update',json={**payload,'client_id':other['client_id'],'client_secret':other['client_secret'],
        'session_token':login2['session_token'],'expected_version':2,'idempotency_key':secrets.token_hex(16),'changes':{'city':'新城市'}})
    assert changed.status_code==200
    replay=client.post('/auth/sso/profile/update',json=payload).json()
    assert replay['applied_version']==2 and replay['user']['profile']['version']==3
    assert replay['user']['profile']['city']=='新城市'
    svc.revoke_session(c['client_id'],c['client_secret'],login['session_token'])
    assert client.post('/auth/sso/profile/update',json=payload).status_code==401


def test_shared_profile_content_is_not_copied_to_request_audit():
    from app.services.request_audit import sanitize_for_audit
    result=sanitize_for_audit({'changes':{'real_name':'private-name','email':'private@example.invalid'},
                               'user':{'profile':{'phone':'private-phone','bio':'private-bio'}}})
    assert 'private-' not in str(result)
    assert 'private@example' not in str(result)
