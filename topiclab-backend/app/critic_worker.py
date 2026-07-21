"""Isolated asynchronous worker surface for basic and complete Critic reviews."""

from __future__ import annotations

import asyncio
import inspect
import json
import os
import pathlib
import secrets
import shlex
import subprocess
import sys
import threading
import uuid
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import urlparse

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Query


SUPPORTED_KINDS = ("skill", "mcp")
EVALUATION_PROFILE = "standard"
RUNTIME = {
    "orchestrator": "agentscope",
    "provider": "aistar",
    "model": "glm5.2",
}
TERMINAL_STATUSES = {"completed", "failed", "blocked", "unverifiable"}
Runner = Callable[[dict[str, Any], pathlib.Path], dict[str, Any] | Awaitable[dict[str, Any]]]
DEFAULT_RUNNER_COMMAND = f'"{sys.executable}" -m app.critic_runner'
DEFAULT_RUNNER_PROFILE = "standard_v1"
DEFAULT_STATE_DIR = pathlib.Path("/app/critic-state")


def _atomic_json(path: pathlib.Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def _is_valid_target(kind: str, target: str) -> bool:
    parsed = urlparse(target)
    is_https = parsed.scheme == "https" and bool(parsed.netloc)
    if kind == "skill":
        return is_https
    if is_https:
        return True
    if not target or any(character.isspace() for character in target):
        return False
    package = target[1:].split("/", 1) if target.startswith("@") else [target]
    return len(package) in {1, 2} and all(package)


def _validate_request(payload: dict[str, Any]) -> dict[str, Any]:
    kind = str(payload.get("kind") or "").strip().lower()
    target = str(payload.get("target") or "").strip()
    if kind not in SUPPORTED_KINDS or not _is_valid_target(kind, target):
        raise HTTPException(status_code=422, detail="不支持的评测目标")
    contract = (payload.get("depth"), payload.get("evaluation_profile"))
    if contract not in {("basic", "basic"), ("standard", "standard"), ("full", "complete")}:
        raise HTTPException(status_code=422, detail="Worker 不接受该评测合同")
    if payload.get("runtime") != RUNTIME:
        raise HTTPException(status_code=422, detail="评测运行时与服务合同不一致")
    if payload.get("source") != "topiclab-skill-hub":
        raise HTTPException(status_code=422, detail="不支持的评测来源")
    try:
        requester_id = int(payload.get("requester_id"))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="评测请求缺少用户标识") from exc
    if requester_id <= 0:
        raise HTTPException(status_code=422, detail="评测用户标识无效")
    return {
        "kind": kind,
        "target": target,
        "depth": str(payload["depth"]),
        "evaluation_profile": str(payload["evaluation_profile"]),
        "runtime": dict(RUNTIME),
        "requester_id": requester_id,
        "source": "topiclab-skill-hub",
    }


