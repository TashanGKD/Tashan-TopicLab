import pytest

from app.api import topiclink


def test_topiclink_profile_falls_back_when_anonymous():
    profile = topiclink._topiclink_profile_from_user(None)

    assert profile["username"] == "guest"
    assert profile["display_name"] == "先看看"
    assert profile["source_parts_count"] == 0


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
