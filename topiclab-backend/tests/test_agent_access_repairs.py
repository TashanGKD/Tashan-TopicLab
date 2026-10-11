import pytest
from test_agent_identity_api import agentid_client


def bootstrap(client, token="valid", name="Research Agent"):
    response = client.post('/api/v1/agent-identity/bootstrap',
        headers={'Authorization': f'Bearer {token}'}, json={'display_name': name})
    assert response.status_code == 200, response.text
    return {'Authorization': f'Bearer {token}'}


def test_agentid_can_use_identity_context_and_task_inbox(agentid_client):
    client, _ = agentid_client
    headers = bootstrap(client)
    for path in ['/api/v1/openclaw/agents/me', '/api/v1/topiclink/profile',
                 '/api/v1/topiclink/agent-tasks', '/api/v1/me/inbox']:
        response = client.get(path, headers=headers)
        assert response.status_code == 200, (path, response.text)


def test_unregistered_identity_cannot_claim_tasks(agentid_client):
    client, _ = agentid_client
    response = client.get('/api/v1/topiclink/agent-tasks',
                          headers={'Authorization': 'Bearer unregistered'})
    assert response.status_code == 403


def test_discussion_requires_authorized_actor_and_server_budget(agentid_client, monkeypatch):
    from app.api import topics
    client, _ = agentid_client
    headers = bootstrap(client)
    topic = client.post('/api/v1/openclaw/topics', headers=headers,
                        json={'title': '研究任务', 'body': '比较材料'}).json()
    topic_id = topic['id']
    for action in ['', '/cancel']:
        response = client.post(f'/api/v1/topics/{topic_id}/discussion{action}', json={})
        assert response.status_code == 401
    other = bootstrap(client, 'second-valid', 'Other Agent')
    for action in ['', '/cancel']:
        response = client.post(f'/api/v1/topics/{topic_id}/discussion{action}', headers=other, json={})
        assert response.status_code == 403
    captured = []
    async def no_sync(*args):
        pass
    async def run(topic_id, payload):
        captured.append(payload)
    monkeypatch.setattr(topics, '_sync_topic_experts_from_resonnet', no_sync)
    monkeypatch.setattr(topics, '_run_discussion_background', run)
    monkeypatch.setenv('TOPICLAB_DISCUSSION_MAX_BUDGET_USD', '2')
    monkeypatch.setenv('TOPICLAB_DISCUSSION_MAX_TURNS', '40')
    response = client.post(f'/api/v1/topics/{topic_id}/discussion', headers=headers,
                           json={'max_budget_usd': 500, 'max_turns': 50000})
    assert response.status_code == 202, response.text
    client.get('/health/ready')
    assert captured[0]['max_budget_usd'] == 2
    assert captured[0]['max_turns'] == 40
