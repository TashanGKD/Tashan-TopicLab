"""First-party SSO with per-client callbacks, mandatory PKCE and revocable sessions."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response, Query
from pydantic import BaseModel, Field, ConfigDict, field_validator
from fastapi.routing import APIRoute
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from app.api.auth import get_current_user
from app.api.admin import require_admin_panel
from app.services import sso_service as service


def no_store(response: Response):
    response.headers['Cache-Control'] = 'no-store'
    response.headers['Referrer-Policy'] = 'no-referrer'


class SsoRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()
        async def handle(request):
            headers = {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'}
            try:
                response = await original(request)
                response.headers.update(headers)
                return response
            except RequestValidationError as exc:
                # Pydantic's default error response echoes rejected input, including secrets.
                detail = [{k: item[k] for k in ('loc', 'msg', 'type')} for item in exc.errors()]
                return JSONResponse(status_code=422, content={'detail': detail}, headers=headers)
            except HTTPException as exc:
                exc.headers = {**(exc.headers or {}), **headers}
                raise
        return handle


router = APIRouter(route_class=SsoRoute, dependencies=[Depends(no_store)])
admin_router = APIRouter(prefix='/admin/sso', route_class=SsoRoute, dependencies=[Depends(no_store), Depends(require_admin_panel)])


class AuthorizeRequest(BaseModel):
    client_id: str = Field(min_length=1, max_length=64)
    redirect_uri: str = Field(min_length=1, max_length=2048)
    state: str = Field(min_length=32, max_length=256)
    code_challenge: str = Field(pattern=r'^[A-Za-z0-9_-]{43}$')
    code_challenge_method: Literal['S256']


class ClientCredentials(BaseModel):
    client_id: str = Field(min_length=1, max_length=64)
    client_secret: str = Field(min_length=32, max_length=512)


class ExchangeRequest(ClientCredentials):
    code: str = Field(min_length=1, max_length=256)
    redirect_uri: str = Field(min_length=1, max_length=2048)
    code_verifier: str = Field(pattern=r'^[A-Za-z0-9._~-]{43,128}$')


class SessionRequest(ClientCredentials):
    session_token: str = Field(min_length=32, max_length=256)


class ProfileChanges(BaseModel):
    model_config = ConfigDict(extra='forbid')
    display_name: str | None = Field(default=None,max_length=80)
    real_name: str | None = Field(default=None,min_length=1,max_length=80)
    email: str | None = Field(default=None,min_length=3,max_length=180,pattern=r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
    organization: str | None = Field(default=None,min_length=1,max_length=160)
    identities: list[str] | None = Field(default=None,min_length=1,max_length=10)
    city: str | None = Field(default=None,min_length=1,max_length=80)
    bio: str | None = Field(default=None,max_length=200)

    @field_validator('identities')
    @classmethod
    def valid_identities(cls,value):
        if value is not None and (len(value)!=len(set(value)) or any(not 1<=len(v.strip())<=80 for v in value)):
            raise ValueError('身份标签必须非空、不重复且不超过80字')
        return value


class ProfileUpdateRequest(SessionRequest):
    expected_version: int = Field(ge=1,le=9007199254740990,strict=True)
    idempotency_key: str = Field(min_length=1,max_length=128,pattern=r'^[A-Za-z0-9_.:-]+$')
    changes: ProfileChanges
    context_hash: str = Field(default='',max_length=64,pattern=r'^(?:[a-f0-9]{64})?$')


class CreateClient(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    origin: str = Field(min_length=1, max_length=2048)


class Enabled(BaseModel):
    enabled: bool


@router.post('/sso/authorize')
async def authorize(req: AuthorizeRequest, user=Depends(get_current_user)):
    if user.get('auth_type') != 'jwt':
        raise HTTPException(403, '请使用用户账号登录')
    return await run_in_threadpool(service.authorize, int(user['sub']), req.client_id, req.redirect_uri, req.code_challenge)


@router.post('/sso/token')
async def exchange(req: ExchangeRequest):
    return await run_in_threadpool(service.exchange, req.client_id, req.client_secret, req.code, req.redirect_uri, req.code_verifier)


@router.post('/sso/session/check')
async def check(req: SessionRequest):
    return await run_in_threadpool(service.validate_session, req.client_id, req.client_secret, req.session_token)


@router.post('/sso/session/revoke')
async def revoke(req: SessionRequest):
    return await run_in_threadpool(service.revoke_session, req.client_id, req.client_secret, req.session_token)


@router.post('/sso/profile/update')
async def update_profile(req: ProfileUpdateRequest):
    changes=req.changes.model_dump(exclude_unset=True)
    if any(value is None for value in changes.values()):
        raise HTTPException(422,'请提交具体字段值')
    return await run_in_threadpool(service.update_profile,req.client_id,req.client_secret,req.session_token,
                                  req.expected_version,req.idempotency_key,changes,req.context_hash)


@admin_router.get('/clients')
async def clients():
    return {'clients': await run_in_threadpool(service.list_clients)}


@admin_router.post('/clients', status_code=201)
async def create(req: CreateClient):
    return await run_in_threadpool(service.create_client, req.name, req.origin)


@admin_router.patch('/clients/{client_id}')
async def update(client_id: str, req: Enabled):
    return await run_in_threadpool(service.update_client, client_id, req.enabled)


@admin_router.post('/clients/{client_id}/rotate')
async def rotate(client_id: str):
    return await run_in_threadpool(service.rotate_client, client_id)


@admin_router.post('/users/{user_id}/revoke')
async def revoke_user(user_id: int):
    return await run_in_threadpool(service.user_policy, user_id)


@admin_router.patch('/users/{user_id}')
async def update_user(user_id: int, req: Enabled):
    return await run_in_threadpool(service.user_policy, user_id, req.enabled)


@admin_router.get('/users')
async def users(q: str = Query(min_length=1, max_length=100)):
    return {'users': await run_in_threadpool(service.search_users, q)}
