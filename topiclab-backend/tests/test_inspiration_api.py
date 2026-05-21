import importlib
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text


@pytest.fixture
def client(tmp_path, monkeypatch):
    database_path = tmp_path / "inspiration.sqlite3"
    monkeypatch.setenv("TOPICLAB_TESTING", "1")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.delenv("AI_GENERATION_BASE_URL", raising=False)
    monkeypatch.delenv("AI_GENERATION_API_KEY", raising=False)
    monkeypatch.delenv("AI_GENERATION_MODEL", raising=False)
    monkeypatch.delenv("INSPIRATION_LLM_CHAT_COMPLETIONS_URL", raising=False)
    monkeypatch.delenv("INSPIRATION_LLM_API_KEY", raising=False)
    monkeypatch.delenv("INSPIRATION_LLM_MODEL", raising=False)
    monkeypatch.delenv("INSPIRATION_LLM_TIMEOUT_SECONDS", raising=False)

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
    res = test_client.get("/api/v1/inspiration/demands?limit=50")

    assert res.status_code == 200
    payload = res.json()
    items = payload["list"]
    assert len(items) >= 25
    assert payload["total"] >= 25
    assert payload["overview"]["total"] >= 25
    assert payload["overview"]["core_stats"][0]["label"] == "线索总数"
    first = items[0]
    assert {"slug", "title", "summary", "tags", "stage", "stuck"}.issubset(first)
    serialized = str(items)
    assert "18773233131" not in serialized
    assert "联系方式" not in serialized


def test_inspiration_public_list_is_limited_with_database_overview(client):
    test_client, _ = client
    res = test_client.get("/api/v1/inspiration/demands?limit=5&offset=0&include_interest=false")

    assert res.status_code == 200
    payload = res.json()
    assert len(payload["list"]) == 5
    assert payload["limit"] == 5
    assert payload["offset"] == 0
    assert payload["total"] >= 25
    assert payload["has_more"] is True
    assert payload["next_offset"] == 5
    assert payload["overview"]["total"] == payload["total"]
    assert payload["overview"]["directions"]
    assert "interest" not in payload["list"][0]

    next_page = test_client.get("/api/v1/inspiration/demands?limit=5&offset=5&include_interest=false")
    assert next_page.status_code == 200
    next_payload = next_page.json()
    assert len(next_payload["list"]) == 5
    assert next_payload["total"] == payload["total"]
    assert "overview" not in next_payload

    forced_overview = test_client.get("/api/v1/inspiration/demands?limit=5&offset=5&include_interest=false&include_overview=true")
    assert forced_overview.status_code == 200
    assert forced_overview.json()["overview"]["total"] == payload["total"]


def test_inspiration_public_overview_is_cached_and_refreshed_on_submission(client):
    test_client, _ = client
    initial = test_client.get("/api/v1/inspiration/demands?limit=5&include_interest=false")
    assert initial.status_code == 200
    initial_total = initial.json()["overview"]["total"]

    from app.storage.database.postgres_client import get_db_session

    with get_db_session() as session:
        session.execute(
            text(
                """
                UPDATE inspiration_public_overview_cache
                SET overview_json = :overview_json, total = :total
                WHERE cache_key = 'public_demands'
                """
            ),
            {
                "overview_json": json.dumps(
                    {
                        "total": 999,
                        "core_stats": [{"label": "线索总数", "value": 999, "hint": "cached"}],
                        "directions": [],
                        "stages": [],
                        "blockers": [],
                    },
                    ensure_ascii=False,
                ),
                "total": 999,
            },
        )

    cached = test_client.get("/api/v1/inspiration/demands?limit=5&include_interest=false")
    assert cached.status_code == 200
    assert cached.json()["overview"]["total"] == 999

    created = test_client.post(
        "/api/v1/inspiration/demands",
        json={
            "submitter_name": "",
            "participation_mode": "我有一个明确需求",
            "contact": "",
            "problem": "我想新增一条用于验证统计缓存刷新的公开线索。",
            "category": "生活效率 / 个人工作流",
            "current_blockers": "想先拆成一个小实验",
            "note": "",
            "allow_public": True,
        },
    )
    assert created.status_code == 200

    refreshed = test_client.get("/api/v1/inspiration/demands?limit=5&include_interest=false")
    assert refreshed.status_code == 200
    assert refreshed.json()["overview"]["total"] == initial_total + 1


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
    assert body["demand"]["title"] == "生成中"
    assert body["demand"]["summary"] == "智能助手正在生成脱敏摘要。"
    assert "模糊想法拆成一周内" not in str(body["demand"])
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
    assert demand["redaction"]["method"] in {"pending_llm", "rule_only", "llm_rewrite", "manual_review"}
    assert demand["summary"] == "智能助手正在生成脱敏摘要。"
    assert "模糊想法拆成一周内" not in str(demand)
    assert demand["path_progress"][0]["key"] == "submitted"
    assert demand["path_progress"][0]["status"] == "needs_input"
    assert "这个问题最真实的使用对象是谁？" in demand["path_progress"][0]["summary"]
    assert "private" not in demand
    assert "test@example.com" not in str(demand)


