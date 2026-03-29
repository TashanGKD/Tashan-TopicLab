import importlib
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import text


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _make_client(tmp_path, monkeypatch):
    database_path = tmp_path / "topiclab-agent-space-test.db"
    workspace_base = tmp_path / "workspace"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("WORKSPACE_BASE", str(workspace_base))
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.setenv("TOPICLAB_TESTING", "1")

    from app.storage.database import postgres_client

    postgres_client.reset_db_state()

    import app.api.auth as auth_module
    import app.api.agent_space as agent_space_module
    import main as main_module

    importlib.reload(postgres_client)
    importlib.reload(auth_module)
    importlib.reload(agent_space_module)
    main_module = importlib.reload(main_module)

    from fastapi.testclient import TestClient

    return TestClient(main_module.app), postgres_client


def _register_and_login(client, *, phone: str, username: str, password: str = "password123") -> dict:
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
    payload = register.json()
    return {"token": payload["token"], "user": payload["user"]}


def _register_login_and_openclaw_key(client, *, phone: str, username: str) -> dict:
    auth = _register_and_login(client, phone=phone, username=username)
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
        "agent_uid": payload["agent_uid"],
    }


def test_agent_space_me_lazily_creates_root_space(tmp_path, monkeypatch):
    client, postgres_client = _make_client(tmp_path, monkeypatch)
    with client:
        actor = _register_login_and_openclaw_key(client, phone="13800011001", username="agent-space-owner")
        headers = {"Authorization": f"Bearer {actor['openclaw_key']}"}

        resp = client.get("/api/v1/openclaw/agent-space/me", headers=headers)
        assert resp.status_code == 200, resp.text
        payload = resp.json()
        assert payload["agent"]["agent_uid"] == actor["agent_uid"]
        assert payload["root_space"]["owner_agent_uid"] == actor["agent_uid"]
        assert payload["owned_subspaces"] == []
        assert payload["accessible_subspaces"] == []
    postgres_client.reset_db_state()


def test_agent_space_upload_and_owner_list(tmp_path, monkeypatch):
    client, postgres_client = _make_client(tmp_path, monkeypatch)
    with client:
        actor = _register_login_and_openclaw_key(client, phone="13800011002", username="agent-space-doc-owner")
        headers = {"Authorization": f"Bearer {actor['openclaw_key']}"}

        create_subspace = client.post(
            "/api/v1/openclaw/agent-space/subspaces",
            headers=headers,
            json={
                "slug": "product_judgment",
                "name": "产品判断",
                "description": "产品与策略判断材料",
                "default_policy": "allowlist",
                "is_requestable": True,
            },
        )
        assert create_subspace.status_code == 201, create_subspace.text
        subspace = create_subspace.json()["subspace"]

        upload = client.post(
            f"/api/v1/openclaw/agent-space/subspaces/{subspace['id']}/documents",
            headers=headers,
            json={
                "title": "增长判断 2026-03",
                "content_format": "markdown",
                "body_text": "# 结论\n\n我们应该优先提高留存。",
                "source_uri": "local://notes/growth.md",
                "metadata": {"tags": ["growth"]},
            },
        )
        assert upload.status_code == 201, upload.text
        document = upload.json()["document"]

        listed = client.get(
            f"/api/v1/openclaw/agent-space/subspaces/{subspace['id']}/documents",
            headers=headers,
        )
        assert listed.status_code == 200, listed.text
        assert [item["id"] for item in listed.json()["items"]] == [document["id"]]

        detail = client.get(
            f"/api/v1/openclaw/agent-space/documents/{document['id']}",
            headers=headers,
        )
        assert detail.status_code == 200, detail.text
        assert detail.json()["document"]["body_text"] == "# 结论\n\n我们应该优先提高留存。"
    postgres_client.reset_db_state()


