"""Profile hub: candidate aggregation, phone lookup and confirmed writes."""
import json
import secrets

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.services import profile_hub_service as hub
from app.storage.database.postgres_client import get_db_session, init_auth_tables


def _user(phone: str, name: str = '合成用户A') -> int:
    init_auth_tables()
    with get_db_session() as db:
        uid = db.execute(text('''INSERT INTO users (phone,password,username,handle,is_guest)
            VALUES (:phone,:password,:username,:handle,false)
            ON CONFLICT (phone) DO UPDATE SET username=excluded.username RETURNING id'''),
            dict(phone=phone, password='x', username=name, handle='h' + phone[-6:])).scalar_one()
        db.execute(text('INSERT INTO user_profiles(user_id) VALUES (:uid) ON CONFLICT(user_id) DO NOTHING'), {'uid': uid})
    return int(uid)


def _confirmed(uid: int) -> dict:
    with get_db_session() as db:
        row = db.execute(text('''SELECT version,real_name,organization,major,research_direction
            FROM user_profiles WHERE user_id=:uid'''), {'uid': uid}).mappings().one()
        return dict(row)


def _seed_candidate(uid: int, source: str, source_user: str, field: str, value: str,
                    updated: str | None, note: str | None = None):
    with get_db_session() as db:
        batch = hub.record_import_batch(db, source, 'apply', {})
        hub.upsert_candidate(db, user_id=uid, source_system=source, source_user_id=source_user,
                             field=field, value=value, source_updated_at=updated, batch_id=batch, field_note=note)


@pytest.fixture(autouse=True)
def schema():
    init_auth_tables()


@pytest.fixture(autouse=True)
def hub_secret(monkeypatch):
    monkeypatch.setenv('PROFILE_HUB_FORUM_SECRET', 'forum-hub-secret-0123456789')


def test_lookup_requires_valid_phone_and_returns_nothing_for_unknown():
    assert hub.lookup_by_phone('13900009000', 'panshi-forum') == {'found': False, 'confirmed': None, 'candidates': []}
    with pytest.raises(HTTPException) as exc:
        hub.lookup_by_phone('12345', 'panshi-forum')
    assert exc.value.status_code == 422


def test_lookup_keeps_confirmed_and_candidates_apart():
    uid = _user('13900009001')
    with get_db_session() as db:
        db.execute(text('UPDATE user_profiles SET real_name=:n, version=4 WHERE user_id=:uid'),
                   {'n': '已确认姓名', 'uid': uid})
    _seed_candidate(uid, 'panshi-camp', 'camp-1', 'organization', '实训营单位', '2026-09-01T00:00:00Z')
    _seed_candidate(uid, 'panshi-forum', 'forum-1', 'organization', '论坛单位', '2026-09-05T00:00:00Z')

    result = hub.lookup_by_phone('+8613900009001', 'panshi-forum')
    assert result['found'] is True
    assert result['confirmed']['version'] == 4
    assert result['confirmed']['fields']['real_name'] == '已确认姓名'
    values = [(c['source_system'], c['value']) for c in result['candidates']]
    assert ('panshi-camp', '实训营单位') in values
    assert ('panshi-forum', '论坛单位') in values
    # Candidates never leak into the confirmed profile.
    assert result['confirmed']['fields']['organization'] is None


def test_confirm_writes_with_version_provenance_and_idempotency():
    uid = _user('13900009002')
    body = {'expected_version': 1, 'idempotency_key': 'forum-confirm-0001',
            'changes': {'organization': '新单位', 'research_direction': '人工智能；材料计算'}}
    first = hub.confirm_by_phone('13900009002', 'panshi-forum', body)
    assert first['version'] == 2 and first['replay'] is False
    stored = _confirmed(uid)
    assert stored['organization'] == '新单位' and stored['research_direction'] == '人工智能；材料计算'
    assert stored['version'] == 2

    replay = hub.confirm_by_phone('13900009002', 'panshi-forum', body)
    assert replay['replay'] is True and replay['version'] == 2

    with get_db_session() as db:
        rows = db.execute(text('SELECT field,source FROM profile_hub_provenance WHERE owner_key=:key'),
                          {'key': 'central:' + str(uid)}).mappings()
        provenance = {r['field']: r['source'] for r in rows}
        events = db.execute(text("SELECT action,result,field_names FROM profile_hub_events WHERE user_id=:uid"),
                            {'uid': uid}).mappings()
        recorded = [dict(e) for e in events]
    assert provenance['organization'] == 'panshi-forum'
    assert any(e['result'] == 'saved' for e in recorded)
    # Audit keeps field names, never values.
    assert all('新单位' not in e['field_names'] for e in recorded)


