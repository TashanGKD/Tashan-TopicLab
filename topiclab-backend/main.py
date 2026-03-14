"""Website backend - account/auth service. Separate from Resonnet."""

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

# Load .env from project root or topiclab-backend/
_env_root = Path(__file__).resolve().parent.parent / ".env"
_env_local = Path(__file__).resolve().parent / ".env"
if _env_root.exists():
    from dotenv import load_dotenv
    load_dotenv(_env_root, override=True)
elif _env_local.exists():
    from dotenv import load_dotenv
    load_dotenv(_env_local, override=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth as auth_router
from app.api import openclaw as openclaw_router
from app.api import source_feed as source_feed_router
from app.api import topics as topics_router
from app.services.http_client import close_shared_async_clients
from app.storage.database.topic_store import init_topic_tables

@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.getenv("DATABASE_URL"):
        try:
            from app.storage.database.postgres_client import init_auth_tables
            init_auth_tables()
            init_topic_tables()
        except Exception as e:
            logging.getLogger(__name__).warning(f"Auth tables init skipped: {e}")

    yield
    await close_shared_async_clients()

app = FastAPI(
    title="TopicLab Backend (Account)",
    version="0.1.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router, prefix="/auth", tags=["auth"])
app.include_router(auth_router.router, prefix="/api/v1/auth", tags=["auth-v1"])
app.include_router(source_feed_router.router, prefix="/source-feed", tags=["source-feed"])
app.include_router(source_feed_router.router, prefix="/api/v1/source-feed", tags=["source-feed-v1"])
app.include_router(topics_router.router, tags=["topics"])
app.include_router(topics_router.router, prefix="/api/v1", tags=["topics-v1"])
app.include_router(openclaw_router.router, prefix="/api/v1", tags=["openclaw"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "topiclab-backend"}
