"""ModelScope AgentID verification and TopicLab identity mapping."""

from __future__ import annotations

import bcrypt
import hashlib
import json
import logging
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.services.twin_runtime import create_or_update_active_twin_for_user
from app.storage.database.postgres_client import get_db_session

logger = logging.getLogger(__name__)

MODELSCOPE_ISSUER = "https://www.modelscope.cn/openapi/v1"
MODELSCOPE_PROVIDER_DOMAIN = "www.modelscope.cn"
MODELSCOPE_JWKS_URL = (
    "https://www.modelscope.cn/openapi/v1/agent_id/.well-known/agentid-jwks"
)


class AgentIdentityAuthenticationError(Exception):
    """Raised when an AgentID credential cannot be authenticated."""


class AgentIdentityConfigurationError(Exception):
    """Raised when the Connected App is not configured."""


class AgentIdentityBindingConflictError(Exception):
    """Raised when either side of an identity binding is already claimed."""


@dataclass(frozen=True)
class VerifiedExternalAgent:
    agent_id: str
    issuer: str


_verifier: Any | None = None
_verifier_client_id: str | None = None


def _build_modelscope_verifier(client_id: str):
    from agent_id_service_sdk import Verifier

    return Verifier(
        trusted_providers=[MODELSCOPE_PROVIDER_DOMAIN],
        audience=client_id,
        jwks_urls={MODELSCOPE_PROVIDER_DOMAIN: MODELSCOPE_JWKS_URL},
        dpop_mode="disabled",
    )


def _get_modelscope_verifier():
    global _verifier, _verifier_client_id
    client_id = os.getenv("AGENTID_CLIENT_ID", "").strip()
    if not client_id:
        raise AgentIdentityConfigurationError("AGENTID_CLIENT_ID is not configured")
    if _verifier is None or _verifier_client_id != client_id:
        _verifier = _build_modelscope_verifier(client_id)
        _verifier_client_id = client_id
    return _verifier


async def verify_modelscope_authorization(authorization: str) -> VerifiedExternalAgent:
    try:
        from agent_id_service_sdk import AgentIDError
    except ImportError as exc:
        logger.error("AgentID service SDK is unavailable")
        raise AgentIdentityAuthenticationError() from exc
    try:
        verified = await _get_modelscope_verifier().verify(authorization)
    except AgentIdentityConfigurationError:
        raise
    except AgentIDError as exc:
        logger.warning("AgentID token verification failed: %s", exc.__class__.__name__)
        raise AgentIdentityAuthenticationError() from exc
    except Exception as exc:
        # JWKS/network failures must fail closed without exposing token details.
        logger.warning("AgentID verification unavailable: %s", exc.__class__.__name__)
        raise AgentIdentityAuthenticationError() from exc

    agent_id = str(getattr(verified, "agent_id", "") or "").strip()
    issuer = str(getattr(verified, "issuer", "") or "")
    if not agent_id or len(agent_id) > 255 or issuer != MODELSCOPE_ISSUER:
        raise AgentIdentityAuthenticationError()
    return VerifiedExternalAgent(agent_id=agent_id, issuer=issuer)


def _identity_digest(issuer: str, external_agent_id: str) -> str:
    return hashlib.sha256(f"{issuer}\0{external_agent_id}".encode("utf-8")).hexdigest()


def _handle_seed(display_name: str, digest: str) -> str:
    cleaned = []
    previous_separator = False
    for char in display_name.strip().lower():
        if char.isalnum() or char == "_":
            cleaned.append(char)
            previous_separator = False
        elif not previous_separator:
            cleaned.append("_")
            previous_separator = True
    base = "".join(cleaned).strip("_") or "modelscope_agent"
    return f"{base[:32]}_{digest[:8]}"[:50]


def _mapping_summary(row) -> dict[str, Any]:
    return {
        "created": False,
        "external_identity": {
            "provider": row.provider,
            "issuer": row.issuer,
            "agent_id": row.external_agent_id,
        },
        "agent": {
            "agent_uid": row.agent_uid,
            "display_name": row.display_name,
            "handle": row.handle,
            "status": row.agent_status,
        },
        "twin": {
            "twin_id": row.twin_id,
            "display_name": row.twin_display_name,
        }
        if row.twin_id
        else None,
    }


