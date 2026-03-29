"""Run a realistic Agent Space skill flow against a local TopicLab app."""

from __future__ import annotations

import importlib
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import text


BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
REPORT_PATH = REPO_ROOT / "AGENT_SPACE_E2E_REPORT.md"
RESULT_JSON_PATH = REPO_ROOT / "AGENT_SPACE_E2E_RESULT.json"
SOURCE_DOCS = [
    REPO_ROOT / "agent-space-spec" / "docs" / "topiclab-agent-space-minimum-product.md",
    REPO_ROOT / "agent-space-spec" / "docs" / "agent-space-acl-inbox-skill-interface-draft.md",
    REPO_ROOT / "agent-space-spec" / "docs" / "topiclab-agent-space-additive-design.md",
    REPO_ROOT / "agent-space-spec" / "docs" / "topiclab-agent-space-implementation-plan.md",
]

sys.path.insert(0, str(BACKEND_ROOT))


def _configure_environment(tmp_dir: Path) -> None:
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_dir / 'agent-space-e2e.db'}"
    os.environ["WORKSPACE_BASE"] = str(tmp_dir / "workspace")
    os.environ["JWT_SECRET"] = "agent-space-e2e-secret"
    os.environ["TOPICLAB_TESTING"] = "1"


def _load_app():
    from app.storage.database import postgres_client

    postgres_client.reset_db_state()

    import app.api.agent_space as agent_space_module
    import app.api.auth as auth_module
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
    register.raise_for_status()
    payload = register.json()
    return {"token": payload["token"], "user": payload["user"]}


def _register_login_and_openclaw_key(client, *, phone: str, username: str) -> dict:
    auth = _register_and_login(client, phone=phone, username=username)
    key_resp = client.post(
        "/api/v1/auth/openclaw-key",
        headers={"Authorization": f"Bearer {auth['token']}"},
    )
    key_resp.raise_for_status()
    payload = key_resp.json()
    return {
        **auth,
        "openclaw_key": payload["key"],
        "bind_key": payload["bind_key"],
        "agent_uid": payload["agent_uid"],
    }


def _build_uploaded_body() -> str:
    sections: list[str] = [
        "# TopicLab Agent Space 详细说明（测试上传材料）",
        "",
        "这份材料用于验证 Agent Space skill 的真实上传、授权与读取链路。",
        "它汇总自当前最终上传目录中的 Agent Space 规格文档。",
        "",
        "## 来源文件",
        "",
    ]
    for path in SOURCE_DOCS:
        sections.append(f"- `{path.relative_to(REPO_ROOT)}`")
    sections.append("")
    for path in SOURCE_DOCS:
        sections.extend(
            [
                f"## Source: {path.name}",
                "",
                path.read_text(encoding="utf-8").strip(),
                "",
            ]
        )
    return "\n".join(sections).strip() + "\n"


def _short_excerpt(text: str, limit: int = 280) -> str:
    compact = " ".join(text.split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 3] + "..."


def _redact_skill_excerpt(text: str) -> str:
    lines: list[str] = []
    for line in text.splitlines()[:18]:
        if "Runtime Key：" in line:
            lines.append("- Runtime Key：`<redacted>`")
        else:
            lines.append(line)
    return "\n".join(lines)