class JobStore:
    def __init__(self, root: pathlib.Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._jobs: dict[str, dict[str, Any]] = {}
        for path in sorted(self.root.glob("*/job.json")):
            try:
                job = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(job, dict) and isinstance(job.get("job_id"), str):
                    self._jobs[job["job_id"]] = job
            except (OSError, json.JSONDecodeError):
                continue

    def job_dir(self, job_id: str) -> pathlib.Path:
        return self.root / job_id

    def write(self, job: dict[str, Any]) -> None:
        with self._lock:
            self._jobs[job["job_id"]] = dict(job)
            _atomic_json(self.job_dir(job["job_id"]) / "job.json", self._jobs[job["job_id"]])

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return dict(job) if job else None


class SubprocessRunner:
    def __init__(self, command: str, profile: str = ""):
        self.command = command.strip()
        self.profile = profile.strip()

    @property
    def ready(self) -> bool:
        return self.profile in {"basic_v1", "standard_v1", "complete_v1"}

    async def __call__(self, request: dict[str, Any], job_dir: pathlib.Path) -> dict[str, Any]:
        output_path = job_dir / "result.json"
        command = shlex.split(self.command, posix=os.name != "nt")
        command.extend(["--request", str(job_dir / "request.json"), "--output", str(output_path)])

        def execute() -> subprocess.CompletedProcess[str]:
            return subprocess.run(
                command,
                cwd=job_dir,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=3600,
                check=False,
            )

        completed = await asyncio.to_thread(execute)
        (job_dir / "runner.stdout.txt").write_text(completed.stdout, encoding="utf-8")
        (job_dir / "runner.stderr.txt").write_text(completed.stderr, encoding="utf-8")
        if completed.returncode != 0 or not output_path.is_file():
            return {
                "status": "failed",
                "message": "评测执行器未能形成有效报告",
                "runner_exit_code": completed.returncode,
            }
        result = json.loads(output_path.read_text(encoding="utf-8"))
        if not isinstance(result, dict):
            raise ValueError("runner result must be a JSON object")
        return result


def _configured_runner() -> Runner | None:
    return SubprocessRunner(DEFAULT_RUNNER_COMMAND, DEFAULT_RUNNER_PROFILE)


def _builtin_runtime_ready() -> bool:
    if not os.environ.get("skillhub_scnet_api_key", "").strip():
        return False
    from app.critic_runner import DEFAULT_CRITIC_RESEARCH_ROOTS

    return any(
        (root / "skills" / "find-science-skills" / "scripts" / "run_agentscope_critic_provider.py").is_file()
        and (root / "skills" / "skill-criticagent" / "vendor" / "mcp_criticagent" / "src" / "core" / "skill_validator.py").is_file()
        and (root / "skills" / "mcp-criticagent" / "SKILL.md").is_file()
        for root in DEFAULT_CRITIC_RESEARCH_ROOTS
    )


def _result_progress(result: dict[str, Any]) -> dict[str, Any]:
    steps = ["validation", "behavior", "triggers", "verdict"]
    if result.get("status") == "completed":
        completed = steps
        current = "verdict"
    else:
        evidence = result.get("evidence") if isinstance(result.get("evidence"), dict) else {}
        completed = []
        if evidence.get("static_validation") or evidence.get("source_before_sha256"):
            completed.append("validation")
        if int(evidence.get("behavior_pairs") or 0) >= 6:
            completed.append("behavior")
        if int(evidence.get("trigger_queries") or 0) >= 8:
            completed.append("triggers")
        if int(evidence.get("final_adjudications") or 0) >= 1:
            completed.append("verdict")
        current = steps[min(len(completed), len(steps) - 1)]
    progress = {
        "current_step": current,
        "completed_steps": completed,
        "total_steps": len(steps),
    }
    message = result.get("message")
    if isinstance(message, str) and message.strip():
        progress["message"] = message.strip()
    return progress


def _running_progress(job_dir: pathlib.Path) -> dict[str, Any] | None:
    path = job_dir / "progress.json"
    try:
        progress = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(progress, dict):
        return None
    steps = {"validation", "behavior", "triggers", "verdict"}
    current = progress.get("current_step")
    completed = progress.get("completed_steps")
    message = progress.get("message")
    if (
        current not in steps
        or not isinstance(completed, list)
        or any(step not in steps for step in completed)
        or progress.get("total_steps") != 4
        or not isinstance(message, str)
        or not message.strip()
    ):
        return None
    return {
        "current_step": current,
        "completed_steps": completed,
        "total_steps": 4,
        "message": message.strip(),
    }


def _trace_events(job_dir: pathlib.Path) -> list[dict[str, Any]]:
    path = job_dir / "progress-events.jsonl"
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    events: list[dict[str, Any]] = []
    allowed_steps = {"validation", "behavior", "triggers", "verdict"}
    allowed_kinds = {"status", "reasoning", "execution", "evidence", "result", "error"}
    for line in lines[-100:]:
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict):
            continue
        details = event.get("details")
        if (
            not isinstance(event.get("sequence"), int)
            or event.get("step") not in allowed_steps
            or event.get("kind") not in allowed_kinds
            or not isinstance(event.get("title"), str)
            or not isinstance(event.get("summary"), str)
            or not isinstance(details, list)
            or any(not isinstance(item, str) for item in details)
        ):
            continue
        events.append(
            {
                "sequence": event["sequence"],
                "step": event["step"],
                "kind": event["kind"],
                "title": event["title"][:120],
                "summary": event["summary"][:1500],
                "details": [item[:1500] for item in details[:12]],
            }
        )
    return events


