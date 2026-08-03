"""Public site-level assets."""

from __future__ import annotations

import re
from io import BytesIO

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image, ImageOps

from app.api.auth import get_current_user
from app.storage.database.site_assets_store import (
    WEBP_MIME_TYPE,
    WECHAT_GROUP_QR_KEY,
    create_site_qr_group,
    get_site_image_asset,
    get_site_image_asset_metadata,
    get_site_qr_group,
    list_site_qr_groups,
    upsert_site_image_asset,
    update_site_qr_group,
)


router = APIRouter(prefix="/site", tags=["site"])
_SITE_ASSET_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,127}$")
_QR_GROUP_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
_MAX_UPLOAD_BYTES = 8 * 1024 * 1024
_MAX_QR_TITLE_LENGTH = 120


def _require_site_admin(user: dict = Depends(get_current_user)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user


def _validate_site_asset_key(key: str) -> str:
    normalized = key.strip()
    if not _SITE_ASSET_KEY_RE.fullmatch(normalized):
        raise HTTPException(status_code=400, detail="Invalid site asset key")
    return normalized


def _validate_qr_group_path(path: str) -> str:
    normalized = path.strip().strip("/")
    if normalized.startswith("qr/"):
        normalized = normalized[3:]
    if not _QR_GROUP_SLUG_RE.fullmatch(normalized):
        raise HTTPException(
            status_code=400,
            detail="Invalid QR path; use 1-64 lowercase letters, numbers, or hyphens",
        )
    return normalized


def _validate_qr_group_title(title: str) -> str:
    normalized = title.strip()
    if not normalized or len(normalized) > _MAX_QR_TITLE_LENGTH:
        raise HTTPException(status_code=400, detail="QR title must be 1-120 characters")
    return normalized


def _legacy_urls_for_key(key: str) -> list[str]:
    if key == WECHAT_GROUP_QR_KEY:
        return ["/api/v1/site/wechat-group-qr.webp"]
    return []


def _site_asset_url(key: str) -> str:
    return f"/api/v1/site/assets/{key}.webp"


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


def _site_asset_metadata_response(key: str) -> dict[str, object]:
    normalized = _validate_site_asset_key(key)
    metadata = get_site_image_asset_metadata(normalized)
    if metadata is None:
        raise HTTPException(status_code=404, detail="Site asset not found")
    return {
        **metadata,
        "url": _site_asset_url(normalized),
        "legacy_urls": _legacy_urls_for_key(normalized),
    }


def _qr_group_response(group: dict[str, str | None]) -> dict[str, object]:
    slug = str(group["slug"])
    asset_key = str(group["asset_key"])
    return {
        "slug": slug,
        "path": f"/qr/{slug}",
        "title": group["title"],
        "key": asset_key,
        "url": _site_asset_url(asset_key),
        "created_at": group["created_at"],
        "updated_at": group["asset_updated_at"] or group["updated_at"],
        "config_updated_at": group["updated_at"],
    }


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


@router.get("/assets/{key}")
def get_site_asset_metadata_by_key(key: str):
    return _site_asset_metadata_response(key)


@router.post("/assets/{key}")
async def upload_site_asset_by_key(
    key: str,
    image: UploadFile = File(...),
    expires_at: str | None = Form(default=None),
    _: dict = Depends(_require_site_admin),
):
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
    metadata = _site_asset_metadata_response(normalized)
    return {
        "ok": True,
        **metadata,
        "width": width,
        "height": height,
        "webp_bytes": len(image_webp),
    }


@router.get("/qr-groups")
def get_site_qr_groups():
    return {"items": [_qr_group_response(group) for group in list_site_qr_groups()]}


@router.get("/qr-groups/admin")
def get_site_qr_groups_for_admin(_: dict = Depends(_require_site_admin)):
    return {"items": [_qr_group_response(group) for group in list_site_qr_groups()]}


@router.get("/qr-groups/{slug}")
def get_site_qr_group_by_slug(slug: str):
    normalized = _validate_qr_group_path(slug)
    group = get_site_qr_group(normalized)
    if group is None:
        raise HTTPException(status_code=404, detail="QR group not found")
    return _qr_group_response(group)


@router.post("/qr-groups")
async def create_site_qr_group_entry(
    path: str = Form(default=""),
    title: str = Form(default=""),
    image: UploadFile = File(...),
    expires_at: str | None = Form(default=None),
    _: dict = Depends(_require_site_admin),
):
    slug = _validate_qr_group_path(path)
    normalized_title = _validate_qr_group_title(title)
    image_webp, width, height = _convert_upload_to_webp(await image.read())
    created = create_site_qr_group(
        slug=slug,
        title=normalized_title,
        image_webp=image_webp,
        source_filename=image.filename,
        expires_at=expires_at,
    )
    if not created:
        raise HTTPException(status_code=409, detail="QR path already exists")
    group = get_site_qr_group(slug)
    if group is None:
        raise HTTPException(status_code=500, detail="Created QR group could not be loaded")
    return {
        "ok": True,
        **_qr_group_response(group),
        "width": width,
        "height": height,
        "webp_bytes": len(image_webp),
    }


@router.put("/qr-groups/{slug}")
async def update_site_qr_group_entry(
    slug: str,
    path: str = Form(default=""),
    title: str = Form(default=""),
    image: UploadFile | None = File(default=None),
    expires_at: str | None = Form(default=None),
    _: dict = Depends(_require_site_admin),
):
    current_slug = _validate_qr_group_path(slug)
    new_slug = _validate_qr_group_path(path)
    normalized_title = _validate_qr_group_title(title)
    image_webp: bytes | None = None
    width: int | None = None
    height: int | None = None
    if image is not None:
        image_webp, width, height = _convert_upload_to_webp(await image.read())
    result = update_site_qr_group(
        slug=current_slug,
        new_slug=new_slug,
        title=normalized_title,
        image_webp=image_webp,
        source_filename=image.filename if image else None,
        expires_at=expires_at,
    )
    if result == "not_found":
        raise HTTPException(status_code=404, detail="QR group not found")
    if result == "conflict":
        raise HTTPException(status_code=409, detail="QR path already exists")
    group = get_site_qr_group(new_slug)
    if group is None:
        raise HTTPException(status_code=500, detail="Updated QR group could not be loaded")
    return {
        "ok": True,
        **_qr_group_response(group),
        "width": width,
        "height": height,
        "webp_bytes": len(image_webp) if image_webp is not None else None,
    }