def test_inspiration_submission_accepts_very_short_problem(client):
    test_client, _ = client
    payload = {
        "submitter_name": "",
        "participation_mode": "我有一个明确需求",
        "contact": "1",
        "problem": "1",
        "category": "科研 / 数据",
        "current_blockers": "想找人一起拆解",
        "note": "",
        "allow_public": True,
    }

    created = test_client.post("/api/v1/inspiration/demands", json=payload)

    assert created.status_code == 200
    body = created.json()
    assert body["demand"]["slug"]
    assert body["demand"]["summary"] == "智能助手正在生成脱敏摘要。"
    assert body["demand"]["stuck"] == "等待智能助手生成公开描述。"
    assert body["demand"]["path_progress"][0]["key"] == "submitted"
    assert body["claim_token"]


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
            "artifacts": [
                {"type": "link", "label": "问题定义记录", "url": "https://example.com", "visibility": "public"},
                {"type": "link", "label": "内部原型", "url": "https://internal.example.com", "visibility": "admin_only"},
            ],
            "visibility": "public",
        },
    )
    assert update.status_code == 200
    assert len(update.json()["update"]["artifacts"]) == 2

    refreshed = test_client.get("/api/v1/inspiration/demands/need-01-ai-english-reading-assistant")

    assert refreshed.status_code == 200
    updates = refreshed.json()["demand"]["updates"]
    assert updates[0]["week_label"] == "2026-W21"
    assert updates[0]["stage_key"] == "defined"
    assert updates[0]["emotion_note"] == "这个问题已经从一个大想法变成可讨论的课堂实验。"
    assert updates[0]["summary"] == "完成问题定义"
    assert updates[0]["artifacts"] == [
        {"type": "link", "label": "问题定义记录", "url": "https://example.com", "visibility": "public"}
    ]
    path = refreshed.json()["demand"]["path_progress"]
    defined = next(item for item in path if item["key"] == "defined")
    assert defined["status"] == "done"
    assert all(item["key"] != "interview" for item in path)

    admin_refreshed = test_client.get(
        "/api/v1/inspiration/demands/need-01-ai-english-reading-assistant",
        headers=headers,
    )
    assert admin_refreshed.status_code == 200
    admin_updates = admin_refreshed.json()["demand"]["updates"]
    assert {artifact["label"] for artifact in admin_updates[0]["artifacts"]} == {"问题定义记录", "内部原型"}


