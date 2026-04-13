import asyncio
import importlib
import time
from io import BytesIO
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import bcrypt
import httpx
import pytest
from PIL import Image
from sqlalchemy import text

from app.services.content_moderation import ModerationDecision

@pytest.fixture
def client(tmp_path, monkeypatch):
    database_path = tmp_path / "topiclab-test.db"
    workspace_base = tmp_path / "workspace"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("WORKSPACE_BASE", str(workspace_base))
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.setenv("RESONNET_BASE_URL", "http://resonnet.test")
    monkeypatch.setenv("ADMIN_PHONE_NUMBERS", "13800000001")
    monkeypatch.setenv("ADMIN_PANEL_PASSWORD", "admin-panel-secret")
    monkeypatch.setenv("ARCADE_EVALUATOR_SECRET_KEY", "arcade-review-secret")
    monkeypatch.setenv("TOPICLAB_TESTING", "1")

    from app.storage.database import postgres_client, topic_store
    postgres_client.reset_db_state()

    import app.api.apps as apps_module
    import app.api.auth as auth_module
    import app.api.topics as topics_module
    import app.services.resonnet_client as resonnet_client_module
    import main as main_module

    importlib.reload(postgres_client)
    importlib.reload(topic_store)
    apps_module = importlib.reload(apps_module)
    importlib.reload(auth_module)
    topics_module = importlib.reload(topics_module)
    resonnet_client_module = importlib.reload(resonnet_client_module)
    main_module = importlib.reload(main_module)
    discussion_state = {"snapshot_turns": []}

    async def fake_request_json(method, path, *, json_body=None, headers=None, params=None, timeout=600.0):
        if path == "/executor/topics/bootstrap":
            topic_root = workspace_base / "topics" / json_body["topic_id"]
            (topic_root / "shared").mkdir(parents=True, exist_ok=True)
            return {"ok": True, "topic_id": json_body["topic_id"]}
        if path == "/executor/discussions":
            await asyncio.sleep(0.3)
            generated_dir = workspace_base / "topics" / json_body["topic_id"] / "shared" / "generated_images"
            generated_dir.mkdir(parents=True, exist_ok=True)
            Image.new("RGB", (32, 24), color=(12, 120, 210)).save(generated_dir / "round1.png", format="PNG")
            discussion_state["snapshot_turns"] = [
                {
                    "turn_key": "round1_physicist",
                    "round_num": 1,
                    "expert_name": "physicist",
                    "expert_label": "Physicist",
                    "body": "观点",
                    "updated_at": "2026-03-14T00:00:00+00:00",
                }
            ]
            return {
                "turns_count": 1,
                "cost_usd": 0.01,
                "completed_at": "2026-03-14T00:00:00+00:00",
                "discussion_summary": "总结\n\n![图](../generated_images/round1.png)",
                "discussion_history": "## Round 1 - Physicist\n\n观点",
                "turns": [
                    {
                        "turn_key": "round1_physicist",
                        "round_num": 1,
                        "expert_name": "physicist",
                        "expert_label": "Physicist",
                        "body": "观点",
                        "updated_at": "2026-03-14T00:00:00+00:00",
                    }
                ],
                "generated_images": ["round1.png"],
            }
        if path.endswith("/snapshot"):
            return {
                "topic_id": path.split("/")[-2],
                "turns": discussion_state["snapshot_turns"],
                "turns_count": len(discussion_state["snapshot_turns"]),
                "discussion_history": "## Round 1 - Physicist\n\n观点" if discussion_state["snapshot_turns"] else "",
                "discussion_summary": "",
                "generated_images": [],
            }
        if path == "/executor/expert-replies":
            return {
                "reply_body": "这是专家回复",
                "num_turns": 1,
                "total_cost_usd": 0.001,
            }
        if path.endswith("/experts"):
            return [{"name": "physicist", "label": "Physicist", "description": "", "source": "preset"}]
        if path.endswith("/moderator-mode"):
            return {
                "mode_id": "standard",
                "num_rounds": 5,
                "custom_prompt": None,
                "skill_list": ["image_generation"],
                "mcp_server_ids": [],
                "model": None,
            }
        return {}

    monkeypatch.setattr(topics_module, "request_json", fake_request_json)
    monkeypatch.setattr(resonnet_client_module, "request_json", fake_request_json)
    monkeypatch.setattr(
        topics_module,
        "moderate_post_content",
        lambda body, scenario: asyncio.sleep(
            0,
            result=ModerationDecision(
                approved=True,
                reason="ok",
                suggestion="",
                category="safe",
            ),
        ),
    )

    from fastapi.testclient import TestClient

    with TestClient(main_module.app) as test_client:
        test_client.app.state.workspace_base = workspace_base
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
    if register.status_code == 200:
        token = register.json()["token"]
        return {"token": token, "user": register.json()["user"]}

    assert register.status_code == 400, register.text
    login = client.post(
        "/auth/login",
        json={"phone": phone, "password": password},
    )
    assert login.status_code == 200, login.text
    return {"token": login.json()["token"], "user": login.json()["user"]}


def register_login_and_openclaw_key(client, *, phone: str, username: str, password: str = "password123") -> dict:
    auth = register_and_login(client, phone=phone, username=username, password=password)
    key_resp = client.post(
        "/api/v1/auth/openclaw-key",
        headers={"Authorization": f"Bearer {auth['token']}"},
    )
    assert key_resp.status_code == 200, key_resp.text
    payload = key_resp.json()
    return {
        **auth,
        "openclaw_key": payload["key"],
        "bind_key": payload["bind_key"],
        "bootstrap_path": payload["bootstrap_path"],
        "skill_path": payload["skill_path"],
        "agent_uid": payload["agent_uid"],
        "openclaw_agent": payload["openclaw_agent"],
        "key_id": payload["key_id"],
    }


def admin_panel_login(client, password: str = "admin-panel-secret") -> dict:
    resp = client.post("/admin/auth/login", json={"password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_topic_create_list_and_posts(client):
    admin = register_and_login(client, phone="13800000001", username="admin")
    create = client.post("/topics", json={"title": "话题A", "body": "正文", "category": "research"})
    assert create.status_code == 201, create.text
    topic = create.json()
    topic_id = topic["id"]
    assert topic["category"] == "research"
    topic_workspace = client.app.state.workspace_base / "topics" / topic_id
    assert not topic_workspace.exists()

    list_resp = client.get("/topics")
    assert list_resp.status_code == 200
    assert any(item["id"] == topic_id for item in list_resp.json()["items"])
    filtered = client.get("/topics?category=research")
    assert filtered.status_code == 200
    assert filtered.json()["items"][0]["id"] == topic_id

    post_resp = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "alice", "body": "我支持把话题列表里的管理能力补齐，方便管理员直接处理内容。"},
    )
    assert post_resp.status_code == 201
    post_payload = post_resp.json()
    assert post_payload["post"]["delete_token"].startswith("ptok_")
    assert not topic_workspace.exists()
    listed_posts = client.get(f"/topics/{topic_id}/posts")
    assert listed_posts.status_code == 200
    assert listed_posts.json()["items"][0]["body"] == "我支持把话题列表里的管理能力补齐，方便管理员直接处理内容。"

    bundle_resp = client.get(f"/topics/{topic_id}/bundle")
    assert bundle_resp.status_code == 200
    bundle = bundle_resp.json()
    assert bundle["topic"]["id"] == topic_id
    assert len(bundle["posts"]["items"]) == 1
    assert bundle["posts"]["items"][0]["topic_id"] == topic_id
    assert bundle["experts"][0]["name"] == "physicist"


def test_arcade_topic_internal_create_and_metadata_roundtrip(client):
    admin = admin_panel_login(client)
    metadata = {
        "scene": "arcade",
        "arcade": {
            "board": "ml",
            "task_type": "list_output",
            "prompt": "请输出一个 JSON 列表。",
            "rules": "必须输出合法 JSON。",
            "output_mode": "json_array",
            "output_schema": {"type": "array", "items": {"type": "string"}},
            "validator": {"type": "custom"},
            "heartbeat_interval_minutes": 30,
            "visibility": "public_read",
        },
    }
    create = client.post(
        "/api/v1/internal/arcade/topics",
        json={"title": "Arcade 题目", "body": "题目正文", "metadata": metadata},
        headers={"Authorization": f"Bearer {admin['token']}"},
    )
    assert create.status_code == 201, create.text
    topic = create.json()
    assert topic["category"] == "arcade"
    assert topic["metadata"]["scene"] == "arcade"
    assert topic["metadata"]["arcade"]["output_mode"] == "json_array"

    fetched = client.get(f"/topics/{topic['id']}")
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["metadata"]["arcade"]["prompt"] == "请输出一个 JSON 列表。"

    listed = client.get("/topics?category=arcade")
    assert listed.status_code == 200, listed.text
    assert any(item["id"] == topic["id"] and item["metadata"]["scene"] == "arcade" for item in listed.json()["items"])

    updated = client.patch(
        f"/api/v1/internal/arcade/topics/{topic['id']}",
        json={"metadata": {"arcade": {"rules": "更新后的规则", "output_mode": "json_array"}}},
        headers={"Authorization": f"Bearer {admin['token']}"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["metadata"]["scene"] == "arcade"
    assert updated.json()["metadata"]["arcade"]["rules"] == "更新后的规则"

    forbidden = client.post("/topics", json={"title": "非法 arcade", "body": "x", "category": "arcade"})
    assert forbidden.status_code == 403, forbidden.text


def test_arcade_openclaw_branch_rules_are_enforced(client):
    admin = admin_panel_login(client)
    create = client.post(
        "/api/v1/internal/arcade/topics",
        json={
            "title": "Arcade 分支题",
            "body": "题目正文",
            "metadata": {"arcade": {"prompt": "输出答案", "rules": "沿自己的分支继续回复", "output_mode": "plain_text"}},
        },
        headers={"Authorization": f"Bearer {admin['token']}"},
    )
    assert create.status_code == 201, create.text
    topic_id = create.json()["id"]

    jwt_user = register_and_login(client, phone="13800009001", username="arcade-jwt-user")
    openclaw_a = register_login_and_openclaw_key(client, phone="13800009002", username="arcade-a")
    openclaw_b = register_login_and_openclaw_key(client, phone="13800009003", username="arcade-b")

    web_post = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "arcade-jwt-user", "body": "网页端不该能发"},
        headers={"Authorization": f"Bearer {jwt_user['token']}"},
    )
    assert web_post.status_code == 403, web_post.text

    branch_a_root_resp = client.post(
        f"/api/v1/openclaw/topics/{topic_id}/posts",
        json={"body": '["alpha", "beta"]'},
        headers={"Authorization": f"Bearer {openclaw_a['openclaw_key']}"},
    )
    assert branch_a_root_resp.status_code == 201, branch_a_root_resp.text
    branch_a_root = branch_a_root_resp.json()["post"]
    assert branch_a_root["metadata"]["arcade"]["post_kind"] == "submission"
    assert branch_a_root["metadata"]["arcade"]["version"] == 1
    assert branch_a_root["metadata"]["arcade"]["branch_owner_openclaw_agent_id"] == branch_a_root["owner_openclaw_agent_id"]

    duplicate_root = client.post(
        f"/api/v1/openclaw/topics/{topic_id}/posts",
        json={"body": '["duplicate"]'},
        headers={"Authorization": f"Bearer {openclaw_a['openclaw_key']}"},
    )
    assert duplicate_root.status_code == 409, duplicate_root.text

    write_other_branch = client.post(
        f"/api/v1/openclaw/topics/{topic_id}/posts",
        json={"body": '["hijack"]', "in_reply_to_id": branch_a_root["id"]},
        headers={"Authorization": f"Bearer {openclaw_b['openclaw_key']}"},
    )
    assert write_other_branch.status_code == 403, write_other_branch.text

    branch_b_root_resp = client.post(
        f"/api/v1/openclaw/topics/{topic_id}/posts",
        json={"body": "这是 B 的答案"},
        headers={"Authorization": f"Bearer {openclaw_b['openclaw_key']}"},
    )
    assert branch_b_root_resp.status_code == 201, branch_b_root_resp.text

    branch_a_second_resp = client.post(
        f"/api/v1/openclaw/topics/{topic_id}/posts",
        json={"body": '["alpha", "beta", "gamma"]', "in_reply_to_id": branch_a_root["id"]},
        headers={"Authorization": f"Bearer {openclaw_a['openclaw_key']}"},
    )
    assert branch_a_second_resp.status_code == 201, branch_a_second_resp.text
    branch_a_second = branch_a_second_resp.json()["post"]
    assert branch_a_second["metadata"]["arcade"]["version"] == 2

    non_leaf_reply = client.post(
        f"/api/v1/openclaw/topics/{topic_id}/posts",
        json={"body": '["should fail"]', "in_reply_to_id": branch_a_root["id"]},
        headers={"Authorization": f"Bearer {openclaw_a['openclaw_key']}"},
    )
    assert non_leaf_reply.status_code == 409, non_leaf_reply.text


def test_admin_panel_can_list_twin_observations(client):
    admin_panel = admin_panel_login(client)
    auth = register_login_and_openclaw_key(client, phone="13800009101", username="twin-owner")

    upsert = client.post(
        "/api/v1/auth/digital-twins/upsert",
        headers={"Authorization": f"Bearer {auth['token']}"},
        json={
            "agent_name": "profile_twin",
            "display_name": "Twin Owner",
            "expert_name": "builder",
            "visibility": "private",
            "exposure": "brief",
            "source": "profile_twin",
            "role_content": "# Twin Owner\n\n## Identity\n\nBuilder",
        },
    )
    assert upsert.status_code == 200, upsert.text
    twin_id = upsert.json()["twin_id"]

    created = client.post(
        f"/api/v1/openclaw/twins/{twin_id}/observations",
        headers={"Authorization": f"Bearer {auth['openclaw_key']}"},
        json={
            "instance_id": auth["agent_uid"],
            "observation_type": "explicit_requirement",
            "confidence": 0.9,
            "payload": {
                "topic": "discussion_style",
                "statement": "prefer concise replies with conclusion first",
                "normalized": {"verbosity": "low", "reply_shape": "conclusion_first"},
                "explicitness": "explicit",
                "scope": "global",
                "scene": "forum.request",
                "evidence": [{"message_id": "msg_1", "excerpt": "先说结论，尽量短一点。"}],
            },
        },
    )
    assert created.status_code == 200, created.text

    listed = client.get(
        "/admin/twins/observations",
        headers={"Authorization": f"Bearer {admin_panel['token']}"},
        params={
            "observation_type": "explicit_requirement",
            "merge_status": "pending_review",
            "q": "conclusion_first",
        },
    )
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["twin_id"] == twin_id
    assert item["owner_username"] == "twin-owner"
    assert item["instance_id"] == auth["agent_uid"]
    assert item["topic"] == "discussion_style"
    assert item["explicitness"] == "explicit"
    assert item["scope"] == "global"
    assert item["scene"] == "forum.request"
    assert item["statement"] == "prefer concise replies with conclusion first"
    assert item["evidence_count"] == 1
    assert item["payload"]["normalized"]["reply_shape"] == "conclusion_first"


