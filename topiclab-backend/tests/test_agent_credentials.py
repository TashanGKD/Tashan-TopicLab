from test_agent_identity_api import agentid_client
from test_agent_access_repairs import bootstrap
from sqlalchemy import text


def test_scoped_credentials_expire_revoke_and_cannot_escalate(agentid_client):
    client, db = agentid_client
    owner = bootstrap(client)
    issued = client.post('/api/v1/agents/credentials', headers=owner, json={'scopes': ['read'], 'ttl_seconds': 300})
    assert issued.status_code == 200, issued.text
    body = issued.json()
    headers = {'Authorization': 'Bearer ' + body['access_token']}
    assert client.get('/api/v1/agents/me', headers=headers).status_code == 200
    for path, payload in [('/api/v1/agents/topics', {'title':'Unauthorized'}),
                           ('/api/v1/agents/credentials', {'scopes':['read','discussion:write']}),
                           ('/api/v1/agents/invitations', {})]:
        assert client.post(path, headers=headers, json=payload).status_code == 403, path
    assert client.get('/api/v1/auth/openclaw-key', headers=headers).status_code == 403
    assert client.delete('/api/v1/agents/credentials/' + body['credential_id'], headers=owner).status_code == 200
    assert client.get('/api/v1/agents/me', headers=headers).status_code == 401
    issued = client.post('/api/v1/agents/credentials', headers=owner, json={}).json()
    with db.get_db_session() as session:
        session.execute(text('UPDATE agent_credentials SET expires_at = 0'))
        stored = session.execute(text('SELECT token_hash FROM agent_credentials')).fetchall()
        assert all(issued['access_token'] != row[0] for row in stored)
    assert client.get('/api/v1/agents/me', headers={'Authorization':'Bearer '+issued['access_token']}).status_code == 401


def test_invitation_only_post_redeems_and_skill_never_contains_secrets(agentid_client):
    client, _ = agentid_client
    owner = bootstrap(client)
    invite = client.post('/api/v1/agents/invitations', headers=owner, json={}).json()
    for _ in range(2):
        assert client.get(invite['onboarding_path']).status_code == 200
    redeemed = client.post('/api/v1/agents/invitations/redeem', json={'invitation': invite['invitation']})
    assert redeemed.status_code == 200, redeemed.text
    assert client.post('/api/v1/agents/invitations/redeem', json={'invitation':invite['invitation']}).status_code == 410
    token = redeemed.json()['access_token']
    headers={'Authorization':'Bearer '+token}
    created = client.post('/api/v1/agents/topics',headers=headers,json={'title':'权限内的研究任务'})
    assert created.status_code == 201,created.text
    skill=client.get('/api/v1/agents/skill.md',headers=headers)
    assert skill.status_code == 200,skill.text
    assert token not in skill.text and invite['invitation'] not in skill.text
    assert skill.headers['Cache-Control'] == 'no-store'


def test_public_discovery_filters_private_routes_and_describes_writes(agentid_client):
    client, _ = agentid_client
    manifest=client.get('/.well-known/manifest').json()
    assert manifest['openapi_url'].endswith('/api/v1/agents/openapi.json')
    schema=client.get('/api/v1/agents/openapi.json').json()
    assert not any('/internal' in path or '/admin' in path for path in schema['paths'])
    tools=client.get('/api/v1/agents/capabilities').json()['tools']
    discussion=next(t for t in tools if t['path']=='/api/v1/topics/{topic_id}/discussion' and t['method']=='POST')
    assert discussion['required_scope']=='discussion:write' and discussion['cost']=='model_usage'
    error=client.get('/api/v1/agents/runs/missing')
    assert error.status_code==401
    assert error.headers['X-Request-ID'] and error.json()['error']['code']=='authentication_required'
