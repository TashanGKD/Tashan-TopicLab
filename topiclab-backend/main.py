"""Website backend - account/auth service. Separate from Resonnet."""

import logging
import asyncio
import os
import sys
import traceback
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

# Load .env from project root or topiclab-backend/
_env_root = Path(__file__).resolve().parent.parent / ".env"
_env_local = Path(__file__).resolve().parent / ".env"
_is_test_process = os.getenv("TOPICLAB_TESTING") == "1" or bool(os.getenv("PYTEST_CURRENT_TEST")) or "pytest" in " ".join(sys.argv).lower()
_dotenv_override = not _is_test_process
if _env_root.exists():
    from dotenv import load_dotenv
    load_dotenv(_env_root, override=_dotenv_override)
elif _env_local.exists():
    from dotenv import load_dotenv
    load_dotenv(_env_local, override=_dotenv_override)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.api import aminer as aminer_router
from app.api import apps as apps_router
from app.api import admin as admin_router
from app.api import agent4s as agent4s_router
from app.api import agent_identity as agent_identity_router
from app.api import agent_runs as agent_runs_router
from app.api import agent_credentials as agent_credentials_router
from app.api import agent_discovery as agent_discovery_router
from app.api import auth as auth_router
from app.api import feedback as feedback_router
from app.api import inspiration as inspiration_router
from app.api import literature as literature_router
from app.api import mcp_hub as mcp_hub_router
from app.api import openclaw as openclaw_router
from app.api import openclaw_plugin as openclaw_plugin_router
from app.api import openclaw_routes as openclaw_dedicated_router
from app.api import openclaw_twin_runtime as openclaw_twin_runtime_router
from app.api import site as site_router
from app.api import skill_hub as skill_hub_router
from app.api import skills as skills_router
from app.api import source_feed as source_feed_router
from app.api import topiclink as topiclink_router
from app.api import topics as topics_router
from app.api import youth_ted as youth_ted_router
from app.services.http_client import close_shared_async_clients
from app.services.openclaw_runtime import record_activity_event
from app.services.request_audit import (
    clear_authenticated_actor_context,
    estimate_token_count,
    extract_text_for_token_estimate,
    get_authenticated_actor_context,
    resolve_bind_key_actor,
    sanitize_query_params,
    should_capture_response_body,
    should_capture_request_body,
    summarize_request_body,
    summarize_response_body,
)
from app.storage.database.postgres_client import get_db_session
from app.storage.database.topic_store import init_topic_tables

@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.getenv("DATABASE_URL"):
        try:
            from app.storage.database.postgres_client import init_auth_tables, ensure_site_feedback_schema
            from app.storage.database.inspiration_store import ensure_inspiration_schema_and_seed
            from app.storage.database.site_assets_store import ensure_site_assets_schema_and_seed
            from app.storage.database.youth_ted_store import ensure_youth_ted_schema_and_seed
            init_auth_tables()
            init_topic_tables()
            try:
                topiclink_router.initialize_topiclink_storage()
            except Exception as e2:
                logging.getLogger(__name__).warning("TopicLink Zvec initialization failed: %s", e2)
            ensure_site_assets_schema_and_seed()
            ensure_youth_ted_schema_and_seed()
            ensure_inspiration_schema_and_seed()
            try:
                ensure_site_feedback_schema()
            except Exception as e2:
                logging.getLogger(__name__).warning("site_feedback schema ensure failed (will retry on first feedback): %s", e2)
            try:
                topiclink_router.start_topiclink_metadata_worker()
            except Exception as e2:
                logging.getLogger(__name__).warning("TopicLink metadata worker start skipped: %s", e2)
        except Exception as e:
            logging.getLogger(__name__).warning(f"Auth tables init skipped: {e}")

    from app.services.agent_runs import recovery_loop
    recovery = asyncio.create_task(recovery_loop())
    try:
        yield
    finally:
        recovery.cancel()
        await asyncio.gather(recovery, return_exceptions=True)
        await topiclink_router.stop_topiclink_metadata_worker()
        await close_shared_async_clients()

