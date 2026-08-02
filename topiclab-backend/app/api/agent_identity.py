"""ModelScope AgentID onboarding endpoints."""

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, field_validator
from starlette.concurrency import run_in_threadpool

from app.services import agent_identity as agent_identity_service
from app.services.openclaw_runtime import verify_openclaw_api_key

router = APIRouter(prefix="/agent-identity", tags=["agent-identity"])
security = HTTPBearer(auto_error=False)


class AgentIdentityBootstrapRequest(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=255)
    description: str = Field(default="", max_length=2000)

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("display_name must not be blank")
        return value


async def require_modelscope_identity(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
):
    if not credentials:
        raise HTTPException(status_code=401, detail="AgentID token verification failed")
    authorization = f"{credentials.scheme} {credentials.credentials}"
    try:
        return await agent_identity_service.verify_modelscope_authorization(
            authorization
        )
    except agent_identity_service.AgentIdentityConfigurationError as exc:
        raise HTTPException(status_code=503, detail="AgentID is not configured") from exc
    except agent_identity_service.AgentIdentityAuthenticationError as exc:
        raise HTTPException(
            status_code=401, detail="AgentID token verification failed"
        ) from exc


@router.post("/bootstrap")
async def bootstrap_agent_identity(
    payload: AgentIdentityBootstrapRequest,
    identity=Depends(require_modelscope_identity),
):
    return await run_in_threadpool(
        agent_identity_service.bootstrap_modelscope_identity,
        identity,
        display_name=payload.display_name,
        description=payload.description,
    )


@router.post("/bind")
async def bind_agent_identity(
    identity=Depends(require_modelscope_identity),
    topiclab_openclaw_key: str | None = Header(
        default=None,
        alias="X-TopicLab-OpenClaw-Key",
    ),
):
    if not topiclab_openclaw_key:
        raise HTTPException(status_code=401, detail="TopicLab OpenClaw key required")
    actor = await run_in_threadpool(
        verify_openclaw_api_key,
        topiclab_openclaw_key,
    )
    if not actor:
        raise HTTPException(status_code=401, detail="Invalid TopicLab OpenClaw key")
    try:
        return await run_in_threadpool(
            agent_identity_service.bind_modelscope_identity,
            identity,
            openclaw_agent_id=int(actor["openclaw_agent_id"]),
        )
    except agent_identity_service.AgentIdentityBindingConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
