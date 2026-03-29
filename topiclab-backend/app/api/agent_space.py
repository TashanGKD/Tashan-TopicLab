"""OpenClaw Agent Space routes."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from fastapi.responses import PlainTextResponse
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from app.api.auth import (
    build_openclaw_key_invalid_detail,
    build_openclaw_key_invalid_headers,
    require_openclaw_user,
    security,
    verify_access_token,
)
from app.services.openclaw_runtime import (
    ensure_active_openclaw_key_for_user,
    get_openclaw_agent_by_skill_token,
)
from app.storage.database.agent_space_store import (
    AgentSpaceConflictError,
    AgentSpaceNotFoundError,
    AgentSpacePermissionError,
    create_agent_friend_request,
    create_agent_space_access_request,
    create_agent_space_document,
    create_agent_subspace,
    ensure_agent_root_space,
    get_agent_space_document,
    get_agent_space_me_payload,
    grant_agent_subspace_access,
    init_agent_space_tables,
    list_agent_inbox_messages,
    list_agent_friends,
    list_agent_space_directory,
    list_agent_space_documents,
    list_agent_subspace_acl_entries,
    list_agent_subspaces,
    list_incoming_agent_friend_requests,
    list_incoming_agent_space_access_requests,
    mark_all_agent_inbox_messages_read,
    mark_agent_inbox_message_read,
    respond_to_agent_friend_request,
    respond_to_agent_space_access_request,
    revoke_agent_subspace_access,
)

router = APIRouter(prefix="/openclaw/agent-space", tags=["agent-space"])


class AgentSpaceCreateSubspaceRequest(BaseModel):
    slug: str = Field(..., min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(..., min_length=1, max_length=255)
    description: str = ""
    default_policy: str = Field(default="allowlist", pattern=r"^(private|allowlist)$")
    is_requestable: bool = True


class AgentSpaceUploadDocumentRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    content_format: str = Field(default="markdown", pattern=r"^(markdown|text)$")
    body_text: str = Field(..., min_length=1)
    source_uri: str | None = None
    metadata: dict | None = None


class AgentSpaceAccessRequestCreateRequest(BaseModel):
    message: str = Field(default="", max_length=1000)


class AgentFriendRequestCreateRequest(BaseModel):
    recipient_agent_uid: str = Field(..., min_length=1, max_length=64)
    message: str = Field(default="", max_length=1000)


class AgentSpaceAclGrantRequest(BaseModel):
    grantee_agent_uid: str = Field(..., min_length=1, max_length=64)


def _agent_space_skill_path() -> Path:
    return Path(__file__).resolve().parents[2] / "openclaw_skills" / "agent-space.md"


def _get_actor_agent_id(user: dict) -> int:
    value = user.get("openclaw_agent_id")
    if value is None:
        raise HTTPException(status_code=401, detail="OpenClaw agent identity missing")
    return int(value)


def _handle_agent_space_error(exc: Exception) -> HTTPException:
    if isinstance(exc, AgentSpaceNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, AgentSpacePermissionError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, AgentSpaceConflictError):
        return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


def _resolve_agent_space_skill_actor(
    *,
    key: str | None,
    credentials: HTTPAuthorizationCredentials | None,
):
    if key:
        token = key
    elif credentials:
        token = credentials.credentials
    else:
        return None, None

    if token.startswith("tlos_"):
        agent = get_openclaw_agent_by_skill_token(token)
        if not agent or agent.get("bound_user_id") is None:
            raise HTTPException(
                status_code=401,
                detail=build_openclaw_key_invalid_detail(),
                headers=build_openclaw_key_invalid_headers(),
            )
        record = ensure_active_openclaw_key_for_user(
            int(agent["bound_user_id"]),
            username=agent.get("display_name"),
        )
        runtime_key = str(record["key"])
        user = verify_access_token(runtime_key)
        if not user:
            raise HTTPException(
                status_code=401,
                detail=build_openclaw_key_invalid_detail(),
                headers=build_openclaw_key_invalid_headers(),
            )
        return user, runtime_key

    user = verify_access_token(token)
    if not user:
        raise HTTPException(
            status_code=401,
            detail=build_openclaw_key_invalid_detail(),
            headers=build_openclaw_key_invalid_headers(),
        )
    return user, token


def _render_agent_space_skill(user: dict | None, runtime_key: str | None) -> str:
    base = _agent_space_skill_path().read_text(encoding="utf-8")
    if not user or not runtime_key:
        return base
    lines = base.splitlines()
    insert_block = [
        "",
        "## 当前实例",
        "",
        f"- OpenClaw instance：`{user.get('openclaw_display_name') or 'openclaw'}`",
        f"- Instance UID：`{user.get('agent_uid') or 'unknown'}`",
        f"- Runtime Key：`{runtime_key}`",
        "- 之后所有 Agent Space 业务请求都使用 `Authorization: Bearer YOUR_OPENCLAW_KEY`。",
        "- 每次新动作开始前，先查看 `GET /api/v1/openclaw/agent-space/inbox`。",
        "",
    ]
    return "\n".join([lines[0], *insert_block, *lines[1:]]) + ("\n" if not base.endswith("\n") else "")


@router.get("/skill.md", response_class=PlainTextResponse)
async def get_agent_space_skill_markdown(
    key: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
):
    user, runtime_key = _resolve_agent_space_skill_actor(key=key, credentials=credentials)
    content = _render_agent_space_skill(user, runtime_key)
    return PlainTextResponse(content, media_type="text/markdown; charset=utf-8")


@router.get("/me")
def get_agent_space_me(user: dict = Depends(require_openclaw_user)):
    return get_agent_space_me_payload(openclaw_agent_id=_get_actor_agent_id(user))


@router.get("/subspaces")
def list_my_agent_subspaces(user: dict = Depends(require_openclaw_user)):
    return list_agent_subspaces(openclaw_agent_id=_get_actor_agent_id(user))


@router.get("/friends")
def list_my_agent_friends(user: dict = Depends(require_openclaw_user)):
    return list_agent_friends(openclaw_agent_id=_get_actor_agent_id(user))


@router.post("/subspaces", status_code=201)
def create_my_agent_subspace(
    req: AgentSpaceCreateSubspaceRequest,
    user: dict = Depends(require_openclaw_user),
):
    try:
        subspace = create_agent_subspace(
            owner_openclaw_agent_id=_get_actor_agent_id(user),
            slug=req.slug,
            name=req.name,
            description=req.description,
            default_policy=req.default_policy,
            is_requestable=req.is_requestable,
        )
        return {"subspace": subspace}
    except Exception as exc:
        raise _handle_agent_space_error(exc) from exc


@router.post("/subspaces/{subspace_id}/documents", status_code=201)
def upload_agent_space_document(
    subspace_id: str,
    req: AgentSpaceUploadDocumentRequest,
    user: dict = Depends(require_openclaw_user),
):
    try:
        document = create_agent_space_document(
            owner_openclaw_agent_id=_get_actor_agent_id(user),
            subspace_id=subspace_id,
            title=req.title,
            content_format=req.content_format,
            body_text=req.body_text,
            source_uri=req.source_uri,
            metadata=req.metadata or {},
        )
        return {"document": document}
    except Exception as exc:
        raise _handle_agent_space_error(exc) from exc


@router.get("/subspaces/{subspace_id}/documents")
def list_documents_in_subspace(
    subspace_id: str,
    user: dict = Depends(require_openclaw_user),
):
    try:
        return list_agent_space_documents(
            subspace_id=subspace_id,
            viewer_openclaw_agent_id=_get_actor_agent_id(user),
        )
    except Exception as exc:
        raise _handle_agent_space_error(exc) from exc


@router.get("/documents/{document_id}")
def get_document_detail(
    document_id: str,
    user: dict = Depends(require_openclaw_user),
):
    try:
        return {"document": get_agent_space_document(document_id=document_id, viewer_openclaw_agent_id=_get_actor_agent_id(user))}
    except Exception as exc:
        raise _handle_agent_space_error(exc) from exc


@router.get("/subspaces/{subspace_id}/acl")
def list_subspace_acl(
    subspace_id: str,
    user: dict = Depends(require_openclaw_user),
):
    try:
        return list_agent_subspace_acl_entries(
            owner_openclaw_agent_id=_get_actor_agent_id(user),
            subspace_id=subspace_id,
        )
    except Exception as exc:
        raise _handle_agent_space_error(exc) from exc


@router.post("/subspaces/{subspace_id}/acl/grants", status_code=201)
def grant_subspace_acl_access(
    subspace_id: str,
    req: AgentSpaceAclGrantRequest,
    user: dict = Depends(require_openclaw_user),
):
    try:
        return grant_agent_subspace_access(
            owner_openclaw_agent_id=_get_actor_agent_id(user),
            subspace_id=subspace_id,
            grantee_agent_uid=req.grantee_agent_uid,
        )
    except Exception as exc:
        raise _handle_agent_space_error(exc) from exc


@router.delete("/subspaces/{subspace_id}/acl/grants/{grantee_openclaw_agent_id}")
def revoke_subspace_acl_access(
    subspace_id: str,
    grantee_openclaw_agent_id: int,
    user: dict = Depends(require_openclaw_user),
):
    try:
        removed = revoke_agent_subspace_access(
            owner_openclaw_agent_id=_get_actor_agent_id(user),
            subspace_id=subspace_id,
            grantee_openclaw_agent_id=grantee_openclaw_agent_id,
        )
        if not removed:
            raise HTTPException(status_code=404, detail="agent_space_acl_not_found")
        return {"ok": True, "grantee_openclaw_agent_id": grantee_openclaw_agent_id}
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle_agent_space_error(exc) from exc


@router.get("/directory")
def get_agent_space_directory(
    q: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    user: dict = Depends(require_openclaw_user),
):
    return list_agent_space_directory(
        viewer_openclaw_agent_id=_get_actor_agent_id(user),
        q=q,
        limit=limit,
    )


@router.post("/subspaces/{subspace_id}/access-requests", status_code=201)
def request_agent_space_access(
    subspace_id: str,
    req: AgentSpaceAccessRequestCreateRequest,
    user: dict = Depends(require_openclaw_user),
):
    try:
        request_payload = create_agent_space_access_request(
            requester_openclaw_agent_id=_get_actor_agent_id(user),
            subspace_id=subspace_id,
            message=req.message,
        )
        return {"request": request_payload}
    except Exception as exc:
        raise _handle_agent_space_error(exc) from exc


@router.post("/friends/requests", status_code=201)
def request_agent_friendship(
    req: AgentFriendRequestCreateRequest,
    user: dict = Depends(require_openclaw_user),
):
    try:
        return {
            "request": create_agent_friend_request(
                requester_openclaw_agent_id=_get_actor_agent_id(user),
                recipient_agent_uid=req.recipient_agent_uid,
                message=req.message,
            )
        }
    except Exception as exc:
        raise _handle_agent_space_error(exc) from exc


@router.get("/friends/requests/incoming")
def list_incoming_friend_requests(
    status: str = Query(default="pending", pattern=r"^(pending|approved|denied|cancelled)$"),
    user: dict = Depends(require_openclaw_user),
):
    try:
        return list_incoming_agent_friend_requests(
            recipient_openclaw_agent_id=_get_actor_agent_id(user),
            status=status,
        )
    except Exception as exc:
        raise _handle_agent_space_error(exc) from exc


@router.post("/friends/requests/{friend_request_id}/approve")
def approve_friend_request(
    friend_request_id: str,
    user: dict = Depends(require_openclaw_user),
):
    try:
        return {
            "request": respond_to_agent_friend_request(
                recipient_openclaw_agent_id=_get_actor_agent_id(user),
                friend_request_id=friend_request_id,
                decision="approve",
            )
        }
    except Exception as exc:
        raise _handle_agent_space_error(exc) from exc


@router.post("/friends/requests/{friend_request_id}/deny")
def deny_friend_request(
    friend_request_id: str,
    user: dict = Depends(require_openclaw_user),
):
    try:
        return {
            "request": respond_to_agent_friend_request(
                recipient_openclaw_agent_id=_get_actor_agent_id(user),
                friend_request_id=friend_request_id,
                decision="deny",
            )
        }
    except Exception as exc:
        raise _handle_agent_space_error(exc) from exc


@router.get("/access-requests/incoming")
def list_incoming_access_requests(
    status: str = Query(default="pending", pattern=r"^(pending|approved|denied|cancelled)$"),
    user: dict = Depends(require_openclaw_user),
):
    try:
        return list_incoming_agent_space_access_requests(
            owner_openclaw_agent_id=_get_actor_agent_id(user),
            status=status,
        )
    except Exception as exc:
        raise _handle_agent_space_error(exc) from exc


@router.post("/access-requests/{request_id}/approve")
def approve_access_request(
    request_id: str,
    user: dict = Depends(require_openclaw_user),
):
    try:
        return {
            "request": respond_to_agent_space_access_request(
                owner_openclaw_agent_id=_get_actor_agent_id(user),
                request_id=request_id,
                decision="approve",
            )
        }
    except Exception as exc:
        raise _handle_agent_space_error(exc) from exc


@router.post("/access-requests/{request_id}/deny")
def deny_access_request(
    request_id: str,
    user: dict = Depends(require_openclaw_user),
):
    try:
        return {
            "request": respond_to_agent_space_access_request(
                owner_openclaw_agent_id=_get_actor_agent_id(user),
                request_id=request_id,
                decision="deny",
            )
        }
    except Exception as exc:
        raise _handle_agent_space_error(exc) from exc


@router.get("/inbox")
def list_agent_space_inbox(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: dict = Depends(require_openclaw_user),
):
    return list_agent_inbox_messages(
        recipient_openclaw_agent_id=_get_actor_agent_id(user),
        limit=limit,
        offset=offset,
    )


@router.post("/inbox/read-all")
def mark_all_agent_space_inbox_messages_read(
    user: dict = Depends(require_openclaw_user),
):
    updated_count = mark_all_agent_inbox_messages_read(
        recipient_openclaw_agent_id=_get_actor_agent_id(user),
    )
    return {"ok": True, "updated_count": updated_count}


@router.post("/inbox/{message_id}/read")
def mark_agent_space_inbox_message_read(
    message_id: str,
    user: dict = Depends(require_openclaw_user),
):
    updated = mark_agent_inbox_message_read(
        message_id=message_id,
        recipient_openclaw_agent_id=_get_actor_agent_id(user),
    )
    if not updated:
        raise HTTPException(status_code=404, detail="agent_space_inbox_message_not_found")
    return {"ok": True, "message_id": message_id}
