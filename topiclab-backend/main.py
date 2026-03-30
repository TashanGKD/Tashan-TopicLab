"""Website backend - account/auth service. Separate from Resonnet."""

import logging
import os
import sys
import traceback
from contextlib import asynccontextmanager
from pathlib import Path

# Load .env from project root or topiclab-backend/
_env_root = Path(__file__).resolve().parent.parent / ".env"
_env_local = Path(__file__).resolve().parent / ".env"
_is_test_process = os.getenv("TOPICLAB_TESTING") == "1" or bool(os.getenv("PYTEST_CURRENT_TEST")) or "pytest" in " ".join(sys.argv).lower()
_dotenv_override = not _is_test_process
if _env_root.exists():
    from dotenv import load_dotenv
    load_dotenv(_env_root, override=_dotenv_override)
elif _env_local.exists():
    from dotenv import load_dotenv
    load_dotenv(_env_local, override=_dotenv_override)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import aminer as aminer_router
from app.api import apps as apps_router
from app.api import admin as admin_router
from app.api import auth as auth_router
from app.api import feedback as feedback_router
from app.api import literature as literature_router
from app.api import openclaw as openclaw_router
from app.api import openclaw_plugin as openclaw_plugin_router
from app.api import openclaw_routes as openclaw_dedicated_router
from app.api import openclaw_twin_runtime as openclaw_twin_runtime_router
from app.api import skill_hub as skill_hub_router
from app.api import skills as skills_router
from app.api import source_feed as source_feed_router
from app.api import topics as topics_router
from app.services.http_client import close_shared_async_clients
from app.storage.database.topic_store import init_topic_tables

@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.getenv("DATABASE_URL"):
        try:
            from app.storage.database.postgres_client import init_auth_tables, ensure_site_feedback_schema
            init_auth_tables()
            init_topic_tables()
            try:
                ensure_site_feedback_schema()
            except Exception as e2:
                logging.getLogger(__name__).warning("site_feedback schema ensure failed (will retry on first feedback): %s", e2)
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
app.include_router(apps_router.router, prefix="/api/v1", tags=["apps-v1"])
app.include_router(source_feed_router.router, prefix="/source-feed", tags=["source-feed"])
app.include_router(source_feed_router.router, prefix="/api/v1/source-feed", tags=["source-feed-v1"])
app.include_router(literature_router.router, prefix="/literature", tags=["literature"])
app.include_router(literature_router.router, prefix="/api/v1/literature", tags=["literature-v1"])
app.include_router(aminer_router.router, prefix="/aminer", tags=["aminer"])
app.include_router(aminer_router.router, prefix="/api/v1/aminer", tags=["aminer-v1"])
app.include_router(topics_router.router, tags=["topics"])
app.include_router(topics_router.router, prefix="/api/v1", tags=["topics-v1"])
app.include_router(skills_router.router, tags=["skills"])
app.include_router(skills_router.router, prefix="/api/v1", tags=["skills-v1"])
app.include_router(skill_hub_router.router, prefix="/api/v1", tags=["skill-hub-v1"])
app.include_router(openclaw_router.router, prefix="/api/v1", tags=["openclaw"])
app.include_router(openclaw_plugin_router.router, prefix="/api/v1", tags=["openclaw-plugin"])
app.include_router(openclaw_dedicated_router.router, prefix="/api/v1", tags=["openclaw-dedicated"])
app.include_router(openclaw_twin_runtime_router.router, prefix="/api/v1", tags=["openclaw-twins"])
app.include_router(feedback_router.router, prefix="/api/v1", tags=["feedback-v1"])
app.include_router(admin_router.router, tags=["admin"])


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Return JSON on 500 so API clients (and reverse proxies) never get plain-text Internal Server Error."""
    log = logging.getLogger(__name__)
    log.error("Unhandled error on %s %s: %s", request.method, request.url.path, exc)
    log.debug(traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={"detail": "服务暂时不可用，请稍后重试。若问题持续，请联系管理员。"},
    )


@app.get("/health")
def health():
    return {"status": "ok", "service": "topiclab-backend"}
