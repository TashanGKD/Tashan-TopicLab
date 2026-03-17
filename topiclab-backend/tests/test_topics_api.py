import asyncio
import importlib
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

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

    delete_resp = client.delete(
        f"/topics/{topic_id}/posts/{post_payload['post']['id']}",
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

    async def fake_hydrate_topic_workspace(topic_id: str, article_ids: list[int]):
        return {"topic_id": topic_id, "article_ids": article_ids, "written_files": []}

    async def fake_request_json(method, path, *, json_body=None, headers=None, params=None, timeout=600.0):
        if path == "/executor/topics/bootstrap":
            return {"ok": True, "topic_id": json_body["topic_id"]}
        return {}

    monkeypatch.setattr(source_feed_module, "fetch_source_feed_article_detail", fake_fetch_source_feed_article_detail)
    monkeypatch.setattr(source_feed_module, "hydrate_topic_workspace", fake_hydrate_topic_workspace)
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
        payload = latest_status.json()
        if payload["status"] == "completed" and payload["result"]["discussion_summary"]:
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

    topic = client.post("/topics", json={"title": "超时测试", "body": "测试"}).json()
    topic_id = topic["id"]
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
    assert "/api/v1/openclaw/skills/{module_name}.md" in skill_resp.text
    assert "/api/v1/openclaw/skills/topic-community.md" in skill_resp.text
    assert "/api/v1/openclaw/skills/source-and-research.md" in skill_resp.text
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


def test_openclaw_dedicated_routes_require_auth(client):
    """OpenClaw dedicated routes reject requests without Authorization."""
    topic_resp = client.post(
        "/api/v1/openclaw/topics",
        json={"title": "匿名开题", "body": "应被拒绝"},
    )
    assert topic_resp.status_code == 401, topic_resp.text


def test_openclaw_dedicated_routes_create_topic_and_post(client):
    """OpenClaw dedicated routes create topic/post with OpenClaw key; author derived from user."""
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
                "username": "dedicated-user",
            },
        )

    login = client.post("/api/v1/auth/login", json={"phone": phone, "password": "password123"})
    assert login.status_code == 200, login.text
    key_resp = client.post(
        "/api/v1/auth/openclaw-key",
        headers={"Authorization": f"Bearer {login.json()['token']}"},
    )
    assert key_resp.status_code == 200, key_resp.text
    raw_key = key_resp.json()["key"]

    topic_resp = client.post(
        "/api/v1/openclaw/topics",
        headers={"Authorization": f"Bearer {raw_key}"},
        json={"title": "专用路由开题", "body": "正文", "category": "plaza"},
    )
    assert topic_resp.status_code == 201, topic_resp.text
    topic = topic_resp.json()
    assert topic["creator_name"] == "dedicated-user's openclaw"
    assert topic["creator_auth_type"] == "openclaw_key"
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


def test_openclaw_module_skill_markdown_is_served(client):
    resp = client.get("/api/v1/openclaw/skills/source-and-research.md")
    topic_resp = client.get("/api/v1/openclaw/skills/topic-community.md")

    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("text/markdown")
    assert "学术检索" in resp.text
    assert "/api/v1/source-feed/articles" in resp.text
    assert "/api/v1/literature/recent" in resp.text
    assert "/api/v1/aminer/paper/search" in resp.text
    assert "title=llm" in resp.text

    assert topic_resp.status_code == 200, topic_resp.text
    assert "/api/v1/topics/{topic_id}/posts/{post_id}/replies" in topic_resp.text
    assert "/api/v1/topics/{topic_id}/posts/{post_id}/thread" in topic_resp.text
    assert "/api/v1/me/favorite-categories" in topic_resp.text


def test_openclaw_module_skill_returns_404_for_unknown_module(client):
    resp = client.get("/api/v1/openclaw/skills/not-exists.md")

    assert resp.status_code == 404, resp.text
    assert "Unknown OpenClaw skill module" in resp.text


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
