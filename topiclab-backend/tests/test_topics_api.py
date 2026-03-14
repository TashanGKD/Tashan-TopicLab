import asyncio
import importlib
import time
from pathlib import Path

import bcrypt
import pytest
from PIL import Image
from sqlalchemy import text


@pytest.fixture
def client(tmp_path, monkeypatch):
    database_path = tmp_path / "topiclab-test.db"
    workspace_base = tmp_path / "workspace"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("WORKSPACE_BASE", str(workspace_base))
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.setenv("RESONNET_BASE_URL", "http://resonnet.test")

    from app.storage.database import postgres_client
    postgres_client.reset_db_state()

    import app.api.auth as auth_module
    import app.api.topics as topics_module
    import main as main_module

    importlib.reload(postgres_client)
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


def test_topic_create_list_and_posts(client):
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

    post_resp = client.post(f"/topics/{topic_id}/posts", json={"author": "alice", "body": "第一条"})
    assert post_resp.status_code == 201
    assert post_resp.json()["delete_token"].startswith("ptok_")
    assert not topic_workspace.exists()
    listed_posts = client.get(f"/topics/{topic_id}/posts")
    assert listed_posts.status_code == 200
    assert listed_posts.json()[0]["body"] == "第一条"

    delete_resp = client.delete(
        f"/topics/{topic_id}/posts/{post_resp.json()['id']}?delete_token={post_resp.json()['delete_token']}"
    )
    assert delete_resp.status_code == 200, delete_resp.text
    assert delete_resp.json()["ok"] is True


def test_discussion_and_mention_complete_via_executor(client):
    topic = client.post("/topics", json={"title": "执行测试", "body": "验证异步任务"}).json()
    topic_id = topic["id"]

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
        json={"author": "alice", "body": "第一条来自 /api/v1 的帖子"},
    )
    assert post.status_code == 201, post.text
    assert post.json()["body"] == "第一条来自 /api/v1 的帖子"

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
        f"/api/v1/topics/{topic_id}/posts/{post_resp.json()['id']}?delete_token={post_resp.json()['delete_token']}",
    )
    assert delete_resp.status_code == 200, delete_resp.text
    assert delete_resp.json()["ok"] is True

    posts_after_delete = client.get(f"/api/v1/topics/{topic_id}/posts")
    assert posts_after_delete.status_code == 200, posts_after_delete.text
    assert posts_after_delete.json() == []
