from sqlalchemy.exc import IntegrityError
from sqlalchemy import text

import app.api.auth as auth_module
from app.storage.database.postgres_client import get_db_session, init_auth_tables


class _FakeOrig:
    def __init__(self, message: str):
        self.args = (message,)
        self._message = message

    def __str__(self) -> str:
        return self._message


def _make_integrity_error(message: str) -> IntegrityError:
    return IntegrityError(
        statement="INSERT INTO users (phone, password, username) VALUES (?, ?, ?)",
        params=("13800000000", "hashed", "tester"),
        orig=_FakeOrig(message),
    )


def test_phone_unique_violation_is_detected():
    exc = _make_integrity_error("duplicate key value violates unique constraint 'users_phone_key'")
    assert auth_module._is_phone_unique_violation(exc) is True


def test_non_phone_integrity_error_is_not_misreported_as_registered():
    exc = _make_integrity_error("duplicate key value violates unique constraint 'digital_twins_user_id_agent_name_key'")
    assert auth_module._is_phone_unique_violation(exc) is False


def test_watcha_oauth_user_is_created_and_reused():
    init_auth_tables()
    provider_user_id = "watcha-test-10001"
    userinfo = {
        "user_id": provider_user_id,
        "nickname": "Watcha Tester",
        "avatar_url": "https://example.com/avatar.png",
        "email": "tester@example.com",
    }
    token_response = {
        "access_token": "access-token",
        "refresh_token": "refresh-token",
        "scope": "read email",
    }

    user, claim_status, claim_detail = auth_module._upsert_watcha_oauth_user(
        userinfo=userinfo,
        token_response=token_response,
        claim_token=None,
    )
    reused, _, _ = auth_module._upsert_watcha_oauth_user(
        userinfo={**userinfo, "nickname": "Watcha Tester 2"},
        token_response={**token_response, "access_token": "access-token-2"},
        claim_token=None,
    )

    assert claim_status is None
    assert claim_detail is None
    assert reused["id"] == user["id"]
    assert str(user["phone"]).startswith("watcha_")
    with get_db_session() as session:
        row = session.execute(
            text(
                """
                SELECT user_id, nickname, access_token
                FROM oauth_accounts
                WHERE provider = 'watcha' AND provider_user_id = :provider_user_id
                """
            ),
            {"provider_user_id": provider_user_id},
        ).fetchone()
    assert row is not None
    assert row.user_id == user["id"]
    assert row.nickname == "Watcha Tester 2"
    assert row.access_token == "access-token-2"


def test_oauth_next_path_rejects_open_redirects():
    assert auth_module._normalize_oauth_next_path("/topics") == "/topics"
    assert auth_module._normalize_oauth_next_path("https://evil.example") == "/"
    assert auth_module._normalize_oauth_next_path("//evil.example") == "/"
