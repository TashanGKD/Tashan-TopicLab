import asyncio
import importlib
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.api import topiclink


def test_topiclink_task_schema_requeues_claims_created_before_lease_tokens():
    engine = create_engine("sqlite:///:memory:")
    with Session(engine) as session:
        session.execute(
            text(
                """
                CREATE TABLE topiclink_agent_tasks (
                    id VARCHAR(36) PRIMARY KEY,
                    task_type VARCHAR(32) NOT NULL,
                    source_type VARCHAR(32) NOT NULL,
                    source_id VARCHAR(255) NOT NULL,
                    source_title TEXT NOT NULL,
                    source_path TEXT NOT NULL,
                    requested_by_user_id INTEGER NOT NULL,
                    target_openclaw_agent_id INTEGER NOT NULL,
                    target_agent_uid VARCHAR(255) NOT NULL,
                    target_handle VARCHAR(255) NOT NULL,
                    status VARCHAR(32) NOT NULL DEFAULT 'pending',
                    input_json TEXT NOT NULL DEFAULT '{}',
                    output_json TEXT NOT NULL DEFAULT '{}',
                    error_message TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    claimed_at TEXT,
                    completed_at TEXT
                )
                """
            )
        )
        session.execute(
            text(
                """
                INSERT INTO topiclink_agent_tasks (
                    id, task_type, source_type, source_id, source_title, source_path,
                    requested_by_user_id, target_openclaw_agent_id, target_agent_uid,
                    target_handle, status, claimed_at
                ) VALUES (
                    'legacy-claimed', 'diligence', 'inspiration_demand', 'legacy-demand',
                    '旧调研单', '/inspiration-co-creation/needs/legacy-demand', 1, 2,
                    'agent-2', 'legacy-agent', 'claimed', CURRENT_TIMESTAMP
                )
                """
            )
        )
        session.commit()

        topiclink._ensure_topiclink_agent_tasks_table(session)
        topiclink._ensure_topiclink_agent_tasks_table(session)
        session.commit()

        columns = {
            str(row[1])
            for row in session.execute(text("PRAGMA table_info(topiclink_agent_tasks)")).fetchall()
        }
        legacy = session.execute(
            text(
                "SELECT status, claimed_at FROM topiclink_agent_tasks "
                "WHERE id = 'legacy-claimed'"
            )
        ).fetchone()

    assert "claim_token_hash" in columns
    assert "claim_expires_at" in columns
    assert "reservation_key" in columns
    assert legacy.status == "pending"
    assert legacy.claimed_at is None


@pytest.fixture
def topiclink_client(tmp_path, monkeypatch):
    database_path = tmp_path / "topiclink-dispatch.db"
    zvec_path = tmp_path / "topiclink.zvec"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("JWT_SECRET", "topiclink-test-secret")
    monkeypatch.setenv("TOPICLAB_TESTING", "1")
    monkeypatch.setenv("TOPICLINK_METADATA_AUTOFILL", "0")
    monkeypatch.setenv("TOPICLINK_METADATA_BACKGROUND_AUTOFILL", "0")
    monkeypatch.setenv("TOPICLINK_ZVEC_PATH", str(zvec_path))
    monkeypatch.setenv("TOPICLINK_ZVEC_DIMENSIONS", "3")

    from app.storage.database import postgres_client, topic_store

    postgres_client.reset_db_state()
    import app.api.auth as auth_module
    import app.api.topiclink as topiclink_module
    import main as main_module

    importlib.reload(postgres_client)
    importlib.reload(topic_store)
    importlib.reload(auth_module)
    importlib.reload(topiclink_module)
    main_module = importlib.reload(main_module)

    from fastapi.testclient import TestClient

    with TestClient(main_module.app) as test_client:
        yield test_client

    postgres_client.reset_db_state()


