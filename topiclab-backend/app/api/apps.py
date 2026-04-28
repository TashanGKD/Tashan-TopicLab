"""App catalog endpoints backed by mergeable JSON manifests."""

from __future__ import annotations

import json
import re
from hashlib import sha256
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import security, verify_access_token
from app.api.topics import ToggleActionRequest, _normalize_topic_category
from app.services.source_feed_pipeline import hydrate_topic_workspace
from app.storage.database.topic_store import create_topic, get_app_topic_summaries, get_topic, get_topic_id_by_app, link_app_to_topic, list_app_catalog_items, set_topic_user_action

router = APIRouter(prefix="/apps", tags=["apps"])


class EnsureAppTopicResponse(BaseModel):
    topic: dict[str, Any]
    created: bool
    catalog_version: str


async def _get_optional_user(credentials=Depends(security)) -> dict | None:
    if not credentials:
        return None
    return verify_access_token(credentials.credentials)


def _resolve_owner_identity(user: dict | None) -> tuple[int | None, str | None]:
    if not user:
        return None, None
    raw_user_id = user.get("sub")
    if raw_user_id is None:
        return None, user.get("auth_type")
    return int(raw_user_id), user.get("auth_type", "jwt")


def _require_owner_identity(user: dict | None) -> tuple[int, str]:
    user_id, auth_type = _resolve_owner_identity(user)
    if user_id is None:
        raise HTTPException(status_code=401, detail="未登录")
    return user_id, auth_type or "jwt"


def _load_catalog() -> tuple[list[dict[str, Any]], str]:
    merged: dict[str, dict[str, Any]] = {}
    digest = sha256()
    for item in list_app_catalog_items():
        app_id = str(item.get("id") or "").strip()
        if not app_id:
            continue
        merged[app_id] = {
            **merged.get(app_id, {}),
            **item,
        }
    def normalized_sort_label(item: dict[str, Any]) -> str:
        name = str(item.get("name") or "").strip()
        app_id = str(item.get("id") or "").strip()
        candidate = name or app_id
        if not candidate:
            return ""
        if re.search(r"[^\x00-\x7F]", candidate):
            return app_id.casefold()
        return candidate.casefold()

    def sort_key(item: dict[str, Any]) -> tuple[int, int, str, str]:
        sort_weight = int(item.get("sort_weight") or (-100 if item.get("pinned") else 0))
        builtin_rank = 0 if bool(item.get("builtin")) else 1
        return (sort_weight, builtin_rank, normalized_sort_label(item), str(item.get("id") or "").casefold())

    apps = sorted(merged.values(), key=sort_key)
    for item in apps:
        digest.update(json.dumps(item, ensure_ascii=False, sort_keys=True).encode("utf-8"))
    return apps, digest.hexdigest()[:16]


