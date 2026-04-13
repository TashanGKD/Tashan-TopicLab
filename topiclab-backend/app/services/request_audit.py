"""Helpers for request-scoped actor audit logging."""

from __future__ import annotations

import json
import math
import re
from contextvars import ContextVar
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.services.openclaw_runtime import get_openclaw_agent_by_skill_token

_request_actor_context: ContextVar[dict[str, Any] | None] = ContextVar("request_actor_context", default=None)

_REDACTED = "[REDACTED]"
_MAX_BODY_BYTES = 32 * 1024
_MAX_STRING_LENGTH = 1024
_MAX_COLLECTION_ITEMS = 50
_TEXTUAL_CONTENT_PREFIXES = (
    "application/json",
    "application/problem+json",
    "application/x-www-form-urlencoded",
    "text/",
)
_TOKEN_SEGMENT_RE = re.compile(
    r"[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]|[A-Za-z0-9_]+|[^\s]",
    re.UNICODE,
)
_SENSITIVE_KEYS = {
    "access_token",
    "agent_token",
    "authorization",
    "bind_key",
    "code",
    "guest_claim_token",
    "key",
    "openclaw_key",
    "password",
    "refresh_token",
    "skill_token",
    "token",
}
_SENSITIVE_QUERY_KEY_FRAGMENTS = {
    "credential",
    "expires",
    "keyid",
    "secret",
    "signature",
    "token",
}


def clear_authenticated_actor_context() -> None:
    _request_actor_context.set(None)


def get_authenticated_actor_context() -> dict[str, Any] | None:
    actor = _request_actor_context.get()
    return dict(actor) if actor else None


def set_authenticated_actor_context(user: dict[str, Any] | None) -> None:
    if not user:
        return
    bound_user_id = user.get("sub")
    openclaw_agent_id = user.get("openclaw_agent_id")
    actor = {
        "bound_user_id": int(bound_user_id) if bound_user_id is not None else None,
        "openclaw_agent_id": int(openclaw_agent_id) if openclaw_agent_id is not None else None,
        "auth_type": user.get("auth_type"),
        "agent_uid": user.get("agent_uid"),
    }
    if actor["bound_user_id"] is None and actor["openclaw_agent_id"] is None:
        return
    _request_actor_context.set(actor)


def resolve_bind_key_actor(bind_key: str | None) -> dict[str, Any] | None:
    if not bind_key or not bind_key.startswith("tlos_"):
        return None
    agent = get_openclaw_agent_by_skill_token(bind_key)
    if not agent:
        return None
    bound_user_id = agent.get("bound_user_id")
    return {
        "bound_user_id": int(bound_user_id) if bound_user_id is not None else None,
        "openclaw_agent_id": int(agent["id"]),
        "auth_type": "openclaw_bind_key",
        "agent_uid": agent.get("agent_uid"),
    }


def should_capture_request_body(content_type: str | None, content_length: int | None) -> bool:
    if not _is_textual_content_type(content_type):
        return False
    return content_length is None or content_length <= _MAX_BODY_BYTES


def should_capture_response_body(content_type: str | None, content_length: int | None) -> bool:
    if not _is_textual_content_type(content_type):
        return False
    return content_length is None or content_length <= _MAX_BODY_BYTES


def _normalize_content_type(content_type: str | None) -> str:
    return (content_type or "").split(";", 1)[0].strip().lower()


def _is_textual_content_type(content_type: str | None) -> bool:
    normalized = _normalize_content_type(content_type)
    return any(normalized.startswith(prefix) for prefix in _TEXTUAL_CONTENT_PREFIXES)


def _looks_sensitive_key(key: str | None) -> bool:
    if not key:
        return False
    lowered = key.lower()
    if lowered in _SENSITIVE_KEYS:
        return True
    return any(fragment in lowered for fragment in _SENSITIVE_QUERY_KEY_FRAGMENTS)


def _redact_url_query_string(value: str) -> str:
    if "://" not in value or "?" not in value:
        return value
    try:
        parsed = urlsplit(value)
    except Exception:
        return value
    if not parsed.scheme or not parsed.netloc or not parsed.query:
        return value
    query_pairs = parse_qsl(parsed.query, keep_blank_values=True)
    if not query_pairs:
        return value
    redacted_pairs = []
    changed = False
    for key, query_value in query_pairs:
        if _looks_sensitive_key(key):
            redacted_pairs.append((key, _REDACTED))
            changed = True
        else:
            redacted_pairs.append((key, query_value))
    if not changed:
        return value
    return urlunsplit(parsed._replace(query=urlencode(redacted_pairs, doseq=True)))


