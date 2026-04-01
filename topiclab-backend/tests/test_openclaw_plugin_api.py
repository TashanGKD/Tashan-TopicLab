import importlib
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import text


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client(tmp_path, monkeypatch):
    database_name = "topiclab-cli-test.db"
    workspace_base = tmp_path / "workspace"
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_name}")
    monkeypatch.setenv("WORKSPACE_BASE", str(workspace_base))
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.setenv("TOPICLAB_TESTING", "1")

    from app.storage.database import postgres_client

    postgres_client.reset_db_state()

    import app.api.auth as auth_module
    import app.api.openclaw_plugin as openclaw_plugin_module
    import app.api.openclaw_twin_runtime as openclaw_twin_runtime_module
    from app.storage.database.postgres_client import init_auth_tables

    importlib.reload(postgres_client)
    importlib.reload(auth_module)
    importlib.reload(openclaw_plugin_module)
    importlib.reload(openclaw_twin_runtime_module)
    init_auth_tables()

    app = FastAPI()
    app.include_router(auth_module.router, prefix="/auth", tags=["auth"])
    app.include_router(auth_module.router, prefix="/api/v1/auth", tags=["auth-v1"])
    app.include_router(openclaw_plugin_module.router, prefix="/api/v1", tags=["openclaw-cli"])
    app.include_router(openclaw_twin_runtime_module.router, prefix="/api/v1", tags=["openclaw-twins"])

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as test_client:
        yield test_client

    postgres_client.reset_db_state()


async def register_and_login(client, *, phone: str, username: str, password: str = "password123") -> dict:
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

    register = await client.post(
        "/auth/register",
        json={
            "phone": phone,
            "code": code,
            "password": password,
            "username": username,
        },
    )
    assert register.status_code == 200, register.text
    return {"token": register.json()["token"], "user": register.json()["user"]}


async def register_login_and_openclaw_key(client, *, phone: str, username: str, password: str = "password123") -> dict:
    auth = await register_and_login(client, phone=phone, username=username, password=password)
    key_resp = await client.post(
        "/api/v1/auth/openclaw-key",
        headers={"Authorization": f"Bearer {auth['token']}"},
    )
    assert key_resp.status_code == 200, key_resp.text
    payload = key_resp.json()
    return {
        **auth,
        "openclaw_key": payload["key"],
        "agent_uid": payload["agent_uid"],
    }


@pytest.mark.anyio
async def test_cli_manifest_and_policy_pack_with_plugin_aliases(client):
    cli_manifest = await client.get("/api/v1/openclaw/cli-manifest")
    assert cli_manifest.status_code == 200, cli_manifest.text
    cli_manifest_body = cli_manifest.json()
    assert cli_manifest_body["app_id"] == "topiclab"
    assert cli_manifest_body["client_kind"] == "cli"
    assert cli_manifest_body["min_cli_version"] == "0.1.0"
    assert cli_manifest_body["min_shell_version"] == cli_manifest_body["min_cli_version"]
    assert cli_manifest_body["commands"]["twins.get_current"]["enabled"] is True
    assert cli_manifest_body["commands"]["twins.report_requirement"]["enabled"] is True
    assert cli_manifest_body["commands"]["apps.list"]["enabled"] is True
    assert cli_manifest_body["commands"]["apps.topic"]["invocation"] == "topiclab apps topic <app_id> --json"
    assert cli_manifest_body["commands"]["skills.list"]["enabled"] is True
    assert cli_manifest_body["commands"]["skills.search"]["enabled"] is True
    assert cli_manifest_body["commands"]["skills.search"]["invocation"] == "topiclab skills search <query> --json"
    assert cli_manifest_body["commands"]["skills.install"]["invocation"] == "topiclab skills install <skill_id> --json"
    assert cli_manifest_body["commands"]["skills.publish"]["enabled"] is True
    assert cli_manifest_body["commands"]["skills.publish"]["invocation"] == "topiclab skills publish --name <name> --summary <summary> --description <description> --category <key> --content-file <path> --json"
    assert cli_manifest_body["commands"]["skills.review"]["enabled"] is True
    assert cli_manifest_body["commands"]["skills.favorite"]["enabled"] is True
    assert cli_manifest_body["commands"]["skills.wishes_create"]["enabled"] is True
    assert cli_manifest_body["commands"]["skills.profile"]["enabled"] is True
    assert cli_manifest_body["commands"]["skills.version"]["invocation"] == "topiclab skills version <skill_id> --version <version> --content-file <path> --json"
    assert cli_manifest_body["commands"]["notifications.list"]["enabled"] is True
    assert cli_manifest_body["commands"]["help.ask"]["enabled"] is True
    assert "apps" in cli_manifest_body["command_groups"]
    assert "skills" in cli_manifest_body["command_groups"]
    assert "help" in cli_manifest_body["command_groups"]

    plugin_manifest = await client.get("/api/v1/openclaw/plugin-manifest")
    assert plugin_manifest.status_code == 200, plugin_manifest.text
    plugin_manifest_body = plugin_manifest.json()
    assert plugin_manifest_body["manifest_version"] == cli_manifest_body["manifest_version"]
    assert plugin_manifest_body["commands"]["session.ensure"]["invocation"] == "topiclab session ensure --json"

    cli_policy = await client.get("/api/v1/openclaw/cli-policy-pack")
    assert cli_policy.status_code == 200, cli_policy.text
    cli_policy_body = cli_policy.json()
    assert cli_policy_body["client_kind"] == "cli"
    assert cli_policy_body["scene_mapping"]["research"] == "forum.research"
    assert cli_policy_body["twin_runtime"]["allow_observation_write"] is True

    plugin_policy = await client.get("/api/v1/openclaw/policy-pack")
    assert plugin_policy.status_code == 200, plugin_policy.text
    plugin_policy_body = plugin_policy.json()
    assert plugin_policy_body["policy_version"] == cli_policy_body["policy_version"]


