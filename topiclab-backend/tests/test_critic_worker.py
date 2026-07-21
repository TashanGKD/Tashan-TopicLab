import asyncio
import json
from datetime import datetime, timedelta, timezone

import httpx
from fastapi.testclient import TestClient


RUNTIME = {
    "orchestrator": "agentscope",
    "provider": "aistar",
    "model": "glm5.2",
}


def test_worker_runs_skill_and_mcp_jobs_with_the_complete_contract(tmp_path):
    from app.critic_worker import create_critic_worker_app

    calls = []

    async def fake_runner(request, job_dir):
        calls.append((request, job_dir))
        await asyncio.sleep(0)
        return {
            "status": "completed",
            "verdict": "建议安装",
            "score": 92,
            "dimensions": [],
            "evidence": {
                "behavior_cases": 3,
                "behavior_pairs": 6,
                "trigger_queries": 8,
                "artifacts": 1,
            },
            "limitations": [],
        }

    app = create_critic_worker_app(
        runner=fake_runner,
        worker_token="worker-secret",
        state_dir=tmp_path,
    )
    client = TestClient(app)
    headers = {"Authorization": "Bearer worker-secret"}

    payloads = [
        {
            "kind": "skill",
            "target": "https://github.com/example/research-skill",
            "depth": "full",
            "evaluation_profile": "complete",
            "runtime": RUNTIME,
            "requester_id": 17,
            "source": "topiclab-skill-hub",
        },
        {
            "kind": "mcp",
            "target": "@scope/mcp-server",
            "depth": "full",
            "evaluation_profile": "complete",
            "runtime": RUNTIME,
            "requester_id": 17,
            "source": "topiclab-skill-hub",
        },
    ]

    job_ids = []
    for payload in payloads:
        response = client.post("/api/v1/evaluations", json=payload, headers=headers)
        assert response.status_code == 202, response.text
        job_ids.append(response.json()["job_id"])

    for job_id, payload in zip(job_ids, payloads, strict=True):
        response = client.get(
            f"/api/v1/evaluations/{job_id}",
            params={"requester_id": 17},
            headers=headers,
        )
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["status"] == "completed"
        assert result["kind"] == payload["kind"]
        assert result["depth"] == "full"
        assert result["evaluation_profile"] == "complete"
        assert result["runtime"] == RUNTIME
        assert result["evidence"]["behavior_pairs"] == 6

    assert [call[0]["kind"] for call in calls] == ["skill", "mcp"]
    assert all(call[0]["runtime"] == RUNTIME for call in calls)
    assert all((call[1] / "request.json").is_file() for call in calls)
    assert all((call[1] / "job.json").is_file() for call in calls)


def test_worker_fails_closed_on_auth_contract_and_ownership(tmp_path):
    from app.critic_worker import create_critic_worker_app

    async def fake_runner(request, job_dir):
        return {"status": "blocked", "message": "runner unavailable"}

    app = create_critic_worker_app(
        runner=fake_runner,
        worker_token="worker-secret",
        state_dir=tmp_path,
    )
    client = TestClient(app)
    payload = {
        "kind": "skill",
        "target": "https://github.com/example/research-skill",
        "depth": "standard",
        "evaluation_profile": "standard",
        "runtime": RUNTIME,
        "requester_id": 17,
        "source": "topiclab-skill-hub",
    }

    assert client.post("/api/v1/evaluations", json=payload).status_code == 401
    headers = {"Authorization": "Bearer worker-secret"}
    invalid = {**payload, "runtime": {**RUNTIME, "model": "another-model"}}
    assert client.post("/api/v1/evaluations", json=invalid, headers=headers).status_code == 422

    response = client.post("/api/v1/evaluations", json=payload, headers=headers)
    assert response.status_code == 202, response.text
    job_id = response.json()["job_id"]
    forbidden = client.get(
        f"/api/v1/evaluations/{job_id}",
        params={"requester_id": 99},
        headers=headers,
    )
    assert forbidden.status_code == 404


