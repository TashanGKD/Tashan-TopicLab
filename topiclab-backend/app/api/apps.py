"""App catalog endpoints backed by mergeable JSON manifests."""

from __future__ import annotations

import json
import os
from hashlib import sha256
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.api.auth import security, verify_access_token
from app.api.topics import _normalize_topic_category
from app.services.source_feed_pipeline import hydrate_topic_workspace
from app.storage.database.topic_store import create_topic, get_topic, get_topic_id_by_app, link_app_to_topic

router = APIRouter(prefix="/apps", tags=["apps"])


async def _get_optional_user(credentials=Depends(security)) -> dict | None:
    if not credentials:
        return None
    return verify_access_token(credentials.credentials)


def _default_manifest_path() -> Path:
    return Path(__file__).resolve().parents[1] / "resources" / "apps_catalog.json"


def _iter_manifest_paths() -> list[Path]:
    paths: list[Path] = [_default_manifest_path()]
    raw_extra = (os.getenv("TOPICLAB_APP_CATALOG_PATHS") or "").strip()
    if not raw_extra:
        return paths

    for entry in raw_extra.split(os.pathsep):
        value = entry.strip()
        if not value:
            continue
        path = Path(value).expanduser()
        if path.is_dir():
            paths.extend(sorted(item for item in path.glob("*.json") if item.is_file()))
        elif path.is_file():
            paths.append(path)
    return paths


def _load_manifest(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, dict):
        apps = payload.get("apps", [])
    elif isinstance(payload, list):
        apps = payload
    else:
        raise ValueError(f"Unsupported catalog format in {path}")
    if not isinstance(apps, list):
        raise ValueError(f"Invalid apps list in {path}")
    return [item for item in apps if isinstance(item, dict)]


def _load_catalog() -> tuple[list[dict[str, Any]], str]:
    merged: dict[str, dict[str, Any]] = {}
    digest = sha256()
    for path in _iter_manifest_paths():
        if not path.exists():
            continue
        raw = path.read_bytes()
        digest.update(raw)
        for item in _load_manifest(path):
            app_id = str(item.get("id") or "").strip()
            if not app_id:
                continue
            merged[app_id] = {
                **merged.get(app_id, {}),
                **item,
            }
    apps = sorted(merged.values(), key=lambda item: (str(item.get("name") or ""), str(item.get("id") or "")))
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


@router.get("")
async def list_apps():
    apps, version = _load_catalog()
    return {
        "version": version,
        "count": len(apps),
        "import_sources": [str(path) for path in _iter_manifest_paths() if path.exists()],
        "list": apps,
    }


@router.get("/{app_id}")
async def get_app(app_id: str):
    apps, version = _load_catalog()
    for item in apps:
        if item.get("id") == app_id:
            return {
                "version": version,
                "app": item,
            }
    raise HTTPException(status_code=404, detail="App not found")


@router.post("/{app_id}/topic")
async def ensure_app_topic(app_id: str, user: dict | None = Depends(_get_optional_user)):
    apps, version = _load_catalog()
    target = next((item for item in apps if item.get("id") == app_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="App not found")

    user_id = int(user["sub"]) if user and user.get("sub") is not None else None
    auth_type = user.get("auth_type") if user else None

    existing_topic_id = get_topic_id_by_app(app_id)
    if existing_topic_id:
        await _ensure_executor_workspace_for_topic(existing_topic_id)
        await hydrate_topic_workspace(existing_topic_id, [])
        topic = get_topic(existing_topic_id, user_id=user_id, auth_type=auth_type)
        if topic is None:
            raise HTTPException(status_code=404, detail="Topic not found")
        return {"topic": topic, "created": False, "catalog_version": version}

    seed = (target.get("openclaw") or {}).get("topic_seed") or {}
    topic = create_topic(
        f"【应用】{str(target.get('name') or app_id)}",
        _build_app_topic_body(target),
        _normalize_topic_category(seed.get("category")) or "app",
    )
    linked_topic_id = link_app_to_topic(
        app_id,
        topic["id"],
        name=str(target.get("name") or ""),
        command=str(target.get("command") or ""),
        summary=str(target.get("summary") or ""),
        docs_url=str(((target.get("links") or {}).get("docs")) or ""),
        repo_url=str(((target.get("links") or {}).get("repo")) or ""),
        icon=str(target.get("icon") or ""),
    )
    created = linked_topic_id == topic["id"]
    await _ensure_executor_workspace_for_topic(linked_topic_id)
    await hydrate_topic_workspace(linked_topic_id, [])
    resolved_topic = get_topic(linked_topic_id, user_id=user_id, auth_type=auth_type)
    if resolved_topic is None:
        raise HTTPException(status_code=404, detail="Topic not found")
    return {"topic": resolved_topic, "created": created, "catalog_version": version}
