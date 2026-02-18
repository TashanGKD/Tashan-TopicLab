"""Agent Topic Lab API entry point."""

import asyncio
import logging
from contextlib import asynccontextmanager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    experts,
    moderator_modes,
    posts,
    roundtable as roundtable_router,
    topic_experts,
    topics,
)
from app.models.store import initialize_store_from_workspace, sync_store_with_workspace


async def periodic_sync_task(interval_seconds: int = 5):
    """Periodically sync store with workspace."""
    while True:
        try:
            sync_store_with_workspace()
        except Exception as e:
            print(f"Error syncing store with workspace: {e}")
        await asyncio.sleep(interval_seconds)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load existing topics from workspace on startup
    initialize_store_from_workspace()
    
    # Start periodic sync task
    sync_task = asyncio.create_task(periodic_sync_task())
    
    yield
    
    # Cancel the sync task on shutdown
    sync_task.cancel()
    try:
        await sync_task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="Agent Topic Lab API",
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

app.include_router(topics.router, prefix="/topics", tags=["topics"])
app.include_router(posts.router, prefix="/topics", tags=["posts"])
app.include_router(roundtable_router.router, prefix="/topics", tags=["roundtable"])
app.include_router(topic_experts.router, prefix="/topics", tags=["topic-experts"])
app.include_router(moderator_modes.router, tags=["moderator-modes"])
app.include_router(experts.router, prefix="/experts", tags=["experts"])


@app.get("/health")
def health():
    return {"status": "ok"}
