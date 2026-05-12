#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from dotenv import load_dotenv
from PIL import Image, ImageOps
from sqlalchemy import text


POSTER_MIME_TYPE = "image/webp"


def find_repo_root(start: Path) -> Path:
    current = start.resolve()
    for candidate in [current, *current.parents]:
        if (candidate / ".git").exists() and (candidate / "topiclab-backend").exists():
            return candidate
    raise FileNotFoundError("Could not locate repo root containing .git and topiclab-backend")


def read_json_object(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"JSON file must contain an object: {path}")
    return data


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def convert_to_webp(source: Path, output: Path | None, quality: int, max_width: int | None) -> tuple[bytes, dict[str, Any]]:
    if not source.exists():
        raise FileNotFoundError(f"Poster not found: {source}")
    with Image.open(source) as raw_image:
        image = ImageOps.exif_transpose(raw_image)
        original_size = image.size
        if max_width and image.width > max_width:
            ratio = max_width / float(image.width)
            image = image.resize((max_width, max(1, round(image.height * ratio))), Image.Resampling.LANCZOS)
        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGB")
        elif image.mode == "RGBA":
            background = Image.new("RGB", image.size, (255, 255, 255))
            background.paste(image, mask=image.getchannel("A"))
            image = background

        target = output
        temp_path: Path | None = None
        if target is None:
            handle = tempfile.NamedTemporaryFile(suffix=".webp", delete=False)
            handle.close()
            temp_path = Path(handle.name)
            target = temp_path

        target.parent.mkdir(parents=True, exist_ok=True)
        image.save(target, "WEBP", quality=quality, method=6)
        payload = target.read_bytes()
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)

        if payload[:4] != b"RIFF" or payload[8:12] != b"WEBP":
            raise ValueError(f"Converted file is not valid WebP: {target}")

        stats = {
            "source": str(source),
            "output": str(output) if output else None,
            "original_width": original_size[0],
            "original_height": original_size[1],
            "webp_width": image.size[0],
            "webp_height": image.size[1],
            "webp_bytes": len(payload),
            "quality": quality,
        }
        return payload, stats


def summarize_database_url(url: str) -> dict[str, Any]:
    parsed = urlparse(url)
    return {
        "scheme": parsed.scheme,
        "hostname": parsed.hostname,
        "port": parsed.port,
        "database": parsed.path.rsplit("/", 1)[-1] if parsed.path else "",
    }


def load_backend(repo_root: Path, env_file: Path | None, database_url: str | None):
    if env_file is not None:
        load_dotenv(env_file)
    else:
        load_dotenv(repo_root / ".env")
    if database_url:
        os.environ["DATABASE_URL"] = database_url
    if not os.getenv("DATABASE_URL"):
        raise ValueError("DATABASE_URL is not set; pass --database-url or provide repo root .env")

    backend_path = repo_root / "topiclab-backend"
    sys.path.insert(0, str(backend_path))
    from app.storage.database.postgres_client import _is_sqlite_session, get_db_session
    from app.storage.database.youth_ted_store import (
        clear_youth_ted_cache,
        ensure_youth_ted_schema_and_seed_for_session,
    )

    return get_db_session, _is_sqlite_session, ensure_youth_ted_schema_and_seed_for_session, clear_youth_ted_cache


def build_payload(args: argparse.Namespace) -> dict[str, Any]:
    content = read_json_object(Path(args.content_json).expanduser()) if args.content_json else {}
    return {
        "label": args.label,
        "title": args.title,
        "meta": args.meta,
        "summary": args.summary,
        "content": content,
    }