def test_admin_panel_can_build_community_observability_rollup(client):
    admin_panel = admin_panel_login(client)
    auth = register_login_and_openclaw_key(client, phone="13800009102", username="ops-user")

    upsert = client.post(
        "/api/v1/auth/digital-twins/upsert",
        headers={"Authorization": f"Bearer {auth['token']}"},
        json={
            "agent_name": "profile_twin",
            "display_name": "Ops User Twin",
            "expert_name": "operator",
            "visibility": "private",
            "exposure": "brief",
            "source": "profile_twin",
            "role_content": "# Ops User Twin\n\n## Identity\n\nOperator",
        },
    )
    assert upsert.status_code == 200, upsert.text
    twin_id = upsert.json()["twin_id"]

    topic_resp = client.post(
        "/api/v1/openclaw/topics",
        headers={"Authorization": f"Bearer {auth['openclaw_key']}"},
        json={"title": "运维观测开题", "body": "建立社区运维观测", "category": "request"},
    )
    assert topic_resp.status_code == 201, topic_resp.text
    topic_id = topic_resp.json()["id"]

    post_resp = client.post(
        f"/api/v1/openclaw/topics/{topic_id}/posts",
        headers={"Authorization": f"Bearer {auth['openclaw_key']}"},
        json={"body": "补充一条动作记录"},
    )
    assert post_resp.status_code == 201, post_resp.text

    failed_post_resp = client.post(
        "/api/v1/openclaw/topics/topic_missing/posts",
        headers={"Authorization": f"Bearer {auth['openclaw_key']}"},
        json={"body": "制造一条失败事件"},
    )
    assert failed_post_resp.status_code == 404, failed_post_resp.text

    observation_resp = client.post(
        f"/api/v1/openclaw/twins/{twin_id}/observations",
        headers={"Authorization": f"Bearer {auth['openclaw_key']}"},
        json={
            "instance_id": auth["agent_uid"],
            "observation_type": "explicit_requirement",
            "confidence": 0.82,
            "payload": {
                "topic": "onboarding",
                "statement": "prefer conclusion-first ops summaries",
                "normalized": {"verbosity": "low", "format": "ops_brief"},
                "explicitness": "explicit",
                "scope": "global",
                "scene": "forum.request",
                "evidence": [{"message_id": "msg_ops_1", "excerpt": "先告诉我风险，再说细节。"}],
            },
        },
    )
    assert observation_resp.status_code == 200, observation_resp.text

    observability_resp = client.get(
        "/admin/community/observability",
        headers={"Authorization": f"Bearer {admin_panel['token']}"},
        params={"window_days": 14},
    )
    assert observability_resp.status_code == 200, observability_resp.text
    payload = observability_resp.json()

    assert payload["today_date"]
    assert payload["timezone"] == "Asia/Shanghai"
    assert "OpenClaw" in payload["activity_rules"]["openclaw"]
    assert payload["today_summary"]["active_agents"] >= 1
    assert payload["today_summary"]["active_users"] >= 1
    assert payload["overview"]["active_agents_today"] >= 1
    assert payload["overview"]["active_users_today"] >= 1
    assert payload["overview"]["total_agents"] >= 1
    assert payload["overview"]["active_agents_7d"] >= 1
    assert payload["overview"]["active_users_7d"] >= 1
    assert payload["overview"]["events_window"] >= 3
    assert payload["overview"]["failed_events_window"] >= 1
    assert payload["overview"]["observations_window"] >= 1
    assert payload["overview"]["pending_observations_total"] >= 1
    assert payload["overview"]["tokenized_requests_window"] >= 3
    assert payload["overview"]["total_tokens_window"] > 0
    assert payload["overview"]["avg_tokens_per_request_window"] > 0

    scene_map = {item["scene"]: item for item in payload["scenes"]}
    assert scene_map["forum.request"]["event_count"] >= 2
    assert scene_map["forum.request"]["observation_count"] >= 1

    event_types = {item["event_type"] for item in payload["top_event_types"]}
    assert "topic.created" in event_types
    assert "post.created" in event_types

    risk_agents = {item["agent_uid"]: item for item in payload["risk_agents"]}
    assert auth["agent_uid"] in risk_agents
    assert risk_agents[auth["agent_uid"]]["recent_failure_count"] >= 1
    assert risk_agents[auth["agent_uid"]]["total_tokens_estimated"] > 0

    active_users = {item["user_id"]: item for item in payload["active_users"]}
    assert auth["user"]["id"] in active_users
    assert active_users[auth["user"]["id"]]["recent_observation_count"] >= 1
    assert active_users[auth["user"]["id"]]["total_tokens_estimated"] > 0

    top_token_agents = {item["agent_uid"]: item for item in payload["top_token_agents"]}
    assert auth["agent_uid"] in top_token_agents
    assert top_token_agents[auth["agent_uid"]]["tokenized_request_count"] >= 3

    daily_agents = {item["agent_uid"]: item for item in payload["daily_openclaw_actions"]}
    assert auth["agent_uid"] in daily_agents
    assert daily_agents[auth["agent_uid"]]["is_today_active"] is True
    assert daily_agents[auth["agent_uid"]]["today_categories"]["content_creation"] >= 1
    assert daily_agents[auth["agent_uid"]]["today_categories"]["observation"] >= 1
    assert daily_agents[auth["agent_uid"]]["total_tokens_estimated"] > 0
    assert len(daily_agents[auth["agent_uid"]]["days"]) == 14

    daily_users = {item["user_id"]: item for item in payload["daily_user_actions"]}
    assert auth["user"]["id"] in daily_users
    assert daily_users[auth["user"]["id"]]["is_today_active"] is True
    assert daily_users[auth["user"]["id"]]["today_action_total"] >= 1
    assert daily_users[auth["user"]["id"]]["total_tokens_estimated"] > 0


def test_arcade_structured_task_rejects_multiple_candidate_markdown_submission(client):
    admin = admin_panel_login(client)
    create = client.post(
        "/api/v1/internal/arcade/topics",
        json={
            "title": "Arcade JSON 题",
            "body": "题目正文",
            "metadata": {
                "arcade": {
                    "prompt": "输出一个 JSON 对象",
                    "rules": "只提交一个最终答案，不要夹带多个候选方案",
                    "output_mode": "json_object",
                    "output_schema": {"type": "object"},
                }
            },
        },
        headers={"Authorization": f"Bearer {admin['token']}"},
    )
    assert create.status_code == 201, create.text
    topic_id = create.json()["id"]

    openclaw = register_login_and_openclaw_key(client, phone="13800009015", username="arcade-json-owner")
    invalid_submission = client.post(
        f"/api/v1/openclaw/topics/{topic_id}/posts",
        json={
            "body": """
## 评测结果分析

策略 A：
{"epochs": 50, "lr": 0.005}

策略 B：
{"epochs": 60, "lr": 0.003}
""".strip()
        },
        headers={"Authorization": f"Bearer {openclaw['openclaw_key']}"},
    )
    assert invalid_submission.status_code == 400, invalid_submission.text
    assert "valid json_object only" in invalid_submission.json()["detail"].lower()

    valid_submission = client.post(
        f"/api/v1/openclaw/topics/{topic_id}/posts",
        json={"body": '{"epochs": 50, "lr": 0.005}'},
        headers={"Authorization": f"Bearer {openclaw['openclaw_key']}"},
    )
    assert valid_submission.status_code == 201, valid_submission.text
    assert valid_submission.json()["post"]["metadata"]["arcade"]["payload"] == {"epochs": 50, "lr": 0.005}


def test_arcade_internal_evaluation_creates_system_post_and_inbox(client):
    admin = admin_panel_login(client)
    create = client.post(
        "/api/v1/internal/arcade/topics",
        json={
            "title": "Arcade 评测题",
            "body": "题目正文",
            "metadata": {"arcade": {"prompt": "输出一句话", "rules": "等评测再继续", "output_mode": "plain_text"}},
        },
        headers={"Authorization": f"Bearer {admin['token']}"},
    )
    assert create.status_code == 201, create.text
    topic_id = create.json()["id"]

    owner = register_login_and_openclaw_key(client, phone="13800009004", username="arcade-owner")
    owner_headers = {"Authorization": f"Bearer {owner['token']}"}

    submission_resp = client.post(
        f"/api/v1/openclaw/topics/{topic_id}/posts",
        json={"body": "第一版答案"},
        headers={"Authorization": f"Bearer {owner['openclaw_key']}"},
    )
    assert submission_resp.status_code == 201, submission_resp.text
    submission = submission_resp.json()["post"]

    evaluation_resp = client.post(
        f"/api/v1/internal/arcade/topics/{topic_id}/branches/{submission['id']}/evaluate",
        json={
            "for_post_id": submission["id"],
            "body": "未通过，请补充更具体的表达。",
            "result": {"passed": False, "score": 0.4, "feedback": "不够具体"},
        },
        headers={"Authorization": f"Bearer {admin['token']}"},
    )
    assert evaluation_resp.status_code == 201, evaluation_resp.text
    evaluation_post = evaluation_resp.json()["post"]
    assert evaluation_post["author_type"] == "system"
    assert evaluation_post["author"] == "评测员"
    assert evaluation_post["metadata"]["arcade"]["post_kind"] == "evaluation"
    assert evaluation_post["metadata"]["arcade"]["for_post_id"] == submission["id"]

    thread = client.get(f"/topics/{topic_id}/posts/{submission['id']}/thread", headers=owner_headers)
    assert thread.status_code == 200, thread.text
    assert [item["author_type"] for item in thread.json()["items"]] == ["human", "system"]

    inbox = client.get("/api/v1/me/inbox", headers=owner_headers)
    assert inbox.status_code == 200, inbox.text
    assert inbox.json()["unread_count"] == 1
    assert inbox.json()["items"][0]["reply_post_id"] == evaluation_post["id"]


def test_admin_panel_can_delete_arcade_evaluation_post_and_inbox_message(client):
    admin = admin_panel_login(client)
    create = client.post(
        "/api/v1/internal/arcade/topics",
        json={
            "title": "Arcade 删除评测回复",
            "body": "题目正文",
            "metadata": {"arcade": {"prompt": "输出一句话", "rules": "等评测再继续", "output_mode": "plain_text"}},
        },
        headers={"Authorization": f"Bearer {admin['token']}"},
    )
    assert create.status_code == 201, create.text
    topic_id = create.json()["id"]

    owner = register_login_and_openclaw_key(client, phone="13800009014", username="arcade-delete-owner")
    owner_headers = {"Authorization": f"Bearer {owner['token']}"}

    submission_resp = client.post(
        f"/api/v1/openclaw/topics/{topic_id}/posts",
        json={"body": "第一版答案"},
        headers={"Authorization": f"Bearer {owner['openclaw_key']}"},
    )
    assert submission_resp.status_code == 201, submission_resp.text
    submission = submission_resp.json()["post"]

    evaluation_resp = client.post(
        f"/api/v1/internal/arcade/topics/{topic_id}/branches/{submission['id']}/evaluate",
        json={
            "for_post_id": submission["id"],
            "body": "这是一条要被删掉的评测回复。",
            "result": {"passed": False, "score": 0.2, "feedback": "继续修改"},
        },
        headers={"Authorization": f"Bearer {admin['token']}"},
    )
    assert evaluation_resp.status_code == 201, evaluation_resp.text
    evaluation_post = evaluation_resp.json()["post"]

    inbox_before = client.get("/api/v1/me/inbox", headers=owner_headers)
    assert inbox_before.status_code == 200, inbox_before.text
    assert inbox_before.json()["unread_count"] == 1
    assert inbox_before.json()["items"][0]["reply_post_id"] == evaluation_post["id"]

    delete_resp = client.delete(
        f"/api/v1/internal/topics/{topic_id}/posts/{evaluation_post['id']}",
        headers={"Authorization": f"Bearer {admin['token']}"},
    )
    assert delete_resp.status_code == 200, delete_resp.text
    assert delete_resp.json()["ok"] is True

    thread_after = client.get(f"/topics/{topic_id}/posts/{submission['id']}/thread", headers=owner_headers)
    assert thread_after.status_code == 200, thread_after.text
    assert [item["id"] for item in thread_after.json()["items"]] == [submission["id"]]

    inbox_after = client.get("/api/v1/me/inbox", headers=owner_headers)
    assert inbox_after.status_code == 200, inbox_after.text
    assert inbox_after.json()["unread_count"] == 0
    assert inbox_after.json()["items"] == []


def test_arcade_evaluator_secret_can_list_pending_submissions_and_reply(client):
    admin = admin_panel_login(client)
    create = client.post(
        "/api/v1/internal/arcade/topics",
        json={
            "title": "Arcade Secret Review",
            "body": "题目正文",
            "metadata": {"arcade": {"prompt": "给出最终答案", "rules": "等评测再继续", "output_mode": "plain_text"}},
        },
        headers={"Authorization": f"Bearer {admin['token']}"},
    )
    assert create.status_code == 201, create.text
    topic_id = create.json()["id"]

    owner = register_login_and_openclaw_key(client, phone="13800009005", username="arcade-secret-owner")
    submission_resp = client.post(
        f"/api/v1/openclaw/topics/{topic_id}/posts",
        json={"body": "需要评测的答案"},
        headers={"Authorization": f"Bearer {owner['openclaw_key']}"},
    )
    assert submission_resp.status_code == 201, submission_resp.text
    submission = submission_resp.json()["post"]

    unauthorized_queue = client.get("/api/v1/internal/arcade/review-queue")
    assert unauthorized_queue.status_code == 401, unauthorized_queue.text

    queue = client.get(
        "/api/v1/internal/arcade/review-queue?include_thread=true",
        headers={"X-Arcade-Secret-Key": "arcade-review-secret"},
    )
    assert queue.status_code == 200, queue.text
    items = queue.json()["items"]
    assert len(items) == 1
    assert items[0]["topic"]["id"] == topic_id
    assert items[0]["branch_root_post_id"] == submission["id"]
    assert items[0]["submission_post"]["id"] == submission["id"]
    assert [post["id"] for post in items[0]["thread"]] == [submission["id"]]

    evaluation_resp = client.post(
        f"/api/v1/internal/arcade/reviewer/topics/{topic_id}/branches/{submission['id']}/evaluate",
        json={
            "for_post_id": submission["id"],
            "body": "通过，保持这个答案。",
            "result": {"passed": True, "score": 1.0, "feedback": "答案可接受"},
        },
        headers={"X-Arcade-Secret-Key": "arcade-review-secret"},
    )
    assert evaluation_resp.status_code == 201, evaluation_resp.text
    evaluation_post = evaluation_resp.json()["post"]
    assert evaluation_post["author_type"] == "system"
    assert evaluation_post["metadata"]["arcade"]["post_kind"] == "evaluation"

    empty_queue = client.get(
        "/api/v1/internal/arcade/review-queue",
        headers={"X-Arcade-Secret-Key": "arcade-review-secret"},
    )
    assert empty_queue.status_code == 200, empty_queue.text
    assert empty_queue.json()["items"] == []


def test_topic_list_uses_latest_post_oss_image_as_preview_fallback(client):
    create = client.post("/topics", json={"title": "评论图预览", "body": "正文无图", "category": "research"})
    assert create.status_code == 201, create.text
    topic_id = create.json()["id"]

    post_resp = client.post(
        f"/topics/{topic_id}/posts",
        json={
            "author": "alice",
            "body": "这条评论带图\n\n![截图](https://oss-example.aliyuncs.com/topic-media/comment-preview.webp)",
        },
    )
    assert post_resp.status_code == 201, post_resp.text

    topic_detail = client.get(f"/topics/{topic_id}")
    assert topic_detail.status_code == 200, topic_detail.text
    assert topic_detail.json()["preview_image"] == "https://oss-example.aliyuncs.com/topic-media/comment-preview.webp"

    list_resp = client.get("/topics")
    assert list_resp.status_code == 200, list_resp.text
    listed = next(item for item in list_resp.json()["items"] if item["id"] == topic_id)
    assert listed["preview_image"] == "https://oss-example.aliyuncs.com/topic-media/comment-preview.webp"


def test_topic_list_prefers_latest_post_oss_image_over_topic_preview_image(client):
    create = client.post(
        "/topics",
        json={
            "title": "评论图优先",
            "body": "正文带图 ![正文图](https://oss-example.aliyuncs.com/topic-media/body-preview.webp)",
            "category": "research",
        },
    )
    assert create.status_code == 201, create.text
    topic_id = create.json()["id"]

    post_resp = client.post(
        f"/topics/{topic_id}/posts",
        json={
            "author": "alice",
            "body": "更新后的评论图\n\n![评论图](https://oss-example.aliyuncs.com/topic-media/comment-preview-latest.webp)",
        },
    )
    assert post_resp.status_code == 201, post_resp.text

    list_resp = client.get("/topics")
    assert list_resp.status_code == 200, list_resp.text
    listed = next(item for item in list_resp.json()["items"] if item["id"] == topic_id)
    assert listed["preview_image"] == "https://oss-example.aliyuncs.com/topic-media/comment-preview-latest.webp"


def test_topic_search_supports_q_and_openclaw_topics_endpoint(client):
    first = client.post(
        "/topics",
        json={"title": "多智能体检索协作", "body": "讨论 agent search pipeline", "category": "research"},
    )
    assert first.status_code == 201, first.text
    first_topic = first.json()

    second = client.post(
        "/topics",
        json={"title": "产品路线图", "body": "只讨论 roadmap", "category": "product"},
    )
    assert second.status_code == 201, second.text

    by_title = client.get("/topics?q=多智能体")
    assert by_title.status_code == 200, by_title.text
    by_title_ids = [item["id"] for item in by_title.json()["items"]]
    assert first_topic["id"] in by_title_ids
    assert second.json()["id"] not in by_title_ids

    by_body = client.get("/topics?q=search")
    assert by_body.status_code == 200, by_body.text
    by_body_ids = [item["id"] for item in by_body.json()["items"]]
    assert first_topic["id"] in by_body_ids
    assert second.json()["id"] not in by_body_ids

    by_category_and_q = client.get("/topics?category=research&q=agent")
    assert by_category_and_q.status_code == 200, by_category_and_q.text
    by_category_and_q_items = by_category_and_q.json()["items"]
    by_category_and_q_ids = [item["id"] for item in by_category_and_q_items]
    assert first_topic["id"] in by_category_and_q_ids
    assert all(item["category"] == "research" for item in by_category_and_q_items)
    assert second.json()["id"] not in by_category_and_q_ids

    openclaw_search = client.get("/api/v1/openclaw/topics?q=roadmap")
    assert openclaw_search.status_code == 200, openclaw_search.text
    openclaw_search_ids = [item["id"] for item in openclaw_search.json()["items"]]
    assert second.json()["id"] in openclaw_search_ids
    assert first_topic["id"] not in openclaw_search_ids


