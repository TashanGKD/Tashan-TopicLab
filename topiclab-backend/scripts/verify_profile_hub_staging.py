"""Database-backed acceptance, including concurrent requests on PostgreSQL."""
import json
import os
import secrets
import sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
from app.services import profile_hub_service as hub
from app.storage.database.postgres_client import get_db_session
from sqlalchemy import text

assert os.environ.get('PROFILE_HUB_ENVIRONMENT') == 'staging'
assert os.environ['DATABASE_URL'].endswith('/tashan_profile_hub_staging')
phone = '13999' + str(secrets.randbelow(1000000)).zfill(6)
body = {'expected_version': 1, 'idempotency_key': secrets.token_hex(16),
        'changes': {'real_name': 'STAGING synthetic profile'}}
with ThreadPoolExecutor(max_workers=5) as pool:
    replies = list(pool.map(lambda _: hub.confirm_by_phone(phone, 'panshi-forum', body), range(5)))
assert sum(not r['replay'] for r in replies) == 1
assert all(r['version'] == 2 for r in replies)

def change(i):
    try:
        hub.confirm_by_phone(phone, 'panshi-forum', {'expected_version': 2,
            'idempotency_key': secrets.token_hex(16), 'changes': {'organization': 'STAGING ' + str(i)}})
        return 200
    except HTTPException as exc:
        return exc.status_code

with ThreadPoolExecutor(max_workers=5) as pool:
    statuses = list(pool.map(change, range(5)))
assert statuses.count(200) == 1 and statuses.count(409) == 4
with get_db_session() as db:
    assert db.execute(text('SELECT count(*) FROM users WHERE phone=:p'), {'p': phone}).scalar() == 0
    assert db.execute(text("SELECT count(*) FROM profile_hub_events WHERE phone_hash=:h AND result='conflict'"),
                      {'h': hub.digest(phone)}).scalar() == 4
print(json.dumps({'database': 'PostgreSQL', 'simultaneous_first_save': 'passed',
                  'idempotent_replays': 4, 'version_conflicts': 4, 'failure_audit': 'passed',
                  'automatic_account_creation': False}))