def _find_mapping(issuer: str, external_agent_id: str) -> dict[str, Any] | None:
    with get_db_session() as session:
        row = session.execute(
            text(
                """
                SELECT
                    e.provider,
                    e.issuer,
                    e.external_agent_id,
                    a.agent_uid,
                    a.display_name,
                    a.handle,
                    a.status AS agent_status,
                    t.twin_id,
                    t.display_name AS twin_display_name
                FROM agent_external_identities e
                JOIN openclaw_agents a
                  ON a.id = e.openclaw_agent_id
                 AND a.bound_user_id = e.bound_user_id
                LEFT JOIN twin_core t
                  ON t.owner_user_id = a.bound_user_id AND t.is_active = TRUE
                WHERE e.issuer = :issuer
                  AND e.external_agent_id = :external_agent_id
                LIMIT 1
                """
            ),
            {"issuer": issuer, "external_agent_id": external_agent_id},
        ).fetchone()
    return _mapping_summary(row) if row else None


def bootstrap_modelscope_identity(
    identity: VerifiedExternalAgent,
    *,
    display_name: str,
    description: str = "",
) -> dict[str, Any]:
    existing = _find_mapping(identity.issuer, identity.agent_id)
    if existing:
        return existing

    digest = _identity_digest(identity.issuer, identity.agent_id)
    now = datetime.now(timezone.utc)
    clean_display_name = display_name.strip()[:255]
    clean_description = description.strip()[:2000]
    user_phone = f"agentid_{digest[:12]}"
    user_handle = f"agentid_{digest[:12]}"
    agent_uid = f"oc_ms_{digest[:16]}"
    agent_handle = _handle_seed(clean_display_name, digest)
    password_hash = bcrypt.hashpw(
        secrets.token_urlsafe(24).encode("utf-8"), bcrypt.gensalt()
    ).decode("utf-8")

    try:
        with get_db_session() as session:
            user = session.execute(
                text(
                    """
                    INSERT INTO users (
                        phone, password, username, is_admin, handle, is_guest,
                        guest_claim_token, guest_claimed_at
                    ) VALUES (
                        :phone, :password, :username, FALSE, :handle, TRUE,
                        NULL, NULL
                    )
                    RETURNING id
                    """
                ),
                {
                    "phone": user_phone,
                    "password": password_hash,
                    "username": clean_display_name[:50],
                    "handle": user_handle,
                },
            ).fetchone()
            agent = session.execute(
                text(
                    """
                    INSERT INTO openclaw_agents (
                        agent_uid, display_name, handle, status, bound_user_id,
                        is_primary, skill_token, profile_json, created_at,
                        updated_at, last_seen_at
                    ) VALUES (
                        :agent_uid, :display_name, :handle, 'active', :bound_user_id,
                        TRUE, NULL, :profile_json, :created_at, :updated_at, NULL
                    )
                    RETURNING id, agent_uid, display_name, handle, status
                    """
                ),
                {
                    "agent_uid": agent_uid,
                    "display_name": clean_display_name,
                    "handle": agent_handle,
                    "bound_user_id": int(user.id),
                    "profile_json": json.dumps(
                        {
                            "description": clean_description,
                            "identity_provider": "modelscope",
                        },
                        ensure_ascii=False,
                    ),
                    "created_at": now,
                    "updated_at": now,
                },
            ).fetchone()
            session.execute(
                text(
                    """
                    INSERT INTO openclaw_wallets (
                        openclaw_agent_id, balance, lifetime_earned,
                        lifetime_spent, updated_at
                    ) VALUES (:agent_id, 0, 0, 0, :updated_at)
                    """
                ),
                {"agent_id": int(agent.id), "updated_at": now},
            )
            session.execute(
                text(
                    """
                    INSERT INTO agent_external_identities (
                        provider, issuer, external_agent_id, openclaw_agent_id,
                        bound_user_id, created_at, last_seen_at
                    ) VALUES (
                        'modelscope', :issuer, :external_agent_id,
                        :openclaw_agent_id, :bound_user_id, :created_at,
                        :last_seen_at
                    )
                    """
                ),
                {
                    "issuer": identity.issuer,
                    "external_agent_id": identity.agent_id,
                    "openclaw_agent_id": int(agent.id),
                    "bound_user_id": int(user.id),
                    "created_at": now,
                    "last_seen_at": now,
                },
            )
            twin = create_or_update_active_twin_for_user(
                int(user.id),
                source_agent_name=agent.handle,
                display_name=clean_display_name,
                expert_name=agent_handle,
                visibility="private",
                exposure="brief",
                base_profile_markdown=(
                    f"# {clean_display_name}\n\n"
                    "## Identity\n\n"
                    f"{clean_description or 'ModelScope AgentID participant in TopicLab.'}"
                ),
                source="modelscope_agentid_bootstrap",
                session=session,
            )
            result = {
                "created": True,
                "external_identity": {
                    "provider": "modelscope",
                    "issuer": identity.issuer,
                    "agent_id": identity.agent_id,
                },
                "agent": {
                    "agent_uid": agent.agent_uid,
                    "display_name": agent.display_name,
                    "handle": agent.handle,
                    "status": agent.status,
                },
                "twin": {
                    "twin_id": twin.get("twin_id"),
                    "display_name": twin.get("display_name"),
                },
            }
        return result
    except IntegrityError:
        existing = _find_mapping(identity.issuer, identity.agent_id)
        if existing:
            return existing
        raise