def test_source_article_reply_creates_topic_once(client, monkeypatch):
    import app.api.source_feed as source_feed_module

    async def fake_fetch_source_feed_article_detail(article_id: int):
        return SimpleNamespace(
            id=article_id,
            title="测试信源标题",
            source_feed_name="信息采集库",
            source_type="we-mp-rss",
            url="https://example.com/source-article",
            pic_url=None,
            description="一条用于自动建题的信源。",
            publish_time="2026-03-14 10:00:00",
            created_at="2026-03-14T10:00:00+00:00",
        )

    async def fake_hydrate_topic_workspace(topic_id: str, article_ids: list[int], snapshots=None):
        return {"topic_id": topic_id, "article_ids": article_ids, "written_files": []}

    async def fake_request_json(method, path, *, json_body=None, headers=None, params=None, timeout=600.0):
        if path == "/executor/topics/bootstrap":
            return {"ok": True, "topic_id": json_body["topic_id"]}
        return {}

    monkeypatch.setattr(source_feed_module, "fetch_source_feed_article_detail", fake_fetch_source_feed_article_detail)
    monkeypatch.setattr(source_feed_module, "hydrate_topic_workspace_with_snapshots", fake_hydrate_topic_workspace)
    monkeypatch.setattr(source_feed_module, "request_json", fake_request_json)

    first = client.post("/source-feed/articles/9001/topic")
    assert first.status_code == 200, first.text
    first_payload = first.json()
    assert first_payload["topic"]["title"] == "测试信源标题"
    assert first_payload["topic"]["category"] == "news"
    assert "## 背景" in first_payload["topic"]["body"]
    assert "- article_id: 9001" in first_payload["topic"]["body"]
    assert "- 原文链接：https://example.com/source-article" in first_payload["topic"]["body"]

    second = client.post("/source-feed/articles/9001/topic")
    assert second.status_code == 200, second.text
    second_payload = second.json()
    assert second_payload["topic"]["id"] == first_payload["topic"]["id"]


def test_source_article_reply_falls_back_to_snapshot_when_detail_unavailable(client, monkeypatch):
    import app.api.source_feed as source_feed_module

    async def fake_fetch_source_feed_article_detail(article_id: int):
        request = httpx.Request("GET", f"https://ic.example.test/api/v1/articles/{article_id}")
        response = httpx.Response(404, request=request)
        raise httpx.HTTPStatusError("not found", request=request, response=response)

    async def fake_hydrate_topic_workspace(topic_id: str, article_ids: list[int], snapshots=None):
        return {"topic_id": topic_id, "article_ids": article_ids, "written_files": []}

    async def fake_request_json(method, path, *, json_body=None, headers=None, params=None, timeout=600.0):
        if path == "/executor/topics/bootstrap":
            return {"ok": True, "topic_id": json_body["topic_id"]}
        return {}

    monkeypatch.setattr(source_feed_module, "fetch_source_feed_article_detail", fake_fetch_source_feed_article_detail)
    monkeypatch.setattr(source_feed_module, "hydrate_topic_workspace_with_snapshots", fake_hydrate_topic_workspace)
    monkeypatch.setattr(source_feed_module, "request_json", fake_request_json)

    payload = {
        "title": "学术论文条目",
        "source_feed_name": "arXiv cs.AI",
        "source_type": "gqy",
        "url": "https://arxiv.org/abs/2603.18916",
        "pic_url": None,
        "description": "用于验证学术条目可在无上游全文时开题。",
        "publish_time": "2026-03-18",
        "created_at": "2026-03-18T00:00:00+00:00",
    }

    resp = client.post("/source-feed/articles/9901/topic", json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["topic"]["title"] == "学术论文条目"
    assert data["topic"]["category"] == "research"
    assert "- article_id: 9901" in data["topic"]["body"]
    assert "- 原文链接：https://arxiv.org/abs/2603.18916" in data["topic"]["body"]


def test_source_article_topic_endpoint_uses_generated_body(client, monkeypatch):
    import app.api.topics as topics_module

    async def fake_fetch_source_feed_article_detail(article_id: int):
        return SimpleNamespace(
            id=article_id,
            title="测试信源标题（topics）",
            source_feed_name="信息采集库",
            source_type="we-mp-rss",
            url="https://example.com/source-article-topics",
            pic_url=None,
            description="一条用于 /source-articles 路径的信源。",
            publish_time="2026-03-14 11:00:00",
            created_at="2026-03-14T11:00:00+00:00",
        )

    async def fake_hydrate_topic_workspace(topic_id: str, article_ids: list[int]):
        return {"topic_id": topic_id, "article_ids": article_ids, "written_files": []}

    async def fake_generate_topic_body(article: dict):
        return (
            "## 背景\n模型输出（topics endpoint）\n\n"
            "## 核心议题\n验证旧路由也接入新生成逻辑。\n\n"
            "## 为什么值得讨论\n减少模板化信息噪声。\n\n"
            "## 建议讨论问题\n"
            "1. 是否可复用到其他入口？\n"
            "2. 原文信息是否完整？\n"
            "3. 如何保证稳定性？\n\n"
            "## 原文信息\n"
            f"- article_id: {article['id']}\n"
            f"- 原文链接：{article['url']}\n"
        )

    monkeypatch.setattr(topics_module, "fetch_source_feed_article_detail", fake_fetch_source_feed_article_detail)
    monkeypatch.setattr(topics_module, "hydrate_topic_workspace", fake_hydrate_topic_workspace)
    monkeypatch.setattr(topics_module, "generate_topic_body_from_source_article", fake_generate_topic_body)

    resp = client.post("/source-articles/9101/topic")
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["topic"]["title"] == "测试信源标题（topics）"
    assert "这篇文章来自 信息采集库" in payload["topic"]["body"]
    assert "模型输出（topics endpoint）" not in payload["topic"]["body"]
    assert "- article_id: 9101" in payload["topic"]["body"]


def test_source_feed_articles_list_uses_short_ttl_cache(client, monkeypatch):
    import app.api.source_feed as source_feed_module

    calls = {"count": 0}

    class FakeResponse:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    class FakeHttpClient:
        async def get(self, url, params=None, timeout=6.0):
            calls["count"] += 1
            article_id = 1000 + calls["count"]
            return FakeResponse(
                {
                    "data": {
                        "list": [
                            {
                                "id": article_id,
                                "title": f"缓存文章-{article_id}",
                                "source_feed_name": "测试源",
                                "source_type": "rss",
                                "url": f"https://example.com/{article_id}",
                                "pic_url": None,
                                "description": "用于测试 source-feed 列表缓存",
                                "publish_time": "2026-03-14 10:00:00",
                                "created_at": "2026-03-14T10:00:00+00:00",
                            }
                        ],
                        "limit": int((params or {}).get("limit", 0)),
                        "offset": int((params or {}).get("offset", 0)),
                    }
                }
            )

    monkeypatch.setenv("SOURCE_FEED_LIST_CACHE_TTL_SECONDS", "30")
    source_feed_module._source_feed_list_cache.clear()
    monkeypatch.setattr(source_feed_module, "get_shared_async_client", lambda _: FakeHttpClient())

    first = client.get("/source-feed/articles?limit=5&offset=0")
    assert first.status_code == 200, first.text
    first_payload = first.json()
    assert calls["count"] == 1

    second = client.get("/source-feed/articles?limit=5&offset=0")
    assert second.status_code == 200, second.text
    second_payload = second.json()
    assert calls["count"] == 1
    assert second_payload["list"][0]["id"] == first_payload["list"][0]["id"]

    third = client.get("/source-feed/articles?limit=5&offset=5")
    assert third.status_code == 200, third.text
    assert calls["count"] == 2
    source_feed_module._source_feed_list_cache.clear()


def test_source_feed_articles_forwards_source_type_query_to_upstream(client, monkeypatch):
    import app.api.source_feed as source_feed_module

    seen_params: list[dict | None] = []

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "data": {
                    "list": [
                        {
                            "id": 42,
                            "title": "微信 RSS 文章",
                            "source_feed_name": "测试号",
                            "source_type": "we-mp-rss",
                            "url": "https://example.com/wx",
                            "pic_url": None,
                            "description": "",
                            "publish_time": "2026-03-14 10:00:00",
                            "created_at": "2026-03-14T10:00:00+00:00",
                        }
                    ],
                    "limit": 5,
                    "offset": 0,
                }
            }

    class FakeHttpClient:
        async def get(self, url, params=None, timeout=6.0):
            seen_params.append(dict(params) if params else None)
            return FakeResponse()

    monkeypatch.setenv("SOURCE_FEED_LIST_CACHE_TTL_SECONDS", "0")
    source_feed_module._source_feed_list_cache.clear()
    monkeypatch.setattr(source_feed_module, "get_shared_async_client", lambda _: FakeHttpClient())

    resp = client.get("/source-feed/articles?limit=5&offset=0&source_type=we-mp-rss")
    assert resp.status_code == 200, resp.text
    assert seen_params and seen_params[0] is not None
    assert seen_params[0].get("source_type") == "we-mp-rss"
    assert seen_params[0].get("limit") == 5
    assert seen_params[0].get("offset") == 0


def test_source_feed_articles_forwards_gqy_source_type_to_upstream(client, monkeypatch):
    import app.api.source_feed as source_feed_module

    seen_params: list[dict | None] = []

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"data": {"list": [], "limit": 5, "offset": 0}}

    class FakeHttpClient:
        async def get(self, url, params=None, timeout=6.0):
            seen_params.append(dict(params) if params else None)
            return FakeResponse()

    monkeypatch.setenv("SOURCE_FEED_LIST_CACHE_TTL_SECONDS", "0")
    source_feed_module._source_feed_list_cache.clear()
    monkeypatch.setattr(source_feed_module, "get_shared_async_client", lambda _: FakeHttpClient())

    resp = client.get("/source-feed/articles?limit=5&offset=0&source_type=gqy")
    assert resp.status_code == 200, resp.text
    assert seen_params and seen_params[0] is not None
    assert seen_params[0].get("source_type") == "gqy"


def test_discussion_and_mention_complete_via_executor(client, monkeypatch):
    monkeypatch.setattr(
        "app.api.topics.moderate_post_content",
        lambda body, scenario: asyncio.sleep(
            0,
            result=ModerationDecision(
                approved=True,
                reason="ok",
                suggestion="",
                category="safe",
            ),
        ),
    )

    topic = client.post("/topics", json={"title": "执行测试", "body": "验证异步任务"}).json()
    topic_id = topic["id"]

    experts = client.get(f"/topics/{topic_id}/experts")
    assert experts.status_code == 200, experts.text
    assert experts.json()[0]["name"] == "physicist"

    start = client.post(
        f"/topics/{topic_id}/discussion",
        json={"num_rounds": 1, "max_turns": 20, "max_budget_usd": 1.0},
    )
    assert start.status_code == 202

    deadline = time.time() + 3
    latest_status = None
    while time.time() < deadline:
        latest_status = client.get(f"/topics/{topic_id}/discussion/status")
        assert latest_status.status_code == 200
        payload = latest_status.json()
        if payload["status"] == "completed" and payload["result"]["discussion_summary"]:
            break
        time.sleep(0.1)
    assert latest_status is not None
    assert latest_status.json()["result"]["discussion_summary"].startswith("总结")

    mention = client.post(
        f"/topics/{topic_id}/posts/mention",
        json={"author": "alice", "body": "@physicist 请回答", "expert_name": "physicist"},
    )
    assert mention.status_code == 202, mention.text
    reply_id = mention.json()["reply_post_id"]

    deadline = time.time() + 3
    latest = None
    while time.time() < deadline:
        latest = client.get(f"/topics/{topic_id}/posts/mention/{reply_id}")
        assert latest.status_code == 200
        if latest.json()["status"] == "completed":
            break
        time.sleep(0.1)
    assert latest is not None
    assert latest.json()["body"] == "这是专家回复"


def test_post_delete_permissions_and_subtree_cascade(client):
    owner = register_and_login(client, phone="13800000002", username="owner")
    other = register_and_login(client, phone="13800000003", username="other")
    admin = register_and_login(client, phone="13800000001", username="admin")

    topic = client.post("/topics", json={"title": "删除测试", "body": "验证权限"}).json()
    topic_id = topic["id"]

    root_resp = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "owner", "body": "这是根帖，用来验证父级回复与整段讨论结构之间的关联。"},
        headers={"Authorization": f"Bearer {owner['token']}"},
    )
    assert root_resp.status_code == 201, root_resp.text
    root = root_resp.json()["post"]
    child_resp = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "owner", "body": "这是二级回复，用来验证嵌套回复关系会被完整识别。", "in_reply_to_id": root["id"]},
        headers={"Authorization": f"Bearer {owner['token']}"},
    )
    assert child_resp.status_code == 201, child_resp.text
    child = child_resp.json()["post"]
    grandchild_resp = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "owner", "body": "这是三级回复，用来验证更深层的回复链同样能被追踪。", "in_reply_to_id": child["id"]},
        headers={"Authorization": f"Bearer {owner['token']}"},
    )
    assert grandchild_resp.status_code == 201, grandchild_resp.text
    grandchild = grandchild_resp.json()["post"]

    forbidden = client.delete(
        f"/topics/{topic_id}/posts/{root['id']}",
        headers={"Authorization": f"Bearer {other['token']}"},
    )
    assert forbidden.status_code == 403

    deleted = client.delete(
        f"/topics/{topic_id}/posts/{root['id']}",
        headers={"Authorization": f"Bearer {owner['token']}"},
    )
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["deleted_count"] == 3
    assert client.get(f"/topics/{topic_id}/posts").json()["items"] == []

    admin_root_resp = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "owner", "body": "这是另一条根帖，用来验证管理员对完整回复树的管理能力。"},
        headers={"Authorization": f"Bearer {owner['token']}"},
    )
    assert admin_root_resp.status_code == 201, admin_root_resp.text
    admin_root = admin_root_resp.json()["post"]
    admin_child_resp = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "owner", "body": "这是对应的子级回复，用来验证管理员对嵌套结构的处理。", "in_reply_to_id": admin_root["id"]},
        headers={"Authorization": f"Bearer {owner['token']}"},
    )
    assert admin_child_resp.status_code == 201, admin_child_resp.text
    admin_child = admin_child_resp.json()["post"]

    admin_delete = client.delete(
        f"/topics/{topic_id}/posts/{admin_root['id']}",
        headers={"Authorization": f"Bearer {admin['token']}"},
    )
    assert admin_delete.status_code == 200, admin_delete.text
    assert admin_delete.json()["deleted_count"] == 2
    assert client.get(f"/topics/{topic_id}/posts").json()["items"] == []


def test_topic_delete_permissions(client):
    owner = register_and_login(client, phone="13800000002", username="owner")
    other = register_and_login(client, phone="13800000003", username="other")
    admin = register_and_login(client, phone="13800000001", username="admin")
    owner_topic = client.post(
        "/topics",
        json={"title": "权限测试", "body": "正文"},
        headers={"Authorization": f"Bearer {owner['token']}"},
    ).json()

    forbidden = client.delete(
        f"/topics/{owner_topic['id']}",
        headers={"Authorization": f"Bearer {other['token']}"},
    )
    assert forbidden.status_code == 403

    owner_deleted = client.delete(
        f"/topics/{owner_topic['id']}",
        headers={"Authorization": f"Bearer {owner['token']}"},
    )
    assert owner_deleted.status_code == 200, owner_deleted.text

    admin_topic = client.post(
        "/topics",
        json={"title": "管理员删除", "body": "正文"},
        headers={"Authorization": f"Bearer {owner['token']}"},
    ).json()
    deleted = client.delete(
        f"/topics/{admin_topic['id']}",
        headers={"Authorization": f"Bearer {admin['token']}"},
    )
    assert deleted.status_code == 200, deleted.text


def test_create_post_rejects_when_content_moderation_fails(client, monkeypatch):
    monkeypatch.setattr(
        "app.api.topics.moderate_post_content",
        lambda body, scenario: asyncio.sleep(
            0,
            result=ModerationDecision(
                approved=False,
                reason="包含人身攻击",
                suggestion="请删除辱骂内容后重试",
                category="abuse",
            ),
        ),
    )

    topic = client.post("/topics", json={"title": "审核测试", "body": "正文"}).json()
    response = client.post(f"/topics/{topic['id']}/posts", json={"author": "alice", "body": "你这个废物"})

    assert response.status_code == 400
    assert response.json() == {
        "detail": {
            "code": "content_moderation_rejected",
            "message": "内容审核未通过，请调整后再发布",
            "review_message": "包含人身攻击",
            "suggestion": "请删除辱骂内容后重试",
            "category": "abuse",
        }
    }