def upsert_activity(
    *,
    args: argparse.Namespace,
    poster_webp: bytes,
    payload: dict[str, Any],
    backend,
) -> str:
    get_db_session, is_sqlite_session, ensure_schema, clear_cache = backend
    payload_json = json_dumps(payload)
    with get_db_session() as session:
        ensure_schema(session)
        existing = session.execute(
            text("SELECT 1 FROM youth_ted_activities WHERE slug = :slug LIMIT 1"),
            {"slug": args.slug},
        ).first()
        action = "update" if existing else "create"
        is_sqlite = is_sqlite_session(session)
        sql = (
            """
            INSERT INTO youth_ted_activities (
                id, slug, status, sort_order, payload_json, poster_webp, poster_mime_type
            )
            VALUES (
                :id, :slug, :status, :sort_order, :payload_json, :poster_webp, :poster_mime_type
            )
            ON CONFLICT(slug) DO UPDATE SET
                id = excluded.id,
                status = excluded.status,
                sort_order = excluded.sort_order,
                payload_json = excluded.payload_json,
                poster_webp = excluded.poster_webp,
                poster_mime_type = excluded.poster_mime_type,
                updated_at = CURRENT_TIMESTAMP
            """
            if is_sqlite
            else
            """
            INSERT INTO youth_ted_activities (
                id, slug, status, sort_order, payload_json, poster_webp, poster_mime_type
            )
            VALUES (
                :id, :slug, :status, :sort_order, CAST(:payload_json AS JSONB), :poster_webp, :poster_mime_type
            )
            ON CONFLICT(slug) DO UPDATE SET
                id = EXCLUDED.id,
                status = EXCLUDED.status,
                sort_order = EXCLUDED.sort_order,
                payload_json = EXCLUDED.payload_json,
                poster_webp = EXCLUDED.poster_webp,
                poster_mime_type = EXCLUDED.poster_mime_type,
                updated_at = CURRENT_TIMESTAMP
            """
        )
        session.execute(
            text(sql),
            {
                "id": args.id or args.slug,
                "slug": args.slug,
                "status": args.status,
                "sort_order": args.sort_order,
                "payload_json": payload_json,
                "poster_webp": poster_webp,
                "poster_mime_type": POSTER_MIME_TYPE,
            },
        )
    clear_cache()
    return action


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert and upsert a Youth TED activity into TopicLab DB.")
    parser.add_argument("--slug", required=True, help="Public activity slug, e.g. youth-ted-2026-05-06")
    parser.add_argument("--id", default=None, help="DB id. Defaults to slug.")
    parser.add_argument("--poster", required=True, help="Source poster image path.")
    parser.add_argument("--webp-out", default=None, help="Optional path to save converted WebP.")
    parser.add_argument("--label", required=True, help="Activity label shown in list.")
    parser.add_argument("--title", required=True, help="Activity title.")
    parser.add_argument("--meta", required=True, help="Activity meta line, usually date/time.")
    parser.add_argument("--summary", required=True, help="Short activity summary.")
    parser.add_argument("--content-json", default=None, help="Path to structured content JSON object.")
    parser.add_argument("--sort-order", type=int, default=20, help="Lower values appear first.")
    parser.add_argument("--status", default="published", help="Activity status.")
    parser.add_argument("--quality", type=int, default=82, help="WebP quality, 1-100.")
    parser.add_argument("--max-width", type=int, default=None, help="Resize if source width exceeds this value.")
    parser.add_argument("--repo-root", default=None, help="Repo root. Auto-detected by default.")
    parser.add_argument("--env-file", default=None, help="Dotenv path. Defaults to repo root .env.")
    parser.add_argument("--database-url", default=None, help="Override DATABASE_URL.")
    parser.add_argument("--dry-run", action="store_true", help="Convert and validate without writing DB.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not 1 <= args.quality <= 100:
        raise ValueError("--quality must be between 1 and 100")

    repo_root = Path(args.repo_root).expanduser().resolve() if args.repo_root else find_repo_root(Path.cwd())
    source = Path(args.poster).expanduser().resolve()
    webp_out = Path(args.webp_out).expanduser().resolve() if args.webp_out else None
    poster_webp, poster_stats = convert_to_webp(source, webp_out, args.quality, args.max_width)
    payload = build_payload(args)

    env_file = Path(args.env_file).expanduser().resolve() if args.env_file else None
    backend = load_backend(repo_root, env_file, args.database_url)
    database_url = os.environ["DATABASE_URL"]

    action = "dry_run"
    if not args.dry_run:
        action = upsert_activity(args=args, poster_webp=poster_webp, payload=payload, backend=backend)

    print(
        json.dumps(
            {
                "action": action,
                "slug": args.slug,
                "status": args.status,
                "sort_order": args.sort_order,
                "poster": poster_stats,
                "payload_keys": sorted(payload.keys()),
                "content_keys": sorted((payload.get("content") or {}).keys()),
                "database": summarize_database_url(database_url),
                "api": {
                    "list": "/api/v1/youth-ted/activities",
                    "poster": f"/api/v1/youth-ted/activities/{args.slug}/poster.webp",
                },
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
