"""Acceptance regressions: historical coverage, provenance, WAL and failure audits."""
import json
import sqlite3
import pytest
from fastapi import HTTPException
from sqlalchemy import text
from app.services import profile_hub_service as hub
from app.storage.database.postgres_client import init_auth_tables, get_db_session
from scripts import import_profile_candidates as importer


@pytest.fixture(autouse=True)
def schema():
    init_auth_tables()


def export_file(tmp_path, phone='13900008001', verified=True):
    path = tmp_path / 'camp.json'
    path.write_text(json.dumps([{'source_user_id': 'camp-' + phone, 'phone': phone,
        'phone_verified': verified, 'name': 'Synthetic person', 'organization': 'Synthetic institute',
        'updated_at': '2026-09-01T00:00:00Z'}]), encoding='utf-8')
    return str(path)


def test_camp_only_person_can_lookup_adopt_and_save_without_creating_account(tmp_path):
    path = export_file(tmp_path)
    importer.run('camp-export', export=path, apply=True)
    before = hub.lookup_by_phone('13900008001', 'panshi-forum')
    assert before['found'] and before['confirmed'] is None
    candidate = next(c for c in before['candidates'] if c['field'] == 'real_name')
    body = {'expected_version': 1, 'idempotency_key': 'camp-only-first-save',
            'changes': {'real_name': candidate['value']}, 'adoptions': {'real_name': candidate['id']}}
    result = hub.confirm_by_phone('13900008001', 'panshi-forum', body)
    assert result['sources']['real_name']['source'] == 'panshi-camp'
    assert result['sources']['real_name']['source_updated_at'] == '2026-09-01T00:00:00Z'
    assert hub.lookup_by_phone('13900008001', 'panshi-forum')['confirmed']['fields']['real_name'] == candidate['value']
    hub.confirm_by_phone('13900008001', 'panshi-forum', {
        'expected_version': 2, 'idempotency_key': 'camp-only-second-save', 'changes': {'real_name': 'New name'}})
    replay = hub.confirm_by_phone('13900008001', 'panshi-forum', body)
    assert replay['version'] == 2 and replay['fields']['real_name'] == candidate['value']
    with get_db_session() as db:
        assert db.execute(text("SELECT count(*) FROM users WHERE phone='13900008001'")).scalar() == 0


def test_dry_run_has_no_writes_and_conflicts_include_existing_confirmation(tmp_path):
    phone = '13900008002'
    hub.confirm_by_phone(phone, 'panshi-forum', {'expected_version': 1,
        'idempotency_key': 'dry-run-existing', 'changes': {'organization': 'Different institute'}})
    with get_db_session() as db:
        counts = [db.execute(text('SELECT count(*) FROM ' + t)).scalar()
                  for t in ['profile_import_batches', 'profile_hub_candidates']]
    report = importer.run('camp-export', export=export_file(tmp_path, phone), apply=False)
    assert report['conflicts'] == 1
    with get_db_session() as db:
        assert counts == [db.execute(text('SELECT count(*) FROM ' + t)).scalar()
                          for t in ['profile_import_batches', 'profile_hub_candidates']]


def test_failure_audit_survives_rollback_and_does_not_log_values():
    phone = '13900008003'
    with pytest.raises(HTTPException) as error:
        hub.confirm_by_phone(phone, 'panshi-forum', {'expected_version': 99,
            'idempotency_key': 'audit-stale-version', 'changes': {'real_name': 'Do not log this'}})
    assert error.value.status_code == 409
    with get_db_session() as db:
        rows = db.execute(text('SELECT result,field_names FROM profile_hub_events WHERE phone_hash=:h'),
                          {'h': hub.digest(phone)}).mappings().all()
        assert any(r['result'] == 'conflict' for r in rows)
        assert 'Do not log this' not in str(rows)
        assert db.execute(text('SELECT count(*) FROM profile_hub_external_profiles WHERE phone=:p'), {'p': phone}).scalar() == 0


def test_wal_committed_registration_is_not_lost(tmp_path):
    path = tmp_path / 'live.sqlite'
    connection = sqlite3.connect(path)
    try:
        connection.execute('PRAGMA journal_mode=WAL')
        connection.execute('CREATE TABLE objects(owner TEXT,kind TEXT,data TEXT)')
        connection.commit()
        connection.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        connection.execute('INSERT INTO objects VALUES (?,?,?)', ('owner','registration',
            json.dumps({'data': {'name': 'Committed WAL row'}, 'updatedAt': '2026-09-01T00:00:00Z'})))
        connection.commit()
        assert importer.read_forum_sqlite(str(path), None)[0]['name'] == 'Committed WAL row'
    finally:
        connection.close()


def test_unverified_source_preserved_but_not_disclosed(tmp_path):
    importer.run('camp-export', export=export_file(tmp_path, '13900008004', False), apply=True)
    assert not hub.lookup_by_phone('13900008004', 'panshi-forum')['found']
    with get_db_session() as db:
        assert db.execute(text("SELECT count(*) FROM profile_hub_candidates WHERE phone='13900008004'")).scalar() == 2


def test_cannot_adopt_someone_elses_candidate(tmp_path):
    importer.run('camp-export', export=export_file(tmp_path, '13900008005'), apply=True)
    candidate = hub.lookup_by_phone('13900008005', 'panshi-forum')['candidates'][0]
    with pytest.raises(HTTPException) as error:
        hub.confirm_by_phone('13900008006', 'panshi-forum', {'expected_version': 1,
            'idempotency_key': 'wrong-person-adoption', 'changes': {candidate['field']: candidate['value']},
            'adoptions': {candidate['field']: candidate['id']}})
    assert error.value.status_code == 422