def _register_topiclink_owner(
    topiclink_client,
    *,
    phone: str = "13800007771",
    username: str = "topiclink-owner",
) -> dict:
    from app.storage.database.postgres_client import get_db_session

    with get_db_session() as session:
        session.execute(
            text(
                """
                INSERT INTO verification_codes (phone, code, type, expires_at)
                VALUES (:phone, '123456', 'register', :expires_at)
                """
            ),
            {
                "phone": phone,
                "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5),
            },
        )
    registered = topiclink_client.post(
        "/auth/register",
        json={
            "phone": phone,
            "code": "123456",
            "password": "password123",
            "username": username,
        },
    )
    assert registered.status_code == 200, registered.text
    token = registered.json()["token"]
    openclaw = topiclink_client.post(
        "/api/v1/auth/openclaw-key",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert openclaw.status_code == 200, openclaw.text
    return {
        "token": token,
        "openclaw_key": openclaw.json()["key"],
        "agent_uid": openclaw.json()["agent_uid"],
    }


def test_topiclink_profile_falls_back_when_anonymous():
    profile = topiclink._topiclink_profile_from_user(None)

    assert profile["username"] == "guest"
    assert profile["display_name"] == "先看看"
    assert profile["source_parts_count"] == 0


def test_topiclink_embedding_cache_round_trips_through_zvec_only(topiclink_client):
    model = "Qwen3-Embedding-8B"
    input_text = "TopicLink deployment cache contract"
    vector = [0.25, -0.5, 0.75]

    assert topiclink._read_embedding_cache(model, [input_text]) == [None]

    topiclink._write_embedding_cache(model, [input_text], [vector])

    assert topiclink._read_embedding_cache(model, [input_text]) == [vector]
    from app.storage.database.postgres_client import get_db_session

    with get_db_session() as session:
        table_count = session.execute(
            text(
                "SELECT COUNT(*) FROM sqlite_master "
                "WHERE type = 'table' AND name = 'topic_link_embedding_cache'"
            )
        ).scalar_one()

    assert table_count == 0


def test_topiclink_embedding_cache_uses_internal_zvec_service(monkeypatch):
    calls: list[tuple[str, str, dict | None]] = []
    vector = [0.25, -0.5, 0.75]

    class FakeResponse:
        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    def fake_request(method, url, *, json=None, timeout=None):
        calls.append((method, url, json))
        if url.endswith("/cache/fetch"):
            return FakeResponse({"vectors": [vector]})
        if url.endswith("/cache/upsert"):
            return FakeResponse({"written": 1})
        return FakeResponse({"status": "ready"})

    monkeypatch.setenv("TOPICLINK_ZVEC_SERVICE_URL", "http://topiclink-zvec:8000/")
    monkeypatch.setattr(topiclink.httpx, "request", fake_request)

    assert topiclink._read_embedding_cache("model", ["text"]) == [vector]
    topiclink._write_embedding_cache("model", ["text"], [vector])
    topiclink.probe_topiclink_storage(None)

    assert [call[0] for call in calls] == ["POST", "POST", "GET"]
    assert calls[0][1] == "http://topiclink-zvec:8000/cache/fetch"
    assert calls[1][2] == {"model": "model", "inputs": ["text"], "vectors": [vector]}


def test_topiclink_web_process_delegates_background_worker_to_zvec_service(monkeypatch):
    monkeypatch.setenv("TOPICLINK_ZVEC_SERVICE_URL", "http://topiclink-zvec:8000")
    topiclink._metadata_worker_task = None
    topiclink._metadata_worker_stop = None

    topiclink.start_topiclink_metadata_worker()

    assert topiclink._metadata_worker_task is None
    assert topiclink._metadata_worker_stop is None


def test_topiclink_zvec_refreshes_hits_and_prunes_stale_vectors(topiclink_client, monkeypatch):
    import zvec

    model = "Qwen3-Embedding-8B"
    stale_text = "outdated TopicLink content"
    active_text = "current TopicLink content"
    topiclink._write_embedding_cache(
        model,
        [stale_text, active_text],
        [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
    )
    stale_key = topiclink._embedding_cache_key(model, stale_text)[0]
    active_key = topiclink._embedding_cache_key(model, active_text)[0]
    stale_id = topiclink._topiclink_zvec_document_id(stale_key)
    active_id = topiclink._topiclink_zvec_document_id(active_key)
    topiclink._zvec_collection.update(
        [
            zvec.Doc(id=stale_id, fields={"last_used_at": "2026-05-01T00:00:00Z"}),
            zvec.Doc(id=active_id, fields={"last_used_at": "2026-07-01T00:00:00Z"}),
        ]
    )

    assert topiclink._read_embedding_cache(model, [active_text]) == [[0.0, 1.0, 0.0]]
    monkeypatch.setenv("TOPICLINK_ZVEC_MAX_IDLE_DAYS", "30")
    deleted = topiclink._prune_zvec_cache(
        force=True,
        now=datetime(2026, 7, 16, tzinfo=timezone.utc),
    )
    fetched = topiclink._zvec_collection.fetch([stale_id, active_id], include_vector=False)

    assert deleted == 1
    assert stale_id not in fetched
    assert active_id in fetched
    assert fetched[active_id].fields["last_used_at"] > "2026-07-01T00:00:00Z"


def test_topiclink_embeddings_only_fetch_missing_inputs_then_hit_zvec(topiclink_client, monkeypatch):
    model = "Qwen3-Embedding-8B"
    requests: list[list[str]] = []

    class FakeResponse:
        def __init__(self, inputs: list[str]):
            self.inputs = inputs

        def raise_for_status(self):
            return None

        def json(self):
            return {
                "data": [
                    {"embedding": [float(index + 1), 0.25, -0.25]}
                    for index, _ in enumerate(self.inputs)
                ]
            }

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return False

        async def post(self, url, *, headers, json):
            inputs = list(json["input"])
            requests.append(inputs)
            return FakeResponse(inputs)

    monkeypatch.setenv("TOPICLINK_EMBEDDING_API_KEY", "test-key")
    monkeypatch.setenv("TOPICLINK_EMBEDDING_MODEL", model)
    monkeypatch.setattr(topiclink.httpx, "AsyncClient", FakeAsyncClient)

    first_inputs = ["科研议程筛选", "一人公司尽调"]
    first = asyncio.run(topiclink._try_remote_embeddings(first_inputs))
    second = asyncio.run(topiclink._try_remote_embeddings(first_inputs))
    mixed = asyncio.run(topiclink._try_remote_embeddings([first_inputs[0], "新增产业线索"]))

    assert first == [[1.0, 0.25, -0.25], [2.0, 0.25, -0.25]]
    assert second == first
    assert mixed == [[1.0, 0.25, -0.25], [1.0, 0.25, -0.25]]
    assert requests == [first_inputs, ["新增产业线索"]]


def test_scnet_credentials_enable_embedding_and_default_chat_without_extra_config(topiclink_client, monkeypatch):
    monkeypatch.setenv("SCNET_BASE_URL", "https://scnet.example/v1")
    monkeypatch.setenv("SCNET_API_KEY", "shared-scnet-key")
    monkeypatch.delenv("TOPICLINK_CHAT_API_KEY", raising=False)
    monkeypatch.delenv("TOPICLINK_CHAT_BASE_URL", raising=False)
    monkeypatch.delenv("TOPICLINK_CHAT_MODEL", raising=False)
    monkeypatch.delenv("MINIMAX_API_KEY", raising=False)

    assert topiclink._topiclink_chat_config() == (
        "https://scnet.example/v1",
        "shared-scnet-key",
        "DeepSeek-V4-Flash",
    )

    monkeypatch.setenv("TOPICLINK_CHAT_API_KEY", "explicit-chat-key")
    monkeypatch.setenv("TOPICLINK_CHAT_BASE_URL", "https://chat.example/v1")
    monkeypatch.setenv("TOPICLINK_CHAT_MODEL", "chat-model")

    assert topiclink._topiclink_chat_config() == (
        "https://chat.example/v1",
        "explicit-chat-key",
        "chat-model",
    )


def test_topiclink_startup_initializes_zvec_without_database_cache(topiclink_client):
    from app.storage.database.postgres_client import get_db_session

    with get_db_session() as session:
        inspiration_columns_before = session.execute(text("PRAGMA table_info(inspiration_demands)")).fetchall()
        inspiration_count_before = session.execute(text("SELECT COUNT(*) FROM inspiration_demands")).scalar_one()
        session.execute(text("DROP TABLE IF EXISTS topiclink_agent_tasks"))

    topiclink.initialize_topiclink_storage()

    assert topiclink._zvec_collection is not None
    with get_db_session() as session:
        vector_table_count = session.execute(
            text(
                "SELECT COUNT(*) FROM sqlite_master "
                "WHERE type = 'table' AND name = 'topic_link_embedding_cache'"
            )
        ).scalar_one()
        task_table_count = session.execute(
            text(
                "SELECT COUNT(*) FROM sqlite_master "
                "WHERE type = 'table' AND name = 'topiclink_agent_tasks'"
            )
        ).scalar_one()
        inspiration_columns_after = session.execute(text("PRAGMA table_info(inspiration_demands)")).fetchall()
        inspiration_count_after = session.execute(text("SELECT COUNT(*) FROM inspiration_demands")).scalar_one()

    assert vector_table_count == 0
    assert task_table_count == 1
    assert inspiration_columns_after == inspiration_columns_before
    assert inspiration_count_after == inspiration_count_before


def test_topiclink_dimension_mismatch_is_reported_by_readiness(topiclink_client, monkeypatch):
    monkeypatch.setenv("TOPICLINK_ZVEC_DIMENSIONS", "4")
    topiclink._zvec_collection = None

    with pytest.raises(
        RuntimeError,
        match="TopicLink Zvec dimension 3 does not match configured 4",
    ):
        topiclink.initialize_topiclink_storage()

    response = topiclink_client.get("/api/v1/topiclink/health/ready")

    assert response.status_code == 503
    assert response.json() == {
        "status": "not_ready",
        "service": "topiclink",
        "zvec": "error",
    }


def test_topiclink_zvec_schema_requires_all_cache_fields():
    class FakeSchema:
        @staticmethod
        def vector(name):
            assert name == topiclink.ZVEC_VECTOR_FIELD
            return SimpleNamespace(dimension=3)

        @staticmethod
        def field(name):
            if name == "model":
                return None
            return SimpleNamespace(data_type=SimpleNamespace(name="STRING"))

    with pytest.raises(RuntimeError, match="schema is missing field model"):
        topiclink._assert_zvec_collection_schema(SimpleNamespace(schema=FakeSchema()), 3)


def test_topiclink_profile_uses_current_twin(monkeypatch):
    monkeypatch.setattr(
        topiclink,
        "get_or_backfill_active_twin_for_user",
        lambda user_id: {
            "display_name": "OpenClaw Guest f894",
            "source_agent_name": "openclaw_guest_f894_openclaw",
            "base_profile_json": {
                "summary": "OpenClaw Guest f894",
                "sections": {
                    "identity": "Temporary OpenClaw account for TopicLab CLI-first access.",
                    "expertise": "Build identity and preferences from future conversations.",
                    "thinking_style": "Start from the current thread and avoid overclaiming.",
                    "discussion_style": "Brief, careful, and thread-aware.",
                },
            },
        },
    )

    profile = topiclink._topiclink_profile_from_user(
        {
            "sub": 42,
            "username": "OpenClaw Guest f894",
            "openclaw_display_name": "OpenClaw Guest f894's openclaw",
            "agent_uid": "oc_demo",
            "auth_type": "openclaw_key",
        }
    )

    assert profile["username"] == "OpenClaw Guest f894"
    assert profile["display_name"] == "OpenClaw Guest f894"
    assert profile["agent_name"] == "openclaw_guest_f894_openclaw"
    assert profile["cards"][0]["detail"] == "Temporary OpenClaw account for TopicLab CLI-first access."
    assert profile["source_parts_count"] == 4


def test_topiclink_metadata_autofill_preserves_existing_metadata(monkeypatch):
    monkeypatch.setenv("TOPICLINK_METADATA_AUTOFILL", "1")
    topic = {
        "id": "topic-1",
        "title": "103-瞬变源异常监测接力",
        "body": "读图后再接一句。",
        "category": "arcade",
        "creator_name": "OpenClaw Guest abcd's openclaw",
        "creator_auth_type": "openclaw_key",
        "posts_count": 2,
        "metadata": {
            "scene": "arcade",
            "arcade": {"board": "science"},
        },
    }
    writes = []

    def fake_persist_topiclink_metadata(topic_id, metadata):
        writes.append((topic_id, metadata))
        updated = dict(topic)
        updated["metadata"] = metadata
        return updated

    monkeypatch.setattr(topiclink, "_persist_topiclink_metadata", fake_persist_topiclink_metadata)
    updated = topiclink._backfill_topiclink_metadata([topic], max_updates=1)[0]

    assert writes[0][0] == "topic-1"
    assert updated["metadata"]["scene"] == "arcade"
    assert updated["metadata"]["arcade"] == {"board": "science"}
    assert updated["metadata"]["topic_link"]["source"] == "topiclink_autofill"
    assert updated["metadata"]["topic_link"]["participants"][0]["openclaw"] is True
    assert updated["metadata"]["topic_link"]["wanted"][0]["title"] == "愿意挑战题目的人"


def test_topiclink_metadata_autofill_skips_test_topics(monkeypatch):
    topic = {
        "id": "topic-test",
        "title": "OpenClaw live smoke 20260522",
        "body": "test",
        "category": "test",
        "creator_name": "OpenClaw Guest abcd's openclaw",
        "posts_count": 1,
        "metadata": None,
    }

    def fail_persist_topiclink_metadata(topic_id, metadata):
        raise AssertionError("test topics should not be autofilled")

    monkeypatch.setattr(topiclink, "_persist_topiclink_metadata", fail_persist_topiclink_metadata)
    updated = topiclink._backfill_topiclink_metadata([topic], max_updates=1)[0]

    assert updated is topic


@pytest.mark.asyncio
async def test_topiclink_background_autofill_uses_llm_metadata_slowly(monkeypatch):
    monkeypatch.setenv("TOPICLINK_METADATA_AUTOFILL", "1")
    monkeypatch.setenv("TOPICLINK_METADATA_BACKGROUND_AUTOFILL", "1")
    topics = [
        {
            "id": "topic-1",
            "title": "Agent for Science 参考架构",
            "body": "需要有人补充评估框架。",
            "category": "research",
            "creator_name": "",
            "posts_count": 0,
            "metadata": None,
        },
        {
            "id": "topic-2",
            "title": "这条已经有 TopicLink",
            "body": "skip",
            "category": "news",
            "creator_name": "",
            "posts_count": 1,
            "metadata": {"topic_link": {"source": "manual"}},
        },
        {
            "id": "topic-3",
            "title": "产品落地经验",
            "body": "需要真实项目经验。",
            "category": "product",
            "creator_name": "",
            "posts_count": 1,
            "metadata": None,
        },
    ]
    writes = []
    llm_calls = []

    def fake_list_topics(limit=20, cursor=None, **kwargs):
        assert cursor is None
        return {"items": topics, "next_cursor": None}

    async def fake_remote_metadata(topic):
        llm_calls.append(topic["id"])
        return {
            **topiclink._derive_topiclink_metadata(topic),
            "source": "topiclink_llm_autofill",
            "wanted": [{"kind": "source", "title": "补材料的人", "description": "带上出处再接", "source": "topiclink_background"}],
        }

    def fake_persist(topic_id, metadata):
        writes.append((topic_id, metadata))
        updated = next(item for item in topics if item["id"] == topic_id).copy()
        updated["metadata"] = metadata
        return updated

    monkeypatch.setenv("TOPICLINK_METADATA_BACKGROUND_MAX_PER_PASS", "2")
    monkeypatch.setenv("TOPICLINK_METADATA_BACKGROUND_LLM_DELAY_SECONDS", "0")
    monkeypatch.setattr(topiclink, "list_topics", fake_list_topics)
    monkeypatch.setattr(topiclink, "_try_remote_topiclink_metadata", fake_remote_metadata)
    monkeypatch.setattr(topiclink, "_persist_topiclink_metadata", fake_persist)

    result = await topiclink._run_topiclink_metadata_background_pass()

    assert result["written"] == 2
    assert llm_calls == ["topic-1", "topic-3"]
    assert [item[0] for item in writes] == ["topic-1", "topic-3"]
    assert writes[0][1]["topic_link"]["source"] == "topiclink_llm_autofill"


@pytest.mark.asyncio
async def test_topiclink_background_embedding_pass_indexes_topics_and_public_opc_demands(monkeypatch):
    topics = [
        {"id": "topic-1", "title": "科研协作", "body": "需要实验复现伙伴", "category": "research"},
        {"id": "topic-test", "title": "smoke test", "body": "skip", "category": "test"},
        {"id": "topic-empty", "title": "", "body": "", "category": "research"},
        {"id": "topic-2", "title": "工程交付", "body": "需要数据清洗", "category": "product"},
        {"id": "topic-3", "title": "超出本轮", "body": "留到下一轮", "category": "research"},
    ]
    embedded_inputs = []

    monkeypatch.setenv("TOPICLINK_EMBEDDING_API_KEY", "test-key")
    monkeypatch.setenv("TOPICLINK_EMBEDDING_BACKGROUND_MAX_PER_PASS", "2")
    monkeypatch.setattr(topiclink, "list_topics", lambda **kwargs: {"items": topics, "next_cursor": "next-page"})
    monkeypatch.setattr(
        topiclink,
        "_list_public_opc_demands_for_embedding",
        lambda **kwargs: {
            "items": [
                {
                    "id": "demand-1",
                    "slug": "need-ai-workflow",
                    "title": "AI 工作流需求",
                    "summary": "需要把公开需求拆成可执行交付。",
                    "tags": ["AI", "工作流"],
                    "stuck": "缺少验收边界。",
                },
                {
                    "id": "demand-2",
                    "slug": "need-private",
                    "title": "未公开需求不应由查询返回",
                    "summary": "",
                    "tags": [],
                    "stuck": "",
                },
            ],
            "next_offset": 2,
        },
    )
    monkeypatch.setattr(topiclink, "probe_topiclink_storage", lambda session: None)

    async def fake_embeddings(inputs):
        embedded_inputs.extend(inputs)
        return [[0.1] * topiclink.DEFAULT_ZVEC_DIMENSIONS for _ in inputs]

    monkeypatch.setattr(topiclink, "_try_remote_embeddings", fake_embeddings)
    topiclink._embedding_worker_cursor = None

    result = await topiclink._run_topiclink_embedding_background_pass()

    expected_demand_topic = topiclink._opc_demand_as_score_topic({
        "id": "demand-1",
        "slug": "need-ai-workflow",
        "title": "AI 工作流需求",
        "summary": "需要把公开需求拆成可执行交付。",
        "tags": ["AI", "工作流"],
        "stuck": "缺少验收边界。",
    })
    assert result == {"scanned": 7, "indexed": 4}
    assert embedded_inputs == [
        topiclink._topic_text(topics[0]),
        topiclink._topic_text(topics[3]),
        topiclink._topic_text(expected_demand_topic),
        topiclink._topic_text(topiclink._opc_demand_as_score_topic({
            "id": "demand-2",
            "slug": "need-private",
            "title": "未公开需求不应由查询返回",
            "summary": "",
            "tags": [],
            "stuck": "",
        })),
    ]
    assert topiclink._embedding_worker_cursor == "next-page"
    assert topiclink._embedding_worker_opc_offset == 2


@pytest.mark.asyncio
async def test_topiclink_background_worker_runs_embedding_and_metadata_passes(monkeypatch):
    calls = []
    ticks = iter([True, False])

    async def fake_sleep(seconds):
        return next(ticks)

    async def fake_embedding_pass():
        calls.append("embedding")

    async def fake_metadata_pass():
        calls.append("metadata")

    monkeypatch.setattr(topiclink, "_sleep_until_topiclink_worker_tick", fake_sleep)
    monkeypatch.setattr(topiclink, "_run_topiclink_embedding_background_pass", fake_embedding_pass)
    monkeypatch.setattr(topiclink, "_run_topiclink_metadata_background_pass", fake_metadata_pass)
    topiclink._metadata_worker_stop = asyncio.Event()
    try:
        await topiclink._topiclink_metadata_worker_loop()
    finally:
        topiclink._metadata_worker_stop = None

    assert calls == ["embedding", "metadata"]


def test_topiclink_dispatch_queues_bound_openclaw_without_posting_for_it(monkeypatch):
    queued = []
    presence_updates = []

    monkeypatch.setattr(topiclink, "_safe_get_topic", lambda topic_id: {"id": topic_id, "title": "科研协作"})
    monkeypatch.setattr(
        topiclink,
        "get_primary_openclaw_agent_for_user",
        lambda user_id: {
            "id": 17,
            "agent_uid": "oc_researcher",
            "display_name": "科研虾",
            "handle": "researcher_openclaw",
            "status": "active",
            "bound_user_id": user_id,
        },
    )
    monkeypatch.setattr(
        topiclink,
        "_enqueue_topiclink_dispatch",
        lambda **payload: queued.append(payload) or {
            "dispatch_post_id": "post-dispatch-1",
            "status": "dispatched",
        },
    )
    monkeypatch.setattr(
        topiclink,
        "_reserve_topiclink_presence_dispatch",
        lambda topic_id, persona_name, *, user_id, agent_id: (
            {"topic_id": topic_id, "persona_name": persona_name, "status": "absent"},
            True,
        ),
    )
    monkeypatch.setattr(
        topiclink,
        "_upsert_topiclink_presence",
        lambda topic_id, persona_name, *, user_id, agent_id, status="resident": presence_updates.append(
            (topic_id, persona_name, user_id, agent_id, status)
        ) or {
            "topic_id": topic_id,
            "persona_name": persona_name,
            "resident": True,
            "status": status,
            "created_at": "2026-07-14T00:00:00Z",
            "updated_at": "2026-07-14T00:00:00Z",
        },
    )

    result = topiclink._dispatch_topiclink_presence(
        "topic-1",
        persona_name="科研虾",
        user={"sub": 42, "username": "owner"},
    )

    assert queued == [
        {
            "topic": {"id": "topic-1", "title": "科研协作"},
            "user_id": 42,
            "agent": {
                "id": 17,
                "agent_uid": "oc_researcher",
                "display_name": "科研虾",
                "handle": "researcher_openclaw",
                "status": "active",
                "bound_user_id": 42,
            },
        }
    ]
    assert presence_updates == [("topic-1", "科研虾", 42, 17, "dispatched")]
    assert result["status"] == "dispatched"
    assert result["dispatch_post_id"] == "post-dispatch-1"


def test_topiclink_presence_isolated_by_owner_and_bound_agent(topiclink_client, monkeypatch):
    monkeypatch.setattr(topiclink, "_safe_get_topic", lambda topic_id: {"id": topic_id})
    first, first_reserved = topiclink._reserve_topiclink_presence_dispatch(
        "topic-shared",
        "分身",
        user_id=41,
        agent_id=71,
    )
    second, second_reserved = topiclink._reserve_topiclink_presence_dispatch(
        "topic-shared",
        "分身",
        user_id=42,
        agent_id=72,
    )
    duplicate, duplicate_reserved = topiclink._reserve_topiclink_presence_dispatch(
        "topic-shared",
        "分身",
        user_id=41,
        agent_id=71,
    )

    assert first_reserved is True
    assert second_reserved is True
    assert duplicate_reserved is False
    assert first["status"] == "dispatching"
    assert second["status"] == "dispatching"
    assert duplicate["status"] == "dispatching"


def test_topiclink_dispatch_post_is_not_counted_or_shown_as_a_real_response(topiclink_client):
    from app.storage.database.postgres_client import get_db_session
    from app.storage.database.topic_store import create_topic, get_topic, make_post, upsert_post

    owner = _register_topiclink_owner(topiclink_client)
    with get_db_session() as session:
        owner_id = session.execute(
            text("SELECT id FROM users WHERE username = 'topiclink-owner'")
        ).scalar_one()

    topic = create_topic(
        "调度帖回应口径",
        "只有真人或分身真正回复后，才应该显示为回应。",
        category="research",
    )
    dispatch = topiclink._enqueue_topiclink_dispatch(
        topic=topic,
        user_id=int(owner_id),
        agent={
            "id": 17,
            "agent_uid": owner["agent_uid"],
            "display_name": "科研虾",
            "handle": "researcher_openclaw",
            "status": "active",
        },
    )

    assert get_topic(topic["id"])["posts_count"] == 0
    empty_discussion = topiclink_client.get(f"/api/v1/topiclink/{topic['id']}/posts")
    assert empty_discussion.status_code == 200
    assert empty_discussion.json()["items"] == []

    with get_db_session() as session:
        session.execute(
            text(
                "UPDATE topics SET posts_count = "
                "(SELECT COUNT(*) FROM posts WHERE topic_id = :topic_id) "
                "WHERE id = :topic_id"
            ),
            {"topic_id": topic["id"]},
        )
        assert session.execute(
            text("SELECT posts_count FROM topics WHERE id = :topic_id"),
            {"topic_id": topic["id"]},
        ).scalar_one() == 1

    topiclink.initialize_topiclink_storage()
    with get_db_session() as session:
        assert session.execute(
            text("SELECT posts_count FROM topics WHERE id = :topic_id"),
            {"topic_id": topic["id"]},
        ).scalar_one() == 1

    unchanged_discussion = topiclink_client.get(f"/api/v1/topiclink/{topic['id']}/posts")
    assert unchanged_discussion.status_code == 200
    assert unchanged_discussion.json()["items"] == []

    with get_db_session() as session:
        session.execute(
            text("UPDATE topics SET posts_count = 0 WHERE id = :topic_id"),
            {"topic_id": topic["id"]},
        )

    agent_reply = upsert_post(
        make_post(
            topic["id"],
            author="科研虾",
            author_type="agent",
            body="我核对了公开材料，建议先补一组失败案例。",
            expert_name="researcher_openclaw",
            expert_label="科研虾",
            in_reply_to_id=dispatch["dispatch_post_id"],
            owner_auth_type="openclaw_key",
        )
    )

    assert get_topic(topic["id"])["posts_count"] == 1
    discussion = topiclink_client.get(f"/api/v1/topiclink/{topic['id']}/posts")
    assert discussion.status_code == 200
    assert [item["id"] for item in discussion.json()["items"]] == [agent_reply["id"]]
    assert discussion.json()["items"][0]["in_reply_to_id"] is None


def test_topiclink_dispatch_body_carries_bounded_topic_context():
    body = topiclink._build_topiclink_dispatch_body(
        topic={
            "title": "AI4S 协作路径",
            "body": "讨论科研智能体怎样先核验上下文，再决定是否参与。",
        },
        agent_handle="researcher_openclaw",
        context_posts=[
            {"author": "研究者甲", "body": "先确认数据和评价口径。"},
            {"expert_label": "科研虾乙", "body": "还需要补充失败案例。"},
        ],
    )

    assert "@researcher_openclaw" in body
    assert "【话题】AI4S 协作路径" in body
    assert "【题面】讨论科研智能体怎样先核验上下文" in body
    assert "研究者甲：先确认数据和评价口径" in body
    assert "科研虾乙：还需要补充失败案例" in body
    assert "先读以上上下文" in body
    assert "不要冒充主人" in body


def test_topiclink_dispatch_requires_an_active_bound_openclaw(monkeypatch):
    monkeypatch.setattr(topiclink, "_safe_get_topic", lambda topic_id: {"id": topic_id, "title": "科研协作"})
    monkeypatch.setattr(topiclink, "get_primary_openclaw_agent_for_user", lambda user_id: None)

    with pytest.raises(HTTPException) as exc_info:
        topiclink._dispatch_topiclink_presence(
            "topic-1",
            persona_name="分身",
            user={"sub": 42, "username": "owner"},
        )

    assert exc_info.value.status_code == 409
    assert "绑定" in str(exc_info.value.detail)


def test_topiclink_legacy_resident_status_is_not_reported_as_dispatched(monkeypatch):
    class FakeResult:
        @staticmethod
        def fetchone():
            return SimpleNamespace(
                topic_id="topic-1",
                persona_name="科研虾",
                status="resident",
                created_at="2026-07-14T00:00:00Z",
                updated_at="2026-07-14T00:00:00Z",
            )

    class FakeSession:
        @staticmethod
        def execute(*_args, **_kwargs):
            return FakeResult()

    class FakeSessionContext:
        def __enter__(self):
            return FakeSession()

        def __exit__(self, *_args):
            return False

    monkeypatch.setattr(topiclink, "_safe_get_topic", lambda topic_id: {"id": topic_id})
    monkeypatch.setattr(topiclink, "_ensure_presence_table", lambda session: None)
    monkeypatch.setattr(topiclink, "get_db_session", lambda: FakeSessionContext())

    result = topiclink._get_topiclink_presence("topic-1", "科研虾")

    assert result["status"] == "resident"
    assert result["resident"] is False


def test_opc_diligence_dispatch_reuses_topic_discussion_and_bound_agent_reply(topiclink_client, monkeypatch):
    owner = _register_topiclink_owner(topiclink_client)
    demands = topiclink_client.get(
        "/api/v1/inspiration/demands?limit=2&include_interest=false&include_overview=false"
    )
    assert demands.status_code == 200, demands.text
    public_demands = demands.json()["list"]
    assert len(public_demands) >= 2

    from app.storage.database.postgres_client import get_db_session

    with get_db_session() as session:
        session.execute(
            text(
                """
                UPDATE inspiration_demands
                SET assistant_status = 'ready', assistant_snapshot_json = :snapshot
                WHERE slug = :slug
                """
            ),
            {
                "slug": public_demands[0]["slug"],
                "snapshot": (
                    '{"summary":"共创队分身已识别技术验证缺口",'
                    '"next_step":"先核验可用数据",'
                    '"follow_up_questions":["公开还缺什么证据？"],'
                    '"private_json":{"contact":"不应外泄"},'
                    '"stages":{"internal":{"note":"不应外泄"}}}'
                ),
            },
        )

    dispatched = topiclink_client.post(
        f"/api/v1/topiclink/opc/{public_demands[0]['slug']}/diligence",
        headers={"Authorization": f"Bearer {owner['token']}"},
    )
    assert dispatched.status_code == 201, dispatched.text
    task = dispatched.json()["task"]
    assert task["task_type"] == "diligence"
    assert task["status"] == "pending"
    assert task["source"]["path"].endswith(public_demands[0]["slug"])
    assert task["target_agent"]["agent_uid"] == owner["agent_uid"]
    assert "private" not in task["input"]
    assert task["input"]["existing_assistant"] == {
        "status": "ready",
        "snapshot": {
            "summary": "共创队分身已识别技术验证缺口",
            "next_step": "先核验可用数据",
            "follow_up_questions": ["公开还缺什么证据？"],
        },
    }
    serialized_snapshot = str(task["input"]["existing_assistant"])
    assert "private_json" not in serialized_snapshot
    assert "不应外泄" not in serialized_snapshot
    discussion_topic_id = task["input"]["discussion_topic_id"]
    dispatch_post_id = task["input"]["dispatch_post_id"]
    assert task["input"]["response_template"] == [
        "需求判断（summary）",
        "已核验进展（progress）",
        "主要阻塞（blockers）",
        "建议下一步（next_steps）",
        "可交付物（artifacts）",
    ]

    with get_db_session() as session:
        topic_row = session.execute(
            text("SELECT category, metadata FROM topics WHERE id = :id"),
            {"id": discussion_topic_id},
        ).fetchone()
        dispatch_row = session.execute(
            text("SELECT body FROM posts WHERE topic_id = :topic_id AND id = :post_id"),
            {"topic_id": discussion_topic_id, "post_id": dispatch_post_id},
        ).fetchone()
        inbox_row = session.execute(
            text(
                "SELECT message_type FROM post_inbox_messages "
                "WHERE topic_id = :topic_id AND reply_post_id = :post_id"
            ),
            {"topic_id": discussion_topic_id, "post_id": dispatch_post_id},
        ).fetchone()

    topic_metadata = topiclink._topiclink_json_object(topic_row.metadata)
    assert topic_row.category == "request"
    assert topic_metadata["topic_link"]["source_id"] == public_demands[0]["slug"]
    assert dispatch_row is not None
    assert f"@{task['target_agent']['handle']}" in dispatch_row.body
    assert "【待填写回执】" in dispatch_row.body
    assert "需求判断（summary）" in dispatch_row.body
    assert inbox_row.message_type == "topiclink_dispatch"

    from app.api import openclaw_routes

    monkeypatch.setattr(openclaw_routes, "_moderate_or_raise", AsyncMock(return_value=None))
    agent_headers = {"Authorization": f"Bearer {owner['openclaw_key']}"}
    replied = topiclink_client.post(
        f"/api/v1/openclaw/topics/{discussion_topic_id}/posts",
        headers=agent_headers,
        json={
            "body": "需求判断：值得继续核验。\n主要阻塞：缺少失败案例。\n建议下一步：主人确认后再打开原线索。",
            "in_reply_to_id": dispatch_post_id,
        },
    )
    assert replied.status_code == 201, replied.text

    owner_view = topiclink_client.get(
        f"/api/v1/topiclink/dispatches/{task['id']}",
        headers={"Authorization": f"Bearer {owner['token']}"},
    )
    assert owner_view.status_code == 200, owner_view.text
    assert owner_view.json()["task"]["status"] == "replied"
    assert "值得继续核验" in owner_view.json()["task"]["output"]["summary"]
    assert owner_view.json()["task"]["output"]["next_step"] == "主人确认后再打开原线索。"

    second = topiclink_client.post(
        f"/api/v1/topiclink/opc/{public_demands[1]['slug']}/diligence",
        headers={"Authorization": f"Bearer {owner['token']}"},
    )
    failed_task_id = second.json()["task"]["id"]
    claimed = topiclink_client.post(
        f"/api/v1/topiclink/agent-tasks/{failed_task_id}/claim",
        headers=agent_headers,
    )
    assert claimed.status_code == 200, claimed.text
    failed = topiclink_client.post(
        f"/api/v1/topiclink/agent-tasks/{failed_task_id}/fail",
        headers=agent_headers,
        json={
            "claim_token": claimed.json()["claim_token"],
            "error_message": "公开信息不足，无法形成可靠判断。",
        },
    )
    assert failed.status_code == 200, failed.text
    assert failed.json()["task"]["status"] == "failed"
    assert failed.json()["task"]["error_message"] == "公开信息不足，无法形成可靠判断。"


def test_opc_diligence_concurrent_requests_share_one_task_and_dispatch(topiclink_client, monkeypatch):
    owner = _register_topiclink_owner(topiclink_client)
    demands = topiclink_client.get(
        "/api/v1/inspiration/demands?limit=1&include_interest=false&include_overview=false"
    )
    slug = demands.json()["list"][0]["slug"]
    barrier = threading.Barrier(2)
    original_load = topiclink._load_public_opc_demand

    def synchronized_load(session, demand_slug):
        barrier.wait(timeout=5)
        return original_load(session, demand_slug)

    monkeypatch.setattr(topiclink, "_load_public_opc_demand", synchronized_load)

    class NoopLock:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            return False

    monkeypatch.setattr(
        topiclink,
        "_topiclink_task_creation_locks",
        tuple(NoopLock() for _ in range(64)),
    )
    headers = {"Authorization": f"Bearer {owner['token']}"}
    from fastapi.testclient import TestClient

    clients = [
        TestClient(topiclink_client.app, raise_server_exceptions=False),
        TestClient(topiclink_client.app, raise_server_exceptions=False),
    ]

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda client: client.post(
                    f"/api/v1/topiclink/opc/{slug}/diligence",
                    headers=headers,
                ),
                clients,
            )
        )

    assert [response.status_code for response in responses] == [201, 201]
    tasks = [response.json()["task"] for response in responses]
    assert len({task["id"] for task in tasks}) == 1
    assert len({task["input"]["dispatch_post_id"] for task in tasks}) == 1

    from app.storage.database.postgres_client import get_db_session

    with get_db_session() as session:
        task_count = session.execute(
            text(
                "SELECT COUNT(*) FROM topiclink_agent_tasks "
                "WHERE task_type = 'diligence' AND source_id = :slug"
            ),
            {"slug": slug},
        ).scalar_one()
        dispatch_count = session.execute(
            text(
                "SELECT COUNT(*) FROM posts WHERE topic_id = :topic_id "
                "AND expert_name = 'topiclink_dispatcher'"
            ),
            {"topic_id": tasks[0]["input"]["discussion_topic_id"]},
        ).scalar_one()
        reservation_count = session.execute(
            text(
                "SELECT COUNT(*) FROM topiclink_agent_tasks "
                "WHERE reservation_key IS NOT NULL AND source_id = :slug"
            ),
            {"slug": slug},
        ).scalar_one()

    assert task_count == 1
    assert dispatch_count == 1
    assert reservation_count == 1


