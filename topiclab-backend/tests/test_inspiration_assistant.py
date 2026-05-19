import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    database_path = tmp_path / "inspiration-assistant.sqlite3"
    monkeypatch.setenv("TOPICLAB_TESTING", "1")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.delenv("INSPIRATION_LLM_CHAT_COMPLETIONS_URL", raising=False)
    monkeypatch.delenv("INSPIRATION_LLM_API_KEY", raising=False)
    monkeypatch.delenv("INSPIRATION_LLM_MODEL", raising=False)
    monkeypatch.delenv("INSPIRATION_LLM_TIMEOUT_SECONDS", raising=False)

    from app.storage.database import inspiration_store, postgres_client
    import app.api.auth as auth_module
    import app.api.inspiration as inspiration_api
    import main as main_module

    postgres_client.reset_db_state()
    importlib.reload(postgres_client)
    importlib.reload(inspiration_store)
    auth_module = importlib.reload(auth_module)
    inspiration_api = importlib.reload(inspiration_api)
    main_module = importlib.reload(main_module)

    with TestClient(main_module.app) as test_client:
        yield test_client, auth_module, inspiration_api

    postgres_client.reset_db_state()


def _submit_payload() -> dict:
    return {
        "submitter_name": "测试用户",
        "participation_mode": "我有一个真实问题，需要拆解初步方案",
        "contact": "test@example.com",
        "problem": "我想做一个 AI 工具，帮助社群成员把模糊想法拆成一周内可以验证的小实验。",
        "category": "生活效率 / 个人工作流",
        "category_extra": "",
        "current_blockers": "不知道怎么把问题拆成项目",
        "note": "希望有人帮忙一起看。",
        "allow_public": True,
    }


def _disable_background_tasks(monkeypatch, inspiration_api):
    scheduled = []

    def fake_create_task(coro):
        scheduled.append(coro)
        coro.close()
        return None

    monkeypatch.setattr(inspiration_api.asyncio, "create_task", fake_create_task)
    return scheduled


def test_submission_creates_pending_initial_assistant_run(client, monkeypatch):
    test_client, _, inspiration_api = client
    scheduled = _disable_background_tasks(monkeypatch, inspiration_api)

    created = test_client.post("/api/v1/inspiration/demands", json=_submit_payload())

    assert created.status_code == 200
    body = created.json()
    slug = body["demand"]["slug"]
    assert scheduled
    assert body["demand"]["assistant"]["status"] == "pending"
    assert body["demand"]["assistant"]["snapshot"]["next_step"]

    from app.storage.database.inspiration_store import list_assistant_runs_for_demand

    runs = list_assistant_runs_for_demand(slug)
    assert len(runs) == 1
    assert runs[0]["trigger_type"] == "initial_submission"
    assert runs[0]["status"] == "pending"


@pytest.mark.asyncio
async def test_assistant_run_completion_writes_ready_snapshot(client, monkeypatch):
    test_client, _, inspiration_api = client
    _disable_background_tasks(monkeypatch, inspiration_api)
    created = test_client.post("/api/v1/inspiration/demands", json=_submit_payload())
    slug = created.json()["demand"]["slug"]

    async def fake_request(messages, **kwargs):
        return '{"title":"特别长的学习反馈助手标题","summary":"面向课堂阅读训练的反馈助手。","public_stuck":"需要先确认试用对象。","clarity":"更清晰","next_step":"先找 3 个真实对象访谈","follow_up_questions":["谁会第一个使用？"],"suggested_roles":["真实问题提出者"],"recommended_tools":["访谈提纲"],"risk_notes":["不要先做完整系统"]}'

    monkeypatch.setattr("app.services.inspiration_review.request_inspiration_llm", fake_request)

    from app.services.inspiration_assistant import run_inspiration_assistant_once
    from app.storage.database.inspiration_store import list_assistant_runs_for_demand

    run_id = list_assistant_runs_for_demand(slug)[0]["id"]
    await run_inspiration_assistant_once(run_id)

    detail = test_client.get(f"/api/v1/inspiration/demands/{slug}")
    demand = detail.json()["demand"]
    assert demand["assistant"]["status"] == "ready"
    assert demand["assistant"]["version"] == 1
    assert demand["assistant"]["latest_run_id"] == run_id
    assert demand["title"] == "特别长的学习反馈助手标题"[:12]
    assert len(demand["title"]) <= 12
    assert demand["summary"] == "面向课堂阅读训练的反馈助手。"
    assert demand["stuck"] == "需要先确认试用对象。"
    assert "社群成员把模糊想法" not in str(demand)
    assert demand["assistant"]["snapshot"]["next_step"] == "先找 3 个真实对象访谈"
    assert demand["llm_review"]["next_step"] == "先找 3 个真实对象访谈"
    assert list_assistant_runs_for_demand(slug)[0]["status"] == "completed"


