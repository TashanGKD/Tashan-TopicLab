import sys
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import jwt
import pytest
from agent_id_service_sdk import Verifier
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy.exc import IntegrityError
import tomllib


def test_modelscope_verifier_uses_registered_audience_and_pinned_jwks(monkeypatch):
    captured = {}

    class FakeVerifier:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setitem(
        sys.modules,
        "agent_id_service_sdk",
        SimpleNamespace(Verifier=FakeVerifier),
    )

    from app.services.agent_identity import _build_modelscope_verifier

    _build_modelscope_verifier("hub_418d2a")

    assert captured == {
        "trusted_providers": ["www.modelscope.cn"],
        "audience": "hub_418d2a",
        "jwks_urls": {
            "www.modelscope.cn": (
                "https://www.modelscope.cn/openapi/v1/agent_id/"
                ".well-known/agentid-jwks"
            )
        },
        "dpop_mode": "disabled",
    }


def test_backend_pins_the_agentid_service_sdk_release():
    pyproject = tomllib.loads(
        (Path(__file__).resolve().parents[1] / "pyproject.toml").read_text(
            encoding="utf-8"
        )
    )

    assert "agent-id-service-sdk==0.6.0" in pyproject["project"]["dependencies"]


def test_concurrent_same_binding_recovers_as_idempotent(monkeypatch):
    from app.services import agent_identity as service

    calls = 0

    class FakeResult:
        def __init__(self, row=None):
            self.row = row

        def fetchone(self):
            return self.row

    class FakeSession:
        def __init__(self, attempt):
            self.attempt = attempt

        def execute(self, statement, params):
            sql = str(statement)
            if "SELECT openclaw_agent_id" in sql:
                row = (
                    SimpleNamespace(openclaw_agent_id=42)
                    if self.attempt == 2
                    else None
                )
                return FakeResult(row)
            if "SELECT external_agent_id" in sql:
                return FakeResult()
            return FakeResult()

    @contextmanager
    def fake_get_db_session():
        nonlocal calls
        calls += 1
        attempt = calls
        yield FakeSession(attempt)
        if attempt == 1:
            raise IntegrityError("duplicate binding", {}, Exception())

    monkeypatch.setattr(service, "get_db_session", fake_get_db_session)
    monkeypatch.setattr(
        service,
        "_find_mapping",
        lambda issuer, agent_id: {
            "created": False,
            "external_identity": {"issuer": issuer, "agent_id": agent_id},
            "agent": {"agent_uid": "oc_existing"},
            "twin": None,
        },
    )

    result = service.bind_modelscope_identity(
        service.VerifiedExternalAgent(
            agent_id="agent_id:modelscope:concurrent",
            issuer=service.MODELSCOPE_ISSUER,
        ),
        openclaw_agent_id=42,
    )

    assert result["created"] is False
    assert result["agent"]["agent_uid"] == "oc_existing"


def _signed_agentid_token(
    signing_key,
    *,
    issuer="https://www.modelscope.cn/openapi/v1",
    audience="hub_418d2a",
    expires_delta=timedelta(minutes=5),
):
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "sub": "agent_id:modelscope:cryptographic_test",
            "iss": issuer,
            "aud": audience,
            "iat": now,
            "exp": now + expires_delta,
        },
        signing_key,
        algorithm="EdDSA",
        headers={"kid": "test-key"},
    )


def _local_verifier(public_key):
    verifier = Verifier(
        trusted_providers=["www.modelscope.cn"],
        audience="hub_418d2a",
        jwks_urls={"www.modelscope.cn": "https://unused.invalid/jwks"},
        clock_skew_seconds=0,
        dpop_mode="disabled",
    )

    async def fetch_jwks(provider_domain, force_refresh=False):
        assert provider_domain == "www.modelscope.cn"
        return {"test-key": public_key}

    verifier._fetch_jwks = fetch_jwks
    return verifier


@pytest.mark.asyncio
async def test_modelscope_authorization_accepts_a_real_valid_signature(monkeypatch):
    from app.services import agent_identity as service

    signing_key = Ed25519PrivateKey.generate()
    monkeypatch.setattr(
        service,
        "_get_modelscope_verifier",
        lambda: _local_verifier(signing_key.public_key()),
    )

    identity = await service.verify_modelscope_authorization(
        f"Bearer {_signed_agentid_token(signing_key)}"
    )

    assert identity == service.VerifiedExternalAgent(
        agent_id="agent_id:modelscope:cryptographic_test",
        issuer=service.MODELSCOPE_ISSUER,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case",
    ["bad_signature", "wrong_audience", "expired", "non_exact_issuer"],
)
async def test_modelscope_authorization_rejects_invalid_real_jwts(monkeypatch, case):
    from app.services import agent_identity as service

    trusted_key = Ed25519PrivateKey.generate()
    signing_key = (
        Ed25519PrivateKey.generate() if case == "bad_signature" else trusted_key
    )
    token_kwargs = {}
    if case == "wrong_audience":
        token_kwargs["audience"] = "another-connected-app"
    elif case == "expired":
        token_kwargs["expires_delta"] = timedelta(minutes=-1)
    elif case == "non_exact_issuer":
        token_kwargs["issuer"] = "https://www.modelscope.cn/openapi/v1/"

    monkeypatch.setattr(
        service,
        "_get_modelscope_verifier",
        lambda: _local_verifier(trusted_key.public_key()),
    )

    with pytest.raises(service.AgentIdentityAuthenticationError):
        await service.verify_modelscope_authorization(
            f"Bearer {_signed_agentid_token(signing_key, **token_kwargs)}"
        )
