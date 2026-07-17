"""Single-writer Zvec sidecar for TopicLink deployments."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.api import topiclink

logger = logging.getLogger(__name__)


class CacheFetchRequest(BaseModel):
    model: str
    inputs: list[str]


class CacheUpsertRequest(CacheFetchRequest):
    vectors: list[list[float]]


class CachePruneRequest(BaseModel):
    force: bool = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    topiclink._ensure_zvec_collection()
    topiclink.start_topiclink_metadata_worker()
    yield
    await topiclink.stop_topiclink_metadata_worker()


app = FastAPI(title="TopicLink Zvec", version="0.1.0", lifespan=lifespan)


@app.get("/health/ready")
def ready_health():
    try:
        topiclink.probe_topiclink_storage(None)
    except Exception as exc:
        logger.warning("TopicLink Zvec sidecar readiness failed: %s", exc)
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "service": "topiclink-zvec", "zvec": "error"},
        )
    return {"status": "ready", "service": "topiclink-zvec", "zvec": "ok"}


@app.post("/cache/fetch")
def fetch_cache(request: CacheFetchRequest):
    return {"vectors": topiclink._read_zvec_cache(request.model, request.inputs)}


@app.post("/cache/upsert")
def upsert_cache(request: CacheUpsertRequest):
    if len(request.inputs) != len(request.vectors):
        raise HTTPException(status_code=422, detail="inputs and vectors must have equal length")
    if not topiclink._write_zvec_cache(request.model, request.inputs, request.vectors):
        raise HTTPException(status_code=503, detail="Zvec write failed")
    return {"written": len(request.inputs)}


@app.post("/cache/prune")
def prune_cache(request: CachePruneRequest):
    return {"deleted": topiclink._prune_zvec_cache(force=request.force)}