def _write_report(result: dict) -> None:
    lines = [
        "# Agent Space Skill E2E Report",
        "",
        f"- Run At: `{result['run_at']}`",
        f"- Backend Root: `{BACKEND_ROOT}`",
        f"- Report JSON: `{RESULT_JSON_PATH}`",
        "",
        "## Source Material",
        "",
    ]
    for path in result["source_docs"]:
        lines.append(f"- `{path}`")
    lines.extend(
        [
            "",
            "## Agents",
            "",
            f"- Owner Agent UID: `{result['owner']['agent_uid']}`",
            f"- Requester Agent UID: `{result['requester']['agent_uid']}`",
            "",
            "## Skill Check",
            "",
            "Owner 通过 bind key 读取到的 skill 片段：",
            "",
            "```markdown",
            result["owner_skill_excerpt"],
            "```",
            "",
            "## Flow",
            "",
            f"1. Owner 创建子空间 `{result['subspace']['slug']}`，ID 为 `{result['subspace']['id']}`。",
            f"2. Owner 上传文档 `{result['document']['title']}`，正文长度 `{result['document']['body_length']}` 字符。",
            f"3. Requester 在 directory 中发现 owner，并看到 `viewer_context.is_friend={result['directory_before_friend']['is_friend']}`。",
            f"4. Requester 发起好友请求 `{result['friend_request']['id']}`。",
            f"5. Owner inbox 收到 `{result['owner_inbox']['message_type']}` 消息并批准，双方成为好友。",
            f"6. Owner 直接把子空间读权限授予 requester，ACL grant 为 `{result['acl_grant']['id']}`。",
            f"7. Requester inbox 收到 `{result['requester_inbox']['message_type']}` 消息，并调用 `read-all` 清空未读。",
            f"8. Requester 成功读取文档，摘录如下：",
            "",
            "```text",
            result["retrieved_excerpt"],
            "```",
            "",
            "## Verification",
            "",
            f"- Directory Before Friendship: `is_friend={result['directory_before_friend']['is_friend']}`",
            f"- Directory After Friendship: `is_friend={result['directory_after_friend']['is_friend']}`",
            f"- Friend List: `owner_friend_count={result['friendship']['owner_friend_count']}`, `requester_friend_count={result['friendship']['requester_friend_count']}`",
            f"- ACL Grant After Friendship: `document_count={result['accessible_subspace']['document_count']}`, `granted_by={result['accessible_subspace']['granted_by_openclaw_agent_id']}`",
            f"- Requester Inbox After Read-All: `unread_count={result['requester_inbox_after_read_all']}`",
            "",
            "结论：本地 TopicLab 已经可以让智能体按 Agent Space skill 完成“上传详细说明 -> 好友申请 -> inbox 审批 -> owner 直接授权 -> 授权读取”的完整闭环。",
            "",
        ]
    )
    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")
    RESULT_JSON_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    uploaded_body = _build_uploaded_body()
    run_at = datetime.now(timezone.utc).isoformat()
    temp_dir = Path(tempfile.mkdtemp(prefix="agent-space-e2e-", dir=str(REPO_ROOT)))
    try:
        _configure_environment(temp_dir)
        client, postgres_client = _load_app()
        with client:
            owner = _register_login_and_openclaw_key(
                client,
                phone="13800012001",
                username="agent-space-owner-e2e",
            )
            requester = _register_login_and_openclaw_key(
                client,
                phone="13800012002",
                username="agent-space-requester-e2e",
            )

            owner_headers = {"Authorization": f"Bearer {owner['openclaw_key']}"}
            requester_headers = {"Authorization": f"Bearer {requester['openclaw_key']}"}

            owner_skill = client.get(
                f"/api/v1/openclaw/agent-space/skill.md?key={owner['bind_key']}"
            )
            owner_skill.raise_for_status()
            requester_skill = client.get(
                f"/api/v1/openclaw/agent-space/skill.md?key={requester['bind_key']}"
            )
            requester_skill.raise_for_status()

            owner_me = client.get("/api/v1/openclaw/agent-space/me", headers=owner_headers)
            owner_me.raise_for_status()

            create_subspace = client.post(
                "/api/v1/openclaw/agent-space/subspaces",
                headers=owner_headers,
                json={
                    "slug": "agent_space_project_spec",
                    "name": "Agent Space 项目说明",
                    "description": "我们想做的这个事的详细说明与实现约束",
                    "default_policy": "allowlist",
                    "is_requestable": True,
                },
            )
            create_subspace.raise_for_status()
            subspace = create_subspace.json()["subspace"]

            upload = client.post(
                f"/api/v1/openclaw/agent-space/subspaces/{subspace['id']}/documents",
                headers=owner_headers,
                json={
                    "title": "TopicLab Agent Space 详细说明（整包）",
                    "content_format": "markdown",
                    "body_text": uploaded_body,
                    "source_uri": "local://agent-space-spec/full-bundle.md",
                    "metadata": {
                        "doc_type": "project_spec_bundle",
                        "source_files": [str(path.relative_to(REPO_ROOT)) for path in SOURCE_DOCS],
                    },
                },
            )
            upload.raise_for_status()
            document = upload.json()["document"]

            directory_before_friend = client.get(
                "/api/v1/openclaw/agent-space/directory?q=owner-e2e",
                headers=requester_headers,
            )
            directory_before_friend.raise_for_status()
            directory_item_before = next(
                item
                for item in directory_before_friend.json()["items"]
                if item["owner_agent_uid"] == owner["agent_uid"]
            )
            subspace_before = next(
                item for item in directory_item_before["requestable_subspaces"] if item["id"] == subspace["id"]
            )

            create_friend_request = client.post(
                "/api/v1/openclaw/agent-space/friends/requests",
                headers=requester_headers,
                json={
                    "recipient_agent_uid": owner["agent_uid"],
                    "message": "我想先成为好友，再直接读取这份详细说明。",
                },
            )
            create_friend_request.raise_for_status()
            friend_request = create_friend_request.json()["request"]

            owner_inbox = client.get("/api/v1/openclaw/agent-space/inbox", headers=owner_headers)
            owner_inbox.raise_for_status()
            owner_inbox_item = owner_inbox.json()["items"][0]

            approve_friend_request = client.post(
                f"/api/v1/openclaw/agent-space/friends/requests/{friend_request['id']}/approve",
                headers=owner_headers,
            )
            approve_friend_request.raise_for_status()

            owner_friends = client.get("/api/v1/openclaw/agent-space/friends", headers=owner_headers)
            owner_friends.raise_for_status()
            requester_me = client.get("/api/v1/openclaw/agent-space/me", headers=requester_headers)
            requester_me.raise_for_status()

            directory_after_friend = client.get(
                "/api/v1/openclaw/agent-space/directory?q=owner-e2e",
                headers=requester_headers,
            )
            directory_after_friend.raise_for_status()
            directory_item_after = next(
                item
                for item in directory_after_friend.json()["items"]
                if item["owner_agent_uid"] == owner["agent_uid"]
            )

            grant_acl = client.post(
                f"/api/v1/openclaw/agent-space/subspaces/{subspace['id']}/acl/grants",
                headers=owner_headers,
                json={"grantee_agent_uid": requester["agent_uid"]},
            )
            grant_acl.raise_for_status()
            acl_grant = grant_acl.json()["grant"]

            requester_inbox = client.get(
                "/api/v1/openclaw/agent-space/inbox",
                headers=requester_headers,
            )
            requester_inbox.raise_for_status()
            requester_inbox_item = requester_inbox.json()["items"][0]

            requester_subspaces = client.get(
                "/api/v1/openclaw/agent-space/subspaces",
                headers=requester_headers,
            )
            requester_subspaces.raise_for_status()
            accessible_subspace = next(
                item
                for item in requester_subspaces.json()["accessible_subspaces"]
                if item["id"] == subspace["id"]
            )

            docs = client.get(
                f"/api/v1/openclaw/agent-space/subspaces/{subspace['id']}/documents",
                headers=requester_headers,
            )
            docs.raise_for_status()
            doc_item = docs.json()["items"][0]

            detail = client.get(
                f"/api/v1/openclaw/agent-space/documents/{document['id']}",
                headers=requester_headers,
            )
            detail.raise_for_status()
            retrieved_body = detail.json()["document"]["body_text"]

            requester_read_all = client.post(
                "/api/v1/openclaw/agent-space/inbox/read-all",
                headers=requester_headers,
            )
            requester_read_all.raise_for_status()
            requester_inbox_after_read_all = client.get(
                "/api/v1/openclaw/agent-space/inbox",
                headers=requester_headers,
            )
            requester_inbox_after_read_all.raise_for_status()

            result = {
                "run_at": run_at,
                "source_docs": [str(path.relative_to(REPO_ROOT)) for path in SOURCE_DOCS],
                "owner": {"agent_uid": owner["agent_uid"]},
                "requester": {"agent_uid": requester["agent_uid"]},
                "owner_skill_excerpt": _redact_skill_excerpt(owner_skill.text),
                "requester_skill_excerpt": _redact_skill_excerpt(requester_skill.text),
                "subspace": {
                    "id": subspace["id"],
                    "slug": subspace["slug"],
                    "name": subspace["name"],
                },
                "document": {
                    "id": document["id"],
                    "title": document["title"],
                    "body_length": len(uploaded_body),
                    "listed_id": doc_item["id"],
                },
                "directory_before_friend": {
                    "is_friend": directory_item_before["viewer_context"]["is_friend"],
                    "has_read_access": subspace_before["viewer_context"]["has_read_access"],
                    "document_count": subspace_before["document_count"],
                },
                "friend_request": {
                    "id": friend_request["id"],
                    "status": approve_friend_request.json()["request"]["status"],
                },
                "directory_after_friend": {
                    "is_friend": directory_item_after["viewer_context"]["is_friend"],
                },
                "friendship": {
                    "owner_friend_count": len(owner_friends.json()["items"]),
                    "requester_friend_count": len(requester_me.json()["friends"]),
                },
                "owner_inbox": {
                    "message_id": owner_inbox_item["id"],
                    "message_type": owner_inbox_item["message_type"],
                },
                "requester_inbox": {
                    "message_id": requester_inbox_item["id"],
                    "message_type": requester_inbox_item["message_type"],
                },
                "acl_grant": acl_grant,
                "accessible_subspace": {
                    "id": accessible_subspace["id"],
                    "document_count": accessible_subspace["document_count"],
                    "granted_by_openclaw_agent_id": accessible_subspace["access"][
                        "granted_by_openclaw_agent_id"
                    ],
                    "granted_at": accessible_subspace["access"]["granted_at"],
                },
                "retrieved_excerpt": _short_excerpt(retrieved_body),
                "requester_inbox_after_read_all": requester_inbox_after_read_all.json()[
                    "unread_count"
                ],
            }
            _write_report(result)
            print(f"report_markdown={REPORT_PATH}")
            print(f"report_json={RESULT_JSON_PATH}")
            print(f"uploaded_document_id={document['id']}")
            print(f"friend_request_id={friend_request['id']}")
        postgres_client.reset_db_state()
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
