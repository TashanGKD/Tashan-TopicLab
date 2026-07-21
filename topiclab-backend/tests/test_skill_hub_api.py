import importlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text


@pytest.fixture
def client(tmp_path, monkeypatch):
    database_path = tmp_path / "skill_hub.sqlite3"
    monkeypatch.setenv("TOPICLAB_TESTING", "1")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")

    import app.storage.database.postgres_client as postgres_client
    import main as main_module

    postgres_client.reset_db_state()
    importlib.reload(postgres_client)
    importlib.reload(main_module)

    with TestClient(main_module.app) as test_client:
        yield test_client

    postgres_client.reset_db_state()


def register_and_login(client, *, phone: str, username: str, password: str = "password123") -> dict:
    from app.storage.database.postgres_client import get_db_session

    code = "123456"
    with get_db_session() as session:
        session.execute(
            text(
                """
                INSERT INTO verification_codes (phone, code, type, expires_at)
                VALUES (:phone, :code, 'register', :expires_at)
                """
            ),
            {
                "phone": phone,
                "code": code,
                "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5),
            },
        )

    register = client.post(
        "/auth/register",
        json={
            "phone": phone,
            "code": code,
            "password": password,
            "username": username,
        },
    )
    assert register.status_code == 200, register.text
    return register.json()


def test_skillhub_public_config_exposes_only_the_single_scnet_key():
    repository = Path(__file__).resolve().parents[2]
    forbidden = (
        "SCIENCE_SKILL_FINDER_",
        "SKILL_HUB_CRITIC_",
        "CRITIC_WORKER_",
        "CRITIC_KERNEL_ROOT",
        "CRITIC_RESEARCH_ROOT",
        "MCP_CRITIC_ROOT",
        "CRITIC_PROVIDER_",
    )

    for name in (".env.example", ".env.deploy.example"):
        content = (repository / name).read_text(encoding="utf-8")
        assert content.count("skillhub_scnet_api_key") == 1
        assert not any(variable in content for variable in forbidden)


def test_skill_hub_public_seeded_routes(client):
    skills = client.get("/api/v1/skill-hub/skills?limit=100&sort=new")
    assert skills.status_code == 200, skills.text
    payload = skills.json()
    assert payload["total"] >= 260

    categories = client.get("/api/v1/skill-hub/categories")
    assert categories.status_code == 200, categories.text
    assert len(categories.json()["disciplines"]) == 14
    assert any(item["key"] == "general" for item in categories.json()["clusters"])
    assert any(item["key"] == "ai" for item in categories.json()["clusters"])

    tasks = client.get("/api/v1/skill-hub/tasks", headers={"Authorization": "Bearer invalid"})
    assert tasks.status_code == 401, tasks.text

    owner = register_and_login(client, phone="13800019991", username="seed-viewer")
    tasks = client.get("/api/v1/skill-hub/tasks", headers={"Authorization": f"Bearer {owner['token']}"})
    assert tasks.status_code == 200, tasks.text
    assert any(item["task_key"] == "publish_first_skill" for item in tasks.json()["tasks"])

    collections = client.get("/api/v1/skill-hub/collections")
    assert collections.status_code == 200, collections.text
    assert any(item["slug"] == "openclaw-starters" for item in collections.json()["list"])

    detail = client.get("/api/v1/skill-hub/skills/research-dream")
    assert detail.status_code == 200, detail.text
    assert detail.json()["slug"] == "research-dream"

    hot = client.get("/api/v1/skill-hub/skills?limit=5&sort=hot")
    assert hot.status_code == 200, hot.text
    assert hot.json()["list"][0]["featured"] is True

    ai_detail = client.get("/api/v1/skill-hub/skills/ai-research-vllm")
    assert ai_detail.status_code == 200, ai_detail.text
    assert ai_detail.json()["cluster_key"] == "ai"
    assert ai_detail.json()["category_key"] == "08"

    scientific_detail = client.get("/api/v1/skill-hub/skills/claude-scientific-networkx")
    assert scientific_detail.status_code == 200, scientific_detail.text
    assert scientific_detail.json()["cluster_key"] == "general"
    assert scientific_detail.json()["category_key"] == "07"

    astro = client.get("/api/v1/skill-hub/skills/claude-scientific-astropy")
    assert astro.status_code == 200, astro.text
    assert astro.json()["category_key"] == "ast"
    assert astro.json()["cluster_key"] == "general"

    tf = client.get("/api/v1/skill-hub/skills/claude-scientific-transformers")
    assert tf.status_code == 200, tf.text
    assert tf.json()["category_key"] == "08"
    assert tf.json()["cluster_key"] == "ai"

    econ = client.get("/api/v1/skill-hub/skills/claude-scientific-alpha-vantage")
    assert econ.status_code == 200, econ.text
    assert econ.json()["category_key"] == "02"
    assert econ.json()["cluster_key"] == "general"

    content = client.get("/api/v1/skill-hub/skills/research-dream/content")
    assert content.status_code == 200, content.text
    content_payload = content.json()
    assert content_payload["skill"]["slug"] == "research-dream"
    assert content_payload["version"]["version"] == detail.json()["latest_version"]
    assert content_payload["content_type"] == "text/markdown"
    assert content_payload["format"] == "skill_md"
    assert "Research Dream" in content_payload["content"]

    ai_content = client.get("/api/v1/skill-hub/skills/ai-research-vllm/content")
    assert ai_content.status_code == 200, ai_content.text
    assert "vllm" in ai_content.json()["content"].lower()

    scientific_content = client.get("/api/v1/skill-hub/skills/claude-scientific-networkx/content")
    assert scientific_content.status_code == 200, scientific_content.text
    assert "networkx" in scientific_content.json()["content"].lower()

    guide = client.get("/api/v1/skill-hub/guide.md")
    assert guide.status_code == 200, guide.text
    assert "GET /api/v1/skill-hub/skills" in guide.text
    assert "GET /api/v1/skill-hub/skills/{id_or_slug}/content" in guide.text