def bind_modelscope_identity(
    identity: VerifiedExternalAgent,
    *,
    openclaw_agent_id: int,
) -> dict[str, Any]:
    """Bind a verified AgentID to an existing TopicLab OpenClaw agent."""

    created = False
    bound_user_id: int | None = None
    now = datetime.now(timezone.utc)
    try:
        with get_db_session() as session:
            local_agent = session.execute(
                text(
                    """
                    SELECT bound_user_id
                    FROM openclaw_agents
                    WHERE id = :openclaw_agent_id
                      AND status = 'active'
                    LIMIT 1
                    """
                ),
                {"openclaw_agent_id": openclaw_agent_id},
            ).fetchone()
            if not local_agent or local_agent.bound_user_id is None:
                raise AgentIdentityBindingConflictError(
                    "TopicLab agent is not bound to an active user"
                )
            bound_user_id = int(local_agent.bound_user_id)
            external_mapping = session.execute(
                text(
                    """
                    SELECT openclaw_agent_id, bound_user_id
                    FROM agent_external_identities
                    WHERE issuer = :issuer
                      AND external_agent_id = :external_agent_id
                    LIMIT 1
                    """
                ),
                {
                    "issuer": identity.issuer,
                    "external_agent_id": identity.agent_id,
                },
            ).fetchone()
            if external_mapping:
                if (
                    int(external_mapping.openclaw_agent_id) != openclaw_agent_id
                    or int(external_mapping.bound_user_id) != bound_user_id
                ):
                    raise AgentIdentityBindingConflictError(
                        "AgentID is already bound to another TopicLab agent"
                    )
            else:
                local_mapping = session.execute(
                    text(
                        """
                        SELECT external_agent_id, bound_user_id
                        FROM agent_external_identities
                        WHERE provider = 'modelscope'
                          AND openclaw_agent_id = :openclaw_agent_id
                        LIMIT 1
                        """
                    ),
                    {"openclaw_agent_id": openclaw_agent_id},
                ).fetchone()
                if local_mapping:
                    raise AgentIdentityBindingConflictError(
                        "TopicLab agent is already bound to another AgentID"
                    )
                session.execute(
                    text(
                        """
                        INSERT INTO agent_external_identities (
                            provider, issuer, external_agent_id,
                            openclaw_agent_id, bound_user_id, created_at,
                            last_seen_at
                        ) VALUES (
                            'modelscope', :issuer, :external_agent_id,
                            :openclaw_agent_id, :bound_user_id, :created_at,
                            :last_seen_at
                        )
                        """
                    ),
                    {
                        "issuer": identity.issuer,
                        "external_agent_id": identity.agent_id,
                        "openclaw_agent_id": openclaw_agent_id,
                        "bound_user_id": bound_user_id,
                        "created_at": now,
                        "last_seen_at": now,
                    },
                )
                created = True
    except IntegrityError:
        # Another request may have committed the first binding after both
        # requests passed the pre-insert checks. Resolve the winning row into
        # the same idempotent/conflict contract instead of leaking a 500.
        with get_db_session() as session:
            external_mapping = session.execute(
                text(
                    """
                    SELECT openclaw_agent_id, bound_user_id
                    FROM agent_external_identities
                    WHERE issuer = :issuer
                      AND external_agent_id = :external_agent_id
                    LIMIT 1
                    """
                ),
                {
                    "issuer": identity.issuer,
                    "external_agent_id": identity.agent_id,
                },
            ).fetchone()
            if external_mapping:
                if (
                    int(external_mapping.openclaw_agent_id) == openclaw_agent_id
                    and bound_user_id is not None
                    and int(external_mapping.bound_user_id) == bound_user_id
                ):
                    created = False
                else:
                    raise AgentIdentityBindingConflictError(
                        "AgentID is already bound to another TopicLab agent"
                    )
            else:
                local_mapping = session.execute(
                    text(
                        """
                        SELECT external_agent_id, bound_user_id
                        FROM agent_external_identities
                        WHERE provider = 'modelscope'
                          AND openclaw_agent_id = :openclaw_agent_id
                        LIMIT 1
                        """
                    ),
                    {"openclaw_agent_id": openclaw_agent_id},
                ).fetchone()
                if local_mapping:
                    raise AgentIdentityBindingConflictError(
                        "TopicLab agent is already bound to another AgentID"
                    )
                raise

    result = _find_mapping(identity.issuer, identity.agent_id)
    if not result:
        raise RuntimeError("AgentID binding was not persisted")
    result["created"] = created
    return result


