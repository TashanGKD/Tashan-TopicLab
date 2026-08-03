import importlib
import json
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
    monkeypatch.setenv("ADMIN_PANEL_PASSWORD", "admin-secret")
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


def _register_existing_openclaw_agent(
    client,
    postgres_client,
    *,
    phone: str = "13800008881",
    username: str = "现有他山分身",
) -> dict:
    with postgres_client.get_db_session() as session:
        session.execute(
            text(
                """
                INSERT INTO verification_codes (phone, code, type, expires_at)
                VALUES (:phone, '123456', 'register', :expires_at)
                """
            ),
            {
                "phone": phone,
                "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5),
            },
        )
    registered = client.post(
        "/auth/register",
        json={
            "phone": phone,
            "code": "123456",
            "password": "password123",
            "username": username,
        },
    )
    assert registered.status_code == 200, registered.text
    key = client.post(
        "/api/v1/auth/openclaw-key",
        headers={"Authorization": f"Bearer {registered.json()['token']}"},
    )
    assert key.status_code == 200, key.text
    result = key.json()
    result["access_token"] = registered.json()["token"]
    result["user"] = registered.json()["user"]
    return result


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
    client, postgres_client = agentid_client
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
    twin_id = twin.json()["twin"]["twin_id"]

    appended = client.post(
        f"/api/v1/openclaw/twins/{twin_id}/observations",
        headers=headers,
        json={
            "instance_id": bootstrap.json()["agent"]["agent_uid"],
            "observation_type": "style_shift",
            "payload": {"signal": "prefers concise summaries"},
        },
    )
    assert appended.status_code == 200, appended.text

    observations = client.get(
        f"/api/v1/openclaw/twins/{twin_id}/observations",
        headers=headers,
    )
    assert observations.status_code == 200, observations.text
    assert observations.json()["total"] == 1

    with postgres_client.get_db_session() as session:
        audit_row = session.execute(
            text(
                """
                SELECT payload_json
                FROM openclaw_activity_events
                WHERE event_type = 'http.request'
                  AND route LIKE '%/openclaw/topics'
                ORDER BY id DESC
                LIMIT 1
                """
            )
        ).fetchone()
    assert audit_row is not None
    authentication = json.loads(audit_row.payload_json)["authentication"]
    assert authentication == {
        "auth_type": "openclaw_key",
        "credential_type": "modelscope_agentid",
        "external_agent_id": "agent_id:modelscope:agent_topiclab_test",
        "external_issuer": "https://www.modelscope.cn/openapi/v1",
    }


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
        bind_audit = session.execute(
            text(
                """
                SELECT payload_json
                FROM openclaw_activity_events
                WHERE event_type = 'http.request'
                  AND route LIKE '%/agent-identity/bind'
                ORDER BY id DESC
                LIMIT 1
                """
            )
        ).fetchone()
    assert local_agent_count == 1
    assert mapping_count == 1
    assert bind_audit is not None
    assert json.loads(bind_audit.payload_json)["authentication"] == {
        "auth_type": "openclaw_key",
        "credential_type": "modelscope_agentid",
        "external_agent_id": "agent_id:modelscope:agent_topiclab_test",
        "external_issuer": "https://www.modelscope.cn/openapi/v1",
    }


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


def test_unbound_agentid_cannot_follow_a_local_agent_to_a_new_user(agentid_client):
    client, postgres_client = agentid_client
    original_owner = _register_existing_openclaw_agent(
        client,
        postgres_client,
        phone="13800008882",
        username="原分身主人",
    )
    bound = client.post(
        "/api/v1/agent-identity/bind",
        headers={
            "Authorization": "Bearer valid",
            "X-TopicLab-OpenClaw-Key": original_owner["key"],
        },
    )
    assert bound.status_code == 200, bound.text

    unbound = client.post(
        f"/api/v1/openclaw/agents/{original_owner['agent_uid']}/unbind-user",
        headers={"Authorization": f"Bearer {original_owner['access_token']}"},
    )
    assert unbound.status_code == 200, unbound.text

    new_owner = _register_existing_openclaw_agent(
        client,
        postgres_client,
        phone="13800008883",
        username="新分身主人",
    )
    rebound = client.post(
        f"/api/v1/openclaw/agents/{original_owner['agent_uid']}/bind-user",
        headers={"Authorization": f"Bearer {new_owner['access_token']}"},
    )
    assert rebound.status_code == 200, rebound.text

    stale_identity = client.post(
        "/api/v1/openclaw/topics",
        headers={"Authorization": "Bearer valid"},
        json={"title": "不应创建", "body": "旧 AgentID 不应跟随换绑"},
    )
    assert stale_identity.status_code == 403, stale_identity.text

    with postgres_client.get_db_session() as session:
        mapping_count = session.execute(
            text("SELECT COUNT(*) FROM agent_external_identities")
        ).scalar_one()
        leaked_topic_count = session.execute(
            text("SELECT COUNT(*) FROM topics WHERE title = '不应创建'")
        ).scalar_one()
    assert mapping_count == 0
    assert leaked_topic_count == 0


def test_deleting_a_user_revokes_its_agentid_mapping(agentid_client):
    client, postgres_client = agentid_client
    existing = _register_existing_openclaw_agent(
        client,
        postgres_client,
        phone="13800008884",
        username="待删除分身主人",
    )
    bound = client.post(
        "/api/v1/agent-identity/bind",
        headers={
            "Authorization": "Bearer valid",
            "X-TopicLab-OpenClaw-Key": existing["key"],
        },
    )
    assert bound.status_code == 200, bound.text

    admin_login = client.post(
        "/admin/auth/login",
        json={"password": "admin-secret"},
    )
    assert admin_login.status_code == 200, admin_login.text
    deleted = client.delete(
        f"/admin/users/{existing['user']['id']}",
        headers={"Authorization": f"Bearer {admin_login.json()['token']}"},
    )
    assert deleted.status_code == 200, deleted.text

    revoked = client.post(
        "/api/v1/openclaw/topics",
        headers={"Authorization": "Bearer valid"},
        json={"title": "删除后不应创建", "body": "映射应失效"},
    )
    assert revoked.status_code == 403, revoked.text
    with postgres_client.get_db_session() as session:
        mapping_count = session.execute(
            text("SELECT COUNT(*) FROM agent_external_identities")
        ).scalar_one()
    assert mapping_count == 0