def test_agent_space_access_request_approval_flow_and_separate_inbox(tmp_path, monkeypatch):
    client, postgres_client = _make_client(tmp_path, monkeypatch)
    with client:
        owner = _register_login_and_openclaw_key(client, phone="13800011003", username="space-owner")
        requester = _register_login_and_openclaw_key(client, phone="13800011004", username="space-requester")

        owner_headers = {"Authorization": f"Bearer {owner['openclaw_key']}"}
        requester_headers = {"Authorization": f"Bearer {requester['openclaw_key']}"}
        owner_jwt_headers = {"Authorization": f"Bearer {owner['token']}"}

        create_subspace = client.post(
            "/api/v1/openclaw/agent-space/subspaces",
            headers=owner_headers,
            json={
                "slug": "strategy_notes",
                "name": "战略判断",
                "description": "战略层判断材料",
                "default_policy": "allowlist",
                "is_requestable": True,
            },
        )
        assert create_subspace.status_code == 201, create_subspace.text
        subspace = create_subspace.json()["subspace"]

        upload = client.post(
            f"/api/v1/openclaw/agent-space/subspaces/{subspace['id']}/documents",
            headers=owner_headers,
            json={
                "title": "战略优先级",
                "content_format": "markdown",
                "body_text": "先做 B2B，再做平台。",
            },
        )
        assert upload.status_code == 201, upload.text
        document_id = upload.json()["document"]["id"]

        directory = client.get("/api/v1/openclaw/agent-space/directory?q=owner", headers=requester_headers)
        assert directory.status_code == 200, directory.text
        directory_items = directory.json()["items"]
        owner_directory_item = next(
            item for item in directory_items if item["owner_agent_uid"] == owner["agent_uid"]
        )
        assert owner_directory_item["viewer_context"]["is_self"] is False
        requestable_subspace = next(
            item for item in owner_directory_item["requestable_subspaces"] if item["id"] == subspace["id"]
        )
        assert requestable_subspace["document_count"] == 1
        assert requestable_subspace["pending_request_count"] == 0
        assert requestable_subspace["viewer_context"]["has_read_access"] is False
        assert requestable_subspace["viewer_context"]["has_pending_request"] is False

        create_request = client.post(
            f"/api/v1/openclaw/agent-space/subspaces/{subspace['id']}/access-requests",
            headers=requester_headers,
            json={"message": "需要读取这个空间来对齐我们的方向。"},
        )
        assert create_request.status_code == 201, create_request.text
        request_id = create_request.json()["request"]["id"]

        directory_after_request = client.get(
            "/api/v1/openclaw/agent-space/directory?q=owner",
            headers=requester_headers,
        )
        assert directory_after_request.status_code == 200, directory_after_request.text
        owner_directory_item = next(
            item
            for item in directory_after_request.json()["items"]
            if item["owner_agent_uid"] == owner["agent_uid"]
        )
        requestable_subspace = next(
            item for item in owner_directory_item["requestable_subspaces"] if item["id"] == subspace["id"]
        )
        assert requestable_subspace["pending_request_count"] == 1
        assert requestable_subspace["viewer_context"]["has_pending_request"] is True
        assert requestable_subspace["viewer_context"]["pending_request_id"] == request_id

        owner_me = client.get("/api/v1/openclaw/agent-space/me", headers=owner_headers)
        assert owner_me.status_code == 200, owner_me.text
        owned_subspace = next(
            item for item in owner_me.json()["owned_subspaces"] if item["id"] == subspace["id"]
        )
        assert owned_subspace["document_count"] == 1
        assert owned_subspace["pending_request_count"] == 1

        owner_agent_inbox = client.get("/api/v1/openclaw/agent-space/inbox", headers=owner_headers)
        assert owner_agent_inbox.status_code == 200, owner_agent_inbox.text
        assert owner_agent_inbox.json()["unread_count"] == 1
        assert owner_agent_inbox.json()["items"][0]["request"]["id"] == request_id
        owner_inbox_message_id = owner_agent_inbox.json()["items"][0]["id"]

        owner_read_all = client.post("/api/v1/openclaw/agent-space/inbox/read-all", headers=owner_headers)
        assert owner_read_all.status_code == 200, owner_read_all.text
        assert owner_read_all.json()["updated_count"] == 1

        owner_agent_inbox_after_read_all = client.get(
            "/api/v1/openclaw/agent-space/inbox",
            headers=owner_headers,
        )
        assert owner_agent_inbox_after_read_all.status_code == 200, owner_agent_inbox_after_read_all.text
        assert owner_agent_inbox_after_read_all.json()["unread_count"] == 0
        assert owner_agent_inbox_after_read_all.json()["items"][0]["id"] == owner_inbox_message_id
        assert owner_agent_inbox_after_read_all.json()["items"][0]["is_read"] is True

        owner_topic_inbox = client.get("/api/v1/me/inbox", headers=owner_jwt_headers)
        assert owner_topic_inbox.status_code == 200, owner_topic_inbox.text
        assert owner_topic_inbox.json()["unread_count"] == 0
        assert owner_topic_inbox.json()["items"] == []

        approve = client.post(
            f"/api/v1/openclaw/agent-space/access-requests/{request_id}/approve",
            headers=owner_headers,
        )
        assert approve.status_code == 200, approve.text
        assert approve.json()["request"]["status"] == "approved"

        requester_subspaces = client.get("/api/v1/openclaw/agent-space/subspaces", headers=requester_headers)
        assert requester_subspaces.status_code == 200, requester_subspaces.text
        accessible_subspaces = requester_subspaces.json()["accessible_subspaces"]
        accessible_ids = {item["id"] for item in accessible_subspaces}
        assert subspace["id"] in accessible_ids
        accessible_subspace = next(item for item in accessible_subspaces if item["id"] == subspace["id"])
        assert accessible_subspace["document_count"] == 1
        assert accessible_subspace["access"]["permission"] == "read"
        assert accessible_subspace["access"]["granted_at"] is not None
        assert (
            accessible_subspace["access"]["granted_by_openclaw_agent_id"]
            == approve.json()["request"]["resolved_by_openclaw_agent_id"]
        )

        requester_agent_inbox = client.get("/api/v1/openclaw/agent-space/inbox", headers=requester_headers)
        assert requester_agent_inbox.status_code == 200, requester_agent_inbox.text
        assert requester_agent_inbox.json()["unread_count"] == 1
        assert requester_agent_inbox.json()["items"][0]["message_type"] == "space_access_approved"

        requester_read_all = client.post(
            "/api/v1/openclaw/agent-space/inbox/read-all",
            headers=requester_headers,
        )
        assert requester_read_all.status_code == 200, requester_read_all.text
        assert requester_read_all.json()["updated_count"] == 1

        requester_agent_inbox_after_read_all = client.get(
            "/api/v1/openclaw/agent-space/inbox",
            headers=requester_headers,
        )
        assert requester_agent_inbox_after_read_all.status_code == 200, requester_agent_inbox_after_read_all.text
        assert requester_agent_inbox_after_read_all.json()["unread_count"] == 0
        assert requester_agent_inbox_after_read_all.json()["items"][0]["is_read"] is True

        docs = client.get(
            f"/api/v1/openclaw/agent-space/subspaces/{subspace['id']}/documents",
            headers=requester_headers,
        )
        assert docs.status_code == 200, docs.text
        assert [item["id"] for item in docs.json()["items"]] == [document_id]

        detail = client.get(
            f"/api/v1/openclaw/agent-space/documents/{document_id}",
            headers=requester_headers,
        )
        assert detail.status_code == 200, detail.text
        assert detail.json()["document"]["body_text"] == "先做 B2B，再做平台。"
    postgres_client.reset_db_state()


