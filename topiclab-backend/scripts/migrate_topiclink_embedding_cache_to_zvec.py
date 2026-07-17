"""Migrate a TopicLink embedding-cache export into a Zvec collection."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, TextIO

try:
    import zvec
except ImportError as exc:  # pragma: no cover - exercised by the CLI environment
    raise SystemExit("zvec is required; run with `uv run --with zvec python ...`") from exc


VECTOR_FIELD = "embedding"


def zvec_document_id(cache_key: str) -> str:
    return hashlib.sha256(cache_key.encode("utf-8")).hexdigest()


def _open_source(path: Path) -> TextIO:
    if path.suffix.lower() == ".gz":
        return gzip.open(path, "rt", encoding="utf-8")
    return path.open("r", encoding="utf-8")


def _parse_row(raw: dict[str, Any], line_number: int) -> tuple[dict[str, Any], list[float]]:
    cache_key = str(raw.get("cache_key") or "").strip()
    model = str(raw.get("model") or "").strip()
    text_hash = str(raw.get("text_hash") or "").strip()
    vector_value = raw.get("vector")
    if vector_value is None:
        vector_value = raw.get("vector_json")
    if isinstance(vector_value, str):
        try:
            vector_value = json.loads(vector_value)
        except json.JSONDecodeError as exc:
            raise ValueError(f"line {line_number}: vector_json is invalid JSON") from exc
    if not cache_key or not model or not text_hash:
        raise ValueError(f"line {line_number}: cache_key, model, and text_hash are required")
    if not isinstance(vector_value, list) or not vector_value:
        raise ValueError(f"line {line_number}: vector must be a non-empty array")
    try:
        vector = [float(value) for value in vector_value]
    except (TypeError, ValueError) as exc:
        raise ValueError(f"line {line_number}: vector contains a non-numeric value") from exc
    dimensions = int(raw.get("dimensions") or len(vector))
    if dimensions != len(vector):
        raise ValueError(
            f"line {line_number}: declared dimension {dimensions} does not match vector length {len(vector)}"
        )
    runtime_cache_key = f"{model}:{text_hash}"
    fields = {
        "cache_key": runtime_cache_key,
        "model": model,
        "text_hash": text_hash,
        "dimensions": dimensions,
        "created_at": str(raw.get("created_at") or ""),
        "updated_at": str(raw.get("updated_at") or ""),
        "last_used_at": str(raw.get("last_used_at") or ""),
    }
    return {"id": zvec_document_id(runtime_cache_key), "fields": fields}, vector


def _iter_rows(path: Path) -> Iterator[tuple[dict[str, Any], list[float]]]:
    with _open_source(path) as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                raw = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"line {line_number}: invalid JSON") from exc
            if not isinstance(raw, dict):
                raise ValueError(f"line {line_number}: each row must be a JSON object")
            yield _parse_row(raw, line_number)


def _inspect_source(path: Path) -> tuple[int, str, int]:
    count = 0
    models: set[str] = set()
    dimensions: set[int] = set()
    for item, vector in _iter_rows(path):
        count += 1
        models.add(str(item["fields"]["model"]))
        dimensions.add(len(vector))
    if count == 0:
        raise ValueError("embedding cache is empty")
    if len(models) != 1:
        raise ValueError(f"embedding cache contains mixed models: {sorted(models)}")
    if len(dimensions) != 1:
        raise ValueError(f"embedding cache contains mixed dimensions: {sorted(dimensions)}")
    return count, next(iter(models)), next(iter(dimensions))


def _open_collection(path: Path, dimensions: int):
    if path.exists():
        collection = zvec.open(str(path))
        vector_schema = collection.schema.vector(VECTOR_FIELD)
        if vector_schema is None or int(vector_schema.dimension) != dimensions:
            actual = None if vector_schema is None else int(vector_schema.dimension)
            raise ValueError(f"existing Zvec collection dimension {actual} does not match source {dimensions}")
        return collection

    path.parent.mkdir(parents=True, exist_ok=True)
    schema = zvec.CollectionSchema(
        name="topiclink_embedding_cache",
        fields=[
            zvec.FieldSchema("cache_key", zvec.DataType.STRING),
            zvec.FieldSchema("model", zvec.DataType.STRING),
            zvec.FieldSchema("text_hash", zvec.DataType.STRING),
            zvec.FieldSchema("dimensions", zvec.DataType.INT32),
            zvec.FieldSchema("created_at", zvec.DataType.STRING),
            zvec.FieldSchema("updated_at", zvec.DataType.STRING),
            zvec.FieldSchema("last_used_at", zvec.DataType.STRING),
        ],
        vectors=zvec.VectorSchema(
            VECTOR_FIELD,
            zvec.DataType.VECTOR_FP32,
            dimensions,
            index_param=zvec.HnswIndexParam(metric_type=zvec.MetricType.COSINE),
        ),
    )
    return zvec.create_and_open(str(path), schema)


def _assert_statuses(statuses: Any) -> None:
    values = statuses if isinstance(statuses, list) else [statuses]
    failed = [status for status in values if not status.ok()]
    if failed:
        detail = "; ".join(f"{status.code}: {status.message}" for status in failed[:3])
        raise RuntimeError(f"Zvec upsert failed: {detail}")


def migrate_cache(
    source: str | Path,
    target: str | Path,
    *,
    batch_size: int = 64,
    optimize: bool = True,
) -> dict[str, Any]:
    source_path = Path(source).expanduser().resolve()
    target_path = Path(target).expanduser().resolve()
    if not source_path.is_file():
        raise FileNotFoundError(source_path)
    if batch_size < 1:
        raise ValueError("batch_size must be at least 1")

    source_rows, model, dimensions = _inspect_source(source_path)
    collection = _open_collection(target_path, dimensions)
    migrated_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    batch: list[Any] = []
    upserted_rows = 0
    for item, vector in _iter_rows(source_path):
        batch.append(
            zvec.Doc(
                id=item["id"],
                vectors={VECTOR_FIELD: vector},
                fields={**item["fields"], "last_used_at": migrated_at},
            )
        )
        if len(batch) >= batch_size:
            _assert_statuses(collection.upsert(batch))
            upserted_rows += len(batch)
            batch = []
    if batch:
        _assert_statuses(collection.upsert(batch))
        upserted_rows += len(batch)
    collection.flush()
    if optimize:
        collection.optimize()
    return {
        "source_rows": source_rows,
        "upserted_rows": upserted_rows,
        "model": model,
        "dimensions": dimensions,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="TopicLink embedding-cache JSONL or JSONL.GZ")
    parser.add_argument("target", type=Path, help="Zvec collection directory")
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--no-optimize", action="store_true")
    args = parser.parse_args()
    summary = migrate_cache(
        args.source,
        args.target,
        batch_size=args.batch_size,
        optimize=not args.no_optimize,
    )
    print(json.dumps({**summary, "target": str(args.target.resolve())}, ensure_ascii=False))


if __name__ == "__main__":
    main()
