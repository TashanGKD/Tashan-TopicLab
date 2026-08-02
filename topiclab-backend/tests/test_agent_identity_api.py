import importlib
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text


@pytest.fixture
def agentid_client(tmp_path, monkeypatch):
    database_path = tmp_path / "topiclab-agentid.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("TOPICLAB_TESTING", "1")
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.setenv("AGENTID_CLIENT_ID", "hub_418d2a")
    monkeypatch.setenv("AGENTID_PUBLIC_BASE_URL", "https://world.tashan.chat")

    from app.storage.database import postgres_client, topic_store

    postgres_client.reset_db_state()
    importlib.reload(postgres_client)
    importlib.reload(topic_store)

    import app.api.auth as auth_module
    import app.api.agent_identity as agent_identity_api_module
    import app.api.openclaw_routes as openclaw_routes_module
    import app.services.agent_identity as agent_identity_service_module
    import main as main_module

    importlib.reload(auth_module)
    agent_identity_service_module = importlib.reload(agent_identity_service_module)
    importlib.reload(agent_identity_api_module)
    importlib.reload(openclaw_routes_module)
    main_module = importlib.reload(main_module)

    async def fake_verify(authorization: str):
        if authorization == "Bearer invalid":
            raise agent_identity_service_module.AgentIdentityAuthenticationError()
        external_id = {
            "Bearer unregistered": "agent_id:modelscope:agent_unregistered",
            "Bearer second-valid": "agent_id:modelscope:agent_topiclab_second",
        }.get(authorization, "agent_id:modelscope:agent_topiclab_test")
        return SimpleNamespace(
            agent_id=external_id,
            issuer="https://www.modelscope.cn/openapi/v1",
        )

    monkeypatch.setattr(
        agent_identity_service_module,
        "verify_modelscope_authorization",
        fake_verify,
    )

    with TestClient(main_module.app) as test_client:
        yield test_client, postgres_client


def _register_existing_openclaw_agent(client, postgres_client) -> dict:
    with postgres_client.get_db_session() as session:
        session.execute(
            text(
                """
                INSERT INTO verification_codes (phone, code, type, expires_at)
                VALUES (:phone, '123456', 'register', :expires_at)
                """
            ),
            {
                "phone": "13800008881",
                "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5),
            },
        )
    registered = client.post(
        "/auth/register",
        json={
            "phone": "13800008881",
            "code": "123456",
            "password": "password123",
            "username": "现有他山分身",
        },
    )
    assert registered.status_code == 200, registered.text
    key = client.post(
        "/api/v1/auth/openclaw-key",
        headers={"Authorization": f"Bearer {registered.json()['token']}"},
    )
    assert key.status_code == 200, key.text
    return key.json()


def test_agentid_bootstrap_is_idempotent_and_does_not_issue_a_long_lived_key(
    agentid_client,
):
    client, postgres_client = agentid_client
    headers = {"Authorization": "Bearer valid"}

    first = client.post(
        "/api/v1/agent-identity/bootstrap",
        headers=headers,
        json={
            "display_name": "他山新闻分身",
            "description": "持续整理天文与 AI 新闻",
        },
    )
    second = client.post(
        "/api/v1/agent-identity/bootstrap",
        headers=headers,
        json={"display_name": "不应创建第二个身份"},
    )

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    first_payload = first.json()
    second_payload = second.json()
    assert first_payload["created"] is True
    assert second_payload["created"] is False
    assert first_payload["agent"]["agent_uid"] == second_payload["agent"]["agent_uid"]
    assert first_payload["external_identity"] == {
        "provider": "modelscope",
        "issuer": "https://www.modelscope.cn/openapi/v1",
        "agent_id": "agent_id:modelscope:agent_topiclab_test",
    }
    assert "key" not in first_payload
    assert "bind_key" not in first_payload
    assert "skill_token" not in first_payload["agent"]

    with postgres_client.get_db_session() as session:
        mapping_count = session.execute(
            text("SELECT COUNT(*) FROM agent_external_identities")
        ).scalar_one()
        local_agent_count = session.execute(
            text("SELECT COUNT(*) FROM openclaw_agents")
        ).scalar_one()
    assert mapping_count == 1
    assert local_agent_count == 1


def test_agentid_can_use_existing_openclaw_business_route_after_bootstrap(
    agentid_client,
):
    client, _ = agentid_client
    headers = {"Authorization": "Bearer valid"}
    bootstrap = client.post(
        "/api/v1/agent-identity/bootstrap",
        headers=headers,
        json={"display_name": "他山选题分身"},
    )
    assert bootstrap.status_code == 200, bootstrap.text

    created = client.post(
        "/api/v1/openclaw/topics",
        headers=headers,
        json={"title": "AgentID 接入测试", "body": "由魔搭 AgentID 发起"},
    )

    assert created.status_code == 201, created.text
    assert created.json()["creator_name"] == "他山选题分身"

    twin = client.get("/api/v1/openclaw/twins/current", headers=headers)
    assert twin.status_code == 200, twin.text
    assert twin.json()["twin"]["display_name"] == "他山选题分身"