def test_confirm_rejects_stale_version_and_changed_payload():
    _user('13900009003')
    with pytest.raises(HTTPException) as stale:
        hub.confirm_by_phone('13900009003', 'panshi-forum',
                             {'expected_version': 9, 'idempotency_key': 'forum-confirm-0002',
                              'changes': {'real_name': '张三'}})
    assert stale.value.status_code == 409

    body = {'expected_version': 1, 'idempotency_key': 'forum-confirm-0003', 'changes': {'real_name': '张三'}}
    hub.confirm_by_phone('13900009003', 'panshi-forum', body)
    with pytest.raises(HTTPException) as conflict:
        hub.confirm_by_phone('13900009003', 'panshi-forum', {**body, 'changes': {'real_name': '李四'}})
    assert conflict.value.status_code == 409


def test_confirm_rejects_fields_outside_the_whitelist_and_empty_values():
    _user('13900009004')
    with pytest.raises(HTTPException) as bad_field:
        hub.confirm_by_phone('13900009004', 'panshi-forum',
                             {'expected_version': 1, 'idempotency_key': 'forum-confirm-0004',
                              'changes': {'phone': '13900000000'}})
    assert bad_field.value.status_code == 422
    with pytest.raises(HTTPException) as empty:
        hub.confirm_by_phone('13900009004', 'panshi-forum',
                             {'expected_version': 1, 'idempotency_key': 'forum-confirm-0005',
                              'changes': {'real_name': '   '}})
    assert empty.value.status_code == 422


def test_confirm_does_not_touch_an_account_without_that_phone():
    _user('13900009005')
    result = hub.confirm_by_phone('13900009006', 'panshi-forum',
                                 {'expected_version': 1, 'idempotency_key': 'forum-confirm-0006',
                                  'changes': {'real_name': '张三'}})
    assert result['fields']['real_name'] == '张三'
    with get_db_session() as db:
        assert db.execute(text("SELECT count(*) FROM users WHERE phone='13900009006'")).scalar() == 0
    assert _confirmed(_user('13900009005'))['real_name'] is None


def test_signed_requests():
    body = json.dumps({'phone': '13900009000'}, separators=(',', ':'))
    headers = hub.sign_request('forum-hub-secret-0123456789', body)
    assert hub.verify_request('panshi-forum', body, {k.lower(): v for k, v in headers.items()}) is True
    assert hub.verify_request('panshi-forum', body + ' ', {k.lower(): v for k, v in headers.items()}) is False
    stale = hub.sign_request('forum-hub-secret-0123456789', body, timestamp='1')
    assert hub.verify_request('panshi-forum', body, {k.lower(): v for k, v in stale.items()}) is False
    # Another client's secret must not authenticate the forum.
    assert hub.verify_request('panshi-camp', body, {k.lower(): v for k, v in headers.items()}) is False
    assert hub.verify_request('panshi-forum', body, {}) is False


def test_import_is_idempotent_and_keeps_candidates_separate(tmp_path, monkeypatch):
    from scripts import import_profile_candidates as importer

    bound_uid = _user('13900009007')
    _user('13900009008')
    export = tmp_path / 'camp.json'
    export.write_text(json.dumps([
        {'source_user_id': 'camp-a', 'subject': str(bound_uid), 'phone': '+8613900009007', 'name': '甲',
         'organization': '单位一', 'major_research_direction': '人工智能；材料计算',
         'updated_at': '2026-09-01T10:00:00Z'},
        {'source_user_id': 'camp-b', 'phone': '13900009008', 'name': '乙', 'organization': '',
         'major_research_direction': None, 'updated_at': None},
        {'source_user_id': 'camp-c', 'phone': '13900009999', 'name': '丙', 'organization': '外部',
         'major_research_direction': None, 'updated_at': None},
    ], ensure_ascii=False), encoding='utf-8')

    dry = importer.run('camp-export', export=str(export), apply=False)
    assert dry['records_read'] == 3
    assert dry['records_matched_by_binding'] == 1
    assert dry['records_matched_by_phone'] == 1
    assert dry['records_without_central_account'] == 1
    assert dry['unknown_source_time'] == 2
    assert dry['candidate_rows_new'] == 0  # dry-run never writes

    applied = importer.run('camp-export', export=str(export), apply=True)
    assert applied['candidate_rows_new'] == 6
    again = importer.run('camp-export', export=str(export), apply=True)
    assert again['candidate_rows_new'] == 0
    assert again['candidate_rows_duplicate'] == 6

    with get_db_session() as db:
        rows = db.execute(text('''SELECT field,value,field_note,source_updated_at FROM profile_hub_candidates
            WHERE user_id=:uid'''), {'uid': bound_uid}).mappings()
        stored = {r['field']: r for r in rows}
    assert stored['research_direction']['value'] == '人工智能；材料计算'
    assert stored['research_direction']['field_note'] == 'combined_field'
    assert stored['research_direction']['source_updated_at'] == '2026-09-01T10:00:00Z'
    # The combined field is never split into a separate major value.
    assert 'major' not in stored


