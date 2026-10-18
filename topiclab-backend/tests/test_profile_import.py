"""Authorized profile import: consent, preview, commit, idempotency and ownership."""
import json
import secrets

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.services import profile_import_service as svc
from app.storage.database.postgres_client import get_db_session, init_auth_tables


def _user(phone: str, name: str) -> int:
    init_auth_tables()
    with get_db_session() as db:
        uid = db.execute(text('''INSERT INTO users (phone,password,username,handle,is_guest)
            VALUES (:phone,:password,:username,:handle,false)
            ON CONFLICT (phone) DO UPDATE SET username=excluded.username RETURNING id'''),
            dict(phone=phone, password='x', username=name, handle='h' + phone[-6:])).scalar_one()
    return int(uid)


def _profile(uid: int, **fields) -> None:
    with get_db_session() as db:
        db.execute(text('INSERT INTO user_profiles(user_id) VALUES (:uid) ON CONFLICT(user_id) DO NOTHING'), {'uid': uid})
        for key, value in fields.items():
            db.execute(text(f'UPDATE user_profiles SET {key}=:v WHERE user_id=:uid'), {'v': value, 'uid': uid})


def _read(uid: int) -> dict:
    with get_db_session() as db:
        row = db.execute(text('''SELECT version,real_name,organization,major,research_direction
            FROM user_profiles WHERE user_id=:uid'''), {'uid': uid}).mappings().one()
        return dict(row)


@pytest.fixture(autouse=True)
def source_config(monkeypatch):
    monkeypatch.setenv('PROFILE_SOURCE_CAMP_URL', 'https://camp-staging.example/api/v1/internal/tashan-profile-candidates')
    monkeypatch.setenv('PROFILE_SOURCE_CAMP_SECRET', 'test-connector-secret')
    monkeypatch.setenv('PROFILE_SOURCE_FORUM_URL', 'https://forum-staging.example/api/forum/internal/profile-candidates')
    monkeypatch.setenv('PROFILE_SOURCE_FORUM_SECRET', 'test-connector-secret')


@pytest.fixture
def source(monkeypatch):
    calls = []

    def fake(cfg, subject):
        calls.append((cfg['source'], subject))
        return {
            'source': cfg['source'], 'bound': True,
            'source_user_id': 'camp-user-uuid', 'account': {'verified_phone': True},
            'activity': {'id': 'panshi-camp-2026', 'name': '磐石 AI4S 实训营'},
            'fields': {
                'real_name': {'value': '合成用户A', 'updated_at': '2026-09-20T08:00:00Z'},
                'organization': {'value': '来源单位甲', 'updated_at': '2026-09-21T08:00:00Z'},
                'major': {'value': None, 'updated_at': None},
                'research_direction': {'value': '人工智能；材料计算', 'updated_at': None,
                                       'note': 'combined_field'},
            },
        }

    monkeypatch.setattr(svc, '_post_candidates', fake)
    return calls


def _authorize(uid: int, source='panshi-camp') -> str:
    return svc.create_authorization(uid, source)['authorization_id']


def test_preview_does_not_touch_profile(source):
    uid = _user('13800001001', 'A')
    _profile(uid, real_name='中央已有姓名', organization=None, major=None, research_direction=None)
    before = _read(uid)
    authz = _authorize(uid)
    preview = svc.create_preview(uid, authz)
    assert preview['bound'] is True
    assert preview['base_version'] == before['version']
    assert _read(uid) == before
    assert [f['source_value'] for f in preview['fields'] if f['field'] == 'organization'] == ['来源单位甲']
    assert preview['activity'] == '磐石 AI4S 实训营'
    assert source and source[0][1].startswith('topiclab:')


def test_commit_saves_selected_fields_with_attribution(source):
    uid = _user('13800001002', 'A')
    _profile(uid, real_name='中央已有姓名', organization=None, major=None, research_direction=None)
    authz = _authorize(uid)
    preview = svc.create_preview(uid, authz)
    result = svc.commit_import(uid, {
        'preview_id': preview['preview_id'], 'preview_token': preview['preview_token'],
        'expected_version': preview['base_version'], 'idempotency_key': 'key-0001-abcdef',
        'selections': {'organization': '来源单位甲', 'research_direction': '人工智能；材料计算'},
        'origin': {'organization': 'source', 'research_direction': 'source'},
    })
    assert result['applied_version'] == preview['base_version'] + 1
    stored = _read(uid)
    assert stored['organization'] == '来源单位甲'
    assert stored['research_direction'] == '人工智能；材料计算'
    assert stored['real_name'] == '中央已有姓名'
    with get_db_session() as db:
        rows = db.execute(text('SELECT field,source,source_updated_at FROM profile_field_sources WHERE user_id=:uid'),
                          {'uid': uid}).mappings()
        stamps = {r['field']: (r['source'], r['source_updated_at']) for r in rows}
        events = db.execute(text('SELECT action,field_names,result FROM profile_import_events WHERE user_id=:uid'),
                            {'uid': uid}).mappings()
        recorded = [dict(e) for e in events]
    assert stamps['organization'] == ('panshi-camp', '2026-09-21T08:00:00Z')
    assert stamps['research_direction'][1] is None  # unknown source time is not invented
    # The audit trail keeps field names only, never the imported values.
    assert all('来源单位甲' not in e['field_names'] for e in recorded)
    assert {e['action'] for e in recorded} == {'authorize', 'preview', 'commit'}


