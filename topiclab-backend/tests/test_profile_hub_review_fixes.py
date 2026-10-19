"""Identity reconciliation and existing SSO edits must survive profile synchronization."""
import json
import secrets

import pytest
from sqlalchemy import text

from app.services import profile_hub_service as hub, sso_service as sso
from app.storage.database.postgres_client import get_db_session, init_auth_tables
from scripts import import_profile_candidates as importer


@pytest.fixture(autouse=True)
def schema():
    init_auth_tables()


def user(phone):
    with get_db_session() as db:
        return db.execute(text('''INSERT INTO users(phone,password,username,handle,is_guest)
            VALUES (:phone,'x','Synthetic profile review',:handle,false) RETURNING id'''),
            {'phone': phone, 'handle': secrets.token_hex(16)}).scalar_one()


def import_record(tmp_path, record):
    path = tmp_path / 'profiles.json'
    path.write_text(json.dumps([record]), encoding='utf-8')
    return importer.run('profile-export', source_system='panshi-camp', export=str(path), apply=True)


def test_import_rejects_conflicting_subject_and_phone_atomically(tmp_path):
    uid = user('13900008501')
    other_uid = user('13900008502')
    record = {'source_user_id': 'review-conflicting-subject', 'subject': f'topiclab:{uid}',
              'phone': '13900008502', 'name': 'Other account private name',
              'updated_at': '2026-09-01T00:00:00Z'}
    with get_db_session() as db:
        before = db.execute(text('SELECT COUNT(*) FROM profile_import_batches')).scalar_one()
    with pytest.raises(ValueError, match='subject.*phone'):
        import_record(tmp_path, record)
    with get_db_session() as db:
        assert db.execute(text('SELECT COUNT(*) FROM profile_import_batches')).scalar_one() == before
        for table in ('profile_hub_source_people', 'profile_hub_candidates'):
            assert db.execute(text(f'SELECT COUNT(*) FROM {table} WHERE source_user_id=:person'),
                              {'person': record['source_user_id']}).scalar_one() == 0
    assert hub.sync_by_identity('13900008502', 'panshi-forum',
                               {'subject': f'topiclab:{other_uid}'})['profile'] == {}


def test_reimport_links_unchanged_values_without_refreshing_source_time(tmp_path):
    uid = user('13900008503')
    record = {'source_user_id': 'review-unmatched', 'name': 'Newly linked person',
              'updated_at': '2026-09-01T00:00:00Z'}
    import_record(tmp_path, record)
    linked = {**record, 'phone': '13900008503', 'phone_verified': True}
    report = import_record(tmp_path, linked)
    assert report['candidate_rows_new'] == 0
    result = hub.lookup_by_phone(linked['phone'], 'panshi-forum')
    assert result['candidates'][0]['value'] == record['name']
    with get_db_session() as db:
        row = db.execute(text('''SELECT user_id,phone,phone_verified,source_updated_at
            FROM profile_hub_candidates WHERE source_user_id=:person'''),
            {'person': record['source_user_id']}).mappings().one()
    assert row == {'user_id': uid, 'phone': linked['phone'], 'phone_verified': True,
                   'source_updated_at': record['updated_at']}


@pytest.mark.parametrize('before,after,phone', [
    (True, False, '13900008504'), (False, True, '13900008505')])
def test_reimport_updates_explicit_phone_verification(tmp_path, before, after, phone):
    record = {'source_user_id': 'review-verification-' + phone, 'phone': phone,
              'phone_verified': before, 'name': 'Synthetic person',
              'updated_at': '2026-09-01T00:00:00Z'}
    import_record(tmp_path, record)
    import_record(tmp_path, {**record, 'phone_verified': after})
    result = hub.lookup_by_phone(phone, 'panshi-forum')
    assert bool(result['candidates']) is after
    with get_db_session() as db:
        assert db.execute(text('SELECT phone_verified FROM profile_hub_candidates WHERE source_user_id=:person'),
                          {'person': record['source_user_id']}).scalar_one() == after