def test_agent_space_rejects_jwt_and_blocks_unauthorized_read(tmp_path, monkeypatch):
    client, postgres_client = _make_client(tmp_path, monkeypatch)
    with client:
        owner = _register_login_and_openclaw_key(client, phone="13800011005", username="jwt-owner")
        outsider = _register_login_and_openclaw_key(client, phone="13800011006", username="jwt-outsider")

        owner_headers = {"Authorization": f"Bearer {owner['openclaw_key']}"}
        outsider_headers = {"Authorization": f"Bearer {outsider['openclaw_key']}"}
        owner_jwt_headers = {"Authorization": f"Bearer {owner['token']}"}

        jwt_resp = client.get("/api/v1/openclaw/agent-space/me", headers=owner_jwt_headers)
        assert jwt_resp.status_code == 401, jwt_resp.text

        create_subspace = client.post(
            "/api/v1/openclaw/agent-space/subspaces",
            headers=owner_headers,
            json={
                "slug": "private_notes",
                "name": "私有笔记",
                "description": "仅自己可读",
                "default_policy": "private",
                "is_requestable": False,
            },
        )
        assert create_subspace.status_code == 201, create_subspace.text
        subspace = create_subspace.json()["subspace"]

        upload = client.post(
            f"/api/v1/openclaw/agent-space/subspaces/{subspace['id']}/documents",
            headers=owner_headers,
            json={
                "title": "不对外材料",
                "content_format": "text",
                "body_text": "这段内容不应被 outsider 读取。",
            },
        )
        assert upload.status_code == 201, upload.text
        document_id = upload.json()["document"]["id"]

        docs = client.get(
            f"/api/v1/openclaw/agent-space/subspaces/{subspace['id']}/documents",
            headers=outsider_headers,
        )
        assert docs.status_code == 403, docs.text

        detail = client.get(
            f"/api/v1/openclaw/agent-space/documents/{document_id}",
            headers=outsider_headers,
        )
        assert detail.status_code == 403, detail.text
    postgres_client.reset_db_state()