def test_empty_values_never_overwrite_existing(source):
    uid = _user('13800001003', 'A')
    _profile(uid, real_name='中央已有姓名', organization='中央已有单位', major=None, research_direction=None)
    authz = _authorize(uid)
    preview = svc.create_preview(uid, authz)
    with pytest.raises(HTTPException) as exc:
        svc.commit_import(uid, {'preview_id': preview['preview_id'], 'preview_token': preview['preview_token'],
                                'expected_version': preview['base_version'], 'idempotency_key': 'key-0002-abcdef',
                                'selections': {'real_name': '   '}})
    assert exc.value.status_code == 422
    assert _read(uid)['real_name'] == '中央已有姓名'
    # An empty source value is simply not offered as a change.
    assert [f['source_value'] for f in preview['fields'] if f['field'] == 'major'] == [None]


def test_idempotent_retry_applies_once(source):
    uid = _user('13800001004', 'A')
    _profile(uid, real_name=None, organization=None, major=None, research_direction=None)
    authz = _authorize(uid)
    preview = svc.create_preview(uid, authz)
    body = {'preview_id': preview['preview_id'], 'preview_token': preview['preview_token'],
            'expected_version': preview['base_version'], 'idempotency_key': 'key-0003-abcdef',
            'selections': {'organization': '来源单位甲'}, 'origin': {'organization': 'source'}}
    first = svc.commit_import(uid, body)
    second = svc.commit_import(uid, body)
    assert first['applied_version'] == second['applied_version']
    assert second['idempotent_replay'] is True
    assert _read(uid)['version'] == first['applied_version']
    # A different payload under the same key is rejected instead of silently applied.
    with pytest.raises(HTTPException) as exc:
        svc.commit_import(uid, {**body, 'selections': {'organization': '另一个单位'}})
    assert exc.value.status_code == 409


def test_expired_preview_and_consumed_preview_cannot_be_committed(source, monkeypatch):
    uid = _user('13800001005', 'A')
    _profile(uid, real_name=None, organization=None, major=None, research_direction=None)
    authz = _authorize(uid)
    preview = svc.create_preview(uid, authz)
    body = {'preview_id': preview['preview_id'], 'preview_token': preview['preview_token'],
            'expected_version': preview['base_version'], 'idempotency_key': 'key-0004-abcdef',
            'selections': {'organization': '来源单位甲'}, 'origin': {'organization': 'source'}}
    svc.commit_import(uid, body)
    with pytest.raises(HTTPException) as exc:
        svc.commit_import(uid, {**body, 'idempotency_key': 'key-0005-abcdef'})
    assert exc.value.status_code == 409

    uid2 = _user('13800001006', 'A')
    _profile(uid2, real_name=None, organization=None, major=None, research_direction=None)
    authz2 = _authorize(uid2)
    preview2 = svc.create_preview(uid2, authz2)
    monkeypatch.setattr(svc, '_now', lambda: preview2['expires_at'] + 1)
    with pytest.raises(HTTPException) as expired:
        svc.commit_import(uid2, {'preview_id': preview2['preview_id'], 'preview_token': preview2['preview_token'],
                                 'expected_version': preview2['base_version'], 'idempotency_key': 'key-0006-abcdef',
                                 'selections': {'organization': '来源单位甲'}})
    assert expired.value.status_code == 409


def test_cancelled_authorization_blocks_preview_and_commit(source):
    uid = _user('13800001007', 'A')
    _profile(uid, real_name=None, organization=None, major=None, research_direction=None)
    authz = _authorize(uid)
    preview = svc.create_preview(uid, authz)
    svc.cancel_authorization(uid, authz)
    with pytest.raises(HTTPException) as exc:
        svc.create_preview(uid, authz)
    assert exc.value.status_code == 409
    with pytest.raises(HTTPException) as commit:
        svc.commit_import(uid, {'preview_id': preview['preview_id'], 'preview_token': preview['preview_token'],
                                'expected_version': preview['base_version'], 'idempotency_key': 'key-0007-abcdef',
                                'selections': {'organization': '来源单位甲'}})
    assert commit.value.status_code == 409
    assert _read(uid)['organization'] is None


