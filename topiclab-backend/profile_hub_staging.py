"""Isolated acceptance entrypoint; never starts or migrates the production app."""
import os
from contextlib import asynccontextmanager
from urllib.parse import urlparse
from fastapi import FastAPI
from sqlalchemy import text
from app.storage.database.postgres_client import get_db_session
from app.services import profile_hub_service, sso_service
from app.api.profile_hub import router


@asynccontextmanager
async def lifespan(app):
    url = urlparse(os.environ.get('DATABASE_URL', ''))
    if os.environ.get('PROFILE_HUB_ENVIRONMENT') != 'staging' or url.path != '/tashan_profile_hub_staging':
        raise RuntimeError('Only the isolated profile staging database is allowed')
    with get_db_session() as db:
        db.execute(text('SELECT pg_advisory_xact_lock(70191019)'))
        db.execute(text('''CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY, phone VARCHAR(20) NOT NULL UNIQUE,
          username VARCHAR(80), is_guest BOOLEAN NOT NULL DEFAULT false)'''))
        sso_service.apply_schema(db)
        profile_hub_service.apply_schema(db)
    yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(router, prefix='/api/v1')


@app.get('/healthz')
def health():
    with get_db_session() as db:
        db.execute(text('SELECT 1'))
    return {'status': 'ok', 'environment': 'staging', 'revision': os.environ.get('PROFILE_HUB_REVISION')}