def test_science_catalog_is_built_in_filterable_and_traceable(client):
    meta = client.get("/api/v1/skill-hub/science-catalog/meta")
    assert meta.status_code == 200, meta.text
    payload = meta.json()
    assert payload["total"] == 1391
    assert payload["dimensions"]["stages"] == ["发现获取", "构思设计", "执行采集", "分析验证", "表达发表"]
    assert len(payload["dimensions"]["functions"]) == 17
    assert payload["source"]["repository"] == "TashanGKD/tashan-research-skills"
    assert len(payload["source"]["sha256"]) == 64

    response = client.get(
        "/api/v1/skill-hub/science-catalog",
        params={"domain": "生命科学", "stage": "执行采集", "function": "模拟建模", "limit": 5},
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["total"] > 0
    assert len(result["list"]) <= 5
    assert all(item["domain"] == "生命科学" for item in result["list"])
    assert all(item["stage"] == "执行采集" for item in result["list"])
    assert all(item["function"] == "模拟建模" for item in result["list"])
    assert all(item["source_repository"] and item["source_path"] for item in result["list"])

    detail = client.get(f"/api/v1/skill-hub/science-catalog/{result['list'][0]['id']}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["id"] == result["list"][0]["id"]


def test_science_catalog_sort_is_stable_and_source_review_aware(monkeypatch):
    from app.services import science_skill_catalog

    skills = [
        {
            "id": "trusted-metadata",
            "name": "Beta",
            "readiness": "trusted",
            "review_status": "metadata_reviewed",
            "quality_score": 99,
        },
        {
            "id": "provisional-manual",
            "name": "Alpha",
            "readiness": "provisional",
            "review_status": "manual_confirmed",
            "quality_score": 100,
        },
        {
            "id": "trusted-manual",
            "name": "Gamma",
            "readiness": "trusted",
            "review_status": "manual_confirmed",
            "quality_score": 80,
        },
    ]
    monkeypatch.setattr(science_skill_catalog, "_load_catalog", lambda: ({"skills": skills}, "digest"))

    result = science_skill_catalog.list_catalog_skills(limit=10)

    assert [item["id"] for item in result["list"]] == [
        "trusted-manual",
        "trusted-metadata",
        "provisional-manual",
    ]


def test_science_catalog_search_matches_bilingual_field_tokens(monkeypatch):
    from app.services import science_skill_catalog

    skills = [
        {
            "id": "protein-analysis",
            "name": "Protein analysis",
            "summary": "Analyze protein structure and sequence data.",
            "task": "蛋白质结构分析",
            "readiness": "trusted",
            "review_status": "manual_confirmed",
            "quality_score": 90,
        },
        {
            "id": "paper-writing",
            "name": "Paper writing",
            "summary": "Draft a research manuscript.",
            "task": "科研写作",
            "readiness": "trusted",
            "review_status": "manual_confirmed",
            "quality_score": 90,
        },
    ]
    monkeypatch.setattr(science_skill_catalog, "_load_catalog", lambda: ({"skills": skills}, "digest"))

    english = science_skill_catalog.list_catalog_skills(q="protein structure", limit=10)
    chinese = science_skill_catalog.list_catalog_skills(q="蛋白质结构", limit=10)

    assert [item["id"] for item in english["list"]] == ["protein-analysis"]
    assert [item["id"] for item in chinese["list"]] == ["protein-analysis"]


def test_science_finder_uses_agentscope_only_for_valid_taxonomy_routing(client, monkeypatch):
    from app.services import science_skill_finder

    monkeypatch.setenv("skillhub_scnet_api_key", "test-key")

    async def fake_route_with_agentscope(query, dimensions, config):
        assert query == "我想预测蛋白质三维结构，并比较不同候选模型"
        assert "生命科学" in dimensions["domains"]
        return {
            "domain": "生命科学",
            "stage": "执行采集",
            "function": "模拟建模",
            "search_terms": ["蛋白质", "结构预测"],
            "rationale": "主要产物是蛋白质三维结构模型。",
            "skill_ids": ["not-allowed-model-answer"],
            "__skill_mounted": True,
        }

    async def fake_recommend_with_agentscope(query, route, candidates, config, limit):
        assert query == "我想预测蛋白质三维结构，并比较不同候选模型"
        assert route["domain"] == "生命科学"
        assert route["stage"] == "执行采集"
        assert any(item["id"] == "alphafold2" for item in candidates)
        assert limit == 6
        return [
            {
                "id": "alphafold2",
                "reason": "研究对象和预期产物都与蛋白质结构预测直接匹配。",
            }
        ]

    monkeypatch.setattr(science_skill_finder, "_route_with_agentscope", fake_route_with_agentscope)
    monkeypatch.setattr(
        science_skill_finder,
        "_recommend_with_agentscope",
        fake_recommend_with_agentscope,
    )
    response = client.post(
        "/api/v1/skill-hub/science-catalog/find",
        json={"query": "我想预测蛋白质三维结构，并比较不同候选模型", "limit": 6},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["driver"] == {
        "orchestrator": "AgentScope",
        "provider": "SCNet",
        "model": "GLM-5.2",
        "mode": "model",
        "configured": True,
        "skill_mounted": True,
        "message": "AgentScope 已完成三维路由与候选推荐",
    }
    assert payload["route"]["domain"] == "生命科学"
    assert payload["route"]["stage"] == "执行采集"
    assert payload["route"]["function"] == "模拟建模"
    assert [item["id"] for item in payload["results"]] == ["alphafold2"]
    assert payload["results"][0]["recommendation_reason"] == "研究对象和预期产物都与蛋白质结构预测直接匹配。"
    assert all(item["domain"] == "生命科学" for item in payload["results"])
    assert all(item["stage"] == "执行采集" for item in payload["results"])
    assert payload["results"][0]["function"] == "模拟建模"
    assert all(item["id"] != "not-allowed-model-answer" for item in payload["results"])
    assert payload["ranking"]["criteria"] == [
        {"key": "semantic_match", "label": "需求语义匹配"},
        {"key": "task_match", "label": "任务匹配"},
        {"key": "function_match", "label": "功能偏好"},
        {"key": "quality_score", "label": "质量分"},
    ]
    assert [item["rank"] for item in payload["results"]] == list(range(1, len(payload["results"]) + 1))
    assert all(item["ranking_signals"]["task_match"] >= 0 for item in payload["results"])
    assert all(item["ranking_signals"]["semantic_match"] > 0 for item in payload["results"])
    assert all(item["ranking_signals"]["readiness"] == item["readiness"] for item in payload["results"])
    assert all(item["ranking_signals"]["source_review"] == item["review_status"] for item in payload["results"])
    assert all(item["ranking_signals"]["quality_score"] == item["quality_score"] for item in payload["results"])


def test_science_finder_uses_only_skillhub_scnet_api_key(monkeypatch):
    from app.services import science_skill_finder

    monkeypatch.setenv("skillhub_scnet_api_key", "skillhub-scnet-test-key")
    monkeypatch.setenv("SCNET_API_KEY", "topiclink-scnet-test-key")
    monkeypatch.setenv("SCIENCE_SKILL_FINDER_API_KEY", "legacy-test-key")

    config = science_skill_finder.get_finder_config()

    assert config.api_key == "skillhub-scnet-test-key"
    assert config.base_url == "https://api.scnet.cn/api/llm/v1"
    assert config.model == "GLM-5.2"
    assert config.protocol == "openai"


def test_science_finder_streams_route_and_recommendations(client, monkeypatch):
    from app.api import skill_hub

    result = {
        "query": "单细胞类型注释",
        "route": {
            "domain": "生命科学",
            "stage": "分析验证",
            "function": "数据处理",
            "search_terms": ["单细胞", "细胞类型"],
            "rationale": "主要产物是细胞类型标签。",
        },
        "results": [{"id": "single-cell-annotation", "name": "Single Cell Annotation"}],
        "total": 1,
        "ranking": {"criteria": [{"key": "semantic_match", "label": "需求语义匹配"}]},
        "driver": {"mode": "model", "skill_mounted": True},
    }

    async def fake_find(query, *, limit, on_event=None):
        assert query == "单细胞类型注释"
        assert limit == 5
        assert on_event is not None
        await on_event("route", result["route"])
        await on_event("status", {"message": "正在复核候选技能"})
        await on_event("result", result["results"][0])
        return result

    monkeypatch.setattr(skill_hub, "find_science_skills", fake_find)
    response = client.post(
        "/api/v1/skill-hub/science-catalog/find/stream",
        json={"query": "单细胞类型注释", "limit": 5},
    )

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    text = response.text
    assert text.index("event: status") < text.index("event: route")
    assert text.index("event: route") < text.index("event: result")
    assert text.index("event: result") < text.index("event: done")
    assert '"id":"single-cell-annotation"' in text
    assert '"skill_mounted":true' in text


def test_science_finder_does_not_reuse_other_product_credentials(monkeypatch):
    from app.services import science_skill_finder

    monkeypatch.delenv("skillhub_scnet_api_key", raising=False)
    monkeypatch.setenv("SCIENCE_SKILL_FINDER_API_KEY", "legacy-test-key")
    monkeypatch.setenv("SCNET_API_KEY", "topiclink-test-key")

    config = science_skill_finder.get_finder_config()

    assert config.api_key == ""
    assert config.configured is False


def test_science_finder_parses_json_after_model_reasoning_text():
    from app.services.science_skill_finder import _parse_json_object

    parsed = _parse_json_object(
        '<think>先比较对象与产物，不能采用 {未验证候选}。</think>\n'
        '```json\n{"recommendations":[{"id":"alphafold2","reason":"对象和产物直接匹配"}]}\n```'
    )

    assert parsed["recommendations"][0]["id"] == "alphafold2"


def test_science_finder_falls_back_to_local_catalog_without_model_credentials(client, monkeypatch):
    monkeypatch.delenv("skillhub_scnet_api_key", raising=False)

    capabilities = client.get("/api/v1/skill-hub/science-catalog/finder/capabilities")
    assert capabilities.status_code == 200, capabilities.text
    assert capabilities.json()["configured"] is False
    assert capabilities.json()["orchestrator"] == "AgentScope"

    response = client.post(
        "/api/v1/skill-hub/science-catalog/find",
        json={"query": "蛋白质结构预测", "limit": 5},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["driver"]["mode"] == "local_fallback"
    assert payload["driver"]["configured"] is False
    assert not any(term in payload["route"]["rationale"] for term in ("模型不可用", "本地路由", "降级", "SCNet"))
    assert payload["results"]
    assert all(item["source_repository"] and item["source_path"] for item in payload["results"])

    english = client.post(
        "/api/v1/skill-hub/science-catalog/find",
        json={"query": "reproduce paper results", "limit": 5},
    )
    assert english.status_code == 200, english.text
    english_payload = english.json()
    assert english_payload["route"]["stage"] == "分析验证"
    assert english_payload["route"]["function"] == "验证评测"
    assert any(item["id"] == "paper-reproduce" for item in english_payload["results"])

    unrelated = client.post(
        "/api/v1/skill-hub/science-catalog/find",
        json={"query": "zzqvorn blxkpt 9876543210", "limit": 5},
    )
    assert unrelated.status_code == 200, unrelated.text
    unrelated_payload = unrelated.json()
    assert unrelated_payload["route"]["domain"] is None
    assert unrelated_payload["route"]["stage"] is None
    assert unrelated_payload["route"]["function"] is None
    assert unrelated_payload["results"] == []
    assert unrelated_payload["total"] == 0

    for vague_query in ("做研究", "我需要一个工具", "帮我处理数据", "I need a research tool"):
        vague = client.post(
            "/api/v1/skill-hub/science-catalog/find",
            json={"query": vague_query, "limit": 5},
        )
        assert vague.status_code == 200, vague.text
        vague_payload = vague.json()
        assert vague_payload["route"]["domain"] is None
        assert vague_payload["route"]["stage"] is None
        assert vague_payload["route"]["function"] is None
        assert vague_payload["results"] == []
        assert vague_payload["total"] == 0

    for specific_query in ("AlphaFold2", "蛋白质结构预测", "因果推断"):
        specific = client.post(
            "/api/v1/skill-hub/science-catalog/find",
            json={"query": specific_query, "limit": 5},
        )
        assert specific.status_code == 200, specific.text
        specific_payload = specific.json()
        assert any(
            specific_payload["route"].get(key)
            for key in ("domain", "stage", "function")
        )
        assert specific_payload["results"]


def test_critic_evaluation_contract_fails_closed_when_builtin_worker_is_unavailable(client, monkeypatch):
    class UnavailableAsyncClient:
        def __init__(self, *, timeout):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, *args, **kwargs):
            raise httpx.ConnectError("worker unavailable")

        async def post(self, *args, **kwargs):
            raise httpx.ConnectError("worker unavailable")

    monkeypatch.setattr("app.services.critic_evaluation.httpx.AsyncClient", UnavailableAsyncClient)
    capabilities = client.get("/api/v1/skill-hub/evaluations/capabilities")
    assert capabilities.status_code == 200, capabilities.text
    assert capabilities.json()["worker_available"] is False
    assert capabilities.json()["supported_kinds"] == ["skill", "mcp"]
    assert capabilities.json()["supported_depths"] == ["standard"]
    assert capabilities.json()["evaluation_profile"] == "standard"

    owner = register_and_login(client, phone="13800019992", username="critic-viewer")
    response = client.post(
        "/api/v1/skill-hub/evaluations",
        json={"kind": "skill", "target": "https://github.com/example/research-skill", "depth": "quick"},
        headers={"Authorization": f"Bearer {owner['token']}"},
    )
    assert response.status_code == 502
    assert "评测 Worker" in response.json()["detail"]


def test_critic_evaluation_allows_isolated_anonymous_jobs(client, monkeypatch):
    calls = []

    class FakeResponse:
        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    class FakeAsyncClient:
        def __init__(self, *, timeout):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, *, json, headers):
            calls.append(("post", url, json, headers))
            return FakeResponse({"job_id": "critic-job-1", "status": "queued", **json})

        async def get(self, url, *, headers, params=None):
            calls.append(("get", url, params, headers))
            if url.endswith("/health"):
                return FakeResponse(
                    {
                        "ready": True,
                        "supported_kinds": ["skill", "mcp"],
                        "evaluation_profile": "standard",
                        "runtime": {
                            "orchestrator": "agentscope",
                            "provider": "aistar",
                            "model": "glm5.2",
                        },
                    }
                )
            return FakeResponse(
                {
                    "job_id": "critic-job-1",
                    "status": "completed",
                    "verdict": "建议安装",
                    "score": 91,
                    "evidence": {"behavior_cases": 3, "behavior_pairs": 6, "trigger_queries": 8},
                }
            )

    monkeypatch.setattr("app.services.critic_evaluation.httpx.AsyncClient", FakeAsyncClient)
    capabilities = client.get("/api/v1/skill-hub/evaluations/capabilities")
    assert capabilities.status_code == 200, capabilities.text
    assert capabilities.json()["worker_available"] is True
    assert capabilities.json()["runtime"] == {
        "orchestrator": "agentscope",
        "provider": "aistar",
        "model": "glm5.2",
    }

    submitted = client.post(
        "/api/v1/skill-hub/evaluations",
        json={"kind": "skill", "target": "https://github.com/example/research-skill", "depth": "quick"},
    )
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["job_id"] == "critic-job-1"
    cookie_header = submitted.headers.get("set-cookie", "")
    assert "skillhub_critic_guest=" in cookie_header
    assert "HttpOnly" in cookie_header
    assert "SameSite=lax" in cookie_header
    requester_id = calls[1][2]["requester_id"]
    assert requester_id >= 2**62
    assert calls[0] == (
        "get",
        "http://skillhub-critic-worker:8090/health",
        None,
        {},
    )
    assert calls[1] == (
        "post",
        "http://skillhub-critic-worker:8090/api/v1/evaluations",
        {
            "kind": "skill",
            "target": "https://github.com/example/research-skill",
            "depth": "standard",
            "evaluation_profile": "standard",
            "runtime": {
                "orchestrator": "agentscope",
                "provider": "aistar",
                "model": "glm5.2",
            },
            "requester_id": requester_id,
            "source": "topiclab-skill-hub",
        },
        {},
    )

    completed = client.get("/api/v1/skill-hub/evaluations/critic-job-1")
    assert completed.status_code == 200, completed.text
    assert completed.json()["evidence"]["behavior_pairs"] == 6
    assert calls[2] == (
        "get",
        "http://skillhub-critic-worker:8090/api/v1/evaluations/critic-job-1",
        {"requester_id": requester_id},
        {},
    )

    streamed = client.get("/api/v1/skill-hub/evaluations/critic-job-1/stream")
    assert streamed.status_code == 200, streamed.text
    assert "event: job" in streamed.text
    assert '"status":"completed"' in streamed.text
    assert calls[3] == (
        "get",
        "http://skillhub-critic-worker:8090/api/v1/evaluations/critic-job-1",
        {"requester_id": requester_id},
        {},
    )

    client.cookies.clear()
    missing_session = client.get("/api/v1/skill-hub/evaluations/critic-job-1")
    assert missing_session.status_code == 404
    assert len(calls) == 4


def test_skill_hub_publish_review_and_profile_flow(client):
    owner = register_and_login(client, phone="13800010001", username="owner")
    reviewer = register_and_login(client, phone="13800010002", username="reviewer")

    publish = client.post(
        "/api/v1/skill-hub/skills",
        headers={"Authorization": f"Bearer {owner['token']}"},
        data={
            "name": "Scientify Notes",
            "summary": "科研实验记录与归档 Skill。",
            "description": "把实验记录、方法版本和结论摘要组织成可复用条目。",
            "category_key": "07",
            "cluster_key": "general",
            "framework": "openclaw",
            "compatibility_level": "runtime_full",
            "pricing_status": "free",
            "version": "0.1.0",
            "tags": "research,notes,automation",
            "capabilities": "capture,summary,archive",
            "content_markdown": "# Scientify Notes\n\nInitial canonical body.",
        },
    )
    assert publish.status_code == 200, publish.text
    published = publish.json()
    assert published["slug"] == "scientify-notes"
    skill_id = published["id"]

    version = client.post(
        f"/api/v1/skill-hub/skills/{published['slug']}/versions",
        headers={"Authorization": f"Bearer {owner['token']}"},
        data={"version": "0.2.0", "changelog": "Add export bundle."},
        files={"file": ("scientify.zip", b"fake-bundle", "application/zip")},
    )
    assert version.status_code == 200, version.text
    assert version.json()["latest_version"] == "0.2.0"

    detail_by_slug = client.get(f"/api/v1/skill-hub/skills/{published['slug']}")
    assert detail_by_slug.status_code == 200, detail_by_slug.text
    assert detail_by_slug.json()["id"] == skill_id
    assert detail_by_slug.json()["versions"][0]["version"] == "0.2.0"

    detail_by_id = client.get(f"/api/v1/skill-hub/skills/{skill_id}")
    assert detail_by_id.status_code == 200, detail_by_id.text
    assert detail_by_id.json()["slug"] == published["slug"]

    content_available = client.get(f"/api/v1/skill-hub/skills/{published['slug']}/content")
    assert content_available.status_code == 200, content_available.text
    assert "Initial canonical body" in content_available.json()["content"]

    review = client.post(
        "/api/v1/skill-hub/reviews",
        headers={"Authorization": f"Bearer {reviewer['token']}"},
        json={
            "skill_id": published["slug"],
            "rating": 5,
            "content": "这个 Skill 把实验日志整理和结论沉淀串起来了，适合在 TopicLab 里反复调用。",
            "model": "gpt-5.4",
            "pros": ["结构清晰"],
            "cons": ["还缺可视化"],
        },
    )
    assert review.status_code == 200, review.text
    review_id = review.json()["id"]

    duplicate = client.post(
        "/api/v1/skill-hub/reviews",
        headers={"Authorization": f"Bearer {reviewer['token']}"},
        json={
            "skill_id": published["slug"],
            "rating": 4,
            "content": "这个重复评测应该失败，因为同一个 OpenClaw Agent 只能提交一次。",
        },
    )
    assert duplicate.status_code == 409, duplicate.text

    helpful = client.post(
        f"/api/v1/skill-hub/reviews/{review_id}/helpful",
        headers={"Authorization": f"Bearer {owner['token']}"},
        json={"enabled": True},
    )
    assert helpful.status_code == 200, helpful.text
    assert helpful.json()["helpful_count"] == 1

    version_with_content = client.post(
        f"/api/v1/skill-hub/skills/{published['slug']}/versions",
        headers={"Authorization": f"Bearer {owner['token']}"},
        data={
            "version": "0.3.0",
            "changelog": "Add canonical skill content.",
            "content_markdown": "# Scientify Notes\n\nCanonical markdown body.",
        },
    )
    assert version_with_content.status_code == 200, version_with_content.text

    content_present = client.get(f"/api/v1/skill-hub/skills/{published['slug']}/content")
    assert content_present.status_code == 200, content_present.text
    assert content_present.json()["version"]["version"] == "0.3.0"
    assert "Canonical markdown body" in content_present.json()["content"]

    profile = client.get(
        "/api/v1/skill-hub/profile",
        headers={"Authorization": f"Bearer {owner['token']}"},
    )
    assert profile.status_code == 200, profile.text
    profile_payload = profile.json()
    assert profile_payload["has_agent"] is True
    assert any(item["slug"] == published["slug"] for item in profile_payload["my_skills"])


def test_skill_hub_publish_and_version_require_payload(client):
    owner = register_and_login(client, phone="13800010009", username="payload-owner")

    publish = client.post(
        "/api/v1/skill-hub/skills",
        headers={"Authorization": f"Bearer {owner['token']}"},
        data={
            "name": "Empty Publish",
            "summary": "should fail",
            "description": "missing markdown and file",
            "category_key": "07",
            "cluster_key": "general",
        },
    )
    assert publish.status_code == 400, publish.text
    assert "content_markdown" in publish.text or "file" in publish.text

    valid_publish = client.post(
        "/api/v1/skill-hub/skills",
        headers={"Authorization": f"Bearer {owner['token']}"},
        data={
            "name": "Payload Skill",
            "summary": "has content",
            "description": "valid publish",
            "category_key": "07",
            "cluster_key": "general",
            "content_markdown": "# Payload Skill\n",
        },
    )
    assert valid_publish.status_code == 200, valid_publish.text
    slug = valid_publish.json()["slug"]

    version = client.post(
        f"/api/v1/skill-hub/skills/{slug}/versions",
        headers={"Authorization": f"Bearer {owner['token']}"},
        data={"version": "0.2.0"},
    )
    assert version.status_code == 400, version.text
    assert "content_markdown" in version.text or "file" in version.text


def test_skill_hub_download_wish_vote_and_points(client):
    from app.services.openclaw_runtime import apply_points_delta, ensure_primary_openclaw_agent
    from app.storage.database.postgres_client import get_db_session

    owner = register_and_login(client, phone="13800010003", username="publisher")
    buyer = register_and_login(client, phone="13800010004", username="buyer")

    publish = client.post(
        "/api/v1/skill-hub/skills",
        headers={"Authorization": f"Bearer {owner['token']}"},
        data={
            "name": "Premium Docking",
            "summary": "付费药物发现 Skill。",
            "description": "用于测试点数扣减和下载记录。",
            "category_key": "08",
            "cluster_key": "pharma",
            "compatibility_level": "install",
            "pricing_status": "pro",
            "price_points": "7",
            "version": "1.0.0",
            "content_markdown": "# Premium Docking\n\nPaid skill body.",
        },
    )
    assert publish.status_code == 200, publish.text
    slug = publish.json()["slug"]

    denied = client.get(
        f"/api/v1/skill-hub/skills/{slug}/download",
        headers={"Authorization": f"Bearer {buyer['token']}"},
    )
    assert denied.status_code == 402, denied.text

    with get_db_session() as session:
        agent = ensure_primary_openclaw_agent(int(buyer["user"]["id"]), username="buyer", phone="13800010004", session=session)
        apply_points_delta(
            openclaw_agent_id=int(agent["id"]),
            delta=20,
            reason_code="skill_referral_reward",
            target_type="test",
            target_id="seed",
            session=session,
        )

    allowed = client.get(
        f"/api/v1/skill-hub/skills/{slug}/download",
        headers={"Authorization": f"Bearer {buyer['token']}"},
    )
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["points_spent"] == 7

    wish = client.post(
        "/api/v1/skill-hub/wishes",
        headers={"Authorization": f"Bearer {buyer['token']}"},
        json={"title": "需要新的显微镜图像分割 Skill", "content": "最好带 benchmark 和可追溯评测。", "category_key": "10"},
    )
    assert wish.status_code == 200, wish.text
    wish_id = wish.json()["id"]

    vote = client.post(
        f"/api/v1/skill-hub/wishes/{wish_id}/vote",
        headers={"Authorization": f"Bearer {owner['token']}"},
        json={"enabled": True},
    )
    assert vote.status_code == 200, vote.text
    assert vote.json()["votes_count"] == 1

    vote_again = client.post(
        f"/api/v1/skill-hub/wishes/{wish_id}/vote",
        headers={"Authorization": f"Bearer {owner['token']}"},
        json={"enabled": True},
    )
    assert vote_again.status_code == 200, vote_again.text
    assert vote_again.json()["votes_count"] == 1

    leaderboard = client.get("/api/v1/skill-hub/leaderboard")
    assert leaderboard.status_code == 200, leaderboard.text
    assert any(item["slug"] == slug for item in leaderboard.json()["skills"])


def test_claude_scientific_taxonomy_json_covers_meta_and_valid_keys():
    import json
    from pathlib import Path

    from app.services.skill_hub import DISCIPLINES, RESEARCH_CLUSTERS

    root = Path(__file__).resolve().parents[1]
    repo = root.parent
    meta_path = repo / "backend" / "libs" / "assignable_skills" / "claude-scientific" / "meta.json"
    tax_path = root / "app" / "data" / "claude_scientific_taxonomy.json"
    assert meta_path.is_file(), meta_path
    assert tax_path.is_file(), tax_path
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    tax = json.loads(tax_path.read_text(encoding="utf-8"))
    slugs_meta = {k.split(":", 1)[1] for k in meta.get("skills", {})}
    assert slugs_meta == set(tax.keys())
    dkeys = {d["key"] for d in DISCIPLINES}
    ckeys = {c["key"] for c in RESEARCH_CLUSTERS}
    for slug, entry in tax.items():
        assert isinstance(entry, dict), slug
        assert entry["category_key"] in dkeys, slug
        assert entry["cluster_key"] in ckeys, slug