app = FastAPI(
    title="TopicLab Backend (Account)",
    version="0.1.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _parse_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer":
        return None
    token = value.strip()
    return token or None


class ActorAuditMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        clear_authenticated_actor_context()
        request = Request(scope)
        request_id = scope.get("state", {}).get("request_id") or f"req_{uuid4().hex}"
        scope.setdefault("state", {})["audit_request_id"] = request_id

        content_type = request.headers.get("content-type")
        content_length_header = request.headers.get("content-length")
        try:
            content_length = int(content_length_header) if content_length_header else None
        except ValueError:
            content_length = None
        should_capture_body = should_capture_request_body(content_type, content_length)

        captured_body = bytearray()
        captured_response_body = bytearray()
        status_code = 500
        response_content_type = None
        response_content_length = None
        capture_response_body = False
        response_body_truncated = False
        error_code = None

        bind_key_actor = None
        bearer_token = _parse_bearer_token(request.headers.get("authorization"))
        if bearer_token and bearer_token.startswith("tlos_"):
            bind_key_actor = resolve_bind_key_actor(bearer_token)
        elif request.query_params.get("key", "").startswith("tlos_"):
            bind_key_actor = resolve_bind_key_actor(request.query_params.get("key"))

        async def audit_receive() -> Message:
            message = await receive()
            if (
                should_capture_body
                and message["type"] == "http.request"
                and len(captured_body) < 32 * 1024
            ):
                captured_body.extend(message.get("body", b""))
            return message

        async def audit_send(message: Message) -> None:
            nonlocal status_code, response_content_type, response_content_length, capture_response_body, response_body_truncated
            if message["type"] == "http.response.start":
                status_code = int(message["status"])
                headers = {
                    key.decode("latin-1").lower(): value.decode("latin-1")
                    for key, value in message.get("headers", [])
                }
                response_content_type = headers.get("content-type")
                content_length_header = headers.get("content-length")
                try:
                    response_content_length = int(content_length_header) if content_length_header else None
                except ValueError:
                    response_content_length = None
                capture_response_body = should_capture_response_body(response_content_type, response_content_length)
            elif message["type"] == "http.response.body" and capture_response_body:
                chunk = message.get("body", b"")
                remaining = max(0, 32 * 1024 - len(captured_response_body))
                if chunk and remaining > 0:
                    captured_response_body.extend(chunk[:remaining])
                if len(chunk) > remaining or message.get("more_body"):
                    response_body_truncated = True
            await send(message)

        try:
            await self.app(scope, audit_receive, audit_send)
        except Exception as exc:
            error_code = exc.__class__.__name__
            raise
        finally:
            actor = get_authenticated_actor_context() or bind_key_actor
            route = scope.get("route")
            route_template = getattr(route, "path", None) or request.url.path
            if actor and (actor.get("bound_user_id") is not None or actor.get("openclaw_agent_id") is not None):
                request_query_string = request.url.query or ""
                request_input_text = "\n".join(
                    part for part in [
                        request.url.path,
                        request_query_string,
                        extract_text_for_token_estimate(bytes(captured_body), content_type) if should_capture_body else "",
                    ]
                    if part
                )
                response_output_text = extract_text_for_token_estimate(bytes(captured_response_body), response_content_type)
                input_tokens_estimated = estimate_token_count(request_input_text)
                output_tokens_estimated = estimate_token_count(response_output_text)
                payload = {
                    "path": request.url.path,
                    "route_template": route_template,
                    "query": sanitize_query_params(request.query_params),
                    "body": summarize_request_body(bytes(captured_body), content_type) if should_capture_body else None,
                    "content_type": content_type,
                    "authentication": {
                        "auth_type": actor.get("auth_type"),
                        "credential_type": actor.get("credential_type"),
                        "external_agent_id": actor.get("external_agent_id"),
                        "external_issuer": actor.get("external_issuer"),
                    },
                }
                result = {
                    "status_code": status_code,
                    "response_content_type": response_content_type,
                    "response_body": summarize_response_body(bytes(captured_response_body), response_content_type) if capture_response_body else None,
                    "response_body_truncated": response_body_truncated,
                    "token_usage": {
                        "method": "heuristic_cjk_ascii_v1",
                        "input_tokens_estimated": input_tokens_estimated,
                        "output_tokens_estimated": output_tokens_estimated,
                        "total_tokens_estimated": input_tokens_estimated + output_tokens_estimated,
                        "input_chars_counted": len(request_input_text),
                        "output_chars_counted": len(response_output_text),
                    },
                }
                try:
                    record_activity_event(
                        openclaw_agent_id=actor.get("openclaw_agent_id"),
                        bound_user_id=actor.get("bound_user_id"),
                        request_id=request_id,
                        event_type="http.request",
                        action_name="http_request",
                        target_type="http_route",
                        target_id=route_template,
                        http_method=request.method,
                        route=route_template,
                        success=status_code < 500,
                        status_code=status_code,
                        error_code=error_code,
                        payload=payload,
                        result=result,
                        client_ip=request.headers.get("x-forwarded-for") or (request.client.host if request.client else None),
                        user_agent=request.headers.get("user-agent"),
                    )
                except Exception:
                    logging.getLogger(__name__).exception("request audit logging failed for %s %s", request.method, request.url.path)
            clear_authenticated_actor_context()


app.add_middleware(ActorAuditMiddleware)

app.include_router(auth_router.router, prefix="/auth", tags=["auth"])
app.include_router(auth_router.router, prefix="/api/v1/auth", tags=["auth-v1"])
app.include_router(apps_router.router, prefix="/api/v1", tags=["apps-v1"])
app.include_router(source_feed_router.router, prefix="/source-feed", tags=["source-feed"])
app.include_router(source_feed_router.router, prefix="/api/v1/source-feed", tags=["source-feed-v1"])
app.include_router(literature_router.router, prefix="/literature", tags=["literature"])
app.include_router(literature_router.router, prefix="/api/v1/literature", tags=["literature-v1"])
app.include_router(aminer_router.router, prefix="/aminer", tags=["aminer"])
app.include_router(aminer_router.router, prefix="/api/v1/aminer", tags=["aminer-v1"])
app.include_router(topics_router.router, tags=["topics"])
app.include_router(topics_router.router, prefix="/api/v1", tags=["topics-v1"])
app.include_router(topiclink_router.router, tags=["topiclink"])
app.include_router(topiclink_router.router, prefix="/api/v1", tags=["topiclink-v1"])
app.include_router(skills_router.router, tags=["skills"])
app.include_router(skills_router.router, prefix="/api/v1", tags=["skills-v1"])
app.include_router(skill_hub_router.router, prefix="/api/v1", tags=["skill-hub-v1"])
app.include_router(mcp_hub_router.router, prefix="/api/v1", tags=["mcp-hub-v1"])
app.include_router(openclaw_router.router, prefix="/api/v1", tags=["openclaw"])
app.include_router(openclaw_plugin_router.router, prefix="/api/v1", tags=["openclaw-plugin"])
app.include_router(openclaw_dedicated_router.router, prefix="/api/v1", tags=["openclaw-dedicated"])
app.include_router(openclaw_twin_runtime_router.router, prefix="/api/v1", tags=["openclaw-twins"])
app.include_router(feedback_router.router, prefix="/api/v1", tags=["feedback-v1"])
app.include_router(site_router.router, prefix="/api/v1", tags=["site-v1"])
app.include_router(agent4s_router.router, prefix="/api/v1", tags=["agent4s-v1"])
app.include_router(agent_discovery_router.router, prefix="/api/v1")
app.include_router(agent_credentials_router.router, prefix="/api/v1")
app.include_router(agent_runs_router.router, prefix="/api/v1")
app.include_router(agent_identity_router.router, prefix="/api/v1", tags=["agent-identity-v1"])
app.include_router(youth_ted_router.router, prefix="/api/v1", tags=["youth-ted-v1"])
app.include_router(inspiration_router.router, prefix="/api/v1", tags=["inspiration-v1"])
app.include_router(admin_router.router, tags=["admin"])


# Canonical Agent routes keep older OpenClaw clients working through aliases.
from fastapi.routing import APIRouter, APIRoute
from app.services.agent_requests import AgentMutationRoute
canonical_agents = APIRouter(route_class=AgentMutationRoute)
for legacy_router in (openclaw_router.router, openclaw_dedicated_router.router, openclaw_twin_runtime_router.router, openclaw_plugin_router.router):
    for route in legacy_router.routes:
        if isinstance(route, APIRoute) and route.path.startswith('/openclaw/'):
            relative_path = route.path[len('/openclaw/'):]
            if relative_path.startswith('agents/'):
                relative_path = 'instances/' + relative_path[len('agents/'):]
            canonical_agents.add_api_route('/agents/' + relative_path, route.endpoint,
                methods=list(route.methods), response_model=route.response_model, status_code=route.status_code,
                dependencies=route.dependencies, response_class=route.response_class, tags=['agents'])
app.include_router(canonical_agents, prefix='/api/v1')

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Return JSON on 500 so API clients (and reverse proxies) never get plain-text Internal Server Error."""
    log = logging.getLogger(__name__)
    log.error("Unhandled error on %s %s: %s", request.method, request.url.path, exc)
    log.debug(traceback.format_exc())
    if request.url.path.startswith("/api/v1/agents/"):
        return agent_error(request, 500, {"code":"internal_error","message":"Service temporarily unavailable","retryable":False})
    return JSONResponse(
        status_code=500,
        content={"detail": "服务暂时不可用，请稍后重试。若问题持续，请联系管理员。"},
    )


@app.get("/health")
def health():
    return {"status": "ok", "service": "topiclab-backend"}


@app.get("/.well-known/manifest")
def agent_identity_manifest(request: Request):
    client_id = os.getenv("AGENTID_CLIENT_ID", "").strip()
    public_base_url = os.getenv("AGENTID_PUBLIC_BASE_URL", "").strip().rstrip("/")
    if not public_base_url:
        public_base_url = str(request.base_url).rstrip("/")

    return {
        "service": "他山世界",
        "api_version": "1.1.0",
        "skill_url": f"{public_base_url}/api/v1/agents/skill.md",
        "capabilities_url": f"{public_base_url}/api/v1/agents/capabilities",
        "openapi_url": f"{public_base_url}/api/v1/agents/openapi.json",
        "agent_identity": {
            "supported": bool(client_id),
            "provider": "modelscope",
            "issuer": "https://www.modelscope.cn/openapi/v1",
            "client_id": client_id,
            "onboarding_mode": "preferred" if client_id else "disabled",
            "token_transport": {
                "type": "bearer",
                "header": "Authorization",
            },
            "bootstrap_url": f"{public_base_url}/api/v1/agent-identity/bootstrap",
            "existing_agent_binding": {
                "url": f"{public_base_url}/api/v1/agent-identity/bind",
                "topiclab_key_header": "X-TopicLab-Agent-Key",
            },
        },
    }


@app.get("/health/ready")
def ready_health():
    try:
        with get_db_session() as session:
            session.execute(text("SELECT 1")).scalar_one()
    except Exception as exc:
        logging.getLogger(__name__).warning("readiness database probe failed: %s", exc)
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "service": "topiclab-backend", "database": "error"},
        )
    return {"status": "ready", "service": "topiclab-backend", "database": "ok"}


@app.middleware("http")
async def scoped_agent_credentials(request: Request, call_next):
    token = request.headers.get('Authorization', '').removeprefix('Bearer ').strip()
    if token.startswith('tlag_'):
        from app.services.agent_credentials import verify, check_scope
        from starlette.concurrency import run_in_threadpool
        from fastapi import HTTPException
        actor = await run_in_threadpool(verify, token)
        if not actor:
            return agent_error(request, 401, {'code': 'credential_expired_or_revoked', 'retryable': False})
        try:
            check_scope(actor, request.method, request.url.path)
        except HTTPException as exc:
            return agent_error(request, exc.status_code, exc.detail)
    response = await call_next(request)
    if token or request.url.query:
        if request.url.path.startswith('/api/v1/agents/'):
            response.headers['Cache-Control'] = 'no-store'
    return response


@app.middleware('http')
async def agent_response_metadata(request: Request, call_next):
    import re
    from uuid import uuid4
    candidate = request.headers.get('X-Request-ID', '')
    request.state.request_id = candidate if re.fullmatch(r'[A-Za-z0-9_-]{8,64}', candidate) else uuid4().hex
    response = await call_next(request)
    response.headers['X-Request-ID'] = request.state.request_id
    response.headers['X-Agent-API-Version'] = '1.1.0'
    if request.url.path.startswith('/api/v1/openclaw/'):
        response.headers['Deprecation'] = 'true'
        response.headers['Link'] = '</api/v1/agents/capabilities>; rel="successor-version"'
    if response.status_code in {429, 502, 503, 504}:
        response.headers.setdefault('Retry-After', '2')
    return response

from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.exception_handlers import http_exception_handler, request_validation_exception_handler
from fastapi.exceptions import RequestValidationError

def agent_error(request, status, detail, headers=None):
    structured = detail if isinstance(detail, dict) else {}
    code = structured.get('code') or {400:'invalid_request',401:'authentication_required',403:'permission_denied',404:'not_found',409:'conflict',410:'expired',422:'validation_error',429:'rate_limited',503:'service_unavailable'}.get(status, 'request_failed')
    return JSONResponse(status_code=status, headers=headers, content={'detail': detail,
        'error': {'code': code, 'message': structured.get('message') or (detail if isinstance(detail, str) else code),
                  'request_id': getattr(request.state, 'request_id', None),
                  'retryable': structured.get('retryable', request.method == 'GET' and status in {429,502,503,504})}})

@app.exception_handler(StarletteHTTPException)
async def agent_http_error(request: Request, exc: StarletteHTTPException):
    if request.url.path.startswith('/api/v1/agents/'):
        return agent_error(request, exc.status_code, exc.detail, exc.headers)
    return await http_exception_handler(request, exc)

@app.exception_handler(RequestValidationError)
async def agent_validation_error(request: Request, exc: RequestValidationError):
    if request.url.path.startswith('/api/v1/agents/'):
        detail = [{'loc': list(item['loc']), 'type': item['type'], 'msg': item['msg']} for item in exc.errors()]
        return agent_error(request, 422, detail)
    return await request_validation_exception_handler(request, exc)