def test_path_create_and_edit_enqueue_assistant_runs(client, monkeypatch):
    test_client, auth_module, inspiration_api = client
    scheduled = _disable_background_tasks(monkeypatch, inspiration_api)
    monkeypatch.setenv("ADMIN_USER_IDS", "1")
    token = auth_module.create_jwt_token(1, "13800138000", is_admin=True)
    headers = {"Authorization": f"Bearer {token}"}

    created = test_client.post(
        "/api/v1/inspiration/demands/need-01-ai-english-reading-assistant/updates",
        headers=headers,
        json={
            "week_label": "2026-W21",
            "stage_key": "defined",
            "stage_status": "done",
            "summary": "完成问题定义",
            "progress": "已确认课堂阅读场景。",
            "blockers": "",
            "next_steps": "",
            "emotion_note": "",
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
            "week_label": "2026-W22",
            "stage_key": "demo",
            "stage_status": "current",
            "summary": "开始 Demo",
            "progress": "准备表单原型。",
            "blockers": "缺少试用对象",
            "next_steps": "",
            "emotion_note": "",
            "artifacts": [],
            "visibility": "public",
        },
    )
    assert edited.status_code == 200
    assert len(scheduled) == 2

    from app.storage.database.inspiration_store import list_assistant_runs_for_demand

    runs = list_assistant_runs_for_demand("need-01-ai-english-reading-assistant")
    assert [run["trigger_type"] for run in runs[:2]] == ["path_update_edit", "path_update"]
    assert runs[0]["trigger_update_id"] == update_id
    assert runs[1]["trigger_update_id"] == update_id


@pytest.mark.asyncio
async def test_stage_run_preserves_public_summary_and_generates_next_stage_ai_snapshot(client, monkeypatch):
    test_client, auth_module, inspiration_api = client
    _disable_background_tasks(monkeypatch, inspiration_api)
    created = test_client.post("/api/v1/inspiration/demands", json=_submit_payload())
    slug = created.json()["demand"]["slug"]

    responses = [
        '{"title":"初始标题","summary":"初始公开摘要。","public_stuck":"初始公开需要。","clarity":"更清晰","next_step":"先回答追问","follow_up_questions":["谁会用？"],"suggested_roles":["真实问题提出者"],"recommended_tools":["访谈提纲"],"risk_notes":["不要泄露隐私"]}',
        '{"title":"不应覆盖标题","summary":"不应覆盖公开摘要","public_stuck":"不应覆盖公开需要","ai_draft_answer":"可以写成：目标用户是正在做课堂阅读训练的学生。","follow_up_questions":["学生现在用什么材料？"],"next_step":"进入问题定义","confidence":"medium"}',
    ]

    async def fake_request(messages, **kwargs):
        return responses.pop(0)

    monkeypatch.setattr("app.services.inspiration_review.request_inspiration_llm", fake_request)

    from app.services.inspiration_assistant import run_inspiration_assistant_once
    from app.storage.database.inspiration_store import list_assistant_runs_for_demand

    first_run_id = list_assistant_runs_for_demand(slug)[0]["id"]
    await run_inspiration_assistant_once(first_run_id)

    monkeypatch.setenv("ADMIN_USER_IDS", "1")
    token = auth_module.create_jwt_token(1, "13800138000", is_admin=True)
    update = test_client.post(
        f"/api/v1/inspiration/demands/{slug}/updates",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "week_label": "2026-W21",
            "stage_key": "submitted",
            "stage_status": "done",
            "summary": "目标用户是正在做课堂阅读训练的学生。",
            "progress": "",
            "blockers": "",
            "next_steps": "",
            "emotion_note": "",
            "artifacts": [],
            "visibility": "public",
        },
    )
    assert update.status_code == 200

    stage_run_id = list_assistant_runs_for_demand(slug)[0]["id"]
    await run_inspiration_assistant_once(stage_run_id)

    demand = test_client.get(f"/api/v1/inspiration/demands/{slug}").json()["demand"]
    assert demand["title"] == "初始标题"
    assert demand["summary"] == "初始公开摘要。"
    assert demand["stuck"] == "初始公开需要。"
    defined_stage = demand["assistant"]["snapshot"]["stages"]["defined"]
    assert defined_stage["ai_draft_answer"] == "可以写成：目标用户是正在做课堂阅读训练的学生。"
    assert defined_stage["follow_up_questions"] == ["学生现在用什么材料？"]
    assert demand["assistant"]["snapshot"]["stage_key"] == "defined"
    assert demand["assistant"]["snapshot"]["next_step"] == "进入问题定义"


@pytest.mark.asyncio
async def test_assistant_failure_preserves_previous_snapshot(client, monkeypatch):
    test_client, _, inspiration_api = client
    _disable_background_tasks(monkeypatch, inspiration_api)
    created = test_client.post("/api/v1/inspiration/demands", json=_submit_payload())
    slug = created.json()["demand"]["slug"]

    async def fake_success(messages, **kwargs):
        return '{"next_step":"旧建议","follow_up_questions":["旧追问"]}'

    monkeypatch.setattr("app.services.inspiration_review.request_inspiration_llm", fake_success)
    from app.services.inspiration_assistant import run_inspiration_assistant_once
    from app.storage.database.inspiration_store import create_assistant_run, list_assistant_runs_for_demand

    first_run_id = list_assistant_runs_for_demand(slug)[0]["id"]
    await run_inspiration_assistant_once(first_run_id)

    failing_run_id = create_assistant_run(slug=slug, trigger_type="path_update", trigger_update_id=None)["id"]

    async def fake_failure(messages, **kwargs):
        raise RuntimeError("model unavailable")

    monkeypatch.setattr("app.services.inspiration_review.request_inspiration_llm", fake_failure)
    await run_inspiration_assistant_once(failing_run_id)

    demand = test_client.get(f"/api/v1/inspiration/demands/{slug}").json()["demand"]
    assert demand["assistant"]["status"] == "failed"
    assert demand["assistant"]["snapshot"]["next_step"] == "旧建议"
    assert demand["assistant"]["error_message"]