@pytest.mark.anyio
async def test_upsert_digital_twin_dual_writes_and_preserves_legacy(client):
    auth = await register_and_login(client, phone="13800000001", username="alice")
    headers = {"Authorization": f"Bearer {auth['token']}"}

    first = await client.post(
        "/api/v1/auth/digital-twins/upsert",
        headers=headers,
        json={
            "agent_name": "my_twin_001",
            "display_name": "Alice Twin",
            "expert_name": "alice_twin",
            "visibility": "private",
            "exposure": "brief",
            "source": "profile_twin",
            "role_content": "# Alice Twin\n\n## Identity\n\nResearcher",
        },
    )
    assert first.status_code == 200, first.text
    first_body = first.json()
    assert first_body["twin_id"]
    assert first_body["twin_version"] == 1

    second = await client.post(
        "/api/v1/auth/digital-twins/upsert",
        headers=headers,
        json={
            "agent_name": "my_twin_002",
            "display_name": "Alice Twin",
            "expert_name": "alice_twin",
            "visibility": "private",
            "exposure": "full",
            "source": "profile_twin",
            "role_content": "# Alice Twin\n\n## Identity\n\nResearcher\n\n## Expertise\n\nAgents",
        },
    )
    assert second.status_code == 200, second.text
    second_body = second.json()
    assert second_body["twin_id"] == first_body["twin_id"]
    assert second_body["twin_version"] == 2

    legacy_list = await client.get("/api/v1/auth/digital-twins", headers=headers)
    assert legacy_list.status_code == 200, legacy_list.text
    assert len(legacy_list.json()["digital_twins"]) == 2

    from app.storage.database.postgres_client import get_db_session

    with get_db_session() as session:
        twin_core_count = session.execute(text("SELECT COUNT(*) FROM twin_core")).scalar()
        active_count = session.execute(text("SELECT COUNT(*) FROM twin_core WHERE is_active = TRUE")).scalar()
        snapshot_count = session.execute(text("SELECT COUNT(*) FROM twin_snapshots")).scalar()
    assert twin_core_count == 1
    assert active_count == 1
    assert snapshot_count == 2


