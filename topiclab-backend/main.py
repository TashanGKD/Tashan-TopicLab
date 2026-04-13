"""Website backend - account/auth service. Separate from Resonnet."""

import logging
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
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.api import aminer as aminer_router
from app.api import apps as apps_router
from app.api import admin as admin_router
from app.api import auth as auth_router
from app.api import feedback as feedback_router
from app.api import literature as literature_router
from app.api import openclaw as openclaw_router
from app.api import openclaw_plugin as openclaw_plugin_router
from app.api import openclaw_routes as openclaw_dedicated_router
from app.api import openclaw_twin_runtime as openclaw_twin_runtime_router
from app.api import skill_hub as skill_hub_router
from app.api import skills as skills_router
from app.api import source_feed as source_feed_router
from app.api import topics as topics_router
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
from app.storage.database.topic_store import init_topic_tables

@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.getenv("DATABASE_URL"):
        try:
            from app.storage.database.postgres_client import init_auth_tables, ensure_site_feedback_schema
            init_auth_tables()
            init_topic_tables()
            try:
                ensure_site_feedback_schema()
            except Exception as e2:
                logging.getLogger(__name__).warning("site_feedback schema ensure failed (will retry on first feedback): %s", e2)
        except Exception as e:
            logging.getLogger(__name__).warning(f"Auth tables init skipped: {e}")

    yield
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
        request_id = f"req_{uuid4().hex}"
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
app.include_router(skills_router.router, tags=["skills"])
app.include_router(skills_router.router, prefix="/api/v1", tags=["skills-v1"])
app.include_router(skill_hub_router.router, prefix="/api/v1", tags=["skill-hub-v1"])
app.include_router(openclaw_router.router, prefix="/api/v1", tags=["openclaw"])
app.include_router(openclaw_plugin_router.router, prefix="/api/v1", tags=["openclaw-plugin"])
app.include_router(openclaw_dedicated_router.router, prefix="/api/v1", tags=["openclaw-dedicated"])
app.include_router(openclaw_twin_runtime_router.router, prefix="/api/v1", tags=["openclaw-twins"])
app.include_router(feedback_router.router, prefix="/api/v1", tags=["feedback-v1"])
app.include_router(admin_router.router, tags=["admin"])


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Return JSON on 500 so API clients (and reverse proxies) never get plain-text Internal Server Error."""
    log = logging.getLogger(__name__)
    log.error("Unhandled error on %s %s: %s", request.method, request.url.path, exc)
    log.debug(traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={"detail": "服务暂时不可用，请稍后重试。若问题持续，请联系管理员。"},
    )


@app.get("/health")
def health():
    return {"status": "ok", "service": "topiclab-backend"}
