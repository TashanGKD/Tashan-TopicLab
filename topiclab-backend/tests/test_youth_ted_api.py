import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    database_path = tmp_path / "youth_ted.sqlite3"
    monkeypatch.setenv("TOPICLAB_TESTING", "1")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")

    import app.storage.database.postgres_client as postgres_client
    import app.storage.database.youth_ted_store as youth_ted_store
    import main as main_module

    postgres_client.reset_db_state()
    youth_ted_store.clear_youth_ted_cache()
    importlib.reload(postgres_client)
    importlib.reload(youth_ted_store)
    importlib.reload(main_module)

    with TestClient(main_module.app) as test_client:
        yield test_client

    postgres_client.reset_db_state()
    youth_ted_store.clear_youth_ted_cache()


def test_youth_ted_activities_seed_single_activity(client):
    response = client.get("/api/v1/youth-ted/activities")
    assert response.status_code == 200, response.text

    payload = response.json()
    assert len(payload["list"]) == 1

    activity = payload["list"][0]
    assert activity["label"] == "本期活动"
    assert activity["title"] == "前沿 AI 进展专场讨论"
    assert activity["meta"] == "周三晚 20:00"
    assert activity["poster_url"].endswith("/poster.webp")
    assert activity["content"]["format_version"] == 1
    assert activity["content"]["agenda"] == [
        "AI 前沿进展分享",
        "Agent4S 及他山世界最新进展同步",
        "社区案例深度讨论",
    ]


def test_youth_ted_activity_poster_serves_webp(client):
    activity = client.get("/api/v1/youth-ted/activities").json()["list"][0]

    response = client.get(activity["poster_url"])
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("image/webp")
    assert response.content[:4] == b"RIFF"
    assert response.content[8:12] == b"WEBP"


def test_youth_ted_activity_list_uses_ttl_cache(client, monkeypatch):
    from app.storage.database import youth_ted_store

    youth_ted_store.clear_youth_ted_cache()
    monkeypatch.setenv("YOUTH_TED_CACHE_TTL_SECONDS", "120")
    original_get_db_session = youth_ted_store.get_db_session
    session_opens = 0

    def counting_get_db_session():
        nonlocal session_opens
        session_opens += 1
        return original_get_db_session()

    monkeypatch.setattr(youth_ted_store, "get_db_session", counting_get_db_session)

    first = youth_ted_store.list_youth_ted_activities()
    second = youth_ted_store.list_youth_ted_activities()

    assert session_opens == 1
    assert first == second

    first[0]["title"] = "mutated by caller"
    third = youth_ted_store.list_youth_ted_activities()
    assert third[0]["title"] == "前沿 AI 进展专场讨论"


def test_youth_ted_poster_uses_ttl_cache(client, monkeypatch):
    from app.storage.database import youth_ted_store

    youth_ted_store.clear_youth_ted_cache()
    monkeypatch.setenv("YOUTH_TED_CACHE_TTL_SECONDS", "120")
    slug = youth_ted_store.list_youth_ted_activities()[0]["slug"]
    youth_ted_store.clear_youth_ted_cache()

    original_get_db_session = youth_ted_store.get_db_session
    session_opens = 0

    def counting_get_db_session():
        nonlocal session_opens
        session_opens += 1
        return original_get_db_session()

    monkeypatch.setattr(youth_ted_store, "get_db_session", counting_get_db_session)

    first = youth_ted_store.get_youth_ted_activity_poster(slug)
    second = youth_ted_store.get_youth_ted_activity_poster(slug)

    assert session_opens == 1
    assert first is not None
    assert second == first