def test_topiclink_agent_task_claim_is_atomic(topiclink_client, monkeypatch):
    owner = _register_topiclink_owner(topiclink_client)
    demand = topiclink_client.get(
        "/api/v1/inspiration/demands?limit=1&include_interest=false&include_overview=false"
    ).json()["list"][0]
    dispatched = topiclink_client.post(
        f"/api/v1/topiclink/opc/{demand['slug']}/diligence",
        headers={"Authorization": f"Bearer {owner['token']}"},
    )
    task_id = dispatched.json()["task"]["id"]
    barrier = threading.Barrier(2)
    thread_state = threading.local()
    original_get_db_session = topiclink.get_db_session

    class SynchronizedSession:
        def __init__(self, session):
            self._session = session

        def execute(self, statement, parameters=None):
            sql = str(statement)
            if (
                "UPDATE topiclink_agent_tasks" in sql
                and "SET status" in sql
                and not getattr(thread_state, "waited", False)
            ):
                thread_state.waited = True
                barrier.wait(timeout=5)
            return self._session.execute(statement, parameters or {})

        def __getattr__(self, name):
            return getattr(self._session, name)

    class SynchronizedSessionContext:
        def __init__(self):
            self._context = original_get_db_session()

        def __enter__(self):
            return SynchronizedSession(self._context.__enter__())

        def __exit__(self, *args):
            return self._context.__exit__(*args)

    monkeypatch.setattr(topiclink, "get_db_session", SynchronizedSessionContext)
    from fastapi.testclient import TestClient

    clients = [
        TestClient(topiclink_client.app, raise_server_exceptions=False),
        TestClient(topiclink_client.app, raise_server_exceptions=False),
    ]
    headers = {"Authorization": f"Bearer {owner['openclaw_key']}"}

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda client: client.post(
                    f"/api/v1/topiclink/agent-tasks/{task_id}/claim",
                    headers=headers,
                ),
                clients,
            )
        )

    monkeypatch.setattr(topiclink, "get_db_session", original_get_db_session)
    assert sorted(response.status_code for response in responses) == [200, 409]
    claimed_response = next(response for response in responses if response.status_code == 200)
    claim_token = claimed_response.json()["claim_token"]
    assert claim_token

    rejected = topiclink_client.post(
        f"/api/v1/topiclink/agent-tasks/{task_id}/complete",
        headers=headers,
        json={
            "claim_token": "losing-worker-token-not-issued",
            "summary": "领取失败的执行器不应能提交。",
            "risk_notes": [],
            "next_step": "不应写入。",
        },
    )
    assert rejected.status_code == 409, rejected.text
    rejected_failure = topiclink_client.post(
        f"/api/v1/topiclink/agent-tasks/{task_id}/fail",
        headers=headers,
        json={
            "claim_token": "losing-worker-token-not-issued",
            "error_message": "领取失败的执行器不应能标记失败。",
        },
    )
    assert rejected_failure.status_code == 409, rejected_failure.text

    with original_get_db_session() as session:
        unchanged = session.execute(
            text(
                "SELECT status, output_json, error_message, completed_at "
                "FROM topiclink_agent_tasks WHERE id = :id"
            ),
            {"id": task_id},
        ).fetchone()
    assert unchanged.status == "claimed"
    assert topiclink._topiclink_json_object(unchanged.output_json) == {}
    assert unchanged.error_message is None
    assert unchanged.completed_at is None

    completed = topiclink_client.post(
        f"/api/v1/topiclink/agent-tasks/{task_id}/complete",
        headers=headers,
        json={
            "claim_token": claim_token,
            "summary": "领取成功的执行器提交调研结果。",
            "risk_notes": ["仍需主人确认"],
            "next_step": "主人确认后再打开原线索。",
        },
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["task"]["status"] == "replied"


def test_topiclink_agent_task_expired_claim_can_be_reclaimed(topiclink_client, monkeypatch):
    owner = _register_topiclink_owner(topiclink_client)
    demand = topiclink_client.get(
        "/api/v1/inspiration/demands?limit=1&include_interest=false&include_overview=false"
    ).json()["list"][0]
    task = topiclink_client.post(
        f"/api/v1/topiclink/opc/{demand['slug']}/diligence",
        headers={"Authorization": f"Bearer {owner['token']}"},
    ).json()["task"]
    agent_headers = {"Authorization": f"Bearer {owner['openclaw_key']}"}

    first_token = "worker-generated-first-claim-token"
    first_claim = topiclink_client.post(
        f"/api/v1/topiclink/agent-tasks/{task['id']}/claim",
        headers=agent_headers,
        json={"claim_token": first_token},
    )
    assert first_claim.status_code == 200, first_claim.text
    assert first_claim.json()["claim_token"] == first_token

    from app.storage.database.postgres_client import get_db_session

    with get_db_session() as session:
        session.execute(
            text(
                "UPDATE topiclink_agent_tasks "
                "SET claim_expires_at = datetime('now', '+1 second') "
                "WHERE id = :id"
            ),
            {"id": task["id"]},
        )

    retried_claim = topiclink_client.post(
        f"/api/v1/topiclink/agent-tasks/{task['id']}/claim",
        headers=agent_headers,
        json={"claim_token": first_token},
    )
    assert retried_claim.status_code == 200, retried_claim.text
    assert retried_claim.json()["claim_token"] == first_token

    with get_db_session() as session:
        lease_was_renewed = session.execute(
            text(
                "SELECT claim_expires_at > datetime('now', '+500 seconds') "
                "FROM topiclink_agent_tasks WHERE id = :id"
            ),
            {"id": task["id"]},
        ).scalar_one()
    assert lease_was_renewed

    with get_db_session() as session:
        session.execute(
            text(
                "UPDATE topiclink_agent_tasks "
                "SET claim_expires_at = datetime('now', '-1 second') "
                "WHERE id = :id"
            ),
            {"id": task["id"]},
        )

    claimable = topiclink_client.get(
        "/api/v1/topiclink/agent-tasks?status=pending",
        headers=agent_headers,
    )
    assert claimable.status_code == 200, claimable.text
    claimable_task = next(
        item for item in claimable.json()["items"] if item["id"] == task["id"]
    )
    assert claimable_task["status"] == "pending"
    assert claimable_task["recovery_reason"] == "claim_expired"

    owner_view = topiclink_client.get(
        f"/api/v1/topiclink/dispatches/{task['id']}",
        headers={"Authorization": f"Bearer {owner['token']}"},
    )
    assert owner_view.status_code == 200, owner_view.text
    assert owner_view.json()["task"]["status"] == "pending"
    assert owner_view.json()["task"]["recovery_reason"] == "claim_expired"

    second_token = "worker-generated-second-claim-token"
    second_claim = topiclink_client.post(
        f"/api/v1/topiclink/agent-tasks/{task['id']}/claim",
        headers=agent_headers,
        json={"claim_token": second_token},
    )
    assert second_claim.status_code == 200, second_claim.text
    assert second_claim.json()["claim_token"] == second_token

    from app.api import openclaw_routes

    monkeypatch.setattr(openclaw_routes, "_moderate_or_raise", AsyncMock(return_value=None))
    late_reply = topiclink_client.post(
        f"/api/v1/openclaw/topics/{task['input']['discussion_topic_id']}/posts",
        headers=agent_headers,
        json={
            "body": "旧执行器的迟到回复不应终结新租约。",
            "in_reply_to_id": task["input"]["dispatch_post_id"],
        },
    )
    assert late_reply.status_code == 201, late_reply.text
    owner_during_second_claim = topiclink_client.get(
        f"/api/v1/topiclink/dispatches/{task['id']}",
        headers={"Authorization": f"Bearer {owner['token']}"},
    )
    assert owner_during_second_claim.status_code == 200, owner_during_second_claim.text
    assert owner_during_second_claim.json()["task"]["status"] == "claimed"

    stale_completion = topiclink_client.post(
        f"/api/v1/topiclink/agent-tasks/{task['id']}/complete",
        headers=agent_headers,
        json={
            "claim_token": first_token,
            "summary": "旧执行器不应再能提交。",
            "risk_notes": [],
            "next_step": "不应写入。",
        },
    )
    assert stale_completion.status_code == 409, stale_completion.text

    completed = topiclink_client.post(
        f"/api/v1/topiclink/agent-tasks/{task['id']}/complete",
        headers=agent_headers,
        json={
            "claim_token": second_token,
            "summary": "新执行器接管并完成调研。",
            "risk_notes": ["仍需主人确认"],
            "next_step": "主人确认后再打开原线索。",
        },
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["task"]["status"] == "replied"


@pytest.mark.parametrize(
    ("terminal_path", "terminal_payload", "expected_status"),
    [
        ("fail", {"error_message": "公开信息不足。"}, "failed"),
        (
            "complete",
            {
                "summary": "人工确认的结构化结论。",
                "risk_notes": ["仍需核验预算"],
                "next_step": "主人确认后再打开原线索。",
            },
            "replied",
        ),
    ],
)
def test_owner_poll_does_not_overwrite_a_terminal_opc_task(
    topiclink_client,
    monkeypatch,
    terminal_path,
    terminal_payload,
    expected_status,
):
    owner = _register_topiclink_owner(topiclink_client)
    demand = topiclink_client.get(
        "/api/v1/inspiration/demands?limit=1&include_interest=false&include_overview=false"
    ).json()["list"][0]
    dispatched = topiclink_client.post(
        f"/api/v1/topiclink/opc/{demand['slug']}/diligence",
        headers={"Authorization": f"Bearer {owner['token']}"},
    ).json()["task"]
    discussion_topic_id = dispatched["input"]["discussion_topic_id"]
    dispatch_post_id = dispatched["input"]["dispatch_post_id"]

    from app.api import openclaw_routes

    monkeypatch.setattr(openclaw_routes, "_moderate_or_raise", AsyncMock(return_value=None))
    agent_headers = {"Authorization": f"Bearer {owner['openclaw_key']}"}
    claimed = topiclink_client.post(
        f"/api/v1/topiclink/agent-tasks/{dispatched['id']}/claim",
        headers=agent_headers,
    )
    assert claimed.status_code == 200, claimed.text
    claim_token = claimed.json()["claim_token"]
    reply = topiclink_client.post(
        f"/api/v1/openclaw/topics/{discussion_topic_id}/posts",
        headers=agent_headers,
        json={"body": "公开资料不足，建议主人先补充边界。", "in_reply_to_id": dispatch_post_id},
    )
    assert reply.status_code == 201, reply.text

    owner_update_ready = threading.Event()
    release_owner_update = threading.Event()
    original_get_db_session = topiclink.get_db_session

    class PausedOwnerSession:
        def __init__(self, session):
            self._session = session

        def execute(self, statement, parameters=None):
            if "SET status = 'replied'" in str(statement):
                owner_update_ready.set()
                assert release_owner_update.wait(timeout=5)
            return self._session.execute(statement, parameters or {})

        def __getattr__(self, name):
            return getattr(self._session, name)

    class PausedOwnerSessionContext:
        def __init__(self):
            self._context = original_get_db_session()

        def __enter__(self):
            return PausedOwnerSession(self._context.__enter__())

        def __exit__(self, *args):
            return self._context.__exit__(*args)

    monkeypatch.setattr(topiclink, "get_db_session", PausedOwnerSessionContext)
    from fastapi.testclient import TestClient

    owner_client = TestClient(topiclink_client.app, raise_server_exceptions=False)
    agent_client = TestClient(topiclink_client.app, raise_server_exceptions=False)
    with ThreadPoolExecutor(max_workers=1) as pool:
        owner_poll = pool.submit(
            owner_client.get,
            f"/api/v1/topiclink/dispatches/{dispatched['id']}",
            headers={"Authorization": f"Bearer {owner['token']}"},
        )
        assert owner_update_ready.wait(timeout=5)
        terminal_response = agent_client.post(
            f"/api/v1/topiclink/agent-tasks/{dispatched['id']}/{terminal_path}",
            headers=agent_headers,
            json={**terminal_payload, "claim_token": claim_token},
        )
        assert terminal_response.status_code == 200, terminal_response.text
        release_owner_update.set()
        owner_view = owner_poll.result(timeout=5)

    assert owner_view.status_code == 200, owner_view.text
    task = owner_view.json()["task"]
    assert task["status"] == expected_status
    if expected_status == "failed":
        assert task["error_message"] == terminal_payload["error_message"]
    else:
        assert task["output"] == terminal_payload


def test_dispatch_read_authorizes_owner_before_reply_reconciliation(topiclink_client, monkeypatch):
    owner = _register_topiclink_owner(topiclink_client)
    observer = _register_topiclink_owner(
        topiclink_client,
        phone="13800007772",
        username="topiclink-observer",
    )
    demand = topiclink_client.get(
        "/api/v1/inspiration/demands?limit=1&include_interest=false&include_overview=false"
    ).json()["list"][0]
    task = topiclink_client.post(
        f"/api/v1/topiclink/opc/{demand['slug']}/diligence",
        headers={"Authorization": f"Bearer {owner['token']}"},
    ).json()["task"]

    from app.api import openclaw_routes

    monkeypatch.setattr(openclaw_routes, "_moderate_or_raise", AsyncMock(return_value=None))
    reply = topiclink_client.post(
        f"/api/v1/openclaw/topics/{task['input']['discussion_topic_id']}/posts",
        headers={"Authorization": f"Bearer {owner['openclaw_key']}"},
        json={
            "body": "已有公开回复，等待主人查看。",
            "in_reply_to_id": task["input"]["dispatch_post_id"],
        },
    )
    assert reply.status_code == 201, reply.text

    from app.storage.database.postgres_client import get_db_session

    task_snapshot_query = text(
        "SELECT status, output_json, error_message, updated_at, claimed_at, completed_at "
        "FROM topiclink_agent_tasks WHERE id = :id"
    )
    with get_db_session() as session:
        before_unauthorized_read = dict(
            session.execute(task_snapshot_query, {"id": task["id"]}).mappings().one()
        )
    assert before_unauthorized_read["status"] == "pending"

    unauthorized = topiclink_client.get(
        f"/api/v1/topiclink/dispatches/{task['id']}",
        headers={"Authorization": f"Bearer {observer['token']}"},
    )
    assert unauthorized.status_code == 404, unauthorized.text

    with get_db_session() as session:
        after_unauthorized_read = dict(
            session.execute(task_snapshot_query, {"id": task["id"]}).mappings().one()
        )
    assert after_unauthorized_read == before_unauthorized_read

    owner_view = topiclink_client.get(
        f"/api/v1/topiclink/dispatches/{task['id']}",
        headers={"Authorization": f"Bearer {owner['token']}"},
    )
    assert owner_view.status_code == 200, owner_view.text
    assert owner_view.json()["task"]["status"] == "replied"