@pytest.mark.anyio
async def test_current_twin_backfills_from_legacy_only(client):
    auth = await register_login_and_openclaw_key(client, phone="13800000002", username="bob")

    from app.storage.database.postgres_client import get_db_session

    with get_db_session() as session:
        session.execute(
            text(
                """
                INSERT INTO digital_twins (
                    user_id, agent_name, display_name, expert_name,
                    visibility, exposure, session_id, source, role_content, updated_at, created_at
                ) VALUES (
                    :user_id, :agent_name, :display_name, :expert_name,
                    'private', 'brief', NULL, 'profile_twin', :role_content, :updated_at, :created_at
                )
                """
            ),
            {
                "user_id": auth["user"]["id"],
                "agent_name": "legacy_twin_001",
                "display_name": "Bob Twin",
                "expert_name": "bob_twin",
                "role_content": "# Bob Twin\n\n## Identity\n\nBuilder",
                "updated_at": datetime.now(timezone.utc),
                "created_at": datetime.now(timezone.utc),
            },
        )

    current = await client.get(
        "/api/v1/openclaw/twins/current",
        headers={"Authorization": f"Bearer {auth['openclaw_key']}"},
    )
    assert current.status_code == 200, current.text
    current_body = current.json()
    assert current_body["twin"]["display_name"] == "Bob Twin"
    assert current_body["twin"]["twin_id"].startswith("twin_")

    with get_db_session() as session:
        twin_core_count = session.execute(text("SELECT COUNT(*) FROM twin_core")).scalar()
        snapshot_count = session.execute(text("SELECT COUNT(*) FROM twin_snapshots")).scalar()
    assert twin_core_count == 1
    assert snapshot_count >= 1


@pytest.mark.anyio
async def test_backfill_helper_is_idempotent_for_legacy_twins(client, monkeypatch):
    monkeypatch.setenv("ADMIN_PHONE_NUMBERS", "13800000009")
    admin = await register_and_login(client, phone="13800000009", username="admin")
    user_one = await register_and_login(client, phone="13800000010", username="eve")
    user_two = await register_and_login(client, phone="13800000011", username="frank")

    from app.storage.database.postgres_client import get_db_session

    with get_db_session() as session:
        for user_id, agent_name, display_name in (
            (user_one["user"]["id"], "legacy_eve_001", "Eve Twin"),
            (user_two["user"]["id"], "legacy_frank_001", "Frank Twin"),
        ):
            session.execute(
                text(
                    """
                    INSERT INTO digital_twins (
                        user_id, agent_name, display_name, expert_name,
                        visibility, exposure, session_id, source, role_content, updated_at, created_at
                    ) VALUES (
                        :user_id, :agent_name, :display_name, :expert_name,
                        'private', 'brief', NULL, 'profile_twin', :role_content, :updated_at, :created_at
                    )
                    """
                ),
                {
                    "user_id": user_id,
                    "agent_name": agent_name,
                    "display_name": display_name,
                    "expert_name": agent_name,
                    "role_content": f"# {display_name}\n\n## Identity\n\nLegacy backfill candidate",
                    "updated_at": datetime.now(timezone.utc),
                    "created_at": datetime.now(timezone.utc),
                },
            )

    headers = {"Authorization": f"Bearer {admin['token']}"}
    first = await client.post(
        "/api/v1/openclaw/twins/backfill",
        headers=headers,
        json={"all_users": True},
    )
    assert first.status_code == 200, first.text
    first_body = first.json()
    assert first_body["backfilled"] == 2
    assert first_body["skipped_existing"] == 0

    second = await client.post(
        "/api/v1/openclaw/twins/backfill",
        headers=headers,
        json={"all_users": True},
    )
    assert second.status_code == 200, second.text
    second_body = second.json()
    assert second_body["backfilled"] == 0
    assert second_body["skipped_existing"] == 2

    with get_db_session() as session:
        active_count = session.execute(text("SELECT COUNT(*) FROM twin_core WHERE is_active = TRUE")).scalar()
        snapshot_count = session.execute(text("SELECT COUNT(*) FROM twin_snapshots")).scalar()
    assert active_count == 2
    assert snapshot_count == 2


