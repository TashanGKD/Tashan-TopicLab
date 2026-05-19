#!/usr/bin/env python3
"""Convert and upsert the TopicLab Footer WeChat group QR image."""

from __future__ import annotations

import argparse
import json
import os
import sys
from io import BytesIO
from pathlib import Path


ASSET_KEY = "wechat-group-qr"


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _load_env(repo_root: Path, database_url: str | None) -> None:
    backend_dir = repo_root / "topiclab-backend"
    sys.path.insert(0, str(backend_dir))

    try:
        from dotenv import load_dotenv
    except ImportError:
        load_dotenv = None

    if load_dotenv is not None:
        for env_path in (repo_root / ".env", backend_dir / ".env"):
            if env_path.exists():
                load_dotenv(env_path, override=False)

    if database_url:
        os.environ["DATABASE_URL"] = database_url


def _convert_to_webp(image_path: Path) -> tuple[bytes, int, int]:
    from PIL import Image, ImageOps

    with Image.open(image_path) as image:
        normalized = ImageOps.exif_transpose(image)
        if normalized.mode not in {"RGB", "RGBA"}:
            normalized = normalized.convert("RGBA" if "A" in normalized.getbands() else "RGB")
        width, height = normalized.size
        output = BytesIO()
        normalized.save(output, format="WEBP", quality=88, method=6)
        return output.getvalue(), width, height


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, help="Path to the new WeChat group QR image.")
    parser.add_argument("--expires-at", default=None, help="Optional QR expiry ISO timestamp.")
    parser.add_argument("--database-url", default=None, help="Override DATABASE_URL for this update.")
    args = parser.parse_args()

    image_path = Path(args.image).expanduser().resolve()
    if not image_path.exists():
        parser.error(f"image does not exist: {image_path}")

    repo_root = _repo_root()
    _load_env(repo_root, args.database_url)

    if not os.getenv("DATABASE_URL"):
        parser.error("DATABASE_URL is not set; load .env or pass --database-url")

    image_webp, width, height = _convert_to_webp(image_path)

    from app.storage.database.site_assets_store import WEBP_MIME_TYPE, upsert_site_image_asset

    upsert_site_image_asset(
        key=ASSET_KEY,
        image_webp=image_webp,
        mime_type=WEBP_MIME_TYPE,
        expires_at=args.expires_at,
        source_filename=image_path.name,
    )

    print(
        json.dumps(
            {
                "ok": True,
                "key": ASSET_KEY,
                "source": str(image_path),
                "mime_type": WEBP_MIME_TYPE,
                "width": width,
                "height": height,
                "webp_bytes": len(image_webp),
                "expires_at": args.expires_at,
                "url": "/api/v1/site/wechat-group-qr.webp",
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