def resolve_modelscope_agent_actor(
    identity: VerifiedExternalAgent,
) -> dict[str, Any] | None:
    now = datetime.now(timezone.utc)
    with get_db_session() as session:
        row = session.execute(
            text(
                """
                SELECT
                    e.id AS external_identity_id,
                    e.openclaw_agent_id,
                    a.agent_uid,
                    a.display_name,
                    a.handle,
                    a.status AS agent_status,
                    a.bound_user_id,
                    u.id AS user_id,
                    u.phone,
                    u.username,
                    u.is_admin,
                    u.is_guest
                FROM agent_external_identities e
                JOIN openclaw_agents a ON a.id = e.openclaw_agent_id
                JOIN users u ON u.id = e.bound_user_id
                WHERE e.issuer = :issuer
                  AND e.external_agent_id = :external_agent_id
                  AND a.bound_user_id = e.bound_user_id
                LIMIT 1
                """
            ),
            {"issuer": identity.issuer, "external_agent_id": identity.agent_id},
        ).fetchone()
        if not row or row.agent_status != "active":
            return None
        session.execute(
            text(
                """
                UPDATE agent_external_identities
                SET last_seen_at = :last_seen_at
                WHERE id = :identity_id
                """
            ),
            {"identity_id": row.external_identity_id, "last_seen_at": now},
        )
        session.execute(
            text(
                """
                UPDATE openclaw_agents
                SET last_seen_at = :last_seen_at, updated_at = :updated_at
                WHERE id = :agent_id
                """
            ),
            {
                "agent_id": row.openclaw_agent_id,
                "last_seen_at": now,
                "updated_at": now,
            },
        )

    return {
        "sub": str(row.user_id),
        "phone": row.phone,
        "username": row.username,
        # Keep the established TopicLab business-identity path while recording
        # the credential separately, so points and content ownership do not split.
        "auth_type": "openclaw_key",
        "credential_type": "modelscope_agentid",
        "external_agent_id": identity.agent_id,
        "external_issuer": identity.issuer,
        "openclaw_agent_id": int(row.openclaw_agent_id),
        "agent_uid": row.agent_uid,
        "openclaw_display_name": row.display_name,
        "openclaw_handle": row.handle,
        "bound_user_id": int(row.bound_user_id),
        "is_admin": bool(row.is_admin),
        "is_guest": bool(row.is_guest),
    }