@pytest.mark.anyio
async def test_runtime_profile_runtime_state_and_observation_flow(client):
    auth = await register_login_and_openclaw_key(client, phone="13800000003", username="carol")
    jwt_headers = {"Authorization": f"Bearer {auth['token']}"}
    openclaw_headers = {"Authorization": f"Bearer {auth['openclaw_key']}"}

    upsert = await client.post(
        "/api/v1/auth/digital-twins/upsert",
        headers=jwt_headers,
        json={
            "agent_name": "my_twin_001",
            "display_name": "Carol Twin",
            "expert_name": "carol_twin",
            "visibility": "private",
            "exposure": "brief",
            "source": "profile_twin",
            "role_content": "# Carol Twin\n\n## Identity\n\nScientist\n\n## Discussion Style\n\nStructured and direct",
        },
    )
    assert upsert.status_code == 200, upsert.text
    twin_id = upsert.json()["twin_id"]

    patch_state = await client.patch(
        f"/api/v1/openclaw/twins/{twin_id}/runtime-state",
        headers=openclaw_headers,
        json={
            "instance_id": auth["agent_uid"],
            "active_scene": "forum.request",
            "current_focus": {"summary": "helping with collaboration requests"},
            "recent_threads": [{"topic_id": "topic_1", "summary": "clarified deliverables"}],
            "recent_style_shift": {"verbosity": "lower"},
        },
    )
    assert patch_state.status_code == 200, patch_state.text
    assert patch_state.json()["runtime_state_version"] == 1

    profile = await client.get(
        f"/api/v1/openclaw/twins/{twin_id}/runtime-profile",
        headers=openclaw_headers,
        params={"scene": "forum.request", "topic_category": "request", "topic_id": "topic_1", "thread_id": "post_1"},
    )
    assert profile.status_code == 200, profile.text
    profile_body = profile.json()
    assert profile_body["resolved_scene"] == "forum.request"
    assert profile_body["runtime_profile"]["display_name"] == "Carol Twin"
    assert "markdown_summary" in profile_body

    from app.storage.database.postgres_client import get_db_session

    with get_db_session() as session:
        core_version_before = session.execute(
            text("SELECT version FROM twin_core WHERE twin_id = :twin_id"),
            {"twin_id": twin_id},
        ).scalar()

    observation = await client.post(
        f"/api/v1/openclaw/twins/{twin_id}/observations",
        headers=openclaw_headers,
        json={
            "instance_id": auth["agent_uid"],
            "observation_type": "style_shift",
            "confidence": 0.8,
            "payload": {"signal": "prefers concise replies in request threads"},
        },
    )
    assert observation.status_code == 200, observation.text
    assert observation.json()["merge_status"] == "pending_review"

    with get_db_session() as session:
        observation_source = session.execute(
            text(
                """
                SELECT source
                FROM twin_observations
                WHERE twin_id = :twin_id
                ORDER BY created_at DESC, id DESC
                LIMIT 1
                """
            ),
            {"twin_id": twin_id},
        ).scalar()
    assert observation_source == "topiclab_cli"

    version = await client.get(
        f"/api/v1/openclaw/twins/{twin_id}/version",
        headers=openclaw_headers,
        params={"instance_id": auth["agent_uid"]},
    )
    assert version.status_code == 200, version.text
    version_body = version.json()
    assert version_body["core_version"] == core_version_before
    assert version_body["runtime_state_version"] == 1
    assert version_body["latest_snapshot_version"] >= 1


@pytest.mark.anyio
async def test_cli_help_returns_skill_refresh_guidance(client):
    auth = await register_login_and_openclaw_key(client, phone="13800000030", username="gina")

    help_resp = await client.post(
        "/api/v1/openclaw/cli-help",
        headers={"Authorization": f"Bearer {auth['openclaw_key']}"},
        json={
            "request": "I am not sure how to continue this task.",
            "scene": "forum.request",
            "context": {"error": "ambiguous next step"},
        },
    )
    assert help_resp.status_code == 200, help_resp.text
    help_body = help_resp.json()
    assert help_body["help_source"] == "website_skill"
    assert help_body["mode"] == "reload_skill"
    assert help_body["should_refresh_skill"] is True
    assert "/api/v1/openclaw/skill.md?key=" in help_body["skill_url"]
    assert help_body["module_skill_urls"] == {}
    assert "does not provide any API access method" in help_body["answer"]
    assert any("install topiclab-cli" in item for item in help_body["recommended_actions"])
    assert any("Do not infer or assemble any other API access method" in item for item in help_body["recommended_actions"])
    assert "他山世界 Agent Skill" in help_body["skill_markdown"]
    assert "Website Skill Version:" in help_body["skill_markdown"]
    assert "topiclab-cli` 是当前实例访问 TopicLab 的必装运行时" in help_body["skill_markdown"]
    assert "本 skill 不提供任何 API 访问方式" in help_body["skill_markdown"]
    assert "/api/v1/auth/openclaw-guest" in help_body["skill_markdown"]
    assert "curl -fsSL" in help_body["skill_markdown"]
    assert "按文件定位落地" in help_body["skill_markdown"]
    assert "`AGENTS.md`" in help_body["skill_markdown"]
    assert "`TOOLS.md`" in help_body["skill_markdown"]


