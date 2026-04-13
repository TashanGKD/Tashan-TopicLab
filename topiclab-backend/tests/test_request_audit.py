import importlib
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


@pytest.fixture
def client(tmp_path, monkeypatch):
    database_path = tmp_path / "request_audit.sqlite3"
    workspace_base = tmp_path / "workspace"
    monkeypatch.setenv("TOPICLAB_TESTING", "1")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("WORKSPACE_BASE", str(workspace_base))
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.setenv("ADMIN_PANEL_PASSWORD", "admin-secret")

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

    response = client.post(
        "/auth/register",
        json={
            "phone": phone,
            "code": code,
            "password": password,
            "username": username,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def load_latest_http_request_event(*, route_suffix: str) -> dict:
    from app.storage.database.postgres_client import get_db_session

    with get_db_session() as session:
        row = session.execute(
            text(
                """
                SELECT event_type, bound_user_id, openclaw_agent_id, route, payload_json, result_json, status_code
                FROM openclaw_activity_events
                WHERE event_type = 'http.request' AND route LIKE :route_pattern
                ORDER BY id DESC
                LIMIT 1
                """
            ),
            {"route_pattern": f"%{route_suffix}"},
        ).fetchone()
    assert row is not None
    return {
        "event_type": row.event_type,
        "bound_user_id": row.bound_user_id,
        "openclaw_agent_id": row.openclaw_agent_id,
        "route": row.route,
        "payload": json.loads(row.payload_json),
        "result": json.loads(row.result_json),
        "status_code": row.status_code,
    }


def admin_login(client) -> str:
    response = client.post("/admin/auth/login", json={"password": "admin-secret"})
    assert response.status_code == 200, response.text
    return response.json()["token"]


def test_jwt_user_requests_are_audited(client):
    auth = register_and_login(client, phone="13800010001", username="audit-user")

    response = client.get(
        "/api/v1/openclaw/topics?q=graph&limit=5",
        headers={"Authorization": f"Bearer {auth['token']}"},
    )
    assert response.status_code == 200, response.text

    event = load_latest_http_request_event(route_suffix="/openclaw/topics")
    assert event["bound_user_id"] == auth["user"]["id"]
    assert event["openclaw_agent_id"] is None
    assert event["status_code"] == 200
    assert event["payload"]["query"]["q"] == "graph"
    assert event["payload"]["query"]["limit"] == "5"
    assert event["result"]["token_usage"]["input_tokens_estimated"] > 0
    assert event["result"]["token_usage"]["output_tokens_estimated"] > 0


def test_openclaw_requests_are_audited(client):
    auth = register_and_login(client, phone="13800010002", username="audit-openclaw")

    key_response = client.post(
        "/api/v1/auth/openclaw-key",
        headers={"Authorization": f"Bearer {auth['token']}"},
    )
    assert key_response.status_code == 200, key_response.text
    openclaw_key = key_response.json()["key"]

    response = client.post(
        "/api/v1/openclaw/topics",
        headers={"Authorization": f"Bearer {openclaw_key}"},
        json={"title": "Audit Topic", "body": "payload", "category": "plaza"},
    )
    assert response.status_code == 201, response.text

    event = load_latest_http_request_event(route_suffix="/openclaw/topics")
    assert event["bound_user_id"] == auth["user"]["id"]
    assert event["openclaw_agent_id"] is not None
    assert event["status_code"] == 201
    assert event["payload"]["body"]["title"] == "Audit Topic"
    assert event["payload"]["body"]["body"] == "payload"
    assert event["result"]["response_body"]["id"] == response.json()["id"]
    assert event["result"]["response_body"]["title"] == "Audit Topic"
    assert event["result"]["token_usage"]["input_tokens_estimated"] > 0
    assert event["result"]["token_usage"]["output_tokens_estimated"] > 0
    assert (
        event["result"]["token_usage"]["total_tokens_estimated"]
        == event["result"]["token_usage"]["input_tokens_estimated"] + event["result"]["token_usage"]["output_tokens_estimated"]
    )


def test_admin_can_view_actor_events_by_user_and_openclaw_id(client):
    auth = register_and_login(client, phone="13800010003", username="audit-admin-view")
    key_response = client.post(
        "/api/v1/auth/openclaw-key",
        headers={"Authorization": f"Bearer {auth['token']}"},
    )
    assert key_response.status_code == 200, key_response.text
    openclaw_key = key_response.json()["key"]

    create_response = client.post(
        "/api/v1/openclaw/topics",
        headers={"Authorization": f"Bearer {openclaw_key}"},
        json={"title": "Admin View Topic", "body": "payload", "category": "plaza"},
    )
    assert create_response.status_code == 201, create_response.text

    admin_token = admin_login(client)
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    by_user = client.get(
        f"/admin/openclaw/events?q={auth['user']['id']}",
        headers=admin_headers,
    )
    assert by_user.status_code == 200, by_user.text
    by_user_items = by_user.json()["items"]
    assert any(item["event_type"] == "http.request" for item in by_user_items)
    assert any(item["resolved_user_id"] == auth["user"]["id"] for item in by_user_items)

    created_event = next(
        item
        for item in by_user_items
        if item["event_type"] == "http.request" and str(item["route"] or "").endswith("/openclaw/topics")
    )
    openclaw_agent_id = created_event["openclaw_agent_id"]
    assert openclaw_agent_id is not None

    by_openclaw = client.get(
        f"/admin/openclaw/events?q={openclaw_agent_id}",
        headers=admin_headers,
    )
    assert by_openclaw.status_code == 200, by_openclaw.text
    by_openclaw_items = by_openclaw.json()["items"]
    assert any(item["openclaw_agent_id"] == openclaw_agent_id for item in by_openclaw_items)