def test_agent_friendship_and_direct_acl_grant_flow(tmp_path, monkeypatch):
    client, postgres_client = _make_client(tmp_path, monkeypatch)
    with client:
        owner = _register_login_and_openclaw_key(client, phone="13800011008", username="friend-owner")
        requester = _register_login_and_openclaw_key(client, phone="13800011009", username="friend-requester")

        owner_headers = {"Authorization": f"Bearer {owner['openclaw_key']}"}
        requester_headers = {"Authorization": f"Bearer {requester['openclaw_key']}"}

        create_subspace = client.post(
            "/api/v1/openclaw/agent-space/subspaces",
            headers=owner_headers,
            json={
                "slug": "friend_only_notes",
                "name": "好友可读材料",
                "description": "只想直接分享给好友的资料",
                "default_policy": "allowlist",
                "is_requestable": True,
            },
        )
        assert create_subspace.status_code == 201, create_subspace.text
        subspace = create_subspace.json()["subspace"]

        upload = client.post(
            f"/api/v1/openclaw/agent-space/subspaces/{subspace['id']}/documents",
            headers=owner_headers,
            json={
                "title": "好友协作说明",
                "content_format": "markdown",
                "body_text": "这是只分享给好友的资料。",
            },
        )
        assert upload.status_code == 201, upload.text
        document_id = upload.json()["document"]["id"]

        directory_before_friendship = client.get(
            "/api/v1/openclaw/agent-space/directory?q=friend-owner",
            headers=requester_headers,
        )
        assert directory_before_friendship.status_code == 200, directory_before_friendship.text
        directory_item = next(
            item
            for item in directory_before_friendship.json()["items"]
            if item["owner_agent_uid"] == owner["agent_uid"]
        )
        assert directory_item["viewer_context"]["is_friend"] is False

        direct_grant_before_friendship = client.post(
            f"/api/v1/openclaw/agent-space/subspaces/{subspace['id']}/acl/grants",
            headers=owner_headers,
            json={"grantee_agent_uid": requester["agent_uid"]},
        )
        assert direct_grant_before_friendship.status_code == 403, direct_grant_before_friendship.text

        create_friend_request = client.post(
            "/api/v1/openclaw/agent-space/friends/requests",
            headers=requester_headers,
            json={
                "recipient_agent_uid": owner["agent_uid"],
                "message": "希望成为好友，方便后续直接共享认知空间。",
            },
        )
        assert create_friend_request.status_code == 201, create_friend_request.text
        friend_request_id = create_friend_request.json()["request"]["id"]

        owner_incoming_friend_requests = client.get(
            "/api/v1/openclaw/agent-space/friends/requests/incoming",
            headers=owner_headers,
        )
        assert owner_incoming_friend_requests.status_code == 200, owner_incoming_friend_requests.text
        assert owner_incoming_friend_requests.json()["items"][0]["id"] == friend_request_id

        owner_inbox = client.get("/api/v1/openclaw/agent-space/inbox", headers=owner_headers)
        assert owner_inbox.status_code == 200, owner_inbox.text
        assert owner_inbox.json()["items"][0]["message_type"] == "friend_request"
        assert owner_inbox.json()["items"][0]["friend_request"]["id"] == friend_request_id

        approve_friend_request = client.post(
            f"/api/v1/openclaw/agent-space/friends/requests/{friend_request_id}/approve",
            headers=owner_headers,
        )
        assert approve_friend_request.status_code == 200, approve_friend_request.text
        assert approve_friend_request.json()["request"]["status"] == "approved"

        owner_friends = client.get("/api/v1/openclaw/agent-space/friends", headers=owner_headers)
        assert owner_friends.status_code == 200, owner_friends.text
        assert owner_friends.json()["items"][0]["friend"]["agent_uid"] == requester["agent_uid"]

        requester_me = client.get("/api/v1/openclaw/agent-space/me", headers=requester_headers)
        assert requester_me.status_code == 200, requester_me.text
        assert requester_me.json()["friends"][0]["friend"]["agent_uid"] == owner["agent_uid"]

        requester_inbox = client.get("/api/v1/openclaw/agent-space/inbox", headers=requester_headers)
        assert requester_inbox.status_code == 200, requester_inbox.text
        assert requester_inbox.json()["items"][0]["message_type"] == "friend_request_approved"

        directory_after_friendship = client.get(
            "/api/v1/openclaw/agent-space/directory?q=friend-owner",
            headers=requester_headers,
        )
        assert directory_after_friendship.status_code == 200, directory_after_friendship.text
        directory_item = next(
            item
            for item in directory_after_friendship.json()["items"]
            if item["owner_agent_uid"] == owner["agent_uid"]
        )
        assert directory_item["viewer_context"]["is_friend"] is True

        direct_grant = client.post(
            f"/api/v1/openclaw/agent-space/subspaces/{subspace['id']}/acl/grants",
            headers=owner_headers,
            json={"grantee_agent_uid": requester["agent_uid"]},
        )
        assert direct_grant.status_code == 201, direct_grant.text
        assert direct_grant.json()["grant"]["grantee"]["agent_uid"] == requester["agent_uid"]

        acl_list = client.get(
            f"/api/v1/openclaw/agent-space/subspaces/{subspace['id']}/acl",
            headers=owner_headers,
        )
        assert acl_list.status_code == 200, acl_list.text
        assert acl_list.json()["items"][0]["grantee"]["agent_uid"] == requester["agent_uid"]

        docs = client.get(
            f"/api/v1/openclaw/agent-space/subspaces/{subspace['id']}/documents",
            headers=requester_headers,
        )
        assert docs.status_code == 200, docs.text
        assert docs.json()["items"][0]["id"] == document_id

        revoke_grant = client.delete(
            f"/api/v1/openclaw/agent-space/subspaces/{subspace['id']}/acl/grants/{requester_me.json()['agent']['openclaw_agent_id']}",
            headers=owner_headers,
        )
        assert revoke_grant.status_code == 200, revoke_grant.text

        docs_after_revoke = client.get(
            f"/api/v1/openclaw/agent-space/subspaces/{subspace['id']}/documents",
            headers=requester_headers,
        )
        assert docs_after_revoke.status_code == 403, docs_after_revoke.text
    postgres_client.reset_db_state()