@pytest.mark.anyio
async def test_requirement_observation_validation_listing_and_permissions(client, monkeypatch):
    monkeypatch.setenv("ADMIN_PHONE_NUMBERS", "13800000020")
    auth = await register_login_and_openclaw_key(client, phone="13800000021", username="dora")
    admin = await register_and_login(client, phone="13800000020", username="admin")
    other = await register_login_and_openclaw_key(client, phone="13800000022", username="erin")
    jwt_headers = {"Authorization": f"Bearer {auth['token']}"}
    openclaw_headers = {"Authorization": f"Bearer {auth['openclaw_key']}"}

    upsert = await client.post(
        "/api/v1/auth/digital-twins/upsert",
        headers=jwt_headers,
        json={
            "agent_name": "my_twin_003",
            "display_name": "Dora Twin",
            "expert_name": "dora_twin",
            "visibility": "private",
            "exposure": "brief",
            "source": "profile_twin",
            "role_content": "# Dora Twin\n\n## Identity\n\nBuilder",
        },
    )
    assert upsert.status_code == 200, upsert.text
    twin_id = upsert.json()["twin_id"]

    profile_before = await client.get(
        f"/api/v1/openclaw/twins/{twin_id}/runtime-profile",
        headers=openclaw_headers,
        params={"scene": "forum.request", "topic_category": "request"},
    )
    assert profile_before.status_code == 200, profile_before.text

    invalid = await client.post(
        f"/api/v1/openclaw/twins/{twin_id}/observations",
        headers=openclaw_headers,
        json={
            "instance_id": auth["agent_uid"],
            "observation_type": "explicit_requirement",
            "payload": {
                "topic": "discussion_style",
                "statement": "reply more concisely",
                "explicitness": "explicit",
                "scope": "global",
            },
        },
    )
    assert invalid.status_code == 400, invalid.text

    invalid_evidence = await client.post(
        f"/api/v1/openclaw/twins/{twin_id}/observations",
        headers=openclaw_headers,
        json={
            "instance_id": auth["agent_uid"],
            "observation_type": "explicit_requirement",
            "payload": {
                "topic": "discussion_style",
                "statement": "reply more concisely",
                "normalized": {"verbosity": "low"},
                "explicitness": "explicit",
                "scope": "global",
                "evidence": [{"raw_text": "full private conversation dump"}],
            },
        },
    )
    assert invalid_evidence.status_code == 400, invalid_evidence.text

    created = await client.post(
        f"/api/v1/openclaw/twins/{twin_id}/observations",
        headers=openclaw_headers,
        json={
            "instance_id": auth["agent_uid"],
            "observation_type": "explicit_requirement",
            "confidence": 0.95,
            "payload": {
                "topic": "discussion_style",
                "statement": "reply more concisely with the conclusion first",
                "normalized": {"verbosity": "low", "reply_shape": "conclusion_first"},
                "explicitness": "explicit",
                "scope": "global",
                "scene": "forum.request",
                "evidence": [{"message_id": "msg_1", "excerpt": "以后回复简短一点，先说结论。"}],
            },
        },
    )
    assert created.status_code == 200, created.text
    assert created.json()["merge_status"] == "pending_review"

    owner_list = await client.get(
        f"/api/v1/openclaw/twins/{twin_id}/observations",
        headers=openclaw_headers,
        params={
            "observation_type": "explicit_requirement",
            "explicitness": "explicit",
            "scope": "global",
            "scene": "forum.request",
        },
    )
    assert owner_list.status_code == 200, owner_list.text
    owner_body = owner_list.json()
    assert owner_body["total"] == 1
    assert owner_body["items"][0]["payload"]["topic"] == "discussion_style"
    assert owner_body["items"][0]["merge_status"] == "pending_review"

    admin_list = await client.get(
        f"/api/v1/openclaw/twins/{twin_id}/observations",
        headers={"Authorization": f"Bearer {admin['token']}"},
        params={"observation_type": "explicit_requirement"},
    )
    assert admin_list.status_code == 200, admin_list.text
    assert admin_list.json()["total"] == 1

    forbidden = await client.get(
        f"/api/v1/openclaw/twins/{twin_id}/observations",
        headers={"Authorization": f"Bearer {other['openclaw_key']}"},
    )
    assert forbidden.status_code == 403, forbidden.text

    profile_after = await client.get(
        f"/api/v1/openclaw/twins/{twin_id}/runtime-profile",
        headers=openclaw_headers,
        params={"scene": "forum.request", "topic_category": "request"},
    )
    assert profile_after.status_code == 200, profile_after.text
    assert profile_after.json()["runtime_profile"] == profile_before.json()["runtime_profile"]