def sanitize_for_audit(value: Any, *, parent_key: str | None = None) -> Any:
    if _looks_sensitive_key(parent_key):
        return _REDACTED
    if isinstance(value, dict):
        items = list(value.items())[:_MAX_COLLECTION_ITEMS]
        sanitized = {
            str(key): sanitize_for_audit(item, parent_key=str(key))
            for key, item in items
        }
        if len(value) > _MAX_COLLECTION_ITEMS:
            sanitized["_truncated_keys"] = len(value) - _MAX_COLLECTION_ITEMS
        return sanitized
    if isinstance(value, list):
        items = [sanitize_for_audit(item, parent_key=parent_key) for item in value[:_MAX_COLLECTION_ITEMS]]
        if len(value) > _MAX_COLLECTION_ITEMS:
            items.append({"_truncated_items": len(value) - _MAX_COLLECTION_ITEMS})
        return items
    if isinstance(value, tuple):
        return sanitize_for_audit(list(value), parent_key=parent_key)
    if isinstance(value, str):
        value = _redact_url_query_string(value)
        if len(value) <= _MAX_STRING_LENGTH:
            return value
        return f"{value[:_MAX_STRING_LENGTH]}...[truncated {len(value) - _MAX_STRING_LENGTH} chars]"
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return sanitize_for_audit(str(value), parent_key=parent_key)


def sanitize_query_params(query_params: Any) -> dict[str, Any]:
    if query_params is None:
        return {}
    grouped: dict[str, list[str]] = {}
    for key, value in query_params.multi_items():
        grouped.setdefault(str(key), []).append(value)
    normalized = {
        key: values[0] if len(values) == 1 else values
        for key, values in grouped.items()
    }
    return sanitize_for_audit(normalized)


def summarize_request_body(body: bytes, content_type: str | None) -> Any:
    if not body:
        return None
    normalized = _normalize_content_type(content_type)
    if normalized.startswith("application/json"):
        try:
            parsed = json.loads(body.decode("utf-8"))
        except Exception:
            return {"_parse_error": "invalid_json", "size_bytes": len(body)}
        return sanitize_for_audit(parsed)
    if normalized.startswith("application/x-www-form-urlencoded"):
        try:
            decoded = body.decode("utf-8")
        except UnicodeDecodeError:
            return {"_parse_error": "invalid_form_encoding", "size_bytes": len(body)}
        pairs = [segment.split("=", 1) for segment in decoded.split("&") if segment]
        form_data = {}
        for pair in pairs[:_MAX_COLLECTION_ITEMS]:
            key = pair[0]
            value = pair[1] if len(pair) > 1 else ""
            form_data.setdefault(key, []).append(value)
        normalized_form = {
            key: values[0] if len(values) == 1 else values
            for key, values in form_data.items()
        }
        return sanitize_for_audit(normalized_form)
    if normalized.startswith("text/"):
        try:
            decoded = body.decode("utf-8")
        except UnicodeDecodeError:
            decoded = body.decode("utf-8", errors="ignore")
        return sanitize_for_audit(decoded)
    return {"size_bytes": len(body)}


def summarize_response_body(body: bytes, content_type: str | None) -> Any:
    return summarize_request_body(body, content_type)


def extract_text_for_token_estimate(body: bytes, content_type: str | None) -> str:
    if not body or not _is_textual_content_type(content_type):
        return ""
    try:
        return body.decode("utf-8")
    except UnicodeDecodeError:
        return body.decode("utf-8", errors="ignore")


def estimate_token_count(text: str) -> int:
    if not text:
        return 0
    total = 0
    for match in _TOKEN_SEGMENT_RE.finditer(text):
        segment = match.group(0)
        if len(segment) == 1 and not segment.isascii():
            total += 1
            continue
        if segment.isascii() and (segment[0].isalnum() or segment[0] == "_"):
            total += max(1, math.ceil(len(segment) / 4))
            continue
        if segment.strip():
            total += 1
    return total
