"""Small profile API sharing the existing central authentication PostgreSQL database."""
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from sqlalchemy import text, inspect
from app.storage.database.postgres_client import get_db_session
from app.services import profile_hub_service
from app.api.profile_hub import router
from app.api.community_profile_hub import router as community_router

@asynccontextmanager
async def lifespan(app):
    if os.environ.get('PROFILE_HUB_ENVIRONMENT') != 'production':
        raise RuntimeError('Explicit production profile environment required')
    with get_db_session() as db:
        columns={c['name'] for c in inspect(db.bind).get_columns('user_profiles')}
        if not set(profile_hub_service.PROFILE_FIELDS).issubset(columns):
            raise RuntimeError('Existing central authentication profile schema required')
        db.execute(text('SELECT pg_advisory_xact_lock(70191019)'))
        profile_hub_service.apply_schema(db)
    yield

app=FastAPI(lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)
app.include_router(router,prefix='/api/v1')
app.include_router(community_router,prefix='/api/v1')

@app.get('/healthz')
def health():
    with get_db_session() as db:db.execute(text('SELECT 1'))
    return {'status':'ok','environment':'production','revision':os.environ.get('PROFILE_HUB_REVISION')}
