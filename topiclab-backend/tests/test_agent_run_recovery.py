import time
from test_agent_identity_api import agentid_client
from test_agent_access_repairs import bootstrap


def test_lost_response_is_recovered_without_restarting(agentid_client, monkeypatch):
    from app.api import topics
    from app.services import agent_runs
    client, _ = agentid_client
    headers = bootstrap(client)
    topic = client.post('/api/v1/openclaw/topics', headers=headers, json={'title': '恢复研究'}).json()
    calls = []
    async def executor(method, path, **kwargs):
        calls.append((method, path))
        if method == 'POST':
            raise TimeoutError('response lost')
        return {'status': 'completed', 'result': {'turns': [], 'discussion_summary': 'Recovered',
                                                 'discussion_history': '', 'turns_count': 0}}
    async def no_sync(*args):
        pass
    monkeypatch.setattr(topics, 'request_json', executor)
    monkeypatch.setattr(topics, '_sync_topic_experts_from_resonnet', no_sync)
    response = client.post(f"/api/v1/topics/{topic['id']}/discussion", headers=headers, json={})
    assert response.status_code == 202, response.text
    url = response.json()['run']['status_url']
    for _ in range(20):
        status = client.get(url, headers=headers)
        if status.json()['status'] == 'completed':
            break
        time.sleep(.02)
    assert status.json()['status'] == 'completed', status.text
    assert sum(method == 'POST' for method, _ in calls) == 1
    assert client.get(url + '/result', headers=headers).status_code == 200
    other = bootstrap(client, 'second-valid', 'Other')
    assert client.get(url, headers=other).status_code == 403
    assert agent_runs.latest_run(topic['id'])['active_key'] is None


def test_cancel_is_not_reported_when_executor_is_unreachable(agentid_client, monkeypatch):
    from app.api import topics
    from app.services import agent_runs
    client, _ = agentid_client
    headers = bootstrap(client)
    topic = client.post('/api/v1/openclaw/topics', headers=headers, json={'title': '执行中'}).json()
    agent_runs.create_run(topic['id'], 'unused', {})
    topics.set_discussion_status(topic['id'], 'running')
    async def unavailable(*args, **kwargs):
        raise TimeoutError()
    monkeypatch.setattr(topics, 'request_json', unavailable)
    response = client.post(f"/api/v1/topics/{topic['id']}/discussion/cancel", headers=headers)
    assert response.status_code == 503
    assert response.json()['detail']['code'] == 'cancel_unconfirmed'
    assert agent_runs.latest_run(topic['id'])['status'] == 'running'
