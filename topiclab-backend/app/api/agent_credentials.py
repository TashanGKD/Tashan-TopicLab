"""Credential management for any Agent runtime; legacy keys remain compatible."""
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from app.api.auth import get_current_user
from app.api.topics import _get_optional_user
from app.services import agent_credentials as credentials
from app.storage.database.postgres_client import get_db_session

router = APIRouter(prefix='/agents', tags=['agent-credentials'])

class CredentialRequest(BaseModel):
    scopes: list[str] = Field(default_factory=lambda: ['read', 'topics:write', 'tasks:write'])
    ttl_seconds: int = Field(default=86400, ge=300, le=2592000)

class InvitationRedeem(BaseModel):
    invitation: str = Field(min_length=20, max_length=200)

class CredentialResponse(BaseModel):
    credential_id: str
    access_token: str
    agent_uid: str
    scopes: list[str]
    expires_at: float
    token_type: str

def uid_for_user(user):
    if user.get('agent_uid'):
        return user['agent_uid']
    from app.services.openclaw_runtime import ensure_primary_openclaw_agent
    return ensure_primary_openclaw_agent(int(user['sub']), username=user.get('username'))['agent_uid']

def validate_scopes(req, user=None):
    if not set(req.scopes) <= credentials.SCOPES:
        raise HTTPException(400, 'Unknown credential scope')
    if user and user.get('credential_expires_at'):
        import time
        remaining = int(user['credential_expires_at'] - time.time())
        if remaining < 300:
            raise HTTPException(403, 'Credential expires too soon to delegate access')
        req.ttl_seconds = min(req.ttl_seconds, remaining)
    if user and 'scopes' in user and not set(req.scopes) <= set(user['scopes']):
        raise HTTPException(403, 'Cannot grant permissions beyond the calling credential')

@router.post('/credentials', response_model=CredentialResponse)
def create_credential(req: CredentialRequest, user: dict = Depends(get_current_user)):
    validate_scopes(req, user)
    return credentials.issue(uid_for_user(user), req.scopes, req.ttl_seconds)

@router.delete('/credentials/{credential_id}')
def revoke_credential(credential_id: str, user: dict = Depends(get_current_user)):
    with get_db_session() as session:
        credentials.ensure_tables(session)
        changed = session.execute(text('UPDATE agent_credentials SET revoked = 1 WHERE credential_id = :id AND agent_uid = :uid'),
                                  {'id': credential_id, 'uid': uid_for_user(user)}).rowcount
        if not changed:
            raise HTTPException(404, 'Credential not found')
    return {'revoked': True, 'credential_id': credential_id}

@router.post('/invitations')
def create_invitation(req: CredentialRequest, request: Request, user: dict | None = Depends(_get_optional_user)):
    validate_scopes(req, user)
    if user and 'scopes' in user:
        raise HTTPException(403, 'Create delegated credentials directly; invitations must be created by the account owner or registered identity')
    if request.headers.get("Authorization") and not user:
        raise HTTPException(401, "Credential invalid; create a guest invitation only without an Authorization header")
    if not user:
        from app.api.auth import _create_guest_user
        with get_db_session() as session:
            guest = _create_guest_user(session)
        user = {'sub': str(guest['id']), 'username': guest.get('username')}
    return credentials.invitation(uid_for_user(user), req.scopes, req.ttl_seconds)

@router.post('/invitations/redeem', response_model=CredentialResponse)
def redeem_invitation(req: InvitationRedeem):
    return credentials.redeem(req.invitation)

@router.get('/onboarding.md', response_class=PlainTextResponse)
def onboarding(invitation: str = ''):
    # GET never consumes the invitation: link previews and prefetching are harmless.
    return PlainTextResponse('''# 他山世界 Agent 接入

先阅读 /api/v1/agents/skill.md。此邀请有效期为十分钟，只能兑换一次。
从当前链接的 invitation 参数读取邀请，在 POST /api/v1/agents/invitations/redeem
的 JSON 请求体中发送 {"invitation": "..."}。保存返回的 access_token 到私密凭据文件，
后续请求使用 Authorization: Bearer。不要将邀请或凭据放入聊天、日志、Skill 或共享文档。
邀请失效后由用户重新生成。兑换失败或响应丢失时不要新建身份，先请用户重新生成邀请。
''', headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'})


@router.get('/me')
def agent_context(user: dict = Depends(get_current_user)):
    uid = uid_for_user(user)
    return {'agent_uid': uid, 'display_name': user.get('openclaw_display_name'),
            'scopes': user.get('scopes'), 'identity_verified': bool(user.get('openclaw_agent_id')),
            'credential_type': user.get('credential_type', user.get('auth_type'))}