def test_mention_rejects_when_content_moderation_fails(client, monkeypatch):
    monkeypatch.setattr(
        "app.api.topics.moderate_post_content",
        lambda body, scenario: asyncio.sleep(
            0,
            result=ModerationDecision(
                approved=False,
                reason="疑似恶意骚扰",
                suggestion="请改为具体问题描述",
                category="abuse",
            ),
        ),
    )

    topic = client.post("/topics", json={"title": "审核测试", "body": "正文"}).json()
    response = client.post(
        f"/topics/{topic['id']}/posts/mention",
        json={"author": "alice", "body": "@physicist 你闭嘴", "expert_name": "physicist"},
    )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "content_moderation_rejected"
    assert response.json()["detail"]["review_message"] == "疑似恶意骚扰"


def test_internal_discussion_snapshot_push_updates_db(client):
    """POST /internal/discussion-snapshot/{topic_id} updates DB (used by Resonnet per-round sync)."""
    topic = client.post("/topics", json={"title": "快照推送", "body": "测试"}).json()
    topic_id = topic["id"]

    push = client.post(
        f"/internal/discussion-snapshot/{topic_id}",
        json={
            "turns": [
                {"turn_key": "round1_physicist", "round_num": 1, "expert_name": "physicist", "expert_label": "Physicist", "body": "第一轮观点"}
            ],
            "turns_count": 1,
            "discussion_history": "## Round 1 - Physicist\n\n第一轮观点",
            "discussion_summary": "",
            "generated_images": [],
        },
    )
    assert push.status_code == 204

    status = client.get(f"/topics/{topic_id}/discussion/status")
    assert status.status_code == 200
    payload = status.json()
    assert payload["status"] == "running"
    assert payload["result"]["turns_count"] == 1
    assert "第一轮观点" in (payload["result"].get("discussion_history") or "")

    # 404 for non-existent topic
    bad_push = client.post(
        "/internal/discussion-snapshot/nonexistent-id",
        json={"turns": [], "turns_count": 0, "discussion_history": "", "discussion_summary": "", "generated_images": []},
    )
    assert bad_push.status_code == 404


def test_discussion_status_syncs_running_turns_into_database(client):
    topic = client.post("/topics", json={"title": "实时状态", "body": "观察进行中 turn"}).json()
    topic_id = topic["id"]

    start = client.post(
        f"/topics/{topic_id}/discussion",
        json={"num_rounds": 1, "max_turns": 20, "max_budget_usd": 1.0},
    )
    assert start.status_code == 202

    deadline = time.time() + 3
    running_status = None
    while time.time() < deadline:
        running_status = client.get(f"/topics/{topic_id}/discussion/status")
        assert running_status.status_code == 200
        payload = running_status.json()
        if payload["status"] == "running" and payload["result"]["turns_count"] >= 1:
            break
        time.sleep(0.05)

    assert running_status is not None
    payload = running_status.json()
    assert payload["status"] in {"running", "completed"}
    assert payload["result"]["turns_count"] >= 1
    if payload["status"] == "running":
        assert payload["progress"]["completed_turns"] >= 1
        assert payload["progress"]["current_round"] == 1
        assert payload["progress"]["latest_speaker"] == "Physicist"


def test_discussion_timeout_failsafe_allows_mention(client):
    """After 45min timeout, stale running discussion is reset to failed; @mention is allowed."""
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import text

    from app.storage.database.postgres_client import get_db_session
    from app.storage.database.topic_store import set_discussion_status

    topic = client.post("/topics", json={"title": "超时测试", "body": "测试"}).json()
    topic_id = topic["id"]
    set_discussion_status(
        topic_id,
        "completed",
        turns_count=1,
        completed_at=datetime.now(timezone.utc).isoformat(),
        discussion_summary="已完成一次讨论",
        discussion_history="## Round 1\n\n已完成",
    )
    # Set topic and run to "running" with old updated_at (simulate stuck discussion)
    old_time = (datetime.now(timezone.utc) - timedelta(minutes=46)).isoformat()
    with get_db_session() as session:
        session.execute(
            text("""
                INSERT INTO discussion_runs (topic_id, status, turns_count, updated_at, discussion_summary, discussion_history)
                VALUES (:id, 'running', 0, :t, '', '')
                ON CONFLICT (topic_id) DO UPDATE SET status = 'running', updated_at = :t
            """),
            {"t": old_time, "id": topic_id},
        )
        session.execute(
            text("UPDATE topics SET discussion_status = 'running', updated_at = :t WHERE id = :id"),
            {"t": old_time, "id": topic_id},
        )

    # get_discussion_status should reset and return failed
    status = client.get(f"/topics/{topic_id}/discussion/status")
    assert status.status_code == 200
    assert status.json()["status"] == "failed"

    # @mention should succeed (no longer blocked)
    mention = client.post(
        f"/topics/{topic_id}/posts/mention",
        json={"author": "测试", "body": "请问专家", "expert_name": "physicist"},
    )
    assert mention.status_code == 202


def test_topic_detail_related_proxy_bootstraps_workspace_on_demand(client):
    topic = client.post("/topics", json={"title": "旧话题", "body": "无 workspace"}).json()
    topic_id = topic["id"]

    experts = client.get(f"/topics/{topic_id}/experts")
    assert experts.status_code == 200, experts.text
    assert experts.json()[0]["name"] == "physicist"

    mode = client.get(f"/topics/{topic_id}/moderator-mode")
    assert mode.status_code == 200, mode.text
    assert mode.json()["mode_id"] == "standard"


def test_discussion_generated_image_is_served_from_database_after_workspace_file_removed(client):
    topic = client.post("/topics", json={"title": "图片入库", "body": "验证图片"}).json()
    topic_id = topic["id"]

    start = client.post(
        f"/topics/{topic_id}/discussion",
        json={"num_rounds": 1, "max_turns": 20, "max_budget_usd": 1.0},
    )
    assert start.status_code == 202

    deadline = time.time() + 3
    latest_status = None
    while time.time() < deadline:
        latest_status = client.get(f"/topics/{topic_id}/discussion/status")
        assert latest_status.status_code == 200
        payload = latest_status.json()
        if payload["status"] == "completed" and payload["result"]["discussion_summary"]:
            break
        time.sleep(0.1)
    assert latest_status is not None
    assert latest_status.json()["result"]["discussion_summary"]
    generated_path = client.app.state.workspace_base / "topics" / topic_id / "shared" / "generated_images" / "round1.png"
    assert generated_path.exists()
    generated_path.unlink()

    image = client.get(f"/topics/{topic_id}/assets/generated_images/round1.png")
    assert image.status_code == 200, image.text
    assert image.headers["content-type"] == "image/webp"
    assert image.content

    preview = client.get(f"/topics/{topic_id}/assets/generated_images/round1.png?w=16&h=16&q=80")
    assert preview.status_code == 200, preview.text
    assert preview.headers["content-type"] == "image/webp"
    assert preview.content


def test_api_v1_topics_alias_and_home_payload(client, monkeypatch):
    create = client.post("/api/v1/topics", json={"title": "开放 API 讨论", "body": "验证 /api/v1 路径", "category": "thought"})
    assert create.status_code == 201, create.text
    topic_id = create.json()["id"]

    post = client.post(
        f"/api/v1/topics/{topic_id}/posts",
        json={"author": "alice", "body": "这是一条通过 /api/v1 发布的完整讨论帖子，用来验证发帖链路。"},
    )
    assert post.status_code == 201, post.text
    post_payload = post.json()
    assert post_payload["post"]["body"] == "这是一条通过 /api/v1 发布的完整讨论帖子，用来验证发帖链路。"
    reply = client.post(
        f"/api/v1/topics/{topic_id}/posts",
        json={
            "author": "bob",
            "body": "这是一条回帖，用来验证统计。",
            "in_reply_to_id": post_payload["post"]["id"],
        },
    )
    assert reply.status_code == 201, reply.text

    from app.storage.database.postgres_client import get_db_session

    with get_db_session() as session:
        session.execute(
            text(
                """
                INSERT INTO topic_user_actions (topic_id, user_id, auth_type, liked, favorited)
                VALUES (:topic_id, :user_id, :auth_type, TRUE, TRUE)
                """
            ),
            {"topic_id": topic_id, "user_id": 1001, "auth_type": "test"},
        )
        session.execute(
            text(
                """
                INSERT INTO post_user_actions (post_id, topic_id, user_id, auth_type, liked)
                VALUES (:post_id, :topic_id, :user_id, :auth_type, TRUE)
                """
            ),
            {"post_id": post_payload["post"]["id"], "topic_id": topic_id, "user_id": 1002, "auth_type": "test"},
        )

    home = client.get("/api/v1/home")
    assert home.status_code == 200, home.text
    payload = home.json()
    assert payload["latest_topics"][0]["id"] == topic_id
    assert payload["latest_topics"][0]["category"] == "thought"
    assert payload["available_categories"][0]["id"] == "plaza"
    assert payload["category_profiles_overview"][0]["profile_id"] == "community_dialogue"
    assert payload["quick_links"]["topics"] == "/api/v1/topics"
    assert payload["quick_links"]["topic_categories"] == "/api/v1/topics/categories"
    assert payload["quick_links"]["topic_category_profile_template"] == "/api/v1/topics/categories/{category_id}/profile"
    assert payload["quick_links"]["source_feed_articles"] == "/api/v1/source-feed/articles"
    assert payload["site_stats"]["topics_count"] >= 1
    assert payload["site_stats"]["openclaw_count"] >= 0
    assert payload["site_stats"]["replies_count"] >= 1
    assert payload["site_stats"]["likes_count"] >= 2
    assert payload["site_stats"]["favorites_count"] >= 1
    assert payload["site_stats"]["skills_count"] >= 1
    assert "source_feed_preview" not in payload
    assert payload["what_to_do_next"]

    filtered_home = client.get("/api/v1/home?category=thought")
    assert filtered_home.status_code == 200, filtered_home.text
    assert filtered_home.json()["selected_category"] == "thought"
    assert filtered_home.json()["latest_topics"][0]["id"] == topic_id

    profile_resp = client.get("/api/v1/topics/categories/research/profile")
    assert profile_resp.status_code == 200, profile_resp.text
    profile = profile_resp.json()
    assert profile["profile_id"] == "research_review"
    assert profile["category_name"] == "科研"
    assert profile["evidence_requirement"] == "high"
    assert "局限" in profile["output_structure"][2]


def test_openclaw_home_site_stats_are_cached(client, monkeypatch):
    import app.api.openclaw as openclaw_module

    openclaw_module._site_stats_cache["value"] = None
    openclaw_module._site_stats_cache["expires_at"] = 0.0

    load_calls = {"count": 0}

    def fake_load_site_stats():
        load_calls["count"] += 1
        return {
            "topics_count": 5,
            "openclaw_count": 2,
            "replies_count": 7,
            "likes_count": 11,
            "favorites_count": 13,
            "skills_count": 17,
        }

    monkeypatch.setattr(openclaw_module, "_load_site_stats", fake_load_site_stats)

    first = client.get("/api/v1/home")
    second = client.get("/api/v1/home")

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json()["site_stats"] == second.json()["site_stats"]
    assert first.json()["site_stats"]["topics_count"] == 5
    assert first.json()["site_stats"]["skills_count"] == 17
    assert load_calls["count"] == 1


def test_openclaw_key_can_bind_user_identity_and_render_personal_skill(client):
    from app.storage.database.postgres_client import get_db_session

    phone = f"138{int(time.time() * 1000) % 100000000:08d}"
    hashed_password = bcrypt.hashpw("password123".encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    with get_db_session() as session:
        session.execute(
            text(
                """
                INSERT INTO users (phone, password, username, handle)
                VALUES (:phone, :password, :username, :handle)
                """
            ),
            {
                "phone": phone,
                "password": hashed_password,
                "username": "openclaw-user",
                "handle": "user_openclaw_test",
            },
        )

    login = client.post(
        "/api/v1/auth/login",
        json={"phone": phone, "password": "password123"},
    )
    assert login.status_code == 200, login.text
    jwt_token = login.json()["token"]

    key_resp = client.post(
        "/api/v1/auth/openclaw-key",
        headers={"Authorization": f"Bearer {jwt_token}"},
    )
    assert key_resp.status_code == 200, key_resp.text
    key_payload = key_resp.json()
    raw_key = key_payload["key"]
    bind_key = key_payload["bind_key"]
    assert raw_key.startswith("tloc_")
    assert bind_key.startswith("tlos_")
    assert "/api/v1/openclaw/skill.md?key=" in key_payload["skill_path"]
    assert "/api/v1/openclaw/bootstrap?key=" in key_payload["bootstrap_path"]
    assert raw_key not in key_payload["skill_path"]
    assert raw_key not in key_payload["bootstrap_path"]

    skill_resp = client.get(key_payload["skill_path"])
    assert skill_resp.status_code == 200, skill_resp.text
    assert "除了读取当前 skill，本 skill 不提供任何 API 访问方式" in skill_resp.text
    assert "/api/v1/auth/openclaw-guest" in skill_resp.text
    assert "curl -fsSL" in skill_resp.text
    assert "## 二、核心文件只写摘要" in skill_resp.text
    assert "`AGENTS.md`" in skill_resp.text
    assert "`TOOLS.md`" in skill_resp.text
    assert "ask agent" in skill_resp.text
    assert raw_key not in skill_resp.text
    assert "完整 API 清单" not in skill_resp.text

    home_resp = client.get("/api/v1/home?include_source_preview=false", headers={"Authorization": f"Bearer {raw_key}"})
    assert home_resp.status_code == 200, home_resp.text
    assert home_resp.json()["your_account"]["authenticated"] is True
    assert home_resp.json()["your_account"]["username"] == "openclaw-user"
    assert home_resp.json()["site_stats"]["openclaw_count"] >= 1

    topic_resp = client.post(
        "/api/v1/topics",
        headers={"Authorization": f"Bearer {raw_key}"},
        json={"title": "绑定身份", "body": "验证发帖作者"},
    )
    assert topic_resp.status_code == 201, topic_resp.text
    topic = topic_resp.json()
    assert topic["creator_name"] == "openclaw-user's openclaw"
    assert topic["creator_auth_type"] == "openclaw_key"
    topic_id = topic["id"]
    post_resp = client.post(
        f"/api/v1/topics/{topic_id}/posts",
        headers={"Authorization": f"Bearer {raw_key}"},
        json={"author": "spoofed-author", "body": "这条帖子应该归属 openclaw-user"},
    )
    assert post_resp.status_code == 201, post_resp.text
    created_post = post_resp.json()["post"]
    assert created_post["author"] == "openclaw-user's openclaw"

    # 回帖：用 openclaw key 无需登录，作者显示为 xxx's openclaw
    reply_resp = client.post(
        f"/api/v1/topics/{topic_id}/posts",
        headers={"Authorization": f"Bearer {raw_key}"},
        json={"author": "ignored", "body": "这是 openclaw 回帖", "in_reply_to_id": created_post["id"]},
    )
    assert reply_resp.status_code == 201, reply_resp.text
    reply_post = reply_resp.json()["post"]
    assert reply_post["author"] == "openclaw-user's openclaw"
    assert reply_post["in_reply_to_id"] == created_post["id"]

    # 先删回复再删根帖
    client.delete(f"/api/v1/topics/{topic_id}/posts/{reply_post['id']}", headers={"Authorization": f"Bearer {raw_key}"})
    delete_resp = client.delete(
        f"/api/v1/topics/{topic_id}/posts/{created_post['id']}",
        headers={"Authorization": f"Bearer {raw_key}"},
    )
    assert delete_resp.status_code == 200, delete_resp.text
    assert delete_resp.json()["ok"] is True
    posts_after_delete = client.get(f"/api/v1/topics/{topic_id}/posts")
    assert posts_after_delete.status_code == 200, posts_after_delete.text
    assert posts_after_delete.json()["items"] == []


def test_openclaw_bootstrap_and_renew_return_runtime_key(client):
    auth = register_login_and_openclaw_key(client, phone="13800009990", username="bootstrap-user")

    bootstrap_resp = client.get(auth["bootstrap_path"])
    assert bootstrap_resp.status_code == 200, bootstrap_resp.text
    bootstrap_payload = bootstrap_resp.json()
    assert bootstrap_payload["bind_key"] == auth["bind_key"]
    assert bootstrap_payload["access_token"] == auth["openclaw_key"]
    assert bootstrap_payload["skill_url"] == auth["skill_path"]
    assert bootstrap_payload["refresh_strategy"] == "renew_with_bind_key"
    assert bootstrap_resp.headers["Cache-Control"] == "no-store"

    renew_resp = client.post(
        "/api/v1/openclaw/session/renew",
        headers={"Authorization": f"Bearer {auth['bind_key']}"},
    )
    assert renew_resp.status_code == 200, renew_resp.text
    renew_payload = renew_resp.json()
    assert renew_payload["bind_key"] == auth["bind_key"]
    assert renew_payload["access_token"] == auth["openclaw_key"]
    assert renew_payload["skill_url"] == auth["skill_path"]


def test_openclaw_bootstrap_and_renew_include_ask_agent_config_when_configured(client, monkeypatch):
    monkeypatch.setenv("OPENCLAW_ASK_AGENT_URL", "https://494qvb9q2p.coze.site/stream_run")
    monkeypatch.setenv("OPENCLAW_ASK_AGENT_TOKEN", "agent_token")
    monkeypatch.setenv("OPENCLAW_ASK_PROJECT_ID", "project_123")
    monkeypatch.setenv("OPENCLAW_ASK_SESSION_ID", "session_456")

    auth = register_login_and_openclaw_key(client, phone="13800009989", username="bootstrap-user-2")

    bootstrap_resp = client.get(auth["bootstrap_path"])
    assert bootstrap_resp.status_code == 200, bootstrap_resp.text
    bootstrap_payload = bootstrap_resp.json()
    assert bootstrap_payload["ask_agent"] == {
        "agent_url": "https://494qvb9q2p.coze.site/stream_run",
        "agent_token": "agent_token",
        "project_id": "project_123",
        "session_id": "session_456",
    }

    renew_resp = client.post(
        "/api/v1/openclaw/session/renew",
        headers={"Authorization": f"Bearer {auth['bind_key']}"},
    )
    assert renew_resp.status_code == 200, renew_resp.text
    renew_payload = renew_resp.json()
    assert renew_payload["ask_agent"] == bootstrap_payload["ask_agent"]


def test_openclaw_guest_bootstrap_returns_claim_links_and_guest_twin(client):
    guest_resp = client.post("/api/v1/auth/openclaw-guest")
    assert guest_resp.status_code == 200, guest_resp.text
    guest = guest_resp.json()
    assert guest["is_guest"] is True
    assert guest["key"].startswith("tloc_")
    assert guest["bind_key"].startswith("tlos_")
    assert guest["claim_token"].startswith("oc_claim_")
    assert guest["claim_register_path"].startswith("/register?openclaw_claim=")
    assert guest["claim_login_path"].startswith("/login?openclaw_claim=")

    skill_resp = client.get(guest["skill_path"])
    assert skill_resp.status_code == 200, skill_resp.text
    assert "## 临时账号升级" in skill_resp.text
    assert "可以先直接稳定使用当前 TopicLab CLI" in skill_resp.text
    assert f"http://testserver{guest['claim_register_path']}" in skill_resp.text
    assert f"http://testserver{guest['claim_login_path']}" in skill_resp.text

    twin_resp = client.get(
        "/api/v1/openclaw/twins/current",
        headers={"Authorization": f"Bearer {guest['key']}"},
    )
    assert twin_resp.status_code == 200, twin_resp.text
    twin_payload = twin_resp.json()
    assert twin_payload["twin"]["display_name"].startswith("OpenClaw Guest")


def test_openclaw_guest_claim_on_register_preserves_identity_and_rebinds_account(client):
    guest_resp = client.post("/api/v1/auth/openclaw-guest")
    assert guest_resp.status_code == 200, guest_resp.text
    guest = guest_resp.json()

    topic_resp = client.post(
        "/api/v1/topics",
        headers={"Authorization": f"Bearer {guest['key']}"},
        json={"title": "guest topic", "body": "guest body"},
    )
    assert topic_resp.status_code == 201, topic_resp.text
    topic_payload = topic_resp.json()
    topic_id = topic_payload["id"]
    assert topic_payload["creator_name"].startswith("OpenClaw Guest")

    from app.storage.database.postgres_client import get_db_session

    claim_phone = "13800009989"
    with get_db_session() as session:
        session.execute(
            text(
                """
                INSERT INTO verification_codes (phone, code, type, expires_at)
                VALUES (:phone, :code, 'register', :expires_at)
                """
            ),
            {
                "phone": claim_phone,
                "code": "123456",
                "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5),
            },
        )

    register_resp = client.post(
        "/auth/register",
        json={
            "phone": claim_phone,
            "code": "123456",
            "password": "password123",
            "username": "claimed-user",
            "claim_token": guest["claim_token"],
        },
    )
    assert register_resp.status_code == 200, register_resp.text
    register_payload = register_resp.json()
    assert register_payload["claim_status"] == "claimed"

    home_resp = client.get(
        "/api/v1/home?include_source_preview=false",
        headers={"Authorization": f"Bearer {guest['key']}"},
    )
    assert home_resp.status_code == 200, home_resp.text
    home_payload = home_resp.json()
    assert home_payload["your_account"]["username"] == "claimed-user"

    claimed_topic = client.get(f"/api/v1/topics/{topic_id}", headers={"Authorization": f"Bearer {guest['key']}"})
    assert claimed_topic.status_code == 200, claimed_topic.text
    assert claimed_topic.json()["creator_name"] == "claimed-user's openclaw"

    me_resp = client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {register_payload['token']}"},
    )
    assert me_resp.status_code == 200, me_resp.text
    assert me_resp.json()["user"]["is_guest"] is False

    with get_db_session() as session:
        topic_row = session.execute(
            text("SELECT creator_user_id, creator_name FROM topics WHERE id = :id"),
            {"id": topic_id},
        ).fetchone()
        agent_row = session.execute(
            text(
                """
                SELECT a.bound_user_id, a.display_name
                FROM openclaw_agents a
                WHERE a.agent_uid = :agent_uid
                """
            ),
            {"agent_uid": guest["agent_uid"]},
        ).fetchone()
    assert topic_row.creator_name == "claimed-user's openclaw"
    assert topic_row.creator_user_id == register_payload["user"]["id"]
    assert agent_row.bound_user_id == register_payload["user"]["id"]
    assert agent_row.display_name == "claimed-user's openclaw"


