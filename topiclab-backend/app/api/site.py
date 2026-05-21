"""Public site-level assets."""

from __future__ import annotations

import re
import os
import secrets
from io import BytesIO

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from PIL import Image, ImageOps

from app.storage.database.site_assets_store import (
    LGGC_WECHAT_GROUP_QR_KEY,
    WEBP_MIME_TYPE,
    WECHAT_GROUP_QR_KEY,
    get_site_image_asset,
    upsert_site_image_asset,
)


router = APIRouter(prefix="/site", tags=["site"])
_SITE_ASSET_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,127}$")
_MAX_UPLOAD_BYTES = 8 * 1024 * 1024


def _validate_site_asset_key(key: str) -> str:
    normalized = key.strip()
    if not _SITE_ASSET_KEY_RE.fullmatch(normalized):
        raise HTTPException(status_code=400, detail="Invalid site asset key")
    return normalized


def _legacy_urls_for_key(key: str) -> list[str]:
    if key == WECHAT_GROUP_QR_KEY:
        return ["/api/v1/site/wechat-group-qr.webp"]
    return []


def _site_asset_url(key: str) -> str:
    return f"/api/v1/site/assets/{key}.webp"


def _get_site_asset_upload_key() -> str:
    configured = (os.getenv("SITE_ASSET_UPLOAD_KEY") or "").strip()
    if not configured:
        raise HTTPException(status_code=503, detail="Site asset upload key is not configured")
    return configured


def _require_site_asset_upload_key(upload_key: str | None) -> None:
    configured = _get_site_asset_upload_key()
    candidate = (upload_key or "").strip()
    if not candidate or not secrets.compare_digest(candidate, configured):
        raise HTTPException(status_code=401, detail="Invalid site asset upload key")


def _serve_site_image_asset(key: str, *, include_body: bool) -> Response:
    normalized = _validate_site_asset_key(key)
    asset = get_site_image_asset(normalized)
    if asset is None:
        raise HTTPException(status_code=404, detail="Site asset not found")
    payload, mime_type = asset
    return Response(
        content=payload if include_body else b"",
        media_type=mime_type,
        headers={"Cache-Control": "public, max-age=60"},
    )


def _convert_upload_to_webp(payload: bytes) -> tuple[bytes, int, int]:
    if not payload:
        raise HTTPException(status_code=400, detail="Image file is required")
    if len(payload) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image file is too large")

    try:
        with Image.open(BytesIO(payload)) as image:
            normalized = ImageOps.exif_transpose(image)
            if normalized.mode not in {"RGB", "RGBA"}:
                normalized = normalized.convert("RGBA" if "A" in normalized.getbands() else "RGB")
            width, height = normalized.size
            output = BytesIO()
            normalized.save(output, format="WEBP", quality=88, method=6)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid image file") from exc

    return output.getvalue(), width, height


@router.get("/wechat-group-qr.webp")
def get_wechat_group_qr():
    return _serve_site_image_asset(WECHAT_GROUP_QR_KEY, include_body=True)


@router.head("/wechat-group-qr.webp")
def head_wechat_group_qr():
    return _serve_site_image_asset(WECHAT_GROUP_QR_KEY, include_body=False)


@router.get("/assets/{key}.webp")
def get_site_asset_by_key(key: str):
    return _serve_site_image_asset(key, include_body=True)


@router.head("/assets/{key}.webp")
def head_site_asset_by_key(key: str):
    return _serve_site_image_asset(key, include_body=False)


@router.post("/assets/{key}")
async def upload_site_asset_by_key(
    key: str,
    image: UploadFile = File(...),
    expires_at: str | None = Form(default=None),
    upload_key: str | None = Query(default=None, alias="key"),
):
    _require_site_asset_upload_key(upload_key)
    normalized = _validate_site_asset_key(key)
    payload = await image.read()
    image_webp, width, height = _convert_upload_to_webp(payload)
    upsert_site_image_asset(
        key=normalized,
        image_webp=image_webp,
        mime_type=WEBP_MIME_TYPE,
        expires_at=expires_at,
        source_filename=image.filename,
    )
    return {
        "ok": True,
        "key": normalized,
        "mime_type": WEBP_MIME_TYPE,
        "width": width,
        "height": height,
        "webp_bytes": len(image_webp),
        "expires_at": expires_at,
        "source_filename": image.filename,
        "url": _site_asset_url(normalized),
        "legacy_urls": _legacy_urls_for_key(normalized),
    }


@router.get("/qr-groups")
def list_site_qr_groups():
    return {
        "items": [
            {
                "slug": "world-wechat-group",
                "key": WECHAT_GROUP_QR_KEY,
                "url": _site_asset_url(WECHAT_GROUP_QR_KEY),
            },
            {
                "slug": "lggc-wechat-group",
                "key": LGGC_WECHAT_GROUP_QR_KEY,
                "url": _site_asset_url(LGGC_WECHAT_GROUP_QR_KEY),
            },
        ],
    }