def test_worker_fails_closed_when_internal_auth_is_unconfigured(monkeypatch, tmp_path):
    from app.critic_worker import create_critic_worker_app

    monkeypatch.delenv("skillhub_scnet_api_key", raising=False)

    async def fake_runner(request, job_dir):
        return {"status": "completed"}

    client = TestClient(create_critic_worker_app(runner=fake_runner, state_dir=tmp_path))
    response = client.post(
        "/api/v1/evaluations",
        json={
            "kind": "skill",
            "target": "https://github.com/example/research-skill",
            "depth": "standard",
            "evaluation_profile": "standard",
            "runtime": RUNTIME,
            "requester_id": 17,
            "source": "topiclab-skill-hub",
        },
    )

    assert response.status_code == 503
    assert "authentication" in response.json()["detail"]


def test_worker_rejects_noncanonical_github_and_option_like_npm_targets(tmp_path):
    from app.critic_worker import create_critic_worker_app

    async def fake_runner(request, job_dir):
        return {"status": "completed"}

    client = TestClient(
        create_critic_worker_app(
            runner=fake_runner,
            worker_token="worker-secret",
            state_dir=tmp_path,
        )
    )
    headers = {"Authorization": "Bearer worker-secret"}
    base = {
        "depth": "standard",
        "evaluation_profile": "standard",
        "runtime": RUNTIME,
        "requester_id": 17,
        "source": "topiclab-skill-hub",
    }
    invalid_targets = (
        ("skill", "https://github.com:8443/example/research-skill"),
        ("skill", "https://github.com/example/research-skill?ref=main"),
        ("mcp", "--help"),
        ("mcp", "../local-package"),
    )

    for kind, target in invalid_targets:
        response = client.post(
            "/api/v1/evaluations",
            json={**base, "kind": kind, "target": target},
            headers=headers,
        )
        assert response.status_code == 422, (target, response.text)


def test_worker_rejects_new_jobs_when_capacity_is_full(tmp_path):
    from app.critic_worker import create_critic_worker_app

    async def exercise():
        started = asyncio.Event()
        release = asyncio.Event()

        async def slow_runner(request, job_dir):
            started.set()
            await release.wait()
            return {"status": "completed"}

        app = create_critic_worker_app(
            runner=slow_runner,
            worker_token="worker-secret",
            state_dir=tmp_path,
            max_concurrent_jobs=1,
            max_pending_jobs=0,
        )
        headers = {"Authorization": "Bearer worker-secret"}
        payload = {
            "kind": "skill",
            "target": "https://github.com/example/first-skill",
            "depth": "standard",
            "evaluation_profile": "standard",
            "runtime": RUNTIME,
            "requester_id": 17,
            "source": "topiclab-skill-hub",
        }
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://worker.test",
        ) as client:
            first = asyncio.create_task(
                client.post("/api/v1/evaluations", json=payload, headers=headers)
            )
            await asyncio.wait_for(started.wait(), timeout=2)
            second = await client.post(
                "/api/v1/evaluations",
                json={**payload, "target": "https://github.com/example/second-skill"},
                headers=headers,
            )
            assert second.status_code == 429
            assert second.headers["retry-after"] == "60"
            release.set()
            assert (await first).status_code == 202

    asyncio.run(exercise())


def test_job_store_removes_expired_terminal_state(tmp_path):
    from app.critic_worker import JobStore

    job_dir = tmp_path / "expired-job"
    job_dir.mkdir()
    old = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    (job_dir / "job.json").write_text(
        json.dumps(
            {
                "job_id": "expired-job",
                "status": "completed",
                "requester_id": 17,
                "created_at": old,
                "updated_at": old,
            }
        ),
        encoding="utf-8",
    )

    store = JobStore(tmp_path, retention_seconds=60, max_stored_jobs=10)

    assert store.get("expired-job") is None
    assert not job_dir.exists()


def test_worker_health_reports_runner_and_fixed_runtime(tmp_path):
    from app.critic_worker import create_critic_worker_app

    async def fake_runner(request, job_dir):
        return {"status": "blocked"}

    app = create_critic_worker_app(
        runner=fake_runner,
        worker_token="worker-secret",
        state_dir=tmp_path,
    )
    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "ready": True,
        "supported_kinds": ["skill", "mcp"],
        "evaluation_profile": "standard",
        "runtime": RUNTIME,
    }


def test_worker_uses_bundled_standard_runner_by_default(monkeypatch, tmp_path):
    from app import critic_worker

    monkeypatch.setattr(critic_worker, "_builtin_runtime_ready", lambda: True)
    app = critic_worker.create_critic_worker_app(state_dir=tmp_path)
    client = TestClient(app)

    assert client.get("/health").json()["ready"] is True


