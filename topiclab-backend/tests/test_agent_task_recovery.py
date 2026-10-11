from sqlalchemy import text
from test_agent_identity_api import agentid_client
from test_agent_access_repairs import bootstrap


def seed_tasks(db, count=3):
    from app.api.topiclink import _ensure_topiclink_agent_tasks_table
    with db.get_db_session() as session:
        agent = session.execute(text('SELECT id, bound_user_id, agent_uid, handle FROM openclaw_agents ORDER BY id LIMIT 1')).fetchone()
        _ensure_topiclink_agent_tasks_table(session)
        for index in range(count):
            session.execute(text('''INSERT INTO topiclink_agent_tasks
                (id, task_type, source_type, source_id, source_title, source_path,
                 requested_by_user_id, target_openclaw_agent_id, target_agent_uid, target_handle)
                VALUES (:id, 'diligence', 'test', 'source', 'Research', '/topiclink', :user, :agent, :uid, :handle)'''),
                {'id': f'task-{index}', 'user': agent.bound_user_id, 'agent': agent.id,
                 'uid': agent.agent_uid, 'handle': agent.handle})


def test_task_cursor_and_owner_access(agentid_client):
    client, db = agentid_client
    headers = bootstrap(client)
    seed_tasks(db)
    cursor = None
    ids = []
    while True:
        params = {'limit': 1}
        if cursor:
            params['cursor'] = cursor
        response = client.get('/api/v1/topiclink/agent-tasks', headers=headers, params=params)
        assert response.status_code == 200, response.text
        page = response.json()
        ids.extend(item['id'] for item in page['items'])
        cursor = page['next_cursor']
        if not cursor:
            break
    assert ids == ['task-0', 'task-1', 'task-2']
    assert client.get('/api/v1/topiclink/agent-tasks?cursor=bad', headers=headers).status_code == 400
    other = bootstrap(client, 'second-valid', 'Other')
    assert client.get('/api/v1/topiclink/agent-tasks/task-0', headers=other).status_code == 404


def test_completed_task_can_be_retried_with_same_proof_and_result(agentid_client):
    client, db = agentid_client
    headers = bootstrap(client)
    seed_tasks(db, 1)
    path = '/api/v1/topiclink/agent-tasks/task-0'
    proof = 'test_claim_token_01234567890123456789'
    assert client.post(path + '/claim', headers=headers, json={'claim_token': proof}).status_code == 200
    assert client.post(path + '/renew', headers=headers, json={'claim_token': proof}).status_code == 200
    result = {'claim_token': proof, 'summary': 'Source checked', 'risk_notes': [], 'next_step': 'Review evidence'}
    first = client.post(path + '/complete', headers=headers, json=result)
    replay = client.post(path + '/complete', headers=headers, json=result)
    assert first.status_code == replay.status_code == 200, replay.text
    assert first.json() == replay.json()
    assert client.post(path + '/complete', headers=headers, json={**result, 'summary': 'Different'}).status_code == 409
    assert client.post(path + '/complete', headers=headers, json={**result, 'claim_token': 'unrelated_token_012345678901234567'}).status_code == 409
