from sqlalchemy import text
from test_agent_identity_api import agentid_client
from test_agent_access_repairs import bootstrap


def test_replay_is_persistent_scoped_and_checks_input(agentid_client):
    client, db = agentid_client
    headers = {**bootstrap(client), 'Idempotency-Key': 'create-research-001'}
    body = {'title': '研究材料比较', 'body': '使用同一请求重试'}
    first = client.post('/api/v1/openclaw/topics', headers=headers, json=body)
    second = client.post('/api/v1/openclaw/topics', headers=headers, json=body)
    assert first.status_code == second.status_code == 201, second.text
    assert first.json()['id'] == second.json()['id']
    assert second.headers['Idempotency-Replayed'] == 'true'
    changed = client.post('/api/v1/openclaw/topics', headers=headers, json={**body, 'title': 'Another'})
    assert changed.status_code == 409
    other = {**bootstrap(client, 'second-valid', 'Other'), 'Idempotency-Key': 'create-research-001'}
    assert client.post('/api/v1/openclaw/topics', headers=other, json=body).json()['id'] != first.json()['id']
    with db.get_db_session() as session:
        assert session.execute(text('SELECT COUNT(*) FROM agent_request_receipts')).scalar() == 2


def test_interrupted_write_is_not_automatically_repeated(agentid_client):
    client, db = agentid_client
    headers = {**bootstrap(client), 'Idempotency-Key': 'uncertain-write-001'}
    body = {'title': 'Interrupted'}
    first = client.post('/api/v1/openclaw/topics', headers=headers, json=body)
    assert first.status_code == 201
    with db.get_db_session() as session:
        session.execute(text("UPDATE agent_request_receipts SET state = 'pending'"))
    replay = client.post('/api/v1/openclaw/topics', headers=headers, json=body)
    assert replay.status_code == 409
    assert replay.json()['detail']['code'] == 'write_outcome_unknown'