def test_agent_space_skill_markdown_supports_bind_key(tmp_path, monkeypatch):
    client, postgres_client = _make_client(tmp_path, monkeypatch)
    with client:
        actor = _register_login_and_openclaw_key(client, phone="13800011007", username="skill-owner")
        resp = client.get(f"/api/v1/openclaw/agent-space/skill.md?key={actor['bind_key']}")
        assert resp.status_code == 200, resp.text
        assert "Module Skill: Agent Space" in resp.text
        assert actor["agent_uid"] in resp.text
    postgres_client.reset_db_state()


def test_openclaw_main_skill_and_module_skill_expose_agent_space(tmp_path, monkeypatch):
    client, postgres_client = _make_client(tmp_path, monkeypatch)
    with client:
        actor = _register_login_and_openclaw_key(client, phone="13800011010", username="main-skill-owner")

        main_skill = client.get(f"/api/v1/openclaw/skill.md?key={actor['bind_key']}")
        assert main_skill.status_code == 200, main_skill.text
        assert "/api/v1/openclaw/skills/agent-space.md" in main_skill.text
        assert "读 `agent-space`" in main_skill.text

        module_skill = client.get("/api/v1/openclaw/skills/agent-space.md")
        assert module_skill.status_code == 200, module_skill.text
        assert "Module Skill: Agent Space" in module_skill.text
        assert "/friends/requests" in module_skill.text
        assert "/acl/grants" in module_skill.text
    postgres_client.reset_db_state()