async def _ensure_executor_workspace_for_topic(topic_id: str) -> dict[str, Any]:
    from app.services.resonnet_client import request_json

    topic = get_topic(topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    await request_json(
        "POST",
        "/executor/topics/bootstrap",
        json_body={
            "topic_id": topic["id"],
            "topic_title": topic["title"],
            "topic_body": topic["body"],
            "num_rounds": topic.get("num_rounds") or 5,
            "use_ai_generated_roles": False,
        },
        timeout=120.0,
    )
    return topic


def _build_app_topic_body(app: dict[str, Any]) -> str:
    seed = (app.get("openclaw") or {}).get("topic_seed") or {}
    body = str(seed.get("body") or "").strip()
    if body:
        return body

    lines = [
        f"应用名称：{app.get('name') or app.get('id')}",
    ]
    if app.get("command"):
        lines.append(f"命令：{app['command']}")
    links = app.get("links") or {}
    if links.get("docs"):
        lines.append(f"文档：{links['docs']}")
    if links.get("repo"):
        lines.append(f"仓库：{links['repo']}")
    if app.get("summary"):
        lines.extend(["", str(app["summary"])])
    return "\n".join(lines)


def _default_app_interaction() -> dict[str, Any]:
    return {
        "likes_count": 0,
        "shares_count": 0,
        "favorites_count": 0,
        "liked": False,
        "favorited": False,
    }


def _serialize_app_item(
    item: dict[str, Any],
    *,
    user_id: int | None = None,
    auth_type: str | None = None,
    topic_summary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = dict(item)
    if topic_summary is not None:
        payload.update(topic_summary)
        payload["interaction"] = topic_summary.get("interaction") or _default_app_interaction()
        return payload

    linked_topic_id = get_topic_id_by_app(str(item.get("id") or ""))
    payload["linked_topic_id"] = linked_topic_id
    payload["interaction"] = _default_app_interaction()
    if not linked_topic_id:
        return payload

    linked_topic = get_topic(linked_topic_id, user_id=user_id, auth_type=auth_type)
    if linked_topic is None:
        return payload

    payload["linked_topic_posts_count"] = linked_topic.get("posts_count")
    payload["interaction"] = dict(linked_topic.get("interaction") or _default_app_interaction())
    return payload


def _serialize_app_list(
    apps: list[dict[str, Any]],
    *,
    user_id: int | None = None,
    auth_type: str | None = None,
) -> list[dict[str, Any]]:
    summaries = get_app_topic_summaries(
        [str(item.get("id") or "") for item in apps],
        user_id=user_id,
        auth_type=auth_type,
    )
    return [
        _serialize_app_item(
            item,
            user_id=user_id,
            auth_type=auth_type,
            topic_summary=summaries.get(str(item.get("id") or "")),
        )
        for item in apps
    ]


def _find_app_or_404(app_id: str) -> tuple[dict[str, Any], str]:
    apps, version = _load_catalog()
    target = next((item for item in apps if item.get("id") == app_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="App not found")
    return target, version


def _ensure_app_topic_link(app_id: str, app: dict[str, Any]) -> tuple[str, bool]:
    existing_topic_id = get_topic_id_by_app(app_id)
    if existing_topic_id:
        return existing_topic_id, False

    seed = (app.get("openclaw") or {}).get("topic_seed") or {}
    topic = create_topic(
        f"【应用】{str(app.get('name') or app_id)}",
        _build_app_topic_body(app),
        _normalize_topic_category(seed.get("category")) or "app",
    )
    linked_topic_id = link_app_to_topic(
        app_id,
        topic["id"],
        name=str(app.get("name") or ""),
        command=str(app.get("command") or ""),
        summary=str(app.get("summary") or ""),
        docs_url=str(((app.get("links") or {}).get("docs")) or ""),
        repo_url=str(((app.get("links") or {}).get("repo")) or ""),
        icon=str(app.get("icon") or ""),
    )
    return linked_topic_id, linked_topic_id == topic["id"]


@router.get("")
async def list_apps(user: dict | None = Depends(_get_optional_user)):
    apps, version = _load_catalog()
    user_id, auth_type = _resolve_owner_identity(user)
    return {
        "version": version,
        "count": len(apps),
        "import_sources": ["database:app_catalog"],
        "list": _serialize_app_list(apps, user_id=user_id, auth_type=auth_type),
    }


@router.get("/{app_id}")
async def get_app(app_id: str, user: dict | None = Depends(_get_optional_user)):
    target, version = _find_app_or_404(app_id)
    user_id, auth_type = _resolve_owner_identity(user)
    return {
        "version": version,
        "app": _serialize_app_item(target, user_id=user_id, auth_type=auth_type),
    }


@router.post("/{app_id}/topic", response_model=EnsureAppTopicResponse)
async def ensure_app_topic(app_id: str, user: dict | None = Depends(_get_optional_user)):
    target, version = _find_app_or_404(app_id)

    user_id = int(user["sub"]) if user and user.get("sub") is not None else None
    auth_type = user.get("auth_type") if user else None

    linked_topic_id, created = _ensure_app_topic_link(app_id, target)
    if not created:
        await _ensure_executor_workspace_for_topic(linked_topic_id)
        await hydrate_topic_workspace(linked_topic_id, [])
        topic = get_topic(linked_topic_id, user_id=user_id, auth_type=auth_type)
        if topic is None:
            raise HTTPException(status_code=404, detail="Topic not found")
        return {"topic": topic, "created": False, "catalog_version": version}

    await _ensure_executor_workspace_for_topic(linked_topic_id)
    await hydrate_topic_workspace(linked_topic_id, [])
    resolved_topic = get_topic(linked_topic_id, user_id=user_id, auth_type=auth_type)
    if resolved_topic is None:
        raise HTTPException(status_code=404, detail="Topic not found")
    return {"topic": resolved_topic, "created": True, "catalog_version": version}


@router.post("/{app_id}/like")
async def like_app(
    app_id: str,
    req: ToggleActionRequest,
    user: dict | None = Depends(_get_optional_user),
):
    target, _ = _find_app_or_404(app_id)
    user_id, auth_type = _require_owner_identity(user)
    linked_topic_id, _ = _ensure_app_topic_link(app_id, target)
    interaction = set_topic_user_action(linked_topic_id, user_id=user_id, auth_type=auth_type, liked=req.enabled)
    return interaction