def test_openclaw_renew_rejects_runtime_key(client):
    auth = register_login_and_openclaw_key(client, phone="13800009991", username="renew-guard-user")

    renew_resp = client.post(
        "/api/v1/openclaw/session/renew",
        headers={"Authorization": f"Bearer {auth['openclaw_key']}"},
    )
    assert renew_resp.status_code == 401, renew_resp.text
    assert renew_resp.headers.get("X-OpenClaw-Auth-Recovery") == "reload_skill_url"


def test_openclaw_key_creates_primary_agent_and_home_summary(client):
    auth = register_login_and_openclaw_key(client, phone="13800009996", username="summary-user")

    home_resp = client.get(
        "/api/v1/home",
        headers={"Authorization": f"Bearer {auth['openclaw_key']}"},
    )
    assert home_resp.status_code == 200, home_resp.text
    account = home_resp.json()["your_account"]
    assert account["authenticated"] is True
    assert account["username"] == "summary-user"
    assert account["openclaw_agent"]["agent_uid"] == auth["agent_uid"]
    assert account["openclaw_agent"]["display_name"] == "summary-user's openclaw"
    assert account["points_balance"] == 0

    me_resp = client.get(
        "/api/v1/openclaw/agents/me",
        headers={"Authorization": f"Bearer {auth['openclaw_key']}"},
    )
    assert me_resp.status_code == 200, me_resp.text
    payload = me_resp.json()
    assert payload["agent"]["agent_uid"] == auth["agent_uid"]
    assert payload["agent"]["is_primary"] is True
    assert payload["wallet"]["balance"] == 0


def test_openclaw_events_and_points_are_recorded_for_core_actions(client):
    auth = register_login_and_openclaw_key(client, phone="13800009997", username="event-user")
    raw_key = auth["openclaw_key"]

    topic_resp = client.post(
        "/api/v1/openclaw/topics",
        headers={"Authorization": f"Bearer {raw_key}"},
        json={"title": "事件开题", "body": "验证事件和积分"},
    )
    assert topic_resp.status_code == 201, topic_resp.text
    topic_id = topic_resp.json()["id"]

    post_resp = client.post(
        f"/api/v1/openclaw/topics/{topic_id}/posts",
        headers={"Authorization": f"Bearer {raw_key}"},
        json={"body": "验证回帖积分"},
    )
    assert post_resp.status_code == 201, post_resp.text

    wallet_resp = client.get(
        f"/api/v1/openclaw/agents/{auth['agent_uid']}/wallet",
        headers={"Authorization": f"Bearer {auth['token']}"},
    )
    assert wallet_resp.status_code == 200, wallet_resp.text
    wallet = wallet_resp.json()
    assert wallet["balance"] == 2
    assert wallet["lifetime_earned"] == 2

    ledger_resp = client.get(
        f"/api/v1/openclaw/agents/{auth['agent_uid']}/points/ledger",
        headers={"Authorization": f"Bearer {auth['token']}"},
    )
    assert ledger_resp.status_code == 200, ledger_resp.text
    ledger_items = ledger_resp.json()["items"]
    reason_codes = {item["reason_code"] for item in ledger_items}
    assert "topic.created" in reason_codes
    assert "post.created" in reason_codes

    admin = admin_panel_login(client)
    events_resp = client.get(
        f"/admin/openclaw/agents/{auth['agent_uid']}/events",
        headers={"Authorization": f"Bearer {admin['token']}"},
    )
    assert events_resp.status_code == 200, events_resp.text
    event_types = {item["event_type"] for item in events_resp.json()["items"]}
    assert "auth.key_created" in event_types
    assert "topic.created" in event_types
    assert "post.created" in event_types


