"""Authorized profile import: consent, preview, confirm-and-save, and audit trail."""
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.api.auth import get_current_user
from app.services import profile_import_service as service


class ImportRoute(APIRoute):
    """Never cache or echo rejected personal data."""

    def get_route_handler(self):
        original = super().get_route_handler()

        async def handle(request):
            headers = {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'}
            try:
                response = await original(request)
                response.headers.update(headers)
                return response
            except RequestValidationError as exc:
                detail = [{k: item[k] for k in ('loc', 'msg', 'type') if k in item} for item in exc.errors()]
                return JSONResponse(status_code=422, content={'detail': detail}, headers=headers)
            except HTTPException as exc:
                exc.headers = {**(exc.headers or {}), **headers}
                raise

        return handle


def no_store(response: Response):
    response.headers['Cache-Control'] = 'no-store'
    response.headers['Referrer-Policy'] = 'no-referrer'


router = APIRouter(prefix='/profile-import', route_class=ImportRoute, dependencies=[Depends(no_store)])


class AuthorizeRequest(BaseModel):
    source: str = Field(min_length=1, max_length=32)


class PreviewRequest(BaseModel):
    authorization_id: str = Field(min_length=32, max_length=32)


class CommitRequest(BaseModel):
    preview_id: str = Field(min_length=32, max_length=32)
    preview_token: str = Field(min_length=32, max_length=128)
    expected_version: int = Field(ge=1, le=9007199254740990)
    idempotency_key: str = Field(min_length=8, max_length=128)
    selections: dict[str, str]
    origin: dict[str, str] = Field(default_factory=dict)


def _user_id(user: dict) -> int:
    if user.get('auth_type') != 'jwt':
        raise HTTPException(403, '请使用用户账号登录')
    try:
        return int(user['sub'])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(401, '登录已失效，请重新登录')


@router.get('/sources')
async def sources(user=Depends(get_current_user)):
    _user_id(user)
    return await run_in_threadpool(service.list_sources)


@router.get('/profile')
async def profile(user=Depends(get_current_user)):
    return await run_in_threadpool(service.current_profile, _user_id(user))


@router.post('/authorizations', status_code=201)
async def authorize(req: AuthorizeRequest, user=Depends(get_current_user)):
    return await run_in_threadpool(service.create_authorization, _user_id(user), req.source)


@router.post('/authorizations/{authorization_id}/cancel')
async def cancel(authorization_id: str, user=Depends(get_current_user)):
    return await run_in_threadpool(service.cancel_authorization, _user_id(user), authorization_id)


@router.post('/previews')
async def preview(req: PreviewRequest, user=Depends(get_current_user)):
    return await run_in_threadpool(service.create_preview, _user_id(user), req.authorization_id)


@router.post('/commits')
async def commit(req: CommitRequest, user=Depends(get_current_user)):
    return await run_in_threadpool(service.commit_import, _user_id(user), req.model_dump())


@router.get('/history')
async def history(limit: int = Query(default=20, ge=1, le=50), user=Depends(get_current_user)):
    return await run_in_threadpool(service.history, _user_id(user), limit)