def test_phone_change_reconciles_all_historical_candidates(tmp_path):
    old_uid = user('13900008506')
    new_uid = user('13900008507')
    record = {'source_user_id': 'review-changed-phone', 'phone': '13900008506',
              'phone_verified': True, 'name': 'Earlier name', 'organization': 'Same institute',
              'updated_at': '2026-09-01T00:00:00Z'}
    import_record(tmp_path, record)
    record.update(phone='13900008507', name='Current name', updated_at='2026-10-01T00:00:00Z')
    import_record(tmp_path, record)
    assert hub.lookup_by_phone('13900008506', 'panshi-forum')['candidates'] == []
    result = hub.lookup_by_phone('13900008507', 'panshi-forum')
    assert {item['value'] for item in result['candidates']} == {'Earlier name', 'Current name', 'Same institute'}
    with get_db_session() as db:
        owners = db.execute(text('SELECT DISTINCT user_id FROM profile_hub_candidates WHERE source_user_id=:person'),
                            {'person': record['source_user_id']}).scalars().all()
    assert owners == [new_uid] and old_uid != new_uid


def test_single_candidate_upsert_refreshes_identity_but_keeps_newest_field_time():
    uid = user('13900008508')
    candidate = dict(source_system='panshi-camp', source_user_id='review-direct-upsert',
                     field='organization', value='Same institute', batch_id='review-direct')
    with get_db_session() as db:
        hub.upsert_candidate(db, user_id=None, phone=None, phone_verified=None,
                             source_updated_at='2026-10-01T00:00:00Z', **candidate)
        hub.upsert_candidate(db, user_id=uid, phone='13900008508', phone_verified=True,
                             source_updated_at='2026-09-01T00:00:00Z', **candidate)
        row = db.execute(text('''SELECT user_id,phone,phone_verified,source_updated_at
            FROM profile_hub_candidates WHERE source_user_id=:person'''),
            {'person': candidate['source_user_id']}).mappings().one()
    assert row == {'user_id': uid, 'phone': '13900008508', 'phone_verified': True,
                   'source_updated_at': '2026-10-01T00:00:00Z'}


def test_existing_sso_edit_survives_sync_and_replay_keeps_original_freshness():
    phone = '13900008509'
    uid = user(phone)
    first = hub.sync_by_identity(phone, 'panshi-forum', {'subject': f'topiclab:{uid}',
        'changes': {'organization': 'Zulu old institute'}, 'event_id': 'review:original:registration',
        'source_updated_at': '2020-09-01T00:00:00Z'})
    client = sso.create_client('Synthetic profile editor', 'https://profile-review.example')
    verifier = secrets.token_urlsafe(32)
    code = sso.authorize(uid, client['client_id'], client['redirect_uri'], sso.challenge(verifier))['code']
    token = sso.exchange(client['client_id'], client['client_secret'], code,
                         client['redirect_uri'], verifier)['session_token']
    args = (client['client_id'], client['client_secret'], token, first['version'],
            'review:existing:sso:edit', {'organization': 'Alpha new institute'})
    saved = sso.update_profile(*args)
    assert saved['user']['profile']['organization'] == 'Alpha new institute'
    with get_db_session() as db:
        provenance = db.execute(text('SELECT source_updated_at FROM profile_hub_provenance WHERE owner_key=:owner'),
                                {'owner': f'central:{uid}'}).scalar_one()
    assert hub.sync_by_identity(phone, 'panshi-forum',
                                {'subject': f'topiclab:{uid}'})['profile']['organization'] == 'Alpha new institute'
    assert sso.update_profile(*args)['applied_version'] == saved['applied_version']
    with get_db_session() as db:
        assert db.execute(text('SELECT source_updated_at FROM profile_hub_provenance WHERE owner_key=:owner'),
                          {'owner': f'central:{uid}'}).scalar_one() == provenance
