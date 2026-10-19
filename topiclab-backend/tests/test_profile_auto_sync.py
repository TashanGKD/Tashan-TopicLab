import json
import pytest
from fastapi import HTTPException
from sqlalchemy import text
from app.services import profile_hub_service as hub
from app.storage.database.postgres_client import init_auth_tables, get_db_session
from scripts import import_profile_candidates as importer

@pytest.fixture(autouse=True)
def schema():
    init_auth_tables()

def test_latest_is_per_field_nonempty_and_uses_source_time_not_import_order():
    rows=[{'field':'real_name','value':'Name','source_system':'panshi-camp','source_updated_at':'2026-09-01T00:00:00Z'},
          {'field':'organization','value':'Older','source_system':'panshi-forum','source_updated_at':'2026-08-01T00:00:00Z','imported_at':9999999999},
          {'field':'organization','value':'Latest','source_system':'tashan-community','source_updated_at':'2026-09-01T00:00:00Z'},
          {'field':'major','value':'Physics','source_system':'panshi-camp','source_updated_at':None},
          {'field':'organization','value':'','source_system':'panshi-forum','source_updated_at':'2026-10-01T00:00:00Z'}]
    latest=hub.latest_fields(None,rows)
    assert {f:x['value'] for f,x in latest.items()}=={'real_name':'Name','organization':'Latest','major':'Physics'}
    assert hub.latest_fields(None,[{'field':'major','value':'World','source_system':'tashan-world'},
                                        {'field':'major','value':'Camp','source_system':'panshi-camp'}])['major']['value']=='Camp'

def test_login_sync_materializes_partial_profile_and_stale_retry_does_not_replace_newer(tmp_path):
    phone='13900008101';path=tmp_path/'export.json'
    path.write_text(json.dumps([{'source_user_id':'camp-auto','phone':phone,'name':'Name','organization':'Institute','updated_at':'2026-09-01T00:00:00Z'}]))
    importer.run('camp-export',export=str(path),apply=True)
    first=hub.sync_by_identity(phone,'panshi-forum',{})
    assert first['profile']=={'real_name':'Name','organization':'Institute'}
    assert hub.sync_by_identity(phone,'panshi-forum',{})['version']==first['version']
    newer={'changes':{'organization':'New Institute'},'event_id':'registration:new:2','source_updated_at':'2026-10-18T00:00:00Z'}
    assert hub.sync_by_identity(phone,'panshi-forum',newer)['profile']['organization']=='New Institute'
    old={'changes':{'organization':'Old Institute'},'event_id':'registration:old:1','source_updated_at':'2026-09-15T00:00:00Z'}
    assert hub.sync_by_identity(phone,'panshi-forum',old)['profile']['organization']=='New Institute'
    with get_db_session() as db:assert db.execute(text('SELECT count(*) FROM users WHERE phone=:p'),{'p':phone}).scalar()==0

def test_signed_subject_must_match_real_central_identity():
    with get_db_session() as db:
        uid=db.execute(text("INSERT INTO users(phone,password,username,handle,is_guest) VALUES ('13900008102','x','test-auto','auto-sync-handle',false) RETURNING id")).scalar_one()
    with pytest.raises(HTTPException) as e:hub.sync_by_identity('13900008103','panshi-forum',{'subject':f'topiclab:{uid}'})
    assert e.value.status_code==403
    result=hub.sync_by_identity('13900008102','panshi-forum',{'subject':f'topiclab:{uid}','changes':{'real_name':'Own Name'},'event_id':'registration:central:1','source_updated_at':'2026-10-18T00:00:00Z'})
    assert result['profile']=={'real_name':'Own Name'}
    with get_db_session() as db:assert db.execute(text('SELECT real_name FROM user_profiles WHERE user_id=:id'),{'id':uid}).scalar()=='Own Name'
