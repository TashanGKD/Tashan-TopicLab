"""Import TopicLink embedding cache rows into the configured DATABASE_URL.

The input is a JSONL or JSONL.GZ export with rows from topic_link_embedding_cache.
This script only upserts that cache table. It does not touch topics, posts, users,
or discussion state.
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
from pathlib import Path
from typing import Any, Iterable

from sqlalchemy import text

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.api.topiclink import _ensure_embedding_cache_table
from app.storage.database.postgres_client import get_db_session


def _iter_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            raw = line.strip()
            if not raw:
                continue
            try:
                value = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError(f"line {line_number}: invalid JSON") from exc
            if not isinstance(value, dict):
                raise ValueError(f"line {line_number}: expected object")
            yield value


def _normalize_row(row: dict[str, Any], *, line_number: int) -> dict[str, Any]:
    cache_key = str(row.get("cache_key") or "").strip()
    model = str(row.get("model") or "").strip()
    text_hash = str(row.get("text_hash") or "").strip()
    vector_json = row.get("vector_json")
    if vector_json is None and "vector" in row:
        vector_json = json.dumps(row["vector"])
    if not cache_key or not model or not text_hash or vector_json is None:
        raise ValueError(f"line {line_number}: cache_key/model/text_hash/vector_json are required")
    if not isinstance(vector_json, str):
        vector_json = json.dumps(vector_json)
    try:
        parsed_vector = json.loads(vector_json)
    except json.JSONDecodeError as exc:
        raise ValueError(f"line {line_number}: vector_json is not JSON") from exc
    if not isinstance(parsed_vector, list) or not parsed_vector:
        raise ValueError(f"line {line_number}: vector_json must be a non-empty array")
    dimensions = int(row.get("dimensions") or len(parsed_vector))
    created_at = row.get("created_at") or row.get("updated_at")
    updated_at = row.get("updated_at") or created_at
    last_used_at = row.get("last_used_at") or updated_at
    return {
        "cache_key": cache_key,
        "model": model,
        "text_hash": text_hash,
        "vector_json": vector_json,
        "dimensions": dimensions,
        "created_at": created_at,
        "updated_at": updated_at,
        "last_used_at": last_used_at,
    }


def _upsert_batch(rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    with get_db_session() as session:
        _ensure_embedding_cache_table(session)
        session.execute(
            text(
                """
                INSERT INTO topic_link_embedding_cache (
                    cache_key, model, text_hash, vector_json, dimensions,
                    created_at, updated_at, last_used_at
                )
                VALUES (
                    :cache_key, :model, :text_hash, :vector_json, :dimensions,
                    COALESCE(:created_at, CURRENT_TIMESTAMP),
                    COALESCE(:updated_at, CURRENT_TIMESTAMP),
                    COALESCE(:last_used_at, CURRENT_TIMESTAMP)
                )
                ON CONFLICT (cache_key) DO UPDATE SET
                    model = EXCLUDED.model,
                    text_hash = EXCLUDED.text_hash,
                    vector_json = EXCLUDED.vector_json,
                    dimensions = EXCLUDED.dimensions,
                    updated_at = EXCLUDED.updated_at,
                    last_used_at = EXCLUDED.last_used_at
                """
            ),
            rows,
        )


def import_cache(path: Path, *, batch_size: int) -> int:
    pending: list[dict[str, Any]] = []
    total = 0
    for line_number, row in enumerate(_iter_jsonl(path), start=1):
        pending.append(_normalize_row(row, line_number=line_number))
        if len(pending) >= batch_size:
            _upsert_batch(pending)
            total += len(pending)
            pending = []
    if pending:
        _upsert_batch(pending)
        total += len(pending)
    return total


def main() -> None:
    parser = argparse.ArgumentParser(description="Import TopicLink embedding cache JSONL(.gz).")
    parser.add_argument("path", type=Path, help="Path to topiclink_embedding_cache_*.jsonl or .jsonl.gz")
    parser.add_argument("--batch-size", type=int, default=200, help="Rows per database upsert batch")
    args = parser.parse_args()
    if args.batch_size < 1:
        raise SystemExit("--batch-size must be >= 1")
    if not args.path.exists():
        raise SystemExit(f"file not found: {args.path}")
    total = import_cache(args.path, batch_size=args.batch_size)
    print(f"imported_or_updated={total}")


if __name__ == "__main__":
    main()