def create_critic_worker_app(
    *,
    runner: Runner | None = None,
    worker_token: str | None = None,
    state_dir: pathlib.Path | None = None,
) -> FastAPI:
    uses_builtin_runner = runner is None
    selected_runner = runner or _configured_runner()
    token = worker_token or ""
    root = state_dir or DEFAULT_STATE_DIR
    store = JobStore(pathlib.Path(root))
    worker = FastAPI(title="TopicLab Critic Worker", docs_url=None, redoc_url=None)
    runner_ready = selected_runner is not None and (
        not isinstance(selected_runner, SubprocessRunner) or selected_runner.ready
    ) and (not uses_builtin_runner or _builtin_runtime_ready())

    def authorize(authorization: str | None) -> None:
        if not token:
            return
        expected = f"Bearer {token}"
        if not authorization or not secrets.compare_digest(authorization, expected):
            raise HTTPException(status_code=401, detail="Worker authentication failed")

    async def run_job(job_id: str, request: dict[str, Any]) -> None:
        job = store.get(job_id)
        if not job:
            return
        job["status"] = "running"
        job["progress"] = {"current_step": "validation", "completed_steps": [], "total_steps": 4}
        store.write(job)
        try:
            result = selected_runner(request, store.job_dir(job_id)) if selected_runner else None
            if inspect.isawaitable(result):
                result = await result
            if not isinstance(result, dict):
                raise RuntimeError("critic runner is unavailable")
            status = str(result.get("status") or "failed")
            if status not in TERMINAL_STATUSES:
                raise ValueError("runner returned a non-terminal status")
            job.update(result)
            job["status"] = status
        except Exception as exc:
            job.update({"status": "failed", "message": "评测执行器发生错误", "error_type": type(exc).__name__})
        job["progress"] = _result_progress(job)
        job["trace"] = _trace_events(store.job_dir(job_id))
        store.write(job)

    @worker.get("/health")
    async def health():
        return {
            "ready": runner_ready,
            "supported_kinds": list(SUPPORTED_KINDS),
            "evaluation_profile": EVALUATION_PROFILE,
            "runtime": dict(RUNTIME),
        }

    @worker.post("/api/v1/evaluations", status_code=202)
    async def submit(
        payload: dict[str, Any],
        background_tasks: BackgroundTasks,
        authorization: str | None = Header(default=None),
    ):
        authorize(authorization)
        if not runner_ready:
            raise HTTPException(status_code=503, detail="Critic runner is not configured")
        request = _validate_request(payload)
        job_id = uuid.uuid4().hex
        job_dir = store.job_dir(job_id)
        job_dir.mkdir(parents=True, exist_ok=False)
        _atomic_json(job_dir / "request.json", request)
        job = {
            "job_id": job_id,
            "status": "queued",
            **request,
            "progress": {"current_step": "validation", "completed_steps": [], "total_steps": 4},
            "trace": [],
        }
        store.write(job)
        background_tasks.add_task(run_job, job_id, request)
        return job

    @worker.get("/api/v1/evaluations/{job_id}")
    async def get_job(
        job_id: str,
        requester_id: int = Query(...),
        authorization: str | None = Header(default=None),
    ):
        authorize(authorization)
        job = store.get(job_id)
        if not job or int(job.get("requester_id") or 0) != requester_id:
            raise HTTPException(status_code=404, detail="Evaluation job not found")
        if job.get("status") == "running":
            progress = _running_progress(store.job_dir(job_id))
            if progress is not None:
                job["progress"] = progress
            job["trace"] = _trace_events(store.job_dir(job_id))
        return job

    return worker


app = create_critic_worker_app()
