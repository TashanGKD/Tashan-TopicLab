"""Public site-level assets."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.storage.database.site_assets_store import WECHAT_GROUP_QR_KEY, get_site_image_asset


router = APIRouter(prefix="/site", tags=["site"])


@router.get("/wechat-group-qr.webp")
def get_wechat_group_qr():
    asset = get_site_image_asset(WECHAT_GROUP_QR_KEY)
    if asset is None:
        raise HTTPException(status_code=404, detail="WeChat group QR not found")
    payload, mime_type = asset
    return Response(
        content=payload,
        media_type=mime_type,
        headers={"Cache-Control": "public, max-age=60"},
    )


@router.head("/wechat-group-qr.webp")
def head_wechat_group_qr():
    asset = get_site_image_asset(WECHAT_GROUP_QR_KEY)
    if asset is None:
        raise HTTPException(status_code=404, detail="WeChat group QR not found")
    _, mime_type = asset
    return Response(
        content=b"",
        media_type=mime_type,
        headers={"Cache-Control": "public, max-age=60"},
    )