def test_inspiration_admin_can_edit_private_info_and_existing_update(client, monkeypatch):
    test_client, auth_module = client
    monkeypatch.setenv("ADMIN_USER_IDS", "1")
    token = auth_module.create_jwt_token(1, "13800138000", is_admin=True)
    headers = {"Authorization": f"Bearer {token}"}

    private_update = test_client.patch(
        "/api/v1/inspiration/demands/need-01-ai-english-reading-assistant/private",
        headers=headers,
        json={"private": {"contact": "new-contact@example.com", "problem": "更新后的完整问题描述"}},
    )
    assert private_update.status_code == 200
    assert private_update.json()["demand"]["private"]["contact"] == "new-contact@example.com"

    created = test_client.post(
        "/api/v1/inspiration/demands/need-01-ai-english-reading-assistant/updates",
        headers=headers,
        json={
            "week_label": "2026-W22",
            "stage_key": "demo",
            "stage_status": "current",
            "summary": "准备 Demo",
            "progress": "先做一个课堂反馈表单。",
            "blockers": "",
            "next_steps": "找学生试填。",
            "emotion_note": "已经进入可验证阶段。",
            "artifacts": [],
            "visibility": "public",
        },
    )
    assert created.status_code == 200
    update_id = created.json()["update"]["id"]

    edited = test_client.patch(
        f"/api/v1/inspiration/demands/need-01-ai-english-reading-assistant/updates/{update_id}",
        headers=headers,
        json={
            "week_label": "2026-W23",
            "stage_key": "demo",
            "stage_status": "done",
            "summary": "Demo 已跑通",
            "progress": "完成课堂反馈表单并收集 3 条试用反馈。",
            "blockers": "",
            "next_steps": "整理成 MVP 页面。",
            "emotion_note": "这一步已经从想法进入真实反馈。",
            "artifacts": [],
            "visibility": "public",
        },
    )
    assert edited.status_code == 200
    assert edited.json()["update"]["summary"] == "Demo 已跑通"

    refreshed = test_client.get("/api/v1/inspiration/demands/need-01-ai-english-reading-assistant")
    demo_stage = next(item for item in refreshed.json()["demand"]["path_progress"] if item["key"] == "demo")
    assert demo_stage["status"] == "done"
    assert demo_stage["summary"] == "Demo 已跑通"


def test_inspiration_admin_can_delete_demand(client, monkeypatch):
    test_client, auth_module = client
    monkeypatch.setenv("ADMIN_USER_IDS", "1")
    slug = "need-01-ai-english-reading-assistant"
    user_token = auth_module.create_jwt_token(2, "13800138002")
    user_headers = {"Authorization": f"Bearer {user_token}"}
    admin_token = auth_module.create_jwt_token(1, "13800138000", is_admin=True)
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    forbidden = test_client.delete(f"/api/v1/inspiration/demands/{slug}", headers=user_headers)
    assert forbidden.status_code == 403

    removed = test_client.delete(f"/api/v1/inspiration/demands/{slug}", headers=admin_headers)
    assert removed.status_code == 200
    assert removed.json() == {"ok": True, "slug": slug}

    assert test_client.get(f"/api/v1/inspiration/demands/{slug}", headers=admin_headers).status_code == 404
    listed = test_client.get("/api/v1/inspiration/demands?limit=50").json()["list"]
    assert slug not in {item["slug"] for item in listed}

    missing = test_client.delete(f"/api/v1/inspiration/demands/{slug}", headers=admin_headers)
    assert missing.status_code == 404