def test_builtin_worker_stays_unready_without_the_single_skillhub_key(monkeypatch, tmp_path):
    from app import critic_worker

    monkeypatch.delenv("skillhub_scnet_api_key", raising=False)
    app = critic_worker.create_critic_worker_app(state_dir=tmp_path)

    assert TestClient(app).get("/health").json()["ready"] is False


def test_worker_does_not_claim_unrun_behavior_steps_for_blocked_result(tmp_path):
    from app.critic_worker import create_critic_worker_app

    async def blocked_runner(request, job_dir):
        return {
            "status": "blocked",
            "blocker": "skill_execution_engine_missing",
            "evaluation_profile_status": "incomplete",
            "message": "评测任务设计未通过来源一致性复核",
            "evidence": {
                "static_validation": {"valid": True},
                "behavior_cases": 0,
                "behavior_pairs": 0,
                "trigger_queries": 0,
                "final_adjudications": 0,
            },
        }

    app = create_critic_worker_app(
        runner=blocked_runner,
        worker_token="worker-secret",
        state_dir=tmp_path,
    )
    client = TestClient(app)
    headers = {"Authorization": "Bearer worker-secret"}
    response = client.post(
        "/api/v1/evaluations",
        json={
            "kind": "skill",
            "target": "https://github.com/example/research-skill",
            "depth": "full",
            "evaluation_profile": "complete",
            "runtime": RUNTIME,
            "requester_id": 17,
            "source": "topiclab-skill-hub",
        },
        headers=headers,
    )
    job_id = response.json()["job_id"]
    result = client.get(
        f"/api/v1/evaluations/{job_id}",
        params={"requester_id": 17},
        headers=headers,
    ).json()

    assert result["status"] == "blocked"
    assert result["progress"] == {
        "current_step": "behavior",
        "completed_steps": ["validation"],
        "total_steps": 4,
        "message": "评测任务设计未通过来源一致性复核",
    }


def test_worker_preserves_progress_when_restart_interrupts_a_running_job(tmp_path):
    from app.critic_worker import create_critic_worker_app

    job_id = "running-job"
    job_dir = tmp_path / job_id
    job_dir.mkdir()
    (job_dir / "job.json").write_text(
        json.dumps(
            {
                "job_id": job_id,
                "status": "running",
                "requester_id": 17,
                "progress": {
                    "current_step": "validation",
                    "completed_steps": [],
                    "total_steps": 4,
                },
            }
        ),
        encoding="utf-8",
    )
    (job_dir / "progress.json").write_text(
        json.dumps(
            {
                "current_step": "behavior",
                "completed_steps": ["validation"],
                "total_steps": 4,
                "message": "正在运行三组任务与隔离对照",
            }
        ),
        encoding="utf-8",
    )
    (job_dir / "progress-events.jsonl").write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "sequence": 1,
                        "step": "validation",
                        "kind": "status",
                        "title": "来源检查",
                        "summary": "正在封存来源",
                        "details": [],
                    }
                ),
                json.dumps(
                    {
                        "sequence": 2,
                        "step": "behavior",
                        "kind": "reasoning",
                        "title": "使用方式判断",
                        "summary": "已设计代表任务",
                        "details": ["使用方式：guidance"],
                    }
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    async def fake_runner(request, current_job_dir):
        return {"status": "blocked"}

    client = TestClient(
        create_critic_worker_app(
            runner=fake_runner,
            worker_token="worker-secret",
            state_dir=tmp_path,
        )
    )
    response = client.get(
        f"/api/v1/evaluations/{job_id}",
        params={"requester_id": 17},
        headers={"Authorization": "Bearer worker-secret"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "failed"
    assert response.json()["error_type"] == "WorkerRestarted"
    assert response.json()["progress"] == {
        "current_step": "behavior",
        "completed_steps": ["validation"],
        "total_steps": 4,
        "message": "正在运行三组任务与隔离对照",
    }
    assert response.json()["trace"] == [
        {
            "sequence": 1,
            "step": "validation",
            "kind": "status",
            "title": "来源检查",
            "summary": "正在封存来源",
            "details": [],
        },
        {
            "sequence": 2,
            "step": "behavior",
            "kind": "reasoning",
            "title": "使用方式判断",
            "summary": "已设计代表任务",
            "details": ["使用方式：guidance"],
        },
    ]
