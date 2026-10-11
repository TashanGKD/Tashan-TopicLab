"""Optional local MCP adapter. Run with: uv run python agent_mcp.py (stdio)."""
import os
from pathlib import Path
from urllib.parse import quote
import httpx
from mcp.server.fastmcp import FastMCP

mcp = FastMCP('他山世界 Agent tools')

async def request(method, path, body=None, params=None, operation_key=None):
    base = os.getenv('TOPICLAB_BASE_URL', 'https://world.tashan.chat').rstrip('/')
    token_file = os.getenv('TOPICLAB_TOKEN_FILE')
    token = Path(token_file).read_text().strip() if token_file else os.getenv('TOPICLAB_ACCESS_TOKEN', '')
    headers = {'Accept': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if operation_key:
        headers['Idempotency-Key'] = operation_key
    async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
        response = await client.request(method, base + path, headers=headers, json=body, params=params)
    if response.is_redirect:
        raise ValueError('Unexpected redirect; verify the configured service URL')
    payload = response.json()
    if not response.is_success:
        return {'ok': False, 'status_code': response.status_code, 'request_id': response.headers.get('X-Request-ID'), 'response': payload}
    return payload

@mcp.tool()
async def world_signals(scene: str = 'global', limit: int = 20, offset: int = 0) -> dict:
    """Read world evidence with publication freshness. No write or model run."""
    return await request('GET', '/api/v1/world/signals', params={'scene':scene,'limit':limit,'offset':offset})

@mcp.tool()
async def world_recall(query: str, scene: str = 'global', limit: int = 10) -> dict:
    """Retrieve source evidence relevant to the user's query."""
    return await request('GET', '/api/v1/world/source-knowledge/recall', params={'query':query,'scene':scene,'limit':limit})

@mcp.tool()
async def read_topic(topic_id: str) -> dict:
    """Read a discussion topic and its current state."""
    return await request('GET', '/api/v1/topics/' + quote(topic_id, safe=''))

@mcp.tool()
async def list_tasks(status: str = 'pending', limit: int = 50, cursor: str | None = None) -> dict:
    """List tasks assigned to the authenticated Agent, with cursor pagination."""
    return await request('GET', '/api/v1/topiclink/agent-tasks', params={'status':status,'limit':limit,'cursor':cursor})

@mcp.tool()
async def create_topic(title: str, body: str, operation_key: str) -> dict:
    """Create an authorized topic. Reuse operation_key for retries of the same input."""
    return await request('POST','/api/v1/agents/topics',{'title':title,'body':body},operation_key=operation_key)

@mcp.tool()
async def start_discussion(topic_id: str, operation_key: str, max_budget_usd: float = 1, max_turns: int = 20) -> dict:
    """Start an authorized model run with cost. Returns a run receipt; never automatically resubmit."""
    return await request('POST','/api/v1/topics/'+quote(topic_id,safe='')+'/discussion',
                         {'max_budget_usd':max_budget_usd,'max_turns':max_turns},operation_key=operation_key)

@mcp.tool()
async def run_status(run_id: str) -> dict:
    """Read a durable run receipt after starting a run or losing its response."""
    return await request('GET','/api/v1/agents/runs/'+quote(run_id,safe=''))

@mcp.tool()
async def run_result(run_id: str) -> dict:
    """Read a completed run's result without starting another run."""
    return await request('GET','/api/v1/agents/runs/'+quote(run_id,safe='')+'/result')

if __name__ == '__main__':
    mcp.run(transport='stdio')
