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
    assert set(data['user'])=={'user_id','username','is_guest'}
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
