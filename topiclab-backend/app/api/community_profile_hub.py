"""Community bridge: reuse registered SSO credentials and verified session identity."""
from fastapi import APIRouter, HTTPException
from starlette.concurrency import run_in_threadpool
from app.api.sso import SessionRequest, ProfileUpdateRequest
from app.api.profile_hub import HubRoute, no_store
from fastapi import Depends
from app.services import sso_service, profile_hub_service
from app.storage.database.postgres_client import get_db_session

router = APIRouter(prefix='/profile-hub/community', route_class=HubRoute, dependencies=[Depends(no_store)])


def identity(req):
    with get_db_session() as db:
        client = sso_service._client(db, req.client_id, req.client_secret)
        if client['origin'] != 'https://community.tashan.ac.cn':
            raise HTTPException(403, '网站未获授权')
        user, _ = sso_service._session_user(db, req.client_id, req.client_secret, req.session_token)
        return dict(user)


def sync(req):
    user = identity(req)
    if profile_hub_service.normalize_phone(user.get('phone')):
        profile_hub_service.sync_by_identity(user['phone'], 'tashan-community', {'subject': 'topiclab:'+str(user['id'])})
    return sso_service.validate_session(req.client_id, req.client_secret, req.session_token)


def update(req):
    identity(req)
    changes = req.changes.model_dump(exclude_unset=True)
    if any(value is None for value in changes.values()):
        raise HTTPException(422, '请提交具体字段值')
    changes = {k:v for k,v in changes.items() if k not in profile_hub_service.PROFILE_FIELDS or v.strip()}
    return sso_service.update_profile(req.client_id, req.client_secret, req.session_token,
        req.expected_version, req.idempotency_key, changes, req.context_hash, profile_source='tashan-community')


@router.post('/session/check')
async def check(req: SessionRequest):
    return await run_in_threadpool(sync, req)


@router.post('/profile/update')
async def save(req: ProfileUpdateRequest):
    return await run_in_threadpool(update, req)
