"""Trusted proxy contract for the isolated Skill and MCP CriticAgent worker."""

from __future__ import annotations

import os
import re
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException


SUPPORTED_KINDS = ("skill", "mcp")
SUPPORTED_DEPTHS = ("standard",)
EVALUATION_PROFILE = "standard"
CRITIC_RUNTIME = {
    "orchestrator": "agentscope",
    "provider": "aistar",
    "model": "glm5.2",
}
NPM_PACKAGE_RE = re.compile(r"^(?:@[a-z0-9._-]+/)?[a-z0-9._-]+$", re.IGNORECASE)


def _worker_url() -> str:
    return os.environ.get("SKILL_HUB_CRITIC_WORKER_URL", "").strip().rstrip("/")


async def get_critic_capabilities() -> dict[str, Any]:
    worker = _worker_url()
    available = False
    if worker:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                response = await client.get(f"{worker}/health", headers=_worker_headers())
                response.raise_for_status()
                health = response.json()
                available = bool(
                    health.get("ready")
                    and health.get("evaluation_profile") == EVALUATION_PROFILE
                    and health.get("runtime") == CRITIC_RUNTIME
                )
        except (httpx.HTTPError, ValueError, AttributeError):
            available = False
    return {
        "worker_available": available,
        "supported_kinds": list(SUPPORTED_KINDS),
        "supported_depths": list(SUPPORTED_DEPTHS),
        "evaluation_profile": EVALUATION_PROFILE,
        "runtime": dict(CRITIC_RUNTIME),
        "execution": "isolated_worker",
        "message": "评测服务已连接" if available else "评测服务尚未就绪",
    }


def _validate_target(kind: str, target: str) -> str:
    clean = target.strip()
    if not clean or len(clean) > 2048:
        raise HTTPException(status_code=422, detail="评测目标不能为空或过长")
    parsed = urlparse(clean)
    is_https_url = parsed.scheme == "https" and bool(parsed.netloc)
    if kind == "skill" and not is_https_url:
        raise HTTPException(status_code=422, detail="Skill 评测当前仅接受 HTTPS 仓库地址")
    if kind == "mcp" and not (is_https_url or NPM_PACKAGE_RE.fullmatch(clean)):
        raise HTTPException(status_code=422, detail="MCP 评测需要 HTTPS 仓库地址或 npm 包名")
    return clean


def _worker_headers() -> dict[str, str]:
    token = os.environ.get("SKILL_HUB_CRITIC_WORKER_TOKEN", "").strip()
    return {"Authorization": f"Bearer {token}"} if token else {}


async def submit_critic_evaluation(payload: dict[str, Any], *, requester_id: int) -> dict[str, Any]:
    worker = _worker_url()
    if not worker:
        raise HTTPException(status_code=503, detail="评测 Worker 尚未配置，不能执行第三方代码")
    kind = str(payload.get("kind") or "").strip().lower()
    if kind not in SUPPORTED_KINDS:
        raise HTTPException(status_code=422, detail="不支持的评测类型")
    body = {
        "kind": kind,
        "target": _validate_target(kind, str(payload.get("target") or "")),
        "depth": "standard",
        "evaluation_profile": EVALUATION_PROFILE,
        "runtime": dict(CRITIC_RUNTIME),
        "requester_id": requester_id,
        "source": "topiclab-skill-hub",
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(f"{worker}/api/v1/evaluations", json=body, headers=_worker_headers())
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="评测 Worker 请求失败") from exc


async def get_critic_evaluation(job_id: str, *, requester_id: int) -> dict[str, Any]:
    worker = _worker_url()
    if not worker:
        raise HTTPException(status_code=503, detail="评测 Worker 尚未配置")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                f"{worker}/api/v1/evaluations/{job_id}",
                params={"requester_id": requester_id},
                headers=_worker_headers(),
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="评测 Worker 请求失败") from exc
