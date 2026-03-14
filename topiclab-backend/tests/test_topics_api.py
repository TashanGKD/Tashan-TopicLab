import asyncio
import importlib
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import bcrypt
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

    from app.storage.database import postgres_client, topic_store
    postgres_client.reset_db_state()

    import app.api.auth as auth_module
    import app.api.topics as topics_module
    import main as main_module

    importlib.reload(postgres_client)
    importlib.reload(topic_store)
    importlib.reload(auth_module)
    topics_module = importlib.reload(topics_module)
    main_module = importlib.reload(main_module)
    discussion_state = {"snapshot_turns": []}

    async def fake_request_json(method, path, *, json_body=None, headers=None, params=None, timeout=600.0):
        if path == "/executor/topics/bootstrap":
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
    assert any(item["id"] == topic_id for item in list_resp.json())
    filtered = client.get("/topics?category=research")
    assert filtered.status_code == 200
    assert filtered.json()[0]["id"] == topic_id

    post_resp = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "alice", "body": "我支持把话题列表里的管理能力补齐，方便管理员直接处理内容。"},
    )
    assert post_resp.status_code == 201
    assert post_resp.json()["delete_token"].startswith("ptok_")
    assert not topic_workspace.exists()
    listed_posts = client.get(f"/topics/{topic_id}/posts")
    assert listed_posts.status_code == 200
    assert listed_posts.json()[0]["body"] == "我支持把话题列表里的管理能力补齐，方便管理员直接处理内容。"

    delete_resp = client.delete(
        f"/topics/{topic_id}/posts/{post_resp.json()['id']}",
        headers={"Authorization": f"Bearer {admin['token']}"},
    )
    assert delete_resp.status_code == 200, delete_resp.text
    assert delete_resp.json()["ok"] is True

    topic_delete_resp = client.delete(
        f"/topics/{topic_id}",
        headers={"Authorization": f"Bearer {admin['token']}"},
    )
    assert topic_delete_resp.status_code == 200, topic_delete_resp.text
    assert topic_delete_resp.json()["ok"] is True

    topic_missing = client.get(f"/topics/{topic_id}")
    assert topic_missing.status_code == 404


def test_discussion_and_mention_complete_via_executor(client):
    topic = client.post("/topics", json={"title": "执行测试", "body": "验证异步任务"}).json()
    topic_id = topic["id"]

    experts = client.get(f"/topics/{topic_id}/experts")
    assert experts.status_code == 200, experts.text
    assert experts.json()[0]["name"] == "physicist"

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
        if latest_status.json()["status"] == "completed":
            break
        time.sleep(0.1)
    assert latest_status is not None
    assert latest_status.json()["result"]["discussion_summary"].startswith("总结")


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
    root = root_resp.json()
    child_resp = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "owner", "body": "这是二级回复，用来验证嵌套回复关系会被完整识别。", "in_reply_to_id": root["id"]},
        headers={"Authorization": f"Bearer {owner['token']}"},
    )
    assert child_resp.status_code == 201, child_resp.text
    child = child_resp.json()
    grandchild_resp = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "owner", "body": "这是三级回复，用来验证更深层的回复链同样能被追踪。", "in_reply_to_id": child["id"]},
        headers={"Authorization": f"Bearer {owner['token']}"},
    )
    assert grandchild_resp.status_code == 201, grandchild_resp.text
    grandchild = grandchild_resp.json()

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
    assert client.get(f"/topics/{topic_id}/posts").json() == []

    admin_root_resp = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "owner", "body": "这是另一条根帖，用来验证管理员对完整回复树的管理能力。"},
        headers={"Authorization": f"Bearer {owner['token']}"},
    )
    assert admin_root_resp.status_code == 201, admin_root_resp.text
    admin_root = admin_root_resp.json()
    admin_child_resp = client.post(
        f"/topics/{topic_id}/posts",
        json={"author": "owner", "body": "这是对应的子级回复，用来验证管理员对嵌套结构的处理。", "in_reply_to_id": admin_root["id"]},
        headers={"Authorization": f"Bearer {owner['token']}"},
    )
    assert admin_child_resp.status_code == 201, admin_child_resp.text
    admin_child = admin_child_resp.json()

    admin_delete = client.delete(
        f"/topics/{topic_id}/posts/{admin_root['id']}",
        headers={"Authorization": f"Bearer {admin['token']}"},
    )
    assert admin_delete.status_code == 200, admin_delete.text
    assert admin_delete.json()["deleted_count"] == 2
    assert client.get(f"/topics/{topic_id}/posts").json() == []


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
        if latest_status.json()["status"] == "completed":
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
    assert post.json()["body"] == "这是一条通过 /api/v1 发布的完整讨论帖子，用来验证发帖链路。"
    reply = client.post(
        f"/api/v1/topics/{topic_id}/posts",
        json={
            "author": "bob",
            "body": "这是一条回帖，用来验证统计。",
            "in_reply_to_id": post.json()["id"],
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
            {"post_id": post.json()["id"], "topic_id": topic_id, "user_id": 1002, "auth_type": "test"},
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
        }

    monkeypatch.setattr(openclaw_module, "_load_site_stats", fake_load_site_stats)

    first = client.get("/api/v1/home")
    second = client.get("/api/v1/home")

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json()["site_stats"] == second.json()["site_stats"]
    assert first.json()["site_stats"]["topics_count"] == 5
    assert load_calls["count"] == 1


def test_openclaw_key_can_bind_user_identity_and_render_personal_skill(client):
    from app.storage.database.postgres_client import get_db_session

    phone = f"138{int(time.time() * 1000) % 100000000:08d}"
    hashed_password = bcrypt.hashpw("password123".encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    with get_db_session() as session:
        session.execute(
            text(
                """
                INSERT INTO users (phone, password, username)
                VALUES (:phone, :password, :username)
                """
            ),
            {
                "phone": phone,
                "password": hashed_password,
                "username": "openclaw-user",
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
    assert raw_key.startswith("tloc_")
    assert key_payload["skill_path"].endswith(raw_key)

    skill_resp = client.get(f"/api/v1/openclaw/skill.md?key={raw_key}")
    assert skill_resp.status_code == 200, skill_resp.text
    assert "OpenClaw 绑定 Key" in skill_resp.text
    assert raw_key in skill_resp.text
    assert "GET /api/v1/topics/categories/{category_id}/profile" in skill_resp.text

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
    assert topic["creator_name"] == "openclaw-user"
    assert topic["creator_auth_type"] == "openclaw_key"
    topic_id = topic["id"]
    post_resp = client.post(
        f"/api/v1/topics/{topic_id}/posts",
        headers={"Authorization": f"Bearer {raw_key}"},
        json={"author": "spoofed-author", "body": "这条帖子应该归属 openclaw-user"},
    )
    assert post_resp.status_code == 201, post_resp.text
    assert post_resp.json()["author"] == "openclaw-user"

    delete_resp = client.delete(
        f"/api/v1/topics/{topic_id}/posts/{post_resp.json()['id']}",
        headers={"Authorization": f"Bearer {raw_key}"},
    )
    assert delete_resp.status_code == 200, delete_resp.text
    assert delete_resp.json()["ok"] is True

    posts_after_delete = client.get(f"/api/v1/topics/{topic_id}/posts")
    assert posts_after_delete.status_code == 200, posts_after_delete.text
    assert posts_after_delete.json() == []
