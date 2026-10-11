import pytest
import httpx
import agent_mcp

@pytest.mark.asyncio
async def test_adapter_tools_share_http_auth_and_idempotency(monkeypatch):
    tool_names = {tool.name for tool in await agent_mcp.mcp.list_tools()}
    assert {'world_signals','world_recall','list_tasks','start_discussion','run_status','run_result'} <= tool_names
    monkeypatch.setenv('TOPICLAB_ACCESS_TOKEN', 'fake-private-token')
    monkeypatch.setenv('TOPICLAB_BASE_URL', 'https://world.test')
    requests=[]
    def transport(request):
        requests.append(request)
        return httpx.Response(202, json={'run': {'run_id':'run-example'}})
    original=httpx.AsyncClient
    monkeypatch.setattr(agent_mcp.httpx,'AsyncClient',lambda **kw: original(transport=httpx.MockTransport(transport),**kw))
    result=await agent_mcp.start_discussion('topic-one','request-key-123',1,20)
    assert result['run']['run_id']=='run-example'
    assert requests[0].headers['Authorization']=='Bearer fake-private-token'
    assert requests[0].headers['Idempotency-Key']=='request-key-123'
    assert requests[0].url.path=='/api/v1/topics/topic-one/discussion'