def test_agentid_rejects_invalid_tokens_and_requires_bootstrap(agentid_client):
    client, _ = agentid_client

    invalid = client.post(
        "/api/v1/agent-identity/bootstrap",
        headers={"Authorization": "Bearer invalid"},
        json={"display_name": "无效身份"},
    )
    unknown = client.post(
        "/api/v1/openclaw/topics",
        headers={"Authorization": "Bearer unregistered"},
        json={"title": "未注册身份", "body": "不应写入"},
    )

    assert invalid.status_code == 401
    assert invalid.json() == {"detail": "AgentID token verification failed"}
    assert unknown.status_code == 403
    assert unknown.json() == {
        "detail": "AgentID identity is not registered; call /api/v1/agent-identity/bootstrap first"
    }


def test_agentid_bootstrap_rejects_a_blank_display_name(agentid_client):
    client, _ = agentid_client

    response = client.post(
        "/api/v1/agent-identity/bootstrap",
        headers={"Authorization": "Bearer valid"},
        json={"display_name": "   "},
    )

    assert response.status_code == 422


def test_existing_openclaw_agent_can_bind_agentid_without_losing_its_local_identity(
    agentid_client,
):
    client, postgres_client = agentid_client
    existing = _register_existing_openclaw_agent(client, postgres_client)
    headers = {
        "Authorization": "Bearer valid",
        "X-TopicLab-OpenClaw-Key": existing["key"],
    }

    first = client.post("/api/v1/agent-identity/bind", headers=headers)
    second = client.post("/api/v1/agent-identity/bind", headers=headers)

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json()["created"] is True
    assert second.json()["created"] is False
    assert first.json()["agent"]["agent_uid"] == existing["agent_uid"]
    assert second.json()["agent"]["agent_uid"] == existing["agent_uid"]

    created = client.post(
        "/api/v1/openclaw/topics",
        headers={"Authorization": "Bearer valid"},
        json={"title": "老分身接入 AgentID", "body": "历史主体保持不变"},
    )
    assert created.status_code == 201, created.text
    assert created.json()["creator_name"] == existing["openclaw_agent"]["display_name"]

    with postgres_client.get_db_session() as session:
        local_agent_count = session.execute(
            text("SELECT COUNT(*) FROM openclaw_agents")
        ).scalar_one()
        mapping_count = session.execute(
            text("SELECT COUNT(*) FROM agent_external_identities")
        ).scalar_one()
    assert local_agent_count == 1
    assert mapping_count == 1


def test_agentid_bind_rejects_reassigning_an_identity_to_another_local_agent(
    agentid_client,
):
    client, postgres_client = agentid_client
    bootstrap = client.post(
        "/api/v1/agent-identity/bootstrap",
        headers={"Authorization": "Bearer valid"},
        json={"display_name": "魔搭先来分身"},
    )
    assert bootstrap.status_code == 200, bootstrap.text
    existing = _register_existing_openclaw_agent(client, postgres_client)

    response = client.post(
        "/api/v1/agent-identity/bind",
        headers={
            "Authorization": "Bearer valid",
            "X-TopicLab-OpenClaw-Key": existing["key"],
        },
    )

    assert response.status_code == 409, response.text
    assert response.json() == {
        "detail": "AgentID is already bound to another TopicLab agent"
    }


def test_agentid_bind_rejects_a_second_identity_for_the_same_local_agent(
    agentid_client,
):
    client, postgres_client = agentid_client
    existing = _register_existing_openclaw_agent(client, postgres_client)
    local_headers = {"X-TopicLab-OpenClaw-Key": existing["key"]}
    first = client.post(
        "/api/v1/agent-identity/bind",
        headers={"Authorization": "Bearer valid", **local_headers},
    )
    assert first.status_code == 200, first.text

    response = client.post(
        "/api/v1/agent-identity/bind",
        headers={"Authorization": "Bearer second-valid", **local_headers},
    )

    assert response.status_code == 409, response.text
    assert response.json() == {
        "detail": "TopicLab agent is already bound to another AgentID"
    }


def test_agentid_bind_requires_proof_of_the_existing_topiclab_agent(
    agentid_client,
):
    client, _ = agentid_client

    response = client.post(
        "/api/v1/agent-identity/bind",
        headers={"Authorization": "Bearer valid"},
    )

    assert response.status_code == 401, response.text
    assert response.json() == {"detail": "TopicLab OpenClaw key required"}


def test_agentid_bind_rejects_an_invalid_topiclab_agent_key(agentid_client):
    client, _ = agentid_client

    response = client.post(
        "/api/v1/agent-identity/bind",
        headers={
            "Authorization": "Bearer valid",
            "X-TopicLab-OpenClaw-Key": "tloc_invalid",
        },
    )

    assert response.status_code == 401, response.text
    assert response.json() == {"detail": "Invalid TopicLab OpenClaw key"}
