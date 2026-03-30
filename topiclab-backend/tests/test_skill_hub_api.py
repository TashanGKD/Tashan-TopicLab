import importlib
from datetime import datetime, timedelta, timezone

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


def test_skill_hub_public_seeded_routes(client):
    skills = client.get("/api/v1/skill-hub/skills")
    assert skills.status_code == 200, skills.text
    payload = skills.json()
    assert payload["total"] == 1
    assert [item["slug"] for item in payload["list"]] == ["research-dream"]

    categories = client.get("/api/v1/skill-hub/categories")
    assert categories.status_code == 200, categories.text
    assert len(categories.json()["disciplines"]) == 14
    assert any(item["key"] == "general" for item in categories.json()["clusters"])

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

    content = client.get("/api/v1/skill-hub/skills/research-dream/content")
    assert content.status_code == 200, content.text
    content_payload = content.json()
    assert content_payload["skill"]["slug"] == "research-dream"
    assert content_payload["version"]["version"] == detail.json()["latest_version"]
    assert content_payload["content_type"] == "text/markdown"
    assert content_payload["format"] == "skill_md"
    assert "Research Dream" in content_payload["content"]

    guide = client.get("/api/v1/skill-hub/guide.md")
    assert guide.status_code == 200, guide.text
    assert "GET /api/v1/skill-hub/skills" in guide.text
    assert "GET /api/v1/skill-hub/skills/{id_or_slug}/content" in guide.text


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
