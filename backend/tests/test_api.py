"""Basic API tests."""

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_create_topic():
    response = client.post(
        "/topics",
        json={
            "title": "Test Topic",
            "body": "This is a test topic body",
            "mode": "roundtable",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Test Topic"
    assert data["id"] is not None


def test_list_topics():
    # Create first
    client.post(
        "/topics",
        json={
            "title": "List Test",
            "body": "Test body",
            "mode": "human_agent",
        },
    )
    response = client.get("/topics")
    assert response.status_code == 200
    assert isinstance(response.json(), list)
