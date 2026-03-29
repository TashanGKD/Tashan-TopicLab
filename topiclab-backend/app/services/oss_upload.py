"""OSS upload helpers for OpenClaw comment media."""

from __future__ import annotations

import mimetypes
import os
import uuid
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from urllib.parse import quote

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError

DEFAULT_ALLOWED_IMAGE_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
}
DEFAULT_ALLOWED_VIDEO_TYPES = {
    "video/mp4",
    "video/webm",
    "video/quicktime",
}
DEFAULT_MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024
DEFAULT_MAX_VIDEO_UPLOAD_BYTES = 80 * 1024 * 1024
VIDEO_EXTENSION_BY_TYPE = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
}
GENERIC_BINARY_CONTENT_TYPES = {
    "application/octet-stream",
}


def _required_env(name: str) -> str:
    value = (os.getenv(name) or "").strip()
    if not value:
        raise RuntimeError(f"Missing required OSS env: {name}")
    return value


def _parse_csv_env(name: str, defaults: set[str]) -> set[str]:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return set(defaults)
    return {item.strip().lower() for item in raw.split(",") if item.strip()}


def _parse_int_env(name: str, default: int) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return max(1, int(raw))
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc


def _normalize_endpoint(value: str) -> str:
    return value.removeprefix("https://").removeprefix("http://").rstrip("/")


def _normalize_prefix(value: str) -> str:
    return value.strip().strip("/")


def _build_object_key(topic_id: str, *, media_dir: str, suffix: str) -> str:
    prefix = _normalize_prefix(os.getenv("OSS_UPLOAD_PREFIX", "openclaw-comments"))
    now = datetime.now(UTC)
    filename = f"{uuid.uuid4().hex}{suffix}"
    return f"{prefix}/{topic_id}/{media_dir}/{now:%Y/%m/%d}/{filename}"


def _content_disposition_filename(suffix: str) -> str:
    return f"{uuid.uuid4().hex}{suffix}"


def build_openclaw_media_app_url(object_key: str) -> str:
    return f"/api/v1/openclaw/media/{quote(object_key, safe='/')}"


def _convert_image_to_webp(payload: bytes) -> tuple[bytes, int, int]:
    try:
        with Image.open(BytesIO(payload)) as image:
            normalized = ImageOps.exif_transpose(image)
            if normalized.mode not in {"RGB", "RGBA"}:
                normalized = normalized.convert("RGBA" if "A" in normalized.getbands() else "RGB")
            width, height = normalized.size
            output = BytesIO()
            normalized.save(output, format="WEBP", quality=86, method=6)
            return output.getvalue(), width, height
    except UnidentifiedImageError as exc:
        raise HTTPException(status_code=400, detail="Unsupported image file") from exc


def _normalize_content_type(*, filename: str, content_type: str | None) -> str:
    normalized_content_type = (content_type or "").split(";")[0].strip().lower()
    if normalized_content_type and normalized_content_type not in GENERIC_BINARY_CONTENT_TYPES:
        return normalized_content_type
    guessed, _ = mimetypes.guess_type(filename)
    return (guessed or normalized_content_type or "").lower()


def _build_bucket():
    access_key_id = _required_env("OSS_ACCESS_KEY_ID")
    access_key_secret = _required_env("OSS_ACCESS_KEY_SECRET")
    bucket_name = _required_env("OSS_BUCKET")
    endpoint = _normalize_endpoint(_required_env("OSS_ENDPOINT"))

    try:
        import oss2
    except ImportError as exc:
        raise RuntimeError("oss2 is not installed; run dependency install for topiclab-backend") from exc

    auth = oss2.Auth(access_key_id, access_key_secret)
    return oss2.Bucket(auth, endpoint, bucket_name)


def _upload_bytes_to_oss(*, object_key: str, content_type: str, payload: bytes, suffix: str) -> str:
    bucket = _build_bucket()
    headers = {
        "Content-Type": content_type,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Disposition": f'inline; filename="{_content_disposition_filename(suffix)}"',
    }
    result = bucket.put_object(object_key, payload, headers=headers)
    if getattr(result, "status", None) and int(result.status) >= 300:
        raise RuntimeError(f"OSS upload failed with status {result.status}")
    return build_openclaw_media_app_url(object_key)


def get_signed_media_url(object_key: str) -> str:
    bucket = _build_bucket()
    expires = _parse_int_env("OSS_SIGN_EXPIRE_SECONDS", 300)
    signed_url = bucket.sign_url("GET", object_key, expires)
    public_base_url = (os.getenv("OSS_PUBLIC_BASE_URL") or "").strip()
    if public_base_url.startswith("https://") and signed_url.startswith("http://"):
        return "https://" + signed_url[len("http://"):]
    return signed_url


def upload_comment_media_to_oss(
    *,
    topic_id: str,
    filename: str,
    content_type: str | None,
    payload: bytes,
) -> dict:
    if not payload:
        raise HTTPException(status_code=400, detail="Empty file")

    allowed_image_types = _parse_csv_env("OSS_ALLOWED_IMAGE_MIME_TYPES", DEFAULT_ALLOWED_IMAGE_TYPES)
    allowed_video_types = _parse_csv_env("OSS_ALLOWED_VIDEO_MIME_TYPES", DEFAULT_ALLOWED_VIDEO_TYPES)
    detected_type = _normalize_content_type(filename=filename, content_type=content_type)

    if detected_type in allowed_image_types:
        max_bytes = _parse_int_env("OSS_MAX_UPLOAD_BYTES", DEFAULT_MAX_IMAGE_UPLOAD_BYTES)
        if len(payload) > max_bytes:
            raise HTTPException(status_code=413, detail="Image file is too large")
        media_bytes, width, height = _convert_image_to_webp(payload)
        object_key = _build_object_key(topic_id, media_dir="images", suffix=".webp")
        url = _upload_bytes_to_oss(
            object_key=object_key,
            content_type="image/webp",
            payload=media_bytes,
            suffix=".webp",
        )
        alt = Path(filename).stem.strip() or "image"
        return {
            "url": url,
            "markdown": f"![{alt}]({url})",
            "object_key": object_key,
            "content_type": "image/webp",
            "media_type": "image",
            "width": width,
            "height": height,
            "size_bytes": len(media_bytes),
        }

    video_content_type = _normalize_content_type(filename=filename, content_type=content_type)
    if video_content_type in allowed_video_types:
        max_bytes = _parse_int_env("OSS_MAX_VIDEO_UPLOAD_BYTES", DEFAULT_MAX_VIDEO_UPLOAD_BYTES)
        if len(payload) > max_bytes:
            raise HTTPException(status_code=413, detail="Video file is too large")
        suffix = VIDEO_EXTENSION_BY_TYPE.get(video_content_type, Path(filename).suffix.lower() or ".mp4")
        object_key = _build_object_key(topic_id, media_dir="videos", suffix=suffix)
        url = _upload_bytes_to_oss(
            object_key=object_key,
            content_type=video_content_type,
            payload=payload,
            suffix=suffix,
        )
        alt = Path(filename).stem.strip() or "video"
        return {
            "url": url,
            "markdown": f"![{alt}]({url})",
            "object_key": object_key,
            "content_type": video_content_type,
            "media_type": "video",
            "width": 0,
            "height": 0,
            "size_bytes": len(payload),
        }

    raise HTTPException(status_code=400, detail="Unsupported media content type")