def test_another_account_cannot_use_foreign_preview(source):
    owner = _user('13800001008', 'A')
    other = _user('13800001009', 'B')
    _profile(owner, real_name=None, organization=None, major=None, research_direction=None)
    _profile(other, real_name=None, organization=None, major=None, research_direction=None)
    authz = _authorize(owner)
    preview = svc.create_preview(owner, authz)
    with pytest.raises(HTTPException) as exc:
        svc.commit_import(other, {'preview_id': preview['preview_id'], 'preview_token': preview['preview_token'],
                                  'expected_version': 1, 'idempotency_key': 'key-0008-abcdef',
                                  'selections': {'organization': '来源单位甲'}})
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as cancel:
        svc.cancel_authorization(other, authz)
    assert cancel.value.status_code == 404
    assert _read(owner)['organization'] is None


def test_version_conflict_is_rejected(source):
    uid = _user('13800001010', 'A')
    _profile(uid, real_name=None, organization=None, major=None, research_direction=None)
    authz = _authorize(uid)
    preview = svc.create_preview(uid, authz)
    with get_db_session() as db:
        db.execute(text('UPDATE user_profiles SET version=version+1, major=:m WHERE user_id=:uid'),
                   {'m': '并发写入的专业', 'uid': uid})
    with pytest.raises(HTTPException) as exc:
        svc.commit_import(uid, {'preview_id': preview['preview_id'], 'preview_token': preview['preview_token'],
                                'expected_version': preview['base_version'], 'idempotency_key': 'key-0009-abcdef',
                                'selections': {'organization': '来源单位甲'}})
    assert exc.value.status_code == 409
    stored = _read(uid)
    assert stored['organization'] is None and stored['major'] == '并发写入的专业'


def test_unbound_source_returns_candidates_absent(monkeypatch):
    uid = _user('13800001011', 'A')
    monkeypatch.setattr(svc, '_post_candidates', lambda cfg, subject: {'source': cfg['source'], 'bound': False})
    authz = _authorize(uid)
    preview = svc.create_preview(uid, authz)
    assert preview['bound'] is False
    assert 'preview_id' not in preview


def test_unavailable_source_does_not_break_other_sources(monkeypatch):
    uid = _user('13800001012', 'A')
    monkeypatch.delenv('PROFILE_SOURCE_CAMP_URL', raising=False)
    with pytest.raises(HTTPException) as exc:
        svc.create_authorization(uid, 'panshi-camp')
    assert exc.value.status_code == 503
    listed = svc.list_sources()
    assert [s['available'] for s in listed['sources']] == [False, True]


def test_rejects_fields_outside_the_whitelist(source):
    uid = _user('13800001013', 'A')
    _profile(uid, real_name=None, organization=None, major=None, research_direction=None)
    authz = _authorize(uid)
    preview = svc.create_preview(uid, authz)
    with pytest.raises(HTTPException) as exc:
        svc.commit_import(uid, {'preview_id': preview['preview_id'], 'preview_token': preview['preview_token'],
                                'expected_version': preview['base_version'], 'idempotency_key': 'key-0010-abcdef',
                                'selections': {'phone': '13800000000'}})
    assert exc.value.status_code == 422


def test_history_lists_authorizations_without_values(source):
    uid = _user('13800001014', 'A')
    _profile(uid, real_name=None, organization=None, major=None, research_direction=None)
    authz = _authorize(uid)
    preview = svc.create_preview(uid, authz)
    svc.commit_import(uid, {'preview_id': preview['preview_id'], 'preview_token': preview['preview_token'],
                            'expected_version': preview['base_version'], 'idempotency_key': 'key-0011-abcdef',
                            'selections': {'organization': '来源单位甲'}, 'origin': {'organization': 'source'}})
    history = svc.history(uid)
    assert history['items'][0]['status'] == 'completed'
    assert history['items'][0]['consent_version'] == svc.CONSENT_VERSION
    assert json.dumps(history, ensure_ascii=False).count('来源单位甲') == 0


def test_connector_signature_covers_body_and_is_verifiable():
    headers = svc._signed_headers('secret-value', '{"subject":"topiclab:1"}')
    assert headers['X-Tashan-Connector-Version'] == '1'
    assert headers['X-Tashan-Signature'].startswith('v1=')
    assert len(headers['X-Tashan-Nonce']) == 32
    assert secrets.token_hex(16) != headers['X-Tashan-Nonce']