def test_openclaw_home_reply_stats_include_openclaw_top_level_posts(client):
    import app.api.openclaw as openclaw_module

    from app.storage.database.postgres_client import get_db_session

    openclaw_module._site_stats_cache["value"] = None
    openclaw_module._site_stats_cache["expires_at"] = 0.0

    phone = f"139{int(time.time() * 1000) % 100000000:08d}"
    hashed_password = bcrypt.hashpw("password123".encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    with get_db_session() as session:
        session.execute(
            text(
                """
                INSERT INTO users (phone, password, username, handle)
                VALUES (:phone, :password, :username, :handle)
                """
            ),
            {
                "phone": phone,
                "password": hashed_password,
                "username": "openclaw-stats-user",
                "handle": "openclaw_stats_user",
            },
        )

    login = client.post(
        "/api/v1/auth/login",
        json={"phone": phone, "password": "password123"},
    )
    assert login.status_code == 200, login.text
    jwt_token = login.json()["token"]

    key_resp = client.post(
        "/api/v1/auth/openclaw-key",
        headers={"Authorization": f"Bearer {jwt_token}"},
    )
    assert key_resp.status_code == 200, key_resp.text
    raw_key = key_resp.json()["key"]

    topic_resp = client.post(
        "/api/v1/topics",
        json={"title": "统计口径验证", "body": "用于验证 OpenClaw 跟帖是否计入回帖数量"},
    )
    assert topic_resp.status_code == 201, topic_resp.text
    topic_id = topic_resp.json()["id"]

    post_resp = client.post(
        f"/api/v1/openclaw/topics/{topic_id}/posts",
        headers={"Authorization": f"Bearer {raw_key}"},
        json={"body": "这是 OpenClaw 发表的一条顶层跟帖"},
    )
    assert post_resp.status_code == 201, post_resp.text

    openclaw_module._site_stats_cache["value"] = None
    openclaw_module._site_stats_cache["expires_at"] = 0.0

    home_resp = client.get("/api/v1/home")
    assert home_resp.status_code == 200, home_resp.text
    assert home_resp.json()["site_stats"]["replies_count"] >= 1


def test_admin_openclaw_points_adjust_suspend_and_restore(client):
    auth = register_login_and_openclaw_key(client, phone="13800009998", username="admin-openclaw-user")
    admin = admin_panel_login(client)

    adjust_resp = client.post(
        f"/admin/openclaw/agents/{auth['agent_uid']}/points/adjust",
        headers={"Authorization": f"Bearer {admin['token']}"},
        json={"delta": 9, "note": "manual reward"},
    )
    assert adjust_resp.status_code == 200, adjust_resp.text
    assert adjust_resp.json()["wallet"]["balance"] == 9
    assert adjust_resp.json()["ledger"]["reason_code"] == "admin.adjust"

    suspend_resp = client.post(
        f"/admin/openclaw/agents/{auth['agent_uid']}/suspend",
        headers={"Authorization": f"Bearer {admin['token']}"},
        json={"reason": "policy check"},
    )
    assert suspend_resp.status_code == 200, suspend_resp.text
    assert suspend_resp.json()["agent"]["status"] == "suspended"

    blocked_topic = client.post(
        "/api/v1/openclaw/topics",
        headers={"Authorization": f"Bearer {auth['openclaw_key']}"},
        json={"title": "should fail", "body": "suspended"},
    )
    assert blocked_topic.status_code == 401, blocked_topic.text

    restore_resp = client.post(
        f"/admin/openclaw/agents/{auth['agent_uid']}/restore",
        headers={"Authorization": f"Bearer {admin['token']}"},
    )
    assert restore_resp.status_code == 200, restore_resp.text
    assert restore_resp.json()["agent"]["status"] == "active"

    allowed_topic = client.post(
        "/api/v1/openclaw/topics",
        headers={"Authorization": f"Bearer {auth['openclaw_key']}"},
        json={"title": "restored", "body": "allowed again"},
    )
    assert allowed_topic.status_code == 201, allowed_topic.text

    events_resp = client.get(
        f"/admin/openclaw/events?agent_uid={auth['agent_uid']}",
        headers={"Authorization": f"Bearer {admin['token']}"},
    )
    assert events_resp.status_code == 200, events_resp.text
    event_types = {item["event_type"] for item in events_resp.json()["items"]}
    assert "admin.points_adjusted" in event_types
    assert "admin.agent_suspended" in event_types
    assert "admin.agent_restored" in event_types


def test_openclaw_dedicated_routes_require_openclaw_key_reject_jwt(client):
    """OpenClaw dedicated routes reject JWT; only accept tloc_ key."""
    user = register_and_login(client, phone="13800009991", username="jwt-user")
    topic_resp = client.post(
        "/api/v1/openclaw/topics",
        headers={"Authorization": f"Bearer {user['token']}"},
        json={"title": "JWT 开题", "body": "应被拒绝"},
    )
    assert topic_resp.status_code == 401, topic_resp.text
    assert "OpenClaw key" in topic_resp.json().get("detail", "")


def test_openclaw_invalid_key_rejected_on_general_routes(client):
    """General routes reject invalid OpenClaw key (tloc_xxx) with 401 instead of anonymous."""
    topic_resp = client.post(
        "/api/v1/topics",
        headers={"Authorization": "Bearer tloc_invalid_key_12345"},
        json={"title": "无效 key 开题", "body": "应被拒绝"},
    )
    assert topic_resp.status_code == 401, topic_resp.text
    assert "OpenClaw" in topic_resp.json().get("detail", "")
    assert topic_resp.headers.get("X-OpenClaw-Auth-Error") == "key_invalid_or_expired"
    assert topic_resp.headers.get("X-OpenClaw-Auth-Recovery") == "reload_skill_url"


def test_openclaw_dedicated_routes_require_openclaw_key(client):
    """OpenClaw dedicated routes no longer allow anonymous writes."""
    topic_resp = client.post(
        "/api/v1/openclaw/topics",
        json={"title": "匿名开题", "body": "无需绑定真人用户"},
    )
    assert topic_resp.status_code == 401, topic_resp.text
    assert "OpenClaw key required" in topic_resp.json().get("detail", "")

    post_resp = client.post(
        "/api/v1/openclaw/topics/topic_x/posts",
        json={"body": "匿名 openclaw 回帖"},
    )
    assert post_resp.status_code == 401, post_resp.text
    assert "OpenClaw key required" in post_resp.json().get("detail", "")


def test_openclaw_dedicated_routes_create_topic_and_post(client):
    """OpenClaw dedicated routes create topic/post with OpenClaw key; author derived from user."""
    auth = register_login_and_openclaw_key(client, phone="13800009992", username="dedicated-user")
    raw_key = auth["openclaw_key"]

    topic_resp = client.post(
        "/api/v1/openclaw/topics",
        headers={"Authorization": f"Bearer {raw_key}"},
        json={"title": "专用路由开题", "body": "正文", "category": "plaza"},
    )
    assert topic_resp.status_code == 201, topic_resp.text
    topic = topic_resp.json()
    assert topic["creator_name"] == "dedicated-user's openclaw"
    assert topic["creator_auth_type"] == "openclaw_key"
    assert topic["creator_openclaw_agent_id"] is not None
    assert topic["openclaw_agent"]["agent_uid"] == auth["agent_uid"]
    topic_id = topic["id"]

    post_resp = client.post(
        f"/api/v1/openclaw/topics/{topic_id}/posts",
        headers={"Authorization": f"Bearer {raw_key}"},
        json={"body": "专用路由发帖，无 author 字段"},
    )
    assert post_resp.status_code == 201, post_resp.text
    created_post = post_resp.json()["post"]
    assert created_post["author"] == "dedicated-user's openclaw"
    assert created_post["owner_auth_type"] == "openclaw_key"
    assert created_post["owner_openclaw_agent_id"] == topic["creator_openclaw_agent_id"]
    assert post_resp.json()["openclaw_agent"]["agent_uid"] == auth["agent_uid"]


def test_mention_requires_completed_discussion_on_general_and_openclaw_routes(client):
    from app.storage.database.topic_store import set_discussion_status

    auth = register_login_and_openclaw_key(client, phone="13800009989", username="mention-guard-user")

    topic = client.post("/topics", json={"title": "需要先完成 discussion", "body": "验证 @mention 前置条件"}).json()
    topic_id = topic["id"]

    general_resp = client.post(
        f"/topics/{topic_id}/posts/mention",
        json={"author": "alice", "body": "@physicist 请回答", "expert_name": "physicist"},
    )
    assert general_resp.status_code == 409, general_resp.text
    assert "complete at least once" in general_resp.json()["detail"]

    dedicated_resp = client.post(
        f"/api/v1/openclaw/topics/{topic_id}/posts/mention",
        headers={"Authorization": f"Bearer {auth['openclaw_key']}"},
        json={"body": "@physicist 请回答", "expert_name": "physicist"},
    )
    assert dedicated_resp.status_code == 409, dedicated_resp.text
    assert "complete at least once" in dedicated_resp.json()["detail"]

    set_discussion_status(
        topic_id,
        "completed",
        turns_count=1,
        completed_at=datetime.now(timezone.utc).isoformat(),
        discussion_summary="讨论完成",
        discussion_history="## Round 1\n\n讨论完成",
    )

    allowed_resp = client.post(
        f"/api/v1/openclaw/topics/{topic_id}/posts/mention",
        headers={"Authorization": f"Bearer {auth['openclaw_key']}"},
        json={"body": "@physicist 现在可以回答", "expert_name": "physicist"},
    )
    assert allowed_resp.status_code == 202, allowed_resp.text


def test_openclaw_comment_media_upload_returns_markdown_url_for_image(client, monkeypatch):
    import app.api.openclaw_routes as openclaw_routes_module

    auth = register_login_and_openclaw_key(client, phone="13800009993", username="media-image-user")
    topic_resp = client.post(
        "/api/v1/openclaw/topics",
        headers={"Authorization": f"Bearer {auth['openclaw_key']}"},
        json={"title": "上传图片", "body": "测试图片上传"},
    )
    assert topic_resp.status_code == 201, topic_resp.text
    topic_id = topic_resp.json()["id"]

    image = Image.new("RGB", (20, 10), color=(120, 80, 200))
    buf = BytesIO()
    image.save(buf, format="PNG")

    def fake_upload_comment_media_to_oss(*, topic_id: str, filename: str, content_type: str | None, payload: bytes) -> dict:
        assert topic_id
        assert filename == "comment.png"
        assert content_type == "image/png"
        assert payload
        return {
            "url": "https://topiclab-comment-media.oss-cn-beijing.aliyuncs.com/openclaw-comments/test.webp",
            "markdown": "![comment](https://topiclab-comment-media.oss-cn-beijing.aliyuncs.com/openclaw-comments/test.webp)",
            "object_key": "openclaw-comments/test.webp",
            "content_type": "image/webp",
            "media_type": "image",
            "width": 20,
            "height": 10,
            "size_bytes": 1234,
        }

    monkeypatch.setattr(openclaw_routes_module, "upload_comment_media_to_oss", fake_upload_comment_media_to_oss)

    upload_resp = client.post(
        f"/api/v1/openclaw/topics/{topic_id}/media",
        headers={"Authorization": f"Bearer {auth['openclaw_key']}"},
        files={"file": ("comment.png", buf.getvalue(), "image/png")},
    )
    assert upload_resp.status_code == 200, upload_resp.text
    payload = upload_resp.json()
    assert payload["url"].endswith(".webp")
    assert payload["markdown"].startswith("![comment](")
    assert payload["content_type"] == "image/webp"
    assert payload["media_type"] == "image"
    assert payload["width"] == 20
    assert payload["height"] == 10


def test_openclaw_comment_image_alias_forwards_to_media_upload(client, monkeypatch):
    import app.api.openclaw_routes as openclaw_routes_module

    auth = register_login_and_openclaw_key(client, phone="13800009988", username="media-alias-user")
    topic_resp = client.post(
        "/api/v1/openclaw/topics",
        headers={"Authorization": f"Bearer {auth['openclaw_key']}"},
        json={"title": "上传图片别名", "body": "测试 /images 别名"},
    )
    assert topic_resp.status_code == 201, topic_resp.text
    topic_id = topic_resp.json()["id"]

    image = Image.new("RGB", (16, 12), color=(10, 20, 30))
    buf = BytesIO()
    image.save(buf, format="PNG")

    def fake_upload_comment_media_to_oss(*, topic_id: str, filename: str, content_type: str | None, payload: bytes) -> dict:
        assert topic_id
        assert filename == "alias.png"
        assert content_type == "image/png"
        assert payload
        return {
            "url": "/api/v1/openclaw/media/openclaw-comments/test.webp",
            "markdown": "![alias](/api/v1/openclaw/media/openclaw-comments/test.webp)",
            "object_key": "openclaw-comments/test.webp",
            "content_type": "image/webp",
            "media_type": "image",
            "width": 16,
            "height": 12,
            "size_bytes": 321,
        }

    monkeypatch.setattr(openclaw_routes_module, "upload_comment_media_to_oss", fake_upload_comment_media_to_oss)

    upload_resp = client.post(
        f"/api/v1/openclaw/topics/{topic_id}/images",
        headers={"Authorization": f"Bearer {auth['openclaw_key']}"},
        files={"file": ("alias.png", buf.getvalue(), "image/png")},
    )
    assert upload_resp.status_code == 200, upload_resp.text
    payload = upload_resp.json()
    assert payload["media_type"] == "image"
    assert payload["width"] == 16
    assert payload["height"] == 12


def test_openclaw_comment_media_upload_returns_markdown_url_for_video(client, monkeypatch):
    import app.api.openclaw_routes as openclaw_routes_module

    auth = register_login_and_openclaw_key(client, phone="13800009994", username="media-video-user")
    topic_resp = client.post(
        "/api/v1/openclaw/topics",
        headers={"Authorization": f"Bearer {auth['openclaw_key']}"},
        json={"title": "上传视频", "body": "测试视频上传"},
    )
    assert topic_resp.status_code == 201, topic_resp.text
    topic_id = topic_resp.json()["id"]

    def fake_upload_comment_media_to_oss(*, topic_id: str, filename: str, content_type: str | None, payload: bytes) -> dict:
        assert topic_id
        assert filename == "clip.mp4"
        assert content_type == "video/mp4"
        assert payload == b"fake-video"
        return {
            "url": "https://topiclab-comment-media.oss-cn-beijing.aliyuncs.com/openclaw-comments/test.mp4",
            "markdown": "![clip](https://topiclab-comment-media.oss-cn-beijing.aliyuncs.com/openclaw-comments/test.mp4)",
            "object_key": "openclaw-comments/test.mp4",
            "content_type": "video/mp4",
            "media_type": "video",
            "width": 0,
            "height": 0,
            "size_bytes": 10,
        }

    monkeypatch.setattr(openclaw_routes_module, "upload_comment_media_to_oss", fake_upload_comment_media_to_oss)

    upload_resp = client.post(
        f"/api/v1/openclaw/topics/{topic_id}/media",
        headers={"Authorization": f"Bearer {auth['openclaw_key']}"},
        files={"file": ("clip.mp4", b"fake-video", "video/mp4")},
    )
    assert upload_resp.status_code == 200, upload_resp.text
    payload = upload_resp.json()
    assert payload["url"].endswith(".mp4")
    assert payload["markdown"].startswith("![clip](")
    assert payload["content_type"] == "video/mp4"
    assert payload["media_type"] == "video"


def test_upload_comment_media_to_oss_guesses_image_type_for_octet_stream(monkeypatch):
    import app.services.oss_upload as oss_upload_module

    image = Image.new("RGB", (12, 8), color=(80, 120, 160))
    buf = BytesIO()
    image.save(buf, format="PNG")

    captured: dict[str, str] = {}

    def fake_upload_bytes_to_oss(*, object_key: str, content_type: str, payload: bytes, suffix: str) -> str:
        captured["content_type"] = content_type
        captured["suffix"] = suffix
        assert object_key
        assert payload
        return "/api/v1/openclaw/media/openclaw-comments/test.webp"

    monkeypatch.setattr(oss_upload_module, "_upload_bytes_to_oss", fake_upload_bytes_to_oss)

    uploaded = oss_upload_module.upload_comment_media_to_oss(
        topic_id="topic_123",
        filename="comment.png",
        content_type="application/octet-stream",
        payload=buf.getvalue(),
    )

    assert captured["content_type"] == "image/webp"
    assert captured["suffix"] == ".webp"
    assert uploaded["content_type"] == "image/webp"
    assert uploaded["media_type"] == "image"
    assert uploaded["width"] == 12
    assert uploaded["height"] == 8


def test_upload_comment_media_to_oss_guesses_video_type_for_octet_stream(monkeypatch):
    import app.services.oss_upload as oss_upload_module

    captured: dict[str, str] = {}

    def fake_upload_bytes_to_oss(*, object_key: str, content_type: str, payload: bytes, suffix: str) -> str:
        captured["content_type"] = content_type
        captured["suffix"] = suffix
        assert object_key
        assert payload == b"fake-video"
        return "/api/v1/openclaw/media/openclaw-comments/test.mp4"

    monkeypatch.setattr(oss_upload_module, "_upload_bytes_to_oss", fake_upload_bytes_to_oss)

    uploaded = oss_upload_module.upload_comment_media_to_oss(
        topic_id="topic_123",
        filename="clip.mp4",
        content_type="application/octet-stream",
        payload=b"fake-video",
    )

    assert captured["content_type"] == "video/mp4"
    assert captured["suffix"] == ".mp4"
    assert uploaded["content_type"] == "video/mp4"
    assert uploaded["media_type"] == "video"
    assert uploaded["width"] == 0
    assert uploaded["height"] == 0


def test_openclaw_comment_media_upload_requires_existing_topic(client):
    image = Image.new("RGB", (8, 8), color=(0, 0, 0))
    buf = BytesIO()
    image.save(buf, format="PNG")
    auth = register_login_and_openclaw_key(client, phone="13800009995", username="media-missing-topic-user")

    resp = client.post(
        "/api/v1/openclaw/topics/not-found/media",
        headers={"Authorization": f"Bearer {auth['openclaw_key']}"},
        files={"file": ("missing.png", buf.getvalue(), "image/png")},
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["detail"] == "Topic not found"


def test_openclaw_module_skill_returns_404_for_unknown_module(client):
    resp = client.get("/api/v1/openclaw/skills/not-exists.md")

    assert resp.status_code == 404, resp.text
    assert "Unknown OpenClaw skill module" in resp.text


def test_openclaw_skill_version_endpoint(client):
    """skill-version 返回 version、updated_at、skill_url、check_url，无需认证。"""
    resp = client.get("/api/v1/openclaw/skill-version")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "version" in data
    assert "updated_at" in data
    assert data.get("skill_url") == "/api/v1/openclaw/skill.md"
    assert data.get("check_url") == "/api/v1/openclaw/skill-version"
    assert len(data["version"]) >= 8


def test_openclaw_skill_returns_etag_and_supports_304(client):
    """skill.md 返回 ETag，带 If-None-Match 且匹配时返回 304。"""
    resp = client.get("/api/v1/openclaw/skill.md")
    assert resp.status_code == 200, resp.text
    etag = resp.headers.get("ETag")
    assert etag is not None
    assert etag.startswith('"') and etag.endswith('"')
    assert "Website Skill Version:" in resp.text

    cond_resp = client.get("/api/v1/openclaw/skill.md", headers={"If-None-Match": etag})
    assert cond_resp.status_code == 304
    assert len(cond_resp.content) == 0


def test_openclaw_skill_invalid_key_returns_recovery_hint(client):
    resp = client.get("/api/v1/openclaw/skill.md?key=tloc_invalid_key_12345")
    assert resp.status_code == 401, resp.text
    assert "Invalid OpenClaw key." in resp.text
    assert "重新拉取你当前持有的 skill 链接" not in resp.text
    assert resp.headers.get("X-OpenClaw-Auth-Error") == "key_invalid_or_expired"
    assert resp.headers.get("X-OpenClaw-Auth-Recovery") == "reload_skill_url"


def test_openclaw_home_and_topic_search_reject_invalid_runtime_key(client):
    home_resp = client.get("/api/v1/home", headers={"Authorization": "Bearer tloc_invalid_key_12345"})
    assert home_resp.status_code == 401, home_resp.text
    assert "OpenClaw" in home_resp.json()["detail"]
    assert home_resp.headers.get("X-OpenClaw-Auth-Error") == "key_invalid_or_expired"
    assert home_resp.headers.get("X-OpenClaw-Auth-Recovery") == "reload_skill_url"

    search_resp = client.get("/api/v1/openclaw/topics?q=agent", headers={"Authorization": "Bearer tloc_invalid_key_12345"})
    assert search_resp.status_code == 401, search_resp.text
    assert "OpenClaw" in search_resp.json()["detail"]
    assert search_resp.headers.get("X-OpenClaw-Auth-Error") == "key_invalid_or_expired"
    assert search_resp.headers.get("X-OpenClaw-Auth-Recovery") == "reload_skill_url"


def test_openclaw_skill_link_is_stable_and_reusable(client):
    auth = register_login_and_openclaw_key(client, phone="13800009993", username="stable-skill")
    skill_url = auth["skill_path"]

    first = client.get(skill_url)
    assert first.status_code == 200, first.text
    assert auth["openclaw_key"] in first.text

    second = client.get(skill_url)
    assert second.status_code == 200, second.text
    assert auth["openclaw_key"] in second.text


def test_openclaw_personalized_skill_enforces_cli_first(client):
    auth = register_login_and_openclaw_key(client, phone="13800009992", username="cli-first-skill")
    resp = client.get(auth["skill_path"])
    assert resp.status_code == 200, resp.text
    body = resp.text
    assert "先遵守这 4 条" in body
    assert "`topiclab-cli` 是必装运行时" in body
    assert "本 skill 不提供任何 API 访问方式" in body
    assert "/api/v1/auth/openclaw-guest" in body
    assert "curl -fsSL" in body
    assert "只写长期规则摘要" in body
    assert "`AGENTS.md`" in body
    assert "`TOOLS.md`" in body
    assert "topiclab notifications list --json" in body
    assert "topiclab help ask" in body
    assert "ask agent" in body
    assert "之后所有 API 请求都使用 `Authorization: Bearer YOUR_OPENCLAW_KEY`。" not in body
    assert "先查看 `/api/v1/me/inbox`" not in body


def test_openclaw_home_includes_skill_version_in_quick_links(client):
    """home 的 quick_links 包含 skill_version。"""
    resp = client.get("/api/v1/home")
    assert resp.status_code == 200, resp.text
    quick = resp.json().get("quick_links", {})
    assert quick.get("skill_version") == "/api/v1/openclaw/skill-version"
    assert quick.get("skill_self_refresh_strategy") == "reload_skill_url"


def test_openclaw_skill_version_includes_auth_recovery_contract(client):
    resp = client.get("/api/v1/openclaw/skill-version")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["auth_recovery"]["on_key_invalid"] == "reload_skill_url"


def test_posts_pagination_and_reply_thread_endpoints(client):
    topic = client.post("/topics", json={"title": "帖子分页", "body": "验证顶层分页与回复分页"}).json()
    topic_id = topic["id"]

    root_one = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "alice", "body": "这是第一条根帖，用来验证顶层分页接口按时间顺序返回帖子。"},
    )
    assert root_one.status_code == 201, root_one.text
    root_one = root_one.json()["post"]
    first_reply = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "bob", "body": "这是根帖一的第一条回复，用来验证回复分页接口。", "in_reply_to_id": root_one["id"]},
    )
    assert first_reply.status_code == 201, first_reply.text
    second_reply = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "carol", "body": "这是根帖一的第二条回复，用来验证回复游标继续向后推进。", "in_reply_to_id": root_one["id"]},
    )
    assert second_reply.status_code == 201, second_reply.text
    root_two = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "dave", "body": "这是第二条根帖，用来验证顶层帖子第二页能够被正确读取。"},
    )
    assert root_two.status_code == 201, root_two.text
    root_two = root_two.json()["post"]

    first_page = client.get(f"/topics/{topic_id}/posts?limit=1&preview_replies=1")
    assert first_page.status_code == 200, first_page.text
    first_payload = first_page.json()
    assert len(first_payload["items"]) == 1
    assert first_payload["items"][0]["id"] == root_one["id"]
    assert first_payload["items"][0]["reply_count"] == 2
    assert len(first_payload["items"][0]["latest_replies"]) == 1
    assert first_payload["next_cursor"]

    second_page = client.get(f"/topics/{topic_id}/posts?limit=1&cursor={first_payload['next_cursor']}")
    assert second_page.status_code == 200, second_page.text
    second_payload = second_page.json()
    assert len(second_payload["items"]) == 1
    assert second_payload["items"][0]["id"] == root_two["id"]
    assert second_payload["next_cursor"] is None

    replies = client.get(f"/topics/{topic_id}/posts/{root_one['id']}/replies?limit=1")
    assert replies.status_code == 200, replies.text
    replies_payload = replies.json()
    assert replies_payload["parent_post_id"] == root_one["id"]
    assert len(replies_payload["items"]) == 1
    assert replies_payload["next_cursor"]

    thread = client.get(f"/topics/{topic_id}/posts/{root_one['id']}/thread")
    assert thread.status_code == 200, thread.text
    assert [item["id"] for item in thread.json()["items"]][0] == root_one["id"]
    assert len(thread.json()["items"]) == 3


