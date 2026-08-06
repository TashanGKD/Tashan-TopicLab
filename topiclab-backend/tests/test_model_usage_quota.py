import pytest
from fastapi import HTTPException


def test_model_usage_quota_works_without_database(monkeypatch):
    from app.services import model_usage_quota

    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(
        model_usage_quota,
        "get_db_session",
        lambda: (_ for _ in ()).throw(AssertionError("database must not be opened")),
    )
    model_usage_quota._memory_usage.clear()

    model_usage_quota.consume_model_usage(987654321, "critic_evaluation")
    model_usage_quota.consume_model_usage(987654321, "critic_evaluation")
    with pytest.raises(HTTPException) as captured:
        model_usage_quota.consume_model_usage(987654321, "critic_evaluation")

    assert captured.value.status_code == 429
    assert captured.value.headers == {"Retry-After": "600"}