def test_logged_in_user_can_mark_inspiration_demand_interest(client):
    test_client, auth_module = client
    token = auth_module.create_jwt_token(2, "13800138002")
    headers = {"Authorization": f"Bearer {token}"}
    slug = "need-01-ai-english-reading-assistant"

    anonymous_detail = test_client.get(f"/api/v1/inspiration/demands/{slug}")
    assert anonymous_detail.status_code == 200
    assert anonymous_detail.json()["demand"]["interest"] == {
        "interested": False,
        "interested_count": 0,
        "interested_users": [],
    }

    anonymous_vote = test_client.post(
        f"/api/v1/inspiration/demands/{slug}/interest",
        json={"interested": True},
    )
    assert anonymous_vote.status_code == 401

    interested = test_client.post(
        f"/api/v1/inspiration/demands/{slug}/interest",
        headers=headers,
        json={"interested": True},
    )
    assert interested.status_code == 200
    interest = interested.json()["interest"]
    assert interest["interested"] is True
    assert interest["interested_count"] == 1
    assert interest["interested_users"] == [
        {"user_id": 2, "display_name": "用户 2"},
    ]

    detail = test_client.get(f"/api/v1/inspiration/demands/{slug}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["demand"]["interest"] == interest

    listed = test_client.get("/api/v1/inspiration/demands?limit=50")
    listed_item = next(item for item in listed.json()["list"] if item["slug"] == slug)
    assert listed_item["interest"]["interested_count"] == 1
    assert listed_item["interest"]["interested_users"] == [
        {"user_id": 2, "display_name": "用户 2"},
    ]

    compact_listed = test_client.get("/api/v1/inspiration/demands?limit=50&include_interest=false")
    compact_item = next(item for item in compact_listed.json()["list"] if item["slug"] == slug)
    assert "interest" not in compact_item

    cancelled = test_client.post(
        f"/api/v1/inspiration/demands/{slug}/interest",
        headers=headers,
        json={"interested": False},
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["interest"] == {
        "interested": False,
        "interested_count": 0,
        "interested_users": [],
    }


def test_inspiration_owner_can_toggle_raw_public_mode(client, monkeypatch):
    test_client, auth_module = client
    monkeypatch.setenv("ADMIN_USER_IDS", "1")
    admin_token = auth_module.create_jwt_token(1, "13800138000", is_admin=True)
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    user_token = auth_module.create_jwt_token(2, "13800138002")
    user_headers = {"Authorization": f"Bearer {user_token}"}
    slug = "need-01-ai-english-reading-assistant"
    raw_problem = "我想把英语阅读课堂拆成可以验证的 AI 助教需求。"

    llm_calls = 0

    async def fake_request(messages, **kwargs):
        nonlocal llm_calls
        llm_calls += 1
        return '{"title":"阅读课堂共创"}'

    monkeypatch.setattr("app.services.inspiration_review.request_inspiration_llm", fake_request)

    denied = test_client.patch(
        f"/api/v1/inspiration/demands/{slug}/public-mode",
        headers=user_headers,
        json={"raw_public": True},
    )
    assert denied.status_code == 403

    private_update = test_client.patch(
        f"/api/v1/inspiration/demands/{slug}/private",
        headers=admin_headers,
        json={
            "private": {
                "problem": raw_problem,
                "note": "已有课程材料，希望公开找同伴。",
                "category": "学习 / 教育",
                "current_blockers": "想找人一起拆解",
                "contact": "raw-mode@example.com",
                "account_user_id": 2,
                "account_phone": "13800138002",
            }
        },
    )
    assert private_update.status_code == 200
    original_public = test_client.get(f"/api/v1/inspiration/demands/{slug}").json()["demand"]
    original_public_title = original_public["title"]
    original_public_summary = original_public["summary"]
    original_public_stuck = original_public["stuck"]

    raw = test_client.patch(
        f"/api/v1/inspiration/demands/{slug}/public-mode",
        headers=admin_headers,
        json={"raw_public": True},
    )
    assert raw.status_code == 200
    raw_demand = raw.json()["demand"]
    assert raw_demand["redaction"]["method"] == "raw_public"
    assert raw_demand["redaction"]["status"] == "raw_public"
    assert len(raw_demand["title"]) <= 12
    assert raw_problem in raw_demand["summary"]

    public_detail = test_client.get(f"/api/v1/inspiration/demands/{slug}")
    assert public_detail.status_code == 200
    public_demand = public_detail.json()["demand"]
    assert public_demand["redaction"]["method"] == "raw_public"
    assert raw_problem in public_demand["summary"]
    assert public_demand["can_view_private"] is True
    assert public_demand["can_update"] is False

    public_full_detail = test_client.get(f"/api/v1/inspiration/demands/{slug}?include_private=true")
    assert public_full_detail.status_code == 200
    public_private = public_full_detail.json()["demand"]["private"]
    assert public_private["problem"] == raw_problem
    assert public_private["contact"] == "raw-mode@example.com"
    assert "account_phone" not in public_private
    assert "account_user_id" not in public_private

    fuzzy = test_client.patch(
        f"/api/v1/inspiration/demands/{slug}/public-mode",
        headers=admin_headers,
        json={"raw_public": False},
    )
    assert fuzzy.status_code == 200
    fuzzy_demand = fuzzy.json()["demand"]
    assert fuzzy_demand["redaction"]["method"] == "spreadsheet_fuzzy_rule"
    assert fuzzy_demand["title"] == original_public_title
    assert fuzzy_demand["summary"] == original_public_summary
    assert fuzzy_demand["stuck"] == original_public_stuck
    assert llm_calls == 0

    fuzzy_public_detail = test_client.get(f"/api/v1/inspiration/demands/{slug}")
    assert fuzzy_public_detail.status_code == 200
    assert raw_problem not in str(fuzzy_public_detail.json()["demand"])
    fuzzy_full_detail = test_client.get(f"/api/v1/inspiration/demands/{slug}?include_private=true")
    assert "private" not in fuzzy_full_detail.json()["demand"]


def test_inspiration_owner_can_edit_public_fields_and_restore_them_after_raw_public(client, monkeypatch):
    test_client, auth_module = client
    monkeypatch.setenv("ADMIN_USER_IDS", "1")
    token = auth_module.create_jwt_token(1, "13800138000", is_admin=True)
    headers = {"Authorization": f"Bearer {token}"}
    slug = "need-01-ai-english-reading-assistant"

    edited = test_client.patch(
        f"/api/v1/inspiration/demands/{slug}/public-fields",
        headers=headers,
        json={
            "title": "阅读共创标题",
            "summary": "这是提出者手动编辑后的公开摘要。",
            "stuck": "当前需要：找真实试用对象。",
        },
    )
    assert edited.status_code == 200
    edited_demand = edited.json()["demand"]
    assert edited_demand["title"] == "阅读共创标题"
    assert edited_demand["summary"] == "这是提出者手动编辑后的公开摘要。"
    assert edited_demand["stuck"] == "当前需要：找真实试用对象。"

    raw = test_client.patch(
        f"/api/v1/inspiration/demands/{slug}/public-mode",
        headers=headers,
        json={"raw_public": True},
    )
    assert raw.status_code == 200
    assert raw.json()["demand"]["redaction"]["method"] == "raw_public"

    raw_title = test_client.patch(
        f"/api/v1/inspiration/demands/{slug}/public-fields",
        headers=headers,
        json={"title": "公开后的标题"},
    )
    assert raw_title.status_code == 200
    assert raw_title.json()["demand"]["title"] == "公开后的标题"

    restored = test_client.patch(
        f"/api/v1/inspiration/demands/{slug}/public-mode",
        headers=headers,
        json={"raw_public": False},
    )
    assert restored.status_code == 200
    restored_demand = restored.json()["demand"]
    assert restored_demand["title"] == "阅读共创标题"
    assert restored_demand["summary"] == "这是提出者手动编辑后的公开摘要。"
    assert restored_demand["stuck"] == "当前需要：找真实试用对象。"


def test_inspiration_public_mode_does_not_restore_prompt_like_summary(client, monkeypatch):
    test_client, auth_module = client
    monkeypatch.setenv("ADMIN_USER_IDS", "1")
    token = auth_module.create_jwt_token(1, "13800138000", is_admin=True)
    headers = {"Authorization": f"Bearer {token}"}
    slug = "need-01-ai-english-reading-assistant"

    raw = test_client.patch(
        f"/api/v1/inspiration/demands/{slug}/public-mode",
        headers=headers,
        json={"raw_public": True},
    )
    assert raw.status_code == 200

    from app.storage.database.postgres_client import get_db_session

    with get_db_session() as session:
        session.execute(
            text("UPDATE inspiration_demands SET public_fuzzy_json = :payload WHERE slug = :slug"),
            {
                "slug": slug,
                "payload": json.dumps(
                    {
                        "title": "提示词泄露",
                        "summary": "你是灵感共创队的需求脱敏改写助手。请仅输出 JSON，不要 Markdown。字段必须包含 title, summary。",
                        "stuck": "任务：根据用户表单生成一个脱敏公开标题。",
                        "tags": ["提示词"],
                    },
                    ensure_ascii=False,
                ),
            },
        )

    restored = test_client.patch(
        f"/api/v1/inspiration/demands/{slug}/public-mode",
        headers=headers,
        json={"raw_public": False},
    )
    assert restored.status_code == 200
    restored_demand = restored.json()["demand"]
    assert "请仅输出 JSON" not in restored_demand["summary"]
    assert "字段必须包含" not in restored_demand["summary"]
    assert restored_demand["summary"]


def test_inspiration_fuzzy_public_mode_keeps_existing_public_fields(client, monkeypatch):
    test_client, auth_module = client
    monkeypatch.setenv("ADMIN_USER_IDS", "1")
    token = auth_module.create_jwt_token(1, "13800138000", is_admin=True)
    headers = {"Authorization": f"Bearer {token}"}
    slug = "need-01-ai-english-reading-assistant"
    llm_calls = 0

    async def fake_request(messages, **kwargs):
        nonlocal llm_calls
        llm_calls += 1
        return '{"title":"课堂阅读反馈"}'

    monkeypatch.setattr("app.services.inspiration_review.request_inspiration_llm", fake_request)

    private_update = test_client.patch(
        f"/api/v1/inspiration/demands/{slug}/private",
        headers=headers,
        json={
            "private": {
                "problem": "我想把英语阅读课堂拆成可以验证的 AI 助教需求。",
                "note": "已有课程材料，希望公开找同伴。",
                "category": "学习 / 教育",
                "current_blockers": "想找人一起拆解",
            }
        },
    )
    assert private_update.status_code == 200
    original_public = test_client.get(f"/api/v1/inspiration/demands/{slug}").json()["demand"]

    fuzzy = test_client.patch(
        f"/api/v1/inspiration/demands/{slug}/public-mode",
        headers=headers,
        json={"raw_public": False},
    )

    assert fuzzy.status_code == 200
    demand = fuzzy.json()["demand"]
    assert demand["title"] == original_public["title"]
    assert demand["summary"] == original_public["summary"]
    assert demand["redaction"]["method"] == "spreadsheet_fuzzy_rule"
    assert llm_calls == 0


def test_inspiration_fuzzy_title_rules_distinguish_specific_domains(client):
    from app.storage.database.inspiration_store import _fuzzy_public_payload_from_private

    industrial = _fuzzy_public_payload_from_private(
        {
            "problem": "面向工业领域的 AI 行业翻译软件，针对质量、工艺、工人、设备、管理层改写同一段内容。",
            "category": "生活效率 / 个人工作流",
            "current_blockers": "不知道技术上能不能实现",
            "participation_mode": "围观围观～",
        }
    )
    ansys = _fuzzy_public_payload_from_private(
        {
            "problem": "使用 Codex 完成 ANSYS 中子弹穿透钢板的动力学仿真、静力分析和模态分析。",
            "category": "科研 / AI for Science",
            "current_blockers": "不知道技术上能不能实现",
            "participation_mode": "我有一个真实问题，需要拆解初步方案",
        }
    )
    json_dict = _fuzzy_public_payload_from_private(
        {
            "problem": "历史遗留项目，需要通过大模型自动解析很大的 JSON 输入，得到数据字典，并通过 diff patch 稳定输出。",
            "category": "生活效率 / 个人工作流",
            "current_blockers": "不知道怎么把问题拆成项目",
            "participation_mode": "我有一个真实问题，需要拆解初步方案",
        }
    )

    assert industrial["title"] == "工业岗位翻译"
    assert ansys["title"] == "ANSYS仿真"
    assert json_dict["title"] == "JSON字典生成"


def test_inspiration_public_list_reflects_latest_path_stage(client, monkeypatch):
    test_client, auth_module = client
    monkeypatch.setenv("ADMIN_USER_IDS", "1")
    token = auth_module.create_jwt_token(1, "13800138000", is_admin=True)
    headers = {"Authorization": f"Bearer {token}"}

    update = test_client.post(
        "/api/v1/inspiration/demands/need-25-ai-for-science/updates",
        headers=headers,
        json={
            "week_label": "2026-05-19 16:30",
            "stage_key": "tooling",
            "stage_status": "current",
            "summary": "正在确定信息渠道和可用工具。",
            "progress": "",
            "blockers": "",
            "next_steps": "",
            "emotion_note": "",
            "artifacts": [],
            "visibility": "public",
        },
    )
    assert update.status_code == 200

    listed = test_client.get("/api/v1/inspiration/demands")

    assert listed.status_code == 200
    demand = next(item for item in listed.json()["list"] if item["slug"] == "need-25-ai-for-science")
    tooling_stage = next(item for item in demand["path_progress"] if item["key"] == "tooling")
    assert tooling_stage["status"] == "current"
    assert tooling_stage["summary"] == "正在确定信息渠道和可用工具。"


def test_inspiration_path_progress_advances_past_stale_current_stage(client, monkeypatch):
    test_client, auth_module = client
    monkeypatch.setenv("ADMIN_USER_IDS", "1")
    token = auth_module.create_jwt_token(1, "13800138000", is_admin=True)
    headers = {"Authorization": f"Bearer {token}"}
    slug = "need-25-ai-for-science"

    demo_update = test_client.post(
        f"/api/v1/inspiration/demands/{slug}/updates",
        headers=headers,
        json={
            "week_label": "2026-05-19 16:30",
            "stage_key": "demo",
            "stage_status": "current",
            "summary": "正在做 Demo 验证。",
            "progress": "",
            "blockers": "",
            "next_steps": "",
            "emotion_note": "",
            "artifacts": [],
            "visibility": "public",
        },
    )
    mvp_update = test_client.post(
        f"/api/v1/inspiration/demands/{slug}/updates",
        headers=headers,
        json={
            "week_label": "2026-05-20 20:30",
            "stage_key": "mvp",
            "stage_status": "done",
            "summary": "已经完成 MVP 复盘，确认下一步迭代。",
            "progress": "",
            "blockers": "",
            "next_steps": "",
            "emotion_note": "",
            "artifacts": [],
            "visibility": "public",
        },
    )
    assert demo_update.status_code == 200
    assert mvp_update.status_code == 200

    demand = test_client.get(f"/api/v1/inspiration/demands/{slug}").json()["demand"]
    path = {stage["key"]: stage for stage in demand["path_progress"]}

    assert path["demo"]["status"] == "done"
    assert path["mvp"]["status"] == "done"
    assert path["mvp"]["summary"] == "已经完成 MVP 复盘，确认下一步迭代。"


def test_inspiration_public_list_sorts_by_latest_update_then_clue_number(client, monkeypatch):
    test_client, auth_module = client
    monkeypatch.setenv("ADMIN_USER_IDS", "1")
    token = auth_module.create_jwt_token(1, "13800138000", is_admin=True)
    headers = {"Authorization": f"Bearer {token}"}

    update_05 = test_client.post(
        "/api/v1/inspiration/demands/need-05-game-theory-model-agent/updates",
        headers=headers,
        json={
            "week_label": "2026-W21",
            "stage_key": "defined",
            "stage_status": "done",
            "summary": "完成模型边界确认",
            "progress": "",
            "blockers": "",
            "next_steps": "",
            "emotion_note": "",
            "artifacts": [],
            "visibility": "public",
        },
    )
    update_01 = test_client.post(
        "/api/v1/inspiration/demands/need-01-ai-english-reading-assistant/updates",
        headers=headers,
        json={
            "week_label": "2026-W21",
            "stage_key": "defined",
            "stage_status": "done",
            "summary": "完成课堂对象确认",
            "progress": "",
            "blockers": "",
            "next_steps": "",
            "emotion_note": "",
            "artifacts": [],
            "visibility": "public",
        },
    )
    assert update_05.status_code == 200
    assert update_01.status_code == 200
    assert update_05.json()["update"]["created_at"]
    assert update_05.json()["update"]["updated_at"]

    from app.storage.database.postgres_client import get_db_session

    update_05_id = update_05.json()["update"]["id"]
    update_01_id = update_01.json()["update"]["id"]
    with get_db_session() as session:
        session.execute(
            text("UPDATE inspiration_demand_updates SET updated_at = :updated_at WHERE id = :id"),
            {"updated_at": "2099-05-02T00:00:00+00:00", "id": update_05_id},
        )
        session.execute(
            text("UPDATE inspiration_demand_updates SET updated_at = :updated_at WHERE id = :id"),
            {"updated_at": "2099-05-01T00:00:00+00:00", "id": update_01_id},
        )

    listed = test_client.get("/api/v1/inspiration/demands")
    assert listed.status_code == 200
    items = listed.json()["list"]
    assert items[0]["slug"] == "need-05-game-theory-model-agent"
    assert items[0]["clue_number"] == 5
    assert items[0]["latest_update_at"] == "2099-05-02T00:00:00+00:00"

    with get_db_session() as session:
        session.execute(
            text("UPDATE inspiration_demand_updates SET updated_at = :updated_at WHERE id IN (:update_01_id, :update_05_id)"),
            {
                "updated_at": "2099-06-01T00:00:00+00:00",
                "update_01_id": update_01_id,
                "update_05_id": update_05_id,
            },
        )

    tied = test_client.get("/api/v1/inspiration/demands")
    assert tied.status_code == 200
    tied_items = tied.json()["list"]
    assert [item["slug"] for item in tied_items[:2]] == [
        "need-01-ai-english-reading-assistant",
        "need-05-game-theory-model-agent",
    ]
