from __future__ import annotations

import importlib
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text


@pytest.fixture
def client(tmp_path, monkeypatch):
    database_path = tmp_path / "science_mcp_hub.sqlite3"
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


def register_and_login(client, *, phone: str, username: str) -> dict:
    from app.storage.database.postgres_client import get_db_session

    with get_db_session() as session:
        session.execute(
            text("INSERT INTO verification_codes (phone, code, type, expires_at) VALUES (:phone, '123456', 'register', :expires_at)"),
            {"phone": phone, "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5)},
        )
    response = client.post("/auth/register", json={"phone": phone, "code": "123456", "password": "password123", "username": username})
    assert response.status_code == 200, response.text
    return response.json()


def test_science_mcp_hub_public_surface_and_catalog_boundary(client):
    meta = client.get("/api/v1/mcp-hub/meta")
    assert meta.status_code == 200, meta.text
    assert meta.json()["active_catalog_count"] == 5643
    assert meta.json()["product_surface"]["candidate_status"] == "needs_review"
    assert meta.json()["product_surface"]["execution_or_installation"] is False
    assert meta.json()["product_surface"]["download_status"] == "safe_placeholder_unavailable"

    skillhub_meta = client.get("/api/v1/mcp-hub/science-catalog/meta")
    assert skillhub_meta.status_code == 200, skillhub_meta.text
    assert skillhub_meta.json()["active_catalog_count"] == meta.json()["active_catalog_count"]
    license_coverage = skillhub_meta.json()["hub_index"]["license_coverage"]
    active_count = meta.json()["active_catalog_count"]
    assert license_coverage["known"] + license_coverage["missing"] == active_count
    assert license_coverage["evidence_complete"] == active_count
    assert sum(license_coverage["evidence_status_counts"].values()) == active_count

    listing = client.get("/api/v1/mcp-hub/mcps?limit=1")
    assert listing.status_code == 200, listing.text
    mcp_id = listing.json()["list"][0]["id"]
    skillhub_listing = client.get("/api/v1/mcp-hub/science-catalog?limit=1")
    assert skillhub_listing.status_code == 200, skillhub_listing.text
    assert skillhub_listing.json()["list"][0]["id"] == mcp_id
    detail = client.get(f"/api/v1/mcp-hub/mcps/{mcp_id}")
    assert detail.status_code == 200, detail.text
    skillhub_detail = client.get(f"/api/v1/mcp-hub/science-catalog/{mcp_id}")
    assert skillhub_detail.status_code == 200, skillhub_detail.text
    assert skillhub_detail.json()["id"] == mcp_id
    assert "license_status" in skillhub_detail.json()
    assert "license_evidence" in skillhub_detail.json()
    search = client.get(f"/api/v1/mcp-hub/search?q={mcp_id}&limit=1")
    assert search.status_code == 200, search.text
    assert search.json()["list"][0]["id"] == mcp_id
    stream = client.post("/api/v1/mcp-hub/science-catalog/find/stream", json={"query": mcp_id, "limit": 1})
    assert stream.status_code == 200, stream.text
    assert "event: status" in stream.text
    assert "event: result" in stream.text
    assert "event: done" in stream.text
    capabilities = client.get("/api/v1/mcp-hub/science-catalog/finder/capabilities")
    assert capabilities.status_code == 200, capabilities.text
    capability_body = capabilities.json()
    assert capability_body["orchestrator"] == "AgentScope"
    assert capability_body["provider"] == "SCNet"
    assert capability_body["model"] == "GLM-5.2"
    assert capability_body["model_requires_auth"] is True
    assert capability_body["agent_api"]["read_only"] is True
    assert capability_body["agent_api"]["search"]["path"].endswith("/science-catalog/find")
    assert capability_body["agent_api"]["stream"]["events"] == ["status", "route", "result", "done"]
    finder = client.post("/api/v1/mcp-hub/science-catalog/find", json={"query": mcp_id, "limit": 1})
    assert finder.status_code == 200, finder.text
    assert finder.json()["results"][0]["id"] == mcp_id
    assert client.post("/api/v1/mcp-hub/science-catalog/find", json={"query": " ", "limit": 1}).status_code == 422
    assert client.post("/api/v1/mcp-hub/science-catalog/find", json={"query": mcp_id, "limit": 25}).status_code == 422
    content = client.get(f"/api/v1/mcp-hub/mcps/{mcp_id}/content")
    assert content.status_code == 200, content.text
    assert content.json()["format"] == "mcp_catalog_record"
    assert "叙事依据：" in content.json()["content"]
    assert "## 这个 MCP 提供什么" in content.json()["content"]
    assert "能力依据：" in content.json()["content"]
    assert "## 一手资料字段" in content.json()["content"]
    assert "能力证据模式：" not in content.json()["content"]
    download = client.get(f"/api/v1/mcp-hub/mcps/{mcp_id}/download")
    assert download.status_code == 200, download.text
    assert download.json()["available"] is False
    asset = client.get(f"/api/v1/mcp-hub/assets/{mcp_id}")
    assert asset.status_code == 200, asset.text
    assert asset.headers["x-science-mcp-executable"] == "false"
    assert detail.json()["name"] in asset.text

    assert client.get(f"/api/v1/mcp-hub/mcps/{mcp_id}/reviews").status_code == 200
    assert client.get("/api/v1/mcp-hub/wishes").status_code == 200
    assert client.get("/api/v1/mcp-hub/collections").status_code == 200
    assert client.get("/api/v1/mcp-hub/leaderboard").status_code == 200
    assert client.post(f"/api/v1/mcp-hub/mcps/{mcp_id}/favorite").status_code == 401
    assert client.post("/api/v1/mcp-hub/submissions", json={}).status_code == 401
    assert client.get("/api/v1/mcp-hub/tasks", headers={"Authorization": "Bearer invalid"}).status_code == 401
    guide = client.get("/api/v1/mcp-hub/guide.md")
    assert guide.status_code == 200 and "active_catalog" in guide.text
    assert "/science-catalog/find" in guide.text
    assert "/science-catalog/find/stream" in guide.text
    assert "taxonomy_reviewed" in guide.text

    enriched_content = client.get("/api/v1/mcp-hub/mcps/nasa-impact-astroquery-mcp/content")
    assert enriched_content.status_code == 200, enriched_content.text
    assert "资料保存状态：fetched" in enriched_content.json()["content"]
    assert "资料指纹 SHA-256：" in enriched_content.json()["content"]


def test_science_mcp_finder_uses_agentscope_for_authenticated_search(client, monkeypatch):
    from app.services import science_mcp_finder

    monkeypatch.setenv("SCNET_API_KEY", "test-key")

    async def fake_route_with_agentscope(query, dimensions, config):
        assert query == "蛋白质结构预测"
        assert "生命科学" in dimensions["domains"]
        return {
            "domain": "生命科学",
            "stage": "分析验证",
            "function": "分析推断",
            "search_terms": ["蛋白质", "结构预测"],
            "rationale": "主要产物是蛋白质结构分析结果。",
            "__skill_mounted": True,
        }

    async def fake_recommend_with_agentscope(
        query,
        route,
        candidates,
        config,
        limit,
        *,
        entity_label="Skill",
    ):
        assert query == "蛋白质结构预测"
        assert route["domain"] == "生命科学"
        assert route["stage"] == "分析验证"
        assert candidates
        assert limit == 5
        assert entity_label == "MCP"
        return [
            {
                "id": candidates[0]["id"],
                "reason": "研究对象、分析动作与蛋白质结构产物直接匹配。",
            }
        ]

    monkeypatch.setattr(science_mcp_finder, "_route_with_agentscope", fake_route_with_agentscope)
    monkeypatch.setattr(science_mcp_finder, "_recommend_with_agentscope", fake_recommend_with_agentscope)
    owner = register_and_login(client, phone="13800029992", username="mcp-finder-viewer")
    response = client.post(
        "/api/v1/mcp-hub/science-catalog/find",
        json={"query": "蛋白质结构预测", "limit": 5},
        headers={"Authorization": f"Bearer {owner['token']}"},
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
        "message": "AgentScope 已完成三维路由与 MCP 候选推荐",
    }
    assert payload["route"]["domain"] == "生命科学"
    assert payload["route"]["stage"] == "分析验证"
    assert payload["route"]["function"] == "分析推断"
    assert len(payload["results"]) == 1
    assert payload["results"][0]["recommendation_reason"] == "研究对象、分析动作与蛋白质结构产物直接匹配。"
    assert payload["ranking"]["criteria"][0] == {"key": "semantic_match", "label": "需求语义匹配"}


def test_anonymous_science_mcp_finder_never_calls_the_model(client, monkeypatch):
    from app.services import science_mcp_finder

    monkeypatch.setenv("SCNET_API_KEY", "configured-but-private")

    async def unexpected_model_call(*args, **kwargs):
        raise AssertionError("anonymous requests must not call the model")

    monkeypatch.setattr(science_mcp_finder, "_route_with_agentscope", unexpected_model_call)
    response = client.post(
        "/api/v1/mcp-hub/science-catalog/find",
        json={"query": "天文", "limit": 5},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["driver"]["mode"] == "local_fallback"
    assert payload["driver"]["orchestrator"] == "AgentScope"
    assert payload["results"]


def test_science_mcp_hub_user_interactions_stay_out_of_active_catalog(client):
    owner = register_and_login(client, phone="13800029991", username="mcp-reviewer")
    headers = {"Authorization": f"Bearer {owner['token']}"}
    mcp_id = client.get("/api/v1/mcp-hub/mcps?limit=1").json()["list"][0]["id"]

    favorite = client.post(f"/api/v1/mcp-hub/mcps/{mcp_id}/favorite", headers=headers)
    assert favorite.status_code == 200, favorite.text
    review = client.post(
        f"/api/v1/mcp-hub/mcps/{mcp_id}/reviews",
        headers=headers,
        json={"rating": 5, "title": "可复核", "content": "一手来源和研究动作描述清楚。", "pros": ["证据清楚"]},
    )
    assert review.status_code == 200, review.text
    assert client.get(f"/api/v1/mcp-hub/mcps/{mcp_id}/reviews").json()["list"][0]["mcp_id"] == mcp_id

    wish = client.post("/api/v1/mcp-hub/wishes", headers=headers, json={"title": "补齐结构生物学工具", "content": "希望发现能处理蛋白结构数据的 MCP。", "taxonomy": {"domain": "生命科学", "subdomain": "蛋白与结构生物学"}})
    assert wish.status_code == 200, wish.text
    assert client.post(f"/api/v1/mcp-hub/wishes/{wish.json()['id']}/vote", headers=headers).status_code == 200

    collection = client.post("/api/v1/mcp-hub/collections", headers=headers, json={"title": "结构生物学观察", "description": "用于持续复核的 MCP 集合"})
    assert collection.status_code == 200, collection.text
    collection_id = collection.json()["id"]
    assert client.post(f"/api/v1/mcp-hub/collections/{collection_id}/items/{mcp_id}", headers=headers).status_code == 200

    submission = client.post(
        "/api/v1/mcp-hub/submissions",
        headers=headers,
        json={"name": "候选 MCP", "summary": "处理蛋白结构实验数据", "canonical_url": "https://github.com/example/protein-mcp", "evidence": "README 明确 MCP server 身份及结构分析动作。", "domain": "生命科学", "subdomain": "蛋白与结构生物学", "stage": "分析验证", "function": "分析推断"},
    )
    assert submission.status_code == 200, submission.text
    assert submission.json()["active_catalog_effect"] == "none_until_taxonomy_reviewed_sync"

    profile = client.get("/api/v1/mcp-hub/profile", headers=headers)
    assert profile.status_code == 200, profile.text
    stats = profile.json()["stats"]
    assert stats["favorites"] == 1
    assert stats["reviews"] == 1
    assert stats["wishes"] == 1
    assert stats["submissions"] == 1
    tasks = client.get("/api/v1/mcp-hub/tasks", headers=headers)
    assert tasks.status_code == 200, tasks.text
    assert any(item["task_key"] == "review_a_mcp" and item["completed"] for item in tasks.json()["tasks"])


def test_science_mcp_hub_read_surfaces_degrade_without_database(monkeypatch):
    import app.services.science_mcp_hub as hub

    monkeypatch.setattr(hub, "database_configured", lambda: False)
    mcp_id = "io-globalping-mcp"
    assert hub.list_mcp_reviews(mcp_id=mcp_id) == {"mcp_id": mcp_id, "list": []}
    assert hub.list_mcp_wishes() == {"list": []}
    assert hub.list_mcp_collections() == {"list": []}
    assert hub.list_mcp_leaderboard() == {"list": []}
