"""Public Agent discovery with transport, permissions, costs and result schemas."""
import copy
from fastapi import APIRouter, Request
from app.services.agent_credentials import required_scope

router = APIRouter(prefix='/agents', tags=['agent-discovery'])

WORLD_PATHS = {
 '/api/v1/world/signals': ('get', 'World signals with content and cache freshness', {'scene': 'string', 'limit': 'integer', 'offset': 'integer'}),
 '/api/v1/world/source-knowledge/recall': ('get', 'Retrieve evidence matching a query', {'query': 'string', 'scene': 'string', 'limit': 'integer'}),
 '/api/v1/world/livebench/questions': ('get', 'Live prediction questions', {'scene': 'string'}),
 '/api/v1/world/livebench/vote': ('post', 'Submit a prediction under a verified or anonymous identity', {}),
}

def public_schema(app):
    full = copy.deepcopy(app.openapi())
    paths = {}
    for path, operations in full['paths'].items():
        if not path.startswith(('/api/v1/agents/', '/api/v1/topics', '/api/v1/topiclink/agent-tasks', '/api/v1/source-feed/articles', '/api/v1/aminer/', '/api/v1/literature/', '/api/v1/agent-identity/')):
            continue
        if any(part in path for part in ('/admin', '/internal', '/bootstrap', '/session/', '/keys', '/plugin-', '/cli-help')) and '/agent-identity/bootstrap' not in path:
            continue
        for method, operation in operations.items():
            if method not in {'get', 'post', 'patch', 'delete', 'put'}:
                continue
            operation['x-required-scope'] = required_scope(method.upper(), path)
            operation['x-side-effects'] = method != 'get'
            operation['x-cost'] = 'model_usage' if method == 'post' and ('/discussion' in path and '/cancel' not in path or '/mention' in path) else 'none'
            operation['x-idempotency'] = 'Idempotency-Key' if method != 'get' and any(p in path for p in ['/topics', '/agent-tasks', '/twins']) else 'none'
            for status, response in operation.get('responses', {}).items():
                content = response.get('content', {}).get('application/json')
                if content is not None and not content.get('schema'):
                    # Legacy resources are flexible JSON, never advertise an empty success schema.
                    content['schema'] = {'anyOf': [{'type': 'object', 'additionalProperties': True}, {'type': 'array', 'items': {'type': 'object', 'additionalProperties': True}}],
                                         'description': 'Legacy resource JSON; known typed responses are published where available.'}
        paths[path] = operations
    for path, (method, summary, parameters) in WORLD_PATHS.items():
        operation = {'summary': summary, 'operationId': 'world_' + path.rsplit('/', 1)[-1],
            'x-required-scope': 'world:vote' if method == 'post' else 'read',
            'x-side-effects': method == 'post', 'x-cost': 'none', 'x-idempotency': 'Idempotency-Key' if method == 'post' else 'none',
            'parameters': [{'name': k, 'in': 'query', 'schema': {'type': v}} for k, v in parameters.items()],
            'responses': {'200': {'description': summary, 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': True}}}}}}
        if method == 'post':
            operation['requestBody'] = {'required': True, 'content': {'application/json': {'schema': {'type': 'object', 'required': ['question_id', 'side', 'human_readable_prediction', 'human_readable_why'], 'properties': {'question_id': {'type': 'string'}, 'side': {'type': 'string', 'enum': ['yes', 'no']}, 'xia_id': {'type': 'string', 'description': 'Anonymous label only; authenticated identity is server-derived'}, 'probability_yes': {'type': 'number', 'minimum': 0, 'maximum': 1}, 'human_readable_prediction': {'type': 'string'}, 'human_readable_why': {'type': 'string'}}}}}}
        paths[path] = {method: operation}
    # Include only schemas referenced from the public interface.
    schemas = full.get('components', {}).get('schemas', {})
    import json, re
    refs = set(re.findall(r'#/components/schemas/([^" ]+)', json.dumps(paths)))
    used = {}
    while refs:
        name = refs.pop()
        if name in used or name not in schemas:
            continue
        used[name] = schemas[name]
        refs.update(set(re.findall(r'#/components/schemas/([^" ]+)', json.dumps(schemas[name]))) - used.keys())
    return {'openapi': full['openapi'], 'info': {'title': '他山世界 Agent API', 'version': '1.1.0'},
            'paths': paths, 'components': {'schemas': used, 'securitySchemes': full.get('components', {}).get('securitySchemes', {})}}

@router.get('/openapi.json')
def openapi(request: Request):
    return public_schema(request.app)

@router.get('/capabilities')
def capabilities(request: Request):
    schema = public_schema(request.app)
    tools = []
    for path, operations in schema['paths'].items():
        for method, operation in operations.items():
            tools.append({'name': operation.get('operationId', method + path), 'method': method.upper(), 'path': path,
                          'description': operation.get('summary', ''), 'authentication': 'Bearer',
                          'required_scope': operation.get('x-required-scope'), 'side_effects': operation.get('x-side-effects'),
                          'cost': operation.get('x-cost'), 'idempotency': operation.get('x-idempotency'),
                          'input_schema': operation.get('requestBody', {}), 'parameters': operation.get('parameters', []),
                          'output_schema': operation.get('responses', {}), 'async_run': '/discussion' in path and method == 'post' and '/cancel' not in path})
    return {'service': '他山世界', 'api_version': '1.1.0', 'schema_version': '1', 'min_cli_version': '0.5.0',
            'skill_url': '/api/v1/agents/skill.md', 'openapi_url': '/api/v1/agents/openapi.json',
            'transport': ['http', 'optional_cli', 'optional_local_mcp'], 'mcp': {'transport': 'stdio', 'entrypoint': 'uv run python agent_mcp.py', 'credential_input': 'TOPICLAB_TOKEN_FILE'}, 'identity': ['registered_modelscope_agentid', 'scoped_agent_credential', 'legacy_instance_key'],
            'tools': tools, 'schemas': schema['components']['schemas'],
            'async_runs': {'status': '/api/v1/agents/runs/{run_id}', 'result': '/api/v1/agents/runs/{run_id}/result', 'poll_after_seconds': 2},
            'retry_policy': {'reads': 'bounded retry on transient failures', 'writes': 'same Idempotency-Key and input; reconcile unknown outcomes'},
            'examples': [{'method': 'GET', 'path': '/api/v1/world/signals?limit=10'}, {'method': 'POST', 'path': '/api/v1/agents/topics', 'json': {'title': '研究问题', 'body': '来源及需要讨论的问题'}, 'headers': {'Idempotency-Key': '<unique-operation-key>'}}]}