def test_topics_list_supports_cursor_pagination(client):
    first = client.post("/topics", json={"title": "列表一", "body": "正文", "category": "research"})
    second = client.post("/topics", json={"title": "列表二", "body": "正文", "category": "research"})
    third = client.post("/topics", json={"title": "列表三", "body": "正文", "category": "product"})
    assert first.status_code == 201
    assert second.status_code == 201
    assert third.status_code == 201

    first_page = client.get("/topics?limit=2")
    assert first_page.status_code == 200, first_page.text
    first_payload = first_page.json()
    assert len(first_payload["items"]) == 2
    assert first_payload["next_cursor"]

    second_page = client.get(f"/topics?limit=2&cursor={first_payload['next_cursor']}")
    assert second_page.status_code == 200, second_page.text
    second_payload = second_page.json()
    assert len(second_payload["items"]) >= 1
    assert not ({item["id"] for item in first_payload["items"]} & {item["id"] for item in second_payload["items"]})

    research_page = client.get("/topics?category=research&limit=10")
    assert research_page.status_code == 200, research_page.text
    assert all(item["category"] == "research" for item in research_page.json()["items"])


def test_favorite_category_items_and_recent_favorites_are_paged(client):
    user = register_and_login(client, phone="13800000011", username="favorite-user")
    headers = {"Authorization": f"Bearer {user['token']}"}

    topic_one = client.post("/topics", json={"title": "收藏一", "body": "正文一"}, headers=headers).json()
    topic_two = client.post("/topics", json={"title": "收藏二", "body": "正文二"}, headers=headers).json()

    assert client.post(f"/topics/{topic_one['id']}/favorite", json={"enabled": True}, headers=headers).status_code == 200
    assert client.post(f"/topics/{topic_two['id']}/favorite", json={"enabled": True}, headers=headers).status_code == 200
    article_payload = {
        "enabled": True,
        "title": "测试信源",
        "source_feed_name": "单测源",
        "source_type": "rss",
        "url": "https://example.com/article-1",
        "pic_url": None,
        "description": "描述",
        "publish_time": "2026-03-14T00:00:00+00:00",
        "created_at": "2026-03-14T00:00:00+00:00",
    }
    assert client.post("/source-feed/articles/101/favorite", json=article_payload, headers=headers).status_code == 200

    category_resp = client.post(
        "/api/v1/me/favorite-categories",
        json={"name": f"专题归档-{int(time.time() * 1000)}", "description": "把重点收藏内容归拢到一个分类里。"},
        headers=headers,
    )
    assert category_resp.status_code == 201, category_resp.text
    category = category_resp.json()
    category_id = category["id"]
    assign_topic = client.post(f"/api/v1/me/favorite-categories/{category_id}/topics/{topic_one['id']}", headers=headers)
    assert assign_topic.status_code == 200, assign_topic.text
    assign_source = client.post(f"/api/v1/me/favorite-categories/{category_id}/source-articles/101", headers=headers)
    assert assign_source.status_code == 200, assign_source.text

    categories = client.get("/api/v1/me/favorite-categories", headers=headers)
    assert categories.status_code == 200, categories.text
    assert categories.json()["list"][0]["topics_count"] == 1
    assert categories.json()["list"][0]["source_articles_count"] == 1

    category_topics = client.get(f"/api/v1/me/favorite-categories/{category_id}/items?type=topics&limit=10", headers=headers)
    assert category_topics.status_code == 200, category_topics.text
    assert [item["id"] for item in category_topics.json()["items"]] == [topic_one["id"]]

    category_sources = client.get(f"/api/v1/me/favorite-categories/{category_id}/items?type=sources&limit=10", headers=headers)
    assert category_sources.status_code == 200, category_sources.text
    assert [item["id"] for item in category_sources.json()["items"]] == [101]

    recent_topics = client.get("/api/v1/me/favorites/recent?type=topics&limit=1", headers=headers)
    assert recent_topics.status_code == 200, recent_topics.text
    assert len(recent_topics.json()["items"]) == 1
    assert recent_topics.json()["next_cursor"]

    recent_sources = client.get("/api/v1/me/favorites/recent?type=sources&limit=10", headers=headers)
    assert recent_sources.status_code == 200, recent_sources.text
    assert [item["id"] for item in recent_sources.json()["items"]] == [101]

    summary = client.get(f"/api/v1/me/favorite-categories/{category_id}/summary-payload", headers=headers)
    assert summary.status_code == 200, summary.text
    assert summary.json()["category"]["id"] == category_id
    assert [item["id"] for item in summary.json()["topics"]] == [topic_one["id"]]
    assert [item["id"] for item in summary.json()["source_articles"]] == [101]


def test_openclaw_bound_user_shares_favorites_with_jwt(client):
    auth = register_login_and_openclaw_key(client, phone="13800000021", username="favorite-sync-user")
    jwt_headers = {"Authorization": f"Bearer {auth['token']}"}
    openclaw_headers = {"Authorization": f"Bearer {auth['openclaw_key']}"}

    topic = client.post("/topics", json={"title": "共享收藏", "body": "验证 JWT 与 OpenClaw 收藏一致"}, headers=jwt_headers).json()
    topic_id = topic["id"]

    article_payload = {
        "enabled": True,
        "title": "共享信源",
        "source_feed_name": "同步源",
        "source_type": "rss",
        "url": "https://example.com/shared-favorite",
        "pic_url": None,
        "description": "用于验证 OpenClaw 与用户收藏同步",
        "publish_time": "2026-03-14T00:00:00+00:00",
        "created_at": "2026-03-14T00:00:00+00:00",
    }

    favorite_topic = client.post(f"/topics/{topic_id}/favorite", json={"enabled": True}, headers=jwt_headers)
    assert favorite_topic.status_code == 200, favorite_topic.text
    favorite_article = client.post("/source-feed/articles/201/favorite", json=article_payload, headers=jwt_headers)
    assert favorite_article.status_code == 200, favorite_article.text

    category_resp = client.post(
        "/api/v1/me/favorite-categories",
        json={"name": f"同步分类-{int(time.time() * 1000)}", "description": "JWT 和 OpenClaw 共用"},
        headers=jwt_headers,
    )
    assert category_resp.status_code == 201, category_resp.text
    category_id = category_resp.json()["id"]
    assert client.post(f"/api/v1/me/favorite-categories/{category_id}/topics/{topic_id}", headers=jwt_headers).status_code == 200
    assert client.post(f"/api/v1/me/favorite-categories/{category_id}/source-articles/201", headers=jwt_headers).status_code == 200

    openclaw_topic = client.get(f"/topics/{topic_id}", headers=openclaw_headers)
    assert openclaw_topic.status_code == 200, openclaw_topic.text
    assert openclaw_topic.json()["interaction"]["favorited"] is True

    openclaw_favorites = client.get("/api/v1/me/favorites", headers=openclaw_headers)
    assert openclaw_favorites.status_code == 200, openclaw_favorites.text
    assert [item["id"] for item in openclaw_favorites.json()["topics"]] == [topic_id]
    assert [item["id"] for item in openclaw_favorites.json()["source_articles"]] == [201]
    assert openclaw_favorites.json()["categories"][0]["topics_count"] == 1
    assert openclaw_favorites.json()["categories"][0]["source_articles_count"] == 1

    openclaw_summary = client.get(f"/api/v1/me/favorite-categories/{category_id}/summary-payload", headers=openclaw_headers)
    assert openclaw_summary.status_code == 200, openclaw_summary.text
    assert [item["id"] for item in openclaw_summary.json()["topics"]] == [topic_id]
    assert [item["id"] for item in openclaw_summary.json()["source_articles"]] == [201]

    unfavorite_topic = client.post(f"/topics/{topic_id}/favorite", json={"enabled": False}, headers=openclaw_headers)
    assert unfavorite_topic.status_code == 200, unfavorite_topic.text
    unfavorite_article = client.post(
        "/source-feed/articles/201/favorite",
        json={**article_payload, "enabled": False},
        headers=openclaw_headers,
    )
    assert unfavorite_article.status_code == 200, unfavorite_article.text

    jwt_favorites = client.get("/api/v1/me/favorites", headers=jwt_headers)
    assert jwt_favorites.status_code == 200, jwt_favorites.text
    assert jwt_favorites.json()["topics"] == []
    assert jwt_favorites.json()["source_articles"] == []

    jwt_categories = client.get("/api/v1/me/favorite-categories", headers=jwt_headers)
    assert jwt_categories.status_code == 200, jwt_categories.text
    assert jwt_categories.json()["list"] == []


def test_write_time_interaction_counters_are_returned_directly(client):
    user = register_and_login(client, phone="13800000012", username="counter-user")
    headers = {"Authorization": f"Bearer {user['token']}"}

    topic = client.post("/topics", json={"title": "计数测试", "body": "正文"}, headers=headers).json()
    topic_id = topic["id"]
    created_post = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "counter-user", "body": "这是根帖，用来验证帖子互动计数会在写入时直接维护。"},
        headers=headers,
    )
    assert created_post.status_code == 201, created_post.text
    created_post = created_post.json()["post"]
    reply = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "counter-user", "body": "这是回复，用来验证父帖 reply_count 在写入时直接递增。", "in_reply_to_id": created_post["id"]},
        headers=headers,
    )
    assert reply.status_code == 201, reply.text

    liked_topic = client.post(f"/topics/{topic_id}/like", json={"enabled": True}, headers=headers)
    favorited_topic = client.post(f"/topics/{topic_id}/favorite", json={"enabled": True}, headers=headers)
    shared_topic = client.post(f"/topics/{topic_id}/share", headers=headers)
    liked_post = client.post(f"/topics/{topic_id}/posts/{created_post['id']}/like", json={"enabled": True}, headers=headers)
    shared_post = client.post(f"/topics/{topic_id}/posts/{created_post['id']}/share", headers=headers)

    assert liked_topic.status_code == 200
    assert favorited_topic.status_code == 200
    assert shared_topic.status_code == 200
    assert liked_post.status_code == 200
    assert shared_post.status_code == 200

    topic_detail = client.get(f"/topics/{topic_id}", headers=headers)
    assert topic_detail.status_code == 200, topic_detail.text
    assert topic_detail.json()["posts_count"] == 2
    assert topic_detail.json()["interaction"]["likes_count"] == 1
    assert topic_detail.json()["interaction"]["favorites_count"] == 1
    assert topic_detail.json()["interaction"]["shares_count"] == 1

    paged_posts = client.get(f"/topics/{topic_id}/posts", headers=headers)
    assert paged_posts.status_code == 200, paged_posts.text
    root_post = paged_posts.json()["items"][0]
    assert root_post["reply_count"] == 1
    assert root_post["interaction"]["likes_count"] == 1
    assert root_post["interaction"]["shares_count"] == 1


def test_post_reply_inbox_is_shared_between_jwt_and_openclaw(client):
    owner = register_login_and_openclaw_key(client, phone="13800000030", username="inbox-owner")
    replier = register_and_login(client, phone="13800000031", username="inbox-replier")
    owner_headers = {"Authorization": f"Bearer {owner['token']}"}
    owner_openclaw_headers = {"Authorization": f"Bearer {owner['openclaw_key']}"}
    replier_headers = {"Authorization": f"Bearer {replier['token']}"}

    topic = client.post(
        "/topics",
        json={"title": "消息信箱", "body": "验证回帖通知"},
        headers=owner_headers,
    ).json()
    topic_id = topic["id"]

    root_resp = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "inbox-owner", "body": "这是我的根帖。"},
        headers=owner_headers,
    )
    assert root_resp.status_code == 201, root_resp.text
    root_post = root_resp.json()["post"]

    self_reply = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "inbox-owner", "body": "这是我自己的回复。", "in_reply_to_id": root_post["id"]},
        headers=owner_headers,
    )
    assert self_reply.status_code == 201, self_reply.text

    inbox_after_self_reply = client.get("/api/v1/me/inbox", headers=owner_headers)
    assert inbox_after_self_reply.status_code == 200, inbox_after_self_reply.text
    assert inbox_after_self_reply.json()["items"] == []
    assert inbox_after_self_reply.json()["unread_count"] == 0

    reply_resp = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "inbox-replier", "body": "这是别人给你的回复。", "in_reply_to_id": root_post["id"]},
        headers=replier_headers,
    )
    assert reply_resp.status_code == 201, reply_resp.text
    reply_post = reply_resp.json()["post"]

    jwt_inbox = client.get("/api/v1/me/inbox", headers=owner_headers)
    assert jwt_inbox.status_code == 200, jwt_inbox.text
    jwt_payload = jwt_inbox.json()
    assert jwt_payload["unread_count"] == 1
    assert jwt_payload["total"] == 1
    assert jwt_payload["items"][0]["reply_post_id"] == reply_post["id"]
    assert jwt_payload["items"][0]["parent_post_id"] == root_post["id"]
    assert jwt_payload["items"][0]["is_read"] is False

    openclaw_inbox = client.get("/api/v1/me/inbox", headers=owner_openclaw_headers)
    assert openclaw_inbox.status_code == 200, openclaw_inbox.text
    openclaw_payload = openclaw_inbox.json()
    assert openclaw_payload["unread_count"] == 1
    assert openclaw_payload["items"][0]["id"] == jwt_payload["items"][0]["id"]

    mark_read = client.post(
        f"/api/v1/me/inbox/{jwt_payload['items'][0]['id']}/read",
        headers=owner_openclaw_headers,
    )
    assert mark_read.status_code == 200, mark_read.text

    jwt_after_read = client.get("/api/v1/me/inbox", headers=owner_headers)
    assert jwt_after_read.status_code == 200, jwt_after_read.text
    assert jwt_after_read.json()["unread_count"] == 0
    assert jwt_after_read.json()["items"][0]["is_read"] is True


def test_post_like_creates_inbox_feedback_for_post_owner(client):
    owner = register_login_and_openclaw_key(client, phone="13800000032", username="like-owner")
    liker = register_login_and_openclaw_key(client, phone="13800000033", username="like-actor")
    owner_headers = {"Authorization": f"Bearer {owner['token']}"}
    liker_openclaw_headers = {"Authorization": f"Bearer {liker['openclaw_key']}"}

    topic = client.post(
        "/topics",
        json={"title": "点赞反馈", "body": "验证帖子被点赞时 OpenClaw 能收到反馈"},
        headers=owner_headers,
    ).json()
    topic_id = topic["id"]

    root_resp = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "like-owner", "body": "这是等待被点赞的帖子。"},
        headers=owner_headers,
    )
    assert root_resp.status_code == 201, root_resp.text
    root_post = root_resp.json()["post"]

    like_resp = client.post(
        f"/topics/{topic_id}/posts/{root_post['id']}/like",
        json={"enabled": True},
        headers=liker_openclaw_headers,
    )
    assert like_resp.status_code == 200, like_resp.text
    assert like_resp.json()["liked"] is True
    assert like_resp.json()["likes_count"] == 1

    inbox = client.get("/api/v1/me/inbox", headers=owner_headers)
    assert inbox.status_code == 200, inbox.text
    payload = inbox.json()
    assert payload["unread_count"] == 1
    assert payload["items"][0]["type"] == "post_liked"
    assert payload["items"][0]["reply_post_id"] == root_post["id"]
    assert payload["items"][0]["parent_post_id"] == root_post["id"]
    assert payload["items"][0]["actor_openclaw_agent"]["agent_uid"] == liker["agent_uid"]

    mark_read = client.post(
        f"/api/v1/me/inbox/{payload['items'][0]['id']}/read",
        headers=owner_headers,
    )
    assert mark_read.status_code == 200, mark_read.text

    inbox_after = client.get("/api/v1/me/inbox", headers=owner_headers)
    assert inbox_after.status_code == 200, inbox_after.text
    assert inbox_after.json()["unread_count"] == 0
    assert inbox_after.json()["items"][0]["is_read"] is True


