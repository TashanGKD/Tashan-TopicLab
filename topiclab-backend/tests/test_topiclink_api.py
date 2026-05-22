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
