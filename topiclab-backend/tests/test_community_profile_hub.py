import secrets
import pytest
from fastapi import HTTPException
from sqlalchemy import text
from app.services import sso_service as sso, profile_hub_service as hub
from app.storage.database.postgres_client import init_auth_tables, get_db_session
from app.api.community_profile_hub import sync, update
from app.api.sso import SessionRequest, ProfileUpdateRequest

def test_community_reads_aggregate_and_writes_fresh_fields_without_replay_refresh():
    init_auth_tables()
    phone='13900008421'
    with get_db_session() as db:
        uid=db.execute(text("INSERT INTO users(phone,password,username,handle,is_guest) VALUES (:p,'x','Synthetic community','community-sync-test',false) RETURNING id"),{'p':phone}).scalar_one()
        hub.upsert_candidate(db,user_id=uid,phone=phone,source_system='panshi-camp',source_user_id='synthetic-camp',field='organization',value='Old Institute',source_updated_at='2020-01-01T00:00:00Z',batch_id='synthetic')
    client=sso.create_client('Synthetic community','https://community.tashan.ac.cn')
    verifier=secrets.token_urlsafe(48)
    code=sso.authorize(uid,client['client_id'],client['redirect_uri'],sso.challenge(verifier))['code']
    token=sso.exchange(client['client_id'],client['client_secret'],code,client['redirect_uri'],verifier)['session_token']
    args=dict(client_id=client['client_id'],client_secret=client['client_secret'],session_token=token)
    first=sync(SessionRequest(**args));assert first['user']['profile']['organization']=='Old Institute'
    req=ProfileUpdateRequest(**args,expected_version=first['user']['profile']['version'],idempotency_key='synthetic-save',changes={'real_name':'Synthetic name','organization':'New Institute','major':'Physics','research_direction':'AI'})
    saved=update(req);assert saved['user']['profile']['major']=='Physics'
    with get_db_session() as db:
        before=[tuple(r) for r in db.execute(text("SELECT field,source_updated_at FROM profile_hub_provenance WHERE owner_key=:o ORDER BY field"),{'o':f'central:{uid}'})]
    assert update(req)['applied_version']==saved['applied_version']
    with get_db_session() as db:
        after=[tuple(r) for r in db.execute(text("SELECT field,source_updated_at FROM profile_hub_provenance WHERE owner_key=:o ORDER BY field"),{'o':f'central:{uid}'})]
    assert before==after
    assert hub.sync_by_identity(phone,'panshi-forum',{'subject':f'topiclab:{uid}'})['profile']['organization']=='New Institute'
    assert sync(SessionRequest(**args))['user']['profile']['research_direction']=='AI'
    with pytest.raises(HTTPException):sync(SessionRequest(**{**args,'session_token':'x'*43}))