def test_user_posts_and_openclaw_posts_share_same_inbox(client):
    import app.api.topics as topics_module

    async def approve_all(*args, **kwargs):
        return None

    topics_module._moderate_or_raise = approve_all

    owner = register_login_and_openclaw_key(client, phone="13800000033", username="mixed-inbox-owner")
    replier = register_and_login(client, phone="13800000034", username="mixed-inbox-replier")
    owner_headers = {"Authorization": f"Bearer {owner['token']}"}
    owner_openclaw_headers = {"Authorization": f"Bearer {owner['openclaw_key']}"}
    replier_headers = {"Authorization": f"Bearer {replier['token']}"}

    topic = client.post(
        "/topics",
        json={"title": "混合信箱", "body": "验证用户帖与 OpenClaw 帖共用信箱"},
        headers=owner_headers,
    ).json()
    topic_id = topic["id"]

    user_root_resp = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "mixed-inbox-owner", "body": "这是用户账号发的帖子。"},
        headers=owner_headers,
    )
    assert user_root_resp.status_code == 201, user_root_resp.text
    user_root = user_root_resp.json()["post"]

    openclaw_root_resp = client.post(
        f"/api/v1/openclaw/topics/{topic_id}/posts",
        json={"body": "这是 OpenClaw 发的帖子。"},
        headers=owner_openclaw_headers,
    )
    assert openclaw_root_resp.status_code == 201, openclaw_root_resp.text
    openclaw_root = openclaw_root_resp.json()["post"]

    reply_to_user = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "mixed-inbox-replier", "body": "回复用户帖子。", "in_reply_to_id": user_root["id"]},
        headers=replier_headers,
    )
    assert reply_to_user.status_code == 201, reply_to_user.text

    reply_to_openclaw = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "mixed-inbox-replier", "body": "回复 OpenClaw 帖子。", "in_reply_to_id": openclaw_root["id"]},
        headers=replier_headers,
    )
    assert reply_to_openclaw.status_code == 201, reply_to_openclaw.text

    inbox = client.get("/api/v1/me/inbox", headers=owner_headers)
    assert inbox.status_code == 200, inbox.text
    payload = inbox.json()
    assert payload["unread_count"] == 2
    assert payload["total"] == 2
    parent_ids = {item["parent_post_id"] for item in payload["items"]}
    assert parent_ids == {user_root["id"], openclaw_root["id"]}


def test_expert_reply_inbox_message_is_created_only_after_completed_reply(client, monkeypatch):
    import app.api.topics as topics_module

    original_request_json = topics_module.request_json

    async def approve_all(*args, **kwargs):
        return None

    async def delayed_request_json(method, path, *, json_body=None, headers=None, params=None, timeout=600.0):
        if path == "/executor/expert-replies":
            await asyncio.sleep(0.2)
        return await original_request_json(
            method,
            path,
            json_body=json_body,
            headers=headers,
            params=params,
            timeout=timeout,
        )

    monkeypatch.setattr(topics_module, "request_json", delayed_request_json)
    monkeypatch.setattr(topics_module, "_moderate_or_raise", approve_all)

    owner = register_and_login(client, phone="13800000032", username="mention-owner")
    headers = {"Authorization": f"Bearer {owner['token']}"}

    topic = client.post(
        "/topics",
        json={"title": "专家回帖通知", "body": "验证 pending 不应先入箱"},
        headers=headers,
    ).json()
    topic_id = topic["id"]

    root_resp = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "mention-owner", "body": "请专家看看这个问题。"},
        headers=headers,
    )
    assert root_resp.status_code == 201, root_resp.text
    root_post = root_resp.json()["post"]

    start = client.post(
        f"/topics/{topic_id}/discussion",
        json={"num_rounds": 1, "max_turns": 20, "max_budget_usd": 1.0},
        headers=headers,
    )
    assert start.status_code == 202, start.text

    deadline = time.time() + 3
    while time.time() < deadline:
        status_resp = client.get(f"/topics/{topic_id}/discussion/status", headers=headers)
        assert status_resp.status_code == 200, status_resp.text
        if status_resp.json()["status"] == "completed":
            break
        time.sleep(0.05)

    mention = client.post(
        f"/topics/{topic_id}/posts/mention",
        json={
            "author": "mention-owner",
            "body": "@physicist 请继续回复",
            "expert_name": "physicist",
            "in_reply_to_id": root_post["id"],
        },
        headers=headers,
    )
    assert mention.status_code == 202, mention.text
    reply_post_id = mention.json()["reply_post_id"]

    pending_inbox = client.get("/api/v1/me/inbox", headers=headers)
    assert pending_inbox.status_code == 200, pending_inbox.text
    assert pending_inbox.json()["items"] == []

    deadline = time.time() + 3
    latest_reply = None
    while time.time() < deadline:
        latest_reply = client.get(f"/topics/{topic_id}/posts/mention/{reply_post_id}", headers=headers)
        assert latest_reply.status_code == 200, latest_reply.text
        if latest_reply.json()["status"] == "completed":
            break
        time.sleep(0.05)

    assert latest_reply is not None
    assert latest_reply.json()["status"] == "completed"

    completed_inbox = client.get("/api/v1/me/inbox", headers=headers)
    assert completed_inbox.status_code == 200, completed_inbox.text
    payload = completed_inbox.json()
    assert payload["unread_count"] == 1
    assert payload["items"][0]["reply_post_id"] == reply_post_id
    assert payload["items"][0]["reply_author_type"] == "agent"


def test_short_ttl_read_cache_hits_and_invalidates_on_write(client, monkeypatch):
    from app.storage.database import topic_store

    topic = client.post("/topics", json={"title": "缓存测试", "body": "正文"}).json()
    topic_id = topic["id"]
    first_post = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "alice", "body": "第一条帖子，用来验证缓存命中。"},
    )
    assert first_post.status_code == 201, first_post.text

    original_get_db_session = topic_store.get_db_session
    calls = {"count": 0}

    class CountingSessionContext:
        def __init__(self, wrapped):
            self._wrapped = wrapped

        def __enter__(self):
            calls["count"] += 1
            return self._wrapped.__enter__()

        def __exit__(self, exc_type, exc, tb):
            return self._wrapped.__exit__(exc_type, exc, tb)

    def counting_get_db_session():
        return CountingSessionContext(original_get_db_session())

    monkeypatch.setattr(topic_store, "get_db_session", counting_get_db_session)

    calls["count"] = 0
    cached_topic_first = topic_store.get_topic(topic_id)
    first_read_calls = calls["count"]
    cached_topic_second = topic_store.get_topic(topic_id)
    assert calls["count"] == first_read_calls
    assert cached_topic_first["id"] == cached_topic_second["id"]

    calls["count"] = 0
    cached_posts_first = topic_store.list_posts(topic_id, preview_replies=2)
    first_posts_read_calls = calls["count"]
    cached_posts_second = topic_store.list_posts(topic_id, preview_replies=2)
    assert calls["count"] == first_posts_read_calls
    assert len(cached_posts_first["items"]) == len(cached_posts_second["items"]) == 1

    second_post = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "bob", "body": "第二条帖子，用来触发写后失效。"},
    )
    assert second_post.status_code == 201, second_post.text

    calls["count"] = 0
    refreshed_topic = topic_store.get_topic(topic_id)
    assert calls["count"] >= 1
    assert refreshed_topic["posts_count"] == 2

    calls["count"] = 0
    refreshed_posts = topic_store.list_posts(topic_id, preview_replies=2)
    assert calls["count"] >= 1
    assert len(refreshed_posts["items"]) == 2


def test_topic_search_with_q_bypasses_stale_read_cache(client, monkeypatch):
    from app.storage.database import topic_store

    auth = register_login_and_openclaw_key(client, phone="13800000031", username="openclaw-search-cache")

    original_get_db_session = topic_store.get_db_session
    calls = {"count": 0}

    class CountingSessionContext:
        def __init__(self, wrapped):
            self._wrapped = wrapped

        def __enter__(self):
            calls["count"] += 1
            return self._wrapped.__enter__()

        def __exit__(self, exc_type, exc, tb):
            return self._wrapped.__exit__(exc_type, exc, tb)

    def counting_get_db_session():
        return CountingSessionContext(original_get_db_session())

    monkeypatch.setattr(topic_store, "get_db_session", counting_get_db_session)

    calls["count"] = 0
    first_search = topic_store.list_topics(q="openclaw live smoke")
    first_read_calls = calls["count"]
    assert first_read_calls >= 1
    assert first_search["items"] == []

    calls["count"] = 0
    second_search = topic_store.list_topics(q="openclaw live smoke")
    assert calls["count"] >= 1
    assert second_search["items"] == []

    topic = client.post(
        "/api/v1/openclaw/topics",
        headers={"Authorization": f"Bearer {auth['openclaw_key']}"},
        json={
            "title": "OpenClaw live smoke regression topic",
            "body": "Created after an empty search result to verify multi-worker cache behavior.",
            "category": "request",
        },
    )
    assert topic.status_code == 201, topic.text
    topic_id = topic.json()["id"]

    calls["count"] = 0
    refreshed_search = topic_store.list_topics(q="openclaw live smoke")
    assert calls["count"] >= 1
    assert topic_id in [item["id"] for item in refreshed_search["items"]]


def test_feedback_allows_anonymous_submit(client):
    from app.storage.database.postgres_client import get_db_session

    resp = client.post(
        "/api/v1/feedback",
        json={
            "body": "匿名反馈内容",
            "scenario": "匿名场景",
            "steps_to_reproduce": "1. 打开页面\n2. 点击反馈",
            "page_url": "https://example.com/anonymous",
        },
    )
    assert resp.status_code == 201, resp.text
    payload = resp.json()
    assert payload["username"] == "匿名用户"
    assert payload["id"] >= 1

    with get_db_session() as session:
        row = session.execute(
            text(
                """
                SELECT user_id, username, auth_channel, scenario, body, steps_to_reproduce, page_url
                FROM site_feedback
                WHERE id = :id
                """
            ),
            {"id": payload["id"]},
        ).fetchone()
    assert row is not None
    assert row[0] is None
    assert row[1] == "匿名用户"
    assert row[2] == "anonymous"
    assert row[3] == "匿名场景"
    assert row[4] == "匿名反馈内容"
    assert row[5] == "1. 打开页面\n2. 点击反馈"
    assert row[6] == "https://example.com/anonymous"


def test_app_topic_is_singleton(client):
    first = client.post("/api/v1/apps/research-dream/topic")
    assert first.status_code == 200, first.text
    first_payload = first.json()
    assert first_payload["created"] is True
    topic_id = first_payload["topic"]["id"]

    second = client.post("/api/v1/apps/research-dream/topic")
    assert second.status_code == 200, second.text
    second_payload = second.json()
    assert second_payload["created"] is False
    assert second_payload["topic"]["id"] == topic_id


def test_apps_catalog_exposes_scientify_install_command(client):
    resp = client.get("/api/v1/apps")
    assert resp.status_code == 200, resp.text
    payload = resp.json()

    scientify = next((item for item in payload["list"] if item["id"] == "scientify"), None)
    assert scientify is not None
    assert scientify["name"] == "Scientify"
    assert scientify["install_command"] == "openclaw plugins install scientify"
    assert scientify["links"]["docs"] == "https://scientify.tech/zh"
    assert scientify["links"]["repo"] == "https://github.com/tsingyuai/scientify"


def test_apps_catalog_exposes_builtin_topiclab_cli(client):
    resp = client.get("/api/v1/apps")
    assert resp.status_code == 200, resp.text
    payload = resp.json()

    topiclab_cli = next((item for item in payload["list"] if item["id"] == "topiclab-cli"), None)
    assert topiclab_cli is not None
    assert topiclab_cli["name"] == "TopicLab CLI"
    assert topiclab_cli["builtin"] is True
    assert topiclab_cli["required_runtime"] is True
    assert topiclab_cli["install_command"] == "npm install -g topiclab-cli --registry=https://registry.npmmirror.com"
    assert topiclab_cli["upgrade_command"] == "npm update -g topiclab-cli --registry=https://registry.npmmirror.com"
    assert topiclab_cli["links"]["docs"] == "https://github.com/TashanGKD/TopicLab-CLI"
    assert topiclab_cli["links"]["repo"] == "https://github.com/TashanGKD/TopicLab-CLI"


def test_apps_catalog_marks_topiclab_cli_as_required_runtime(client):
    resp = client.get("/api/v1/apps/topiclab-cli")
    assert resp.status_code == 200, resp.text
    app = resp.json()["app"]
    assert app["required_runtime"] is True
    assert "必需 CLI 运行时" in app["description"]
    assert "不要直接手写 TopicLab API" in app["description"]


def test_apps_catalog_removes_scispark_and_sorts_builtin_first_then_alphabetically(client):
    resp = client.get("/api/v1/apps")
    assert resp.status_code == 200, resp.text
    payload = resp.json()

    ids = [item["id"] for item in payload["list"]]
    assert "scispark" not in ids
    assert ids == ["topiclab-cli", "giiisp-paper-search-apis", "manim-creator", "paperbanana-dashscope", "research-dream", "scientify"]


def test_apps_catalog_exposes_giiisp_skill_docs_and_scope(client):
    resp = client.get("/api/v1/apps")
    assert resp.status_code == 200, resp.text
    payload = resp.json()

    giiisp = next((item for item in payload["list"] if item["id"] == "giiisp-paper-search-apis"), None)
    assert giiisp is not None
    assert giiisp["name"] == "集思谱 Skill"
    assert giiisp["links"]["docs"] == "https://www.giiisp.com/SKILL.md"
    assert "1.15 亿篇文献" in giiisp["description"]
    assert "6200 万件专利" in giiisp["description"]
    assert "1.8 亿" in giiisp["description"]


def test_apps_catalog_exposes_paperbanana_dashscope_install_command(client):
    resp = client.get("/api/v1/apps")
    assert resp.status_code == 200, resp.text
    payload = resp.json()

    paperbanana = next((item for item in payload["list"] if item["id"] == "paperbanana-dashscope"), None)
    assert paperbanana is not None
    assert paperbanana["name"] == "PaperBanana-DashScope"
    assert paperbanana["install_command"] == "clawhub install paperbanana-dashscope"
    assert paperbanana["links"]["docs"] == "https://github.com/TashanGKD/PaperBanana-DashScope"
    assert paperbanana["links"]["repo"] == "https://github.com/TashanGKD/PaperBanana-DashScope"


def test_apps_catalog_exposes_research_dream_install_command(client):
    resp = client.get("/api/v1/apps")
    assert resp.status_code == 200, resp.text
    payload = resp.json()

    research_dream = next((item for item in payload["list"] if item["id"] == "research-dream"), None)
    assert research_dream is not None
    assert research_dream["name"] == "Research-Dream"
    assert research_dream["install_command"] == "topiclab skills install research-dream"
    assert research_dream["links"]["docs"] == "https://github.com/TashanGKD/Research-Dream"
    assert research_dream["links"]["repo"] == "https://github.com/TashanGKD/Research-Dream"


def test_app_like_roundtrip_and_catalog_interaction(client):
    user = register_and_login(client, phone="13800000031", username="app-like-user")
    headers = {"Authorization": f"Bearer {user['token']}"}

    like_resp = client.post(
        "/api/v1/apps/research-dream/like",
        json={"enabled": True},
        headers=headers,
    )
    assert like_resp.status_code == 200, like_resp.text
    interaction = like_resp.json()
    assert interaction["liked"] is True
    assert interaction["likes_count"] == 1

    list_resp = client.get("/api/v1/apps", headers=headers)
    assert list_resp.status_code == 200, list_resp.text
    item = next(entry for entry in list_resp.json()["list"] if entry["id"] == "research-dream")
    assert item["interaction"]["liked"] is True
    assert item["interaction"]["likes_count"] == 1
    assert item["linked_topic_id"]

    unlike_resp = client.post(
        "/api/v1/apps/research-dream/like",
        json={"enabled": False},
        headers=headers,
    )
    assert unlike_resp.status_code == 200, unlike_resp.text
    assert unlike_resp.json()["liked"] is False
    assert unlike_resp.json()["likes_count"] == 0


def test_feedback_submit_migrates_legacy_site_feedback_schema(client):
    from app.storage.database.postgres_client import get_db_session

    user = register_and_login(client, phone="13800000013", username="feedback-user")
    with get_db_session() as session:
        session.execute(text("DROP TABLE IF EXISTS site_feedback"))
        session.execute(
            text(
                """
                CREATE TABLE site_feedback (
                    id INTEGER PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    username VARCHAR(255) NOT NULL,
                    message TEXT NOT NULL,
                    user_agent TEXT
                )
                """
            )
        )

    resp = client.post(
        "/api/v1/feedback",
        headers={"Authorization": f"Bearer {user['token']}"},
        json={
            "body": "反馈内容",
            "scenario": "旧表兼容",
            "steps_to_reproduce": "1. 打开反馈\n2. 提交",
            "page_url": "https://example.com/topic/1",
        },
    )
    assert resp.status_code == 201, resp.text
    payload = resp.json()
    assert payload["username"] == "feedback-user"
    assert payload["id"] >= 1

    with get_db_session() as session:
        row = session.execute(
            text(
                """
                SELECT username, auth_channel, scenario, body, steps_to_reproduce, page_url, client_user_agent
                FROM site_feedback
                WHERE id = :id
                """
            ),
            {"id": payload["id"]},
        ).fetchone()
    assert row is not None
    assert row[0] == "feedback-user"
    assert row[1] == "jwt"
    assert row[2] == "旧表兼容"
    assert row[3] == "反馈内容"
    assert row[4] == "1. 打开反馈\n2. 提交"
    assert row[5] == "https://example.com/topic/1"
    assert isinstance(row[6], str) and row[6]
