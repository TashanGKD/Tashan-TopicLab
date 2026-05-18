import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    database_path = tmp_path / "inspiration.sqlite3"
    monkeypatch.setenv("TOPICLAB_TESTING", "1")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.delenv("AI_GENERATION_BASE_URL", raising=False)
    monkeypatch.delenv("AI_GENERATION_API_KEY", raising=False)
    monkeypatch.delenv("AI_GENERATION_MODEL", raising=False)

    from app.storage.database import inspiration_store, postgres_client
    import app.api.auth as auth_module
    import main as main_module

    postgres_client.reset_db_state()
    importlib.reload(postgres_client)
    importlib.reload(inspiration_store)
    auth_module = importlib.reload(auth_module)
    main_module = importlib.reload(main_module)

    with TestClient(main_module.app) as test_client:
        yield test_client, auth_module

    postgres_client.reset_db_state()


def test_inspiration_public_list_is_seeded_and_desensitized(client):
    test_client, _ = client
    res = test_client.get("/api/v1/inspiration/demands")

    assert res.status_code == 200
    items = res.json()["list"]
    assert len(items) >= 25
    first = items[0]
    assert {"slug", "title", "summary", "tags", "stage", "stuck"}.issubset(first)
    serialized = str(items)
    assert "18773233131" not in serialized
    assert "联系方式" not in serialized


def test_inspiration_submission_creates_path_and_public_detail(client):
    test_client, _ = client
    payload = {
        "submitter_name": "测试用户",
        "participation_mode": "我有一个真实问题，需要拆解初步方案",
        "contact": "test@example.com",
        "problem": "我想做一个 AI 工具，帮助社群成员把模糊想法拆成一周内可以验证的小实验。",
        "category": "生活效率 / 个人工作流",
        "current_blockers": "不知道怎么把问题拆成项目",
        "note": "希望有人帮忙一起看。",
        "allow_public": True,
    }

    created = test_client.post("/api/v1/inspiration/demands", json=payload)
    assert created.status_code == 200
    body = created.json()
    slug = body["demand"]["slug"]
    assert body["demand"]["stage"]
    assert body["llm_review"]["follow_up_questions"]
    assert body["claim_token"]

    detail = test_client.get(f"/api/v1/inspiration/demands/{slug}")

    assert detail.status_code == 200
    demand = detail.json()["demand"]
    assert demand["slug"] == slug
    assert demand["can_view_private"] is False
    assert demand["can_update"] is False
    assert demand["llm_review"]["next_step"]
    assert demand["redaction"]["status"] in {"published", "needs_review"}
    assert demand["redaction"]["method"] in {"rule_only", "llm_rewrite", "manual_review"}
    assert demand["path_progress"][0]["key"] == "submitted"
    assert demand["path_progress"][0]["status"] == "done"
    assert "private" not in demand
    assert "test@example.com" not in str(demand)


def test_inspiration_private_submission_is_hidden_until_claimed(client):
    test_client, auth_module = client
    payload = {
        "submitter_name": "匿名提出者",
        "participation_mode": "我有一个真实问题，需要拆解初步方案",
        "contact": "private@example.com",
        "problem": "我想把内部团队的复盘材料整理成一个不会泄露个人信息的 AI 检索助手。",
        "category": "生活效率 / 个人工作流",
        "current_blockers": "不知道技术上能不能实现",
        "note": "不希望先公开。",
        "allow_public": False,
    }
    created = test_client.post("/api/v1/inspiration/demands", json=payload)

    assert created.status_code == 200
    body = created.json()
    slug = body["demand"]["slug"]
    claim_token = body["claim_token"]
    assert claim_token

    assert test_client.get("/api/v1/inspiration/demands").status_code == 200
    assert slug not in str(test_client.get("/api/v1/inspiration/demands").json())
    assert test_client.get(f"/api/v1/inspiration/demands/{slug}").status_code == 404

    owner_token = auth_module.create_jwt_token(7, "13800138007")
    headers = {"Authorization": f"Bearer {owner_token}"}
    claimed = test_client.post(
        f"/api/v1/inspiration/demands/{slug}/claim",
        headers=headers,
        json={"claim_token": claim_token},
    )
    assert claimed.status_code == 200
    assert claimed.json()["demand"]["can_view_private"] is True

    owner_detail = test_client.get(f"/api/v1/inspiration/demands/{slug}", headers=headers)
    assert owner_detail.status_code == 200
    owner_demand = owner_detail.json()["demand"]
    assert owner_demand["can_view_private"] is True
    assert owner_demand["can_update"] is True
    assert "private" not in owner_demand

    private_detail = test_client.get(f"/api/v1/inspiration/demands/{slug}?include_private=true", headers=headers)
    assert private_detail.status_code == 200
    assert private_detail.json()["demand"]["private"]["contact"] == "private@example.com"


def test_inspiration_admin_can_view_private_and_create_update(client, monkeypatch):
    test_client, auth_module = client
    monkeypatch.setenv("ADMIN_USER_IDS", "1")
    token = auth_module.create_jwt_token(1, "13800138000", is_admin=True)
    headers = {"Authorization": f"Bearer {token}"}

    detail = test_client.get("/api/v1/inspiration/demands/need-01-ai-english-reading-assistant", headers=headers)
    assert detail.status_code == 200
    demand = detail.json()["demand"]
    assert demand["can_view_private"] is True
    assert demand["can_update"] is True
    assert "private" not in demand
    assert demand["llm_review"]["follow_up_questions"]

    private_detail = test_client.get(
        "/api/v1/inspiration/demands/need-01-ai-english-reading-assistant?include_private=true",
        headers=headers,
    )
    assert private_detail.status_code == 200
    assert private_detail.json()["demand"]["private"]["contact"] == "18773233131"

    update = test_client.post(
        "/api/v1/inspiration/demands/need-01-ai-english-reading-assistant/updates",
        headers=headers,
        json={
            "week_label": "2026-W21",
            "stage_key": "defined",
            "stage_status": "done",
            "summary": "完成问题定义",
            "progress": "已把英语阅读需求拆成课堂练习和课后反馈两个验证方向。",
            "blockers": "还缺真实学生样本。",
            "next_steps": "下周找 3 名学生试用低保真原型。",
            "emotion_note": "这个问题已经从一个大想法变成可讨论的课堂实验。",
            "artifacts": [{"label": "问题定义记录", "url": "https://example.com"}],
            "visibility": "public",
        },
    )
    assert update.status_code == 200

    refreshed = test_client.get("/api/v1/inspiration/demands/need-01-ai-english-reading-assistant")

    assert refreshed.status_code == 200
    updates = refreshed.json()["demand"]["updates"]
    assert updates[0]["week_label"] == "2026-W21"
    assert updates[0]["stage_key"] == "defined"
    assert updates[0]["emotion_note"] == "这个问题已经从一个大想法变成可讨论的课堂实验。"
    assert updates[0]["summary"] == "完成问题定义"
    path = refreshed.json()["demand"]["path_progress"]
    defined = next(item for item in path if item["key"] == "defined")
    assert defined["status"] == "done"
    assert all(item["key"] != "interview" for item in path)
