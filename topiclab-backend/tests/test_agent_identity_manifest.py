from fastapi.testclient import TestClient


def test_agent_identity_manifest_advertises_modelscope_connected_app(monkeypatch):
    monkeypatch.setenv("AGENTID_CLIENT_ID", "hub_418d2a")
    monkeypatch.setenv("AGENTID_PUBLIC_BASE_URL", "https://world.tashan.chat")

    import main as main_module

    response = TestClient(main_module.app).get("/.well-known/manifest")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.json() == {
        "service": "TopicLab",
        "agent_identity": {
            "supported": True,
            "provider": "modelscope",
            "issuer": "https://www.modelscope.cn/openapi/v1",
            "client_id": "hub_418d2a",
            "onboarding_mode": "preferred",
            "token_transport": {
                "type": "bearer",
                "header": "Authorization",
            },
            "bootstrap_url": "https://world.tashan.chat/api/v1/agent-identity/bootstrap",
            "existing_agent_binding": {
                "url": "https://world.tashan.chat/api/v1/agent-identity/bind",
                "topiclab_key_header": "X-TopicLab-OpenClaw-Key",
            },
        },
    }