def test_import_never_overwrites_confirmed_profile(tmp_path):
    from scripts import import_profile_candidates as importer

    uid = _user('13900009009')
    with get_db_session() as db:
        db.execute(text('UPDATE user_profiles SET organization=:v WHERE user_id=:uid'),
                   {'v': '已确认单位', 'uid': uid})
    export = tmp_path / 'camp.json'
    export.write_text(json.dumps([
        {'source_user_id': 'camp-d', 'phone': '13900009009', 'name': '甲', 'organization': '来源单位',
         'major_research_direction': None, 'updated_at': '2026-09-02T00:00:00Z'}], ensure_ascii=False),
        encoding='utf-8')
    importer.run('camp-export', export=str(export), apply=True)
    assert _confirmed(uid)['organization'] == '已确认单位'


def test_forum_sqlite_adapter_reads_record_timestamp_and_skips_unknown_phone(tmp_path):
    from scripts import import_profile_candidates as importer
    import sqlite3

    db_path = tmp_path / 'recovery.sqlite'
    connection = sqlite3.connect(db_path)
    connection.executescript('''CREATE TABLE objects(id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL);''')
    record = {'id': 'r1', 'owner': 'forum-owner-1', 'kind': 'registration', 'version': 1,
              'createdAt': '2026-09-01T00:00:00Z', 'updatedAt': '2026-09-03T00:00:00Z',
              'data': {'name': '论坛甲', 'organization': '论坛单位', 'major': '材料科学与工程',
                       'researchDirection': '计算材料'}}
    connection.execute('INSERT INTO objects VALUES (?,?,?,?)',
                       ('r1', 'forum-owner-1', 'registration', json.dumps(record, ensure_ascii=False)))
    connection.commit()
    connection.close()
    phone_map = tmp_path / 'phones.json'
    phone_map.write_text(json.dumps({'forum-owner-1': '13900009010'}), encoding='utf-8')

    rows = importer.read_forum_sqlite(str(db_path), str(phone_map))
    assert rows[0]['updated_at'] == '2026-09-03T00:00:00Z'
    assert rows[0]['major'] == '材料科学与工程'
    assert rows[0]['phone'] == '13900009010'

    # Without a phone map the record cannot be attributed to a central account.
    _user('13900009010')
    report = importer.run('forum-sqlite', sqlite=str(db_path), apply=False)
    assert report['records_without_phone'] == 1


def test_api_rejects_unsigned_calls_and_unknown_clients():
    """Route-level guard only: the SQLite test engine is per-thread, so signed
    lookups are covered by the service tests above."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api import profile_hub

    app = FastAPI()
    app.include_router(profile_hub.router, prefix='/api/v1')
    client = TestClient(app)
    body = json.dumps({'phone': '13900009011'}, separators=(',', ':'))

    unsigned = client.post('/api/v1/profile-hub/lookup', content=body,
                           headers={'content-type': 'application/json', 'x-tashan-client': 'panshi-forum'})
    assert unsigned.status_code == 401
    assert unsigned.headers['cache-control'] == 'no-store'

    headers = {'content-type': 'application/json', 'x-tashan-client': 'unknown-site',
               **hub.sign_request('forum-hub-secret-0123456789', body)}
    assert client.post('/api/v1/profile-hub/lookup', content=body, headers=headers).status_code == 401

    # A body changed after signing is rejected before any database access.
    signed = {'content-type': 'application/json', 'x-tashan-client': 'panshi-forum',
              **hub.sign_request('forum-hub-secret-0123456789', body)}
    assert client.post('/api/v1/profile-hub/lookup', content=body + ' ', headers=signed).status_code == 401
