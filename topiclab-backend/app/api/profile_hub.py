"""Server-to-server profile hub API used by the activity sites.

There is deliberately no public phone search: every call must be signed with the
calling site's secret, and the phone number comes from that site's own session.
"""
import json
import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from starlette.concurrency import run_in_threadpool

from app.services import profile_hub_service as service

CLIENTS = {'panshi-forum', 'panshi-camp'}
RATE_LIMIT = 120
RATE_WINDOW = 60
_buckets: dict[tuple[str, str], tuple[int, int]] = {}


class HubRoute(APIRoute):
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


router = APIRouter(prefix='/profile-hub', route_class=HubRoute, dependencies=[Depends(no_store)])


def _rate_limit(client: str, request: Request):
    ip = (request.client.host if request.client else 'unknown') or 'unknown'
    key = (client, ip)
    now = int(time.time())
    count, reset = _buckets.get(key, (0, now + RATE_WINDOW))
    if reset <= now:
        count, reset = 0, now + RATE_WINDOW
    count += 1
    if len(_buckets) > 5000:
        _buckets.clear()
    _buckets[key] = (count, reset)
    if count > RATE_LIMIT:
        raise HTTPException(429, '请求过于频繁，请稍后重试')


async def signed_body(request: Request, client: str) -> dict:
    raw = (await request.body()).decode('utf-8', 'replace')
    if not raw or not service.verify_request(client, raw, {k.lower(): v for k, v in request.headers.items()}):
        raise HTTPException(401, '请求未授权')
    try:
        payload = json.loads(raw)
    except ValueError:
        raise HTTPException(422, '请求内容格式错误')
    if not isinstance(payload, dict):
        raise HTTPException(422, '请求内容格式错误')
    return payload


def _client(request: Request) -> str:
    client = request.headers.get('x-tashan-client', '')
    if client not in CLIENTS:
        raise HTTPException(401, '请求未授权')
    _rate_limit(client, request)
    return client


@router.post('/lookup')
async def lookup(request: Request):
    client = _client(request)
    payload = await signed_body(request, client)
    return await run_in_threadpool(service.lookup_by_phone, payload.get('phone'), client)


@router.post('/confirm')
async def confirm(request: Request):
    client = _client(request)
    payload = await signed_body(request, client)
    return await run_in_threadpool(service.confirm_by_phone, payload.get('phone'), client, payload)


@router.post('/sync')
async def sync(request: Request):
    client = _client(request)
    payload = await signed_body(request, client)
    return await run_in_threadpool(service.sync_by_identity, payload.get('phone'), client, payload)
