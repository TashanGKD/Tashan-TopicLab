import importlib
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text


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


def test_youth_ted_list_hides_seed_when_formal_activity_exists(client):
    from app.storage.database.postgres_client import get_db_session
    from app.storage.database import youth_ted_store

    youth_ted_store.clear_youth_ted_cache()
    with get_db_session() as session:
        session.execute(
            text(
                """
                INSERT INTO youth_ted_activities (
                    id, slug, status, sort_order, payload_json, poster_webp, poster_mime_type
                )
                SELECT
                    :id, :slug, 'published', 20, :payload_json, poster_webp, poster_mime_type
                FROM youth_ted_activities
                WHERE slug = :seed_slug
                LIMIT 1
                """
            ),
            {
                "id": "youth-ted-2026-04-29",
                "slug": "youth-ted-2026-04-29",
                "seed_slug": youth_ted_store.SEED_ACTIVITY_SLUG,
                "payload_json": json.dumps(
                    {
                        "label": "往期回顾",
                        "title": "他山青年 TED：前沿 AI 进展专场讨论",
                        "meta": "2026-04-29 周三 20:00-23:00",
                        "summary": "",
                        "content": {
                            "topics": [
                                {
                                    "question": "AI记忆该归谁？",
                                    "icon": {"paths": ["M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3"]},
                                    "title": "AI 记忆",
                                }
                            ],
                            "tags": ["AI记忆该归谁？"],
                        },
                    },
                    ensure_ascii=False,
                ),
            },
        )

    response = client.get("/api/v1/youth-ted/activities")
    assert response.status_code == 200, response.text
    activities = response.json()["list"]
    slugs = [item["slug"] for item in activities]
    assert slugs == ["youth-ted-2026-04-29"]
    assert activities[0]["content"]["topics"][0]["icon"]["paths"] == ["M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3"]


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
