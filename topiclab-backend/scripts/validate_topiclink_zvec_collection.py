#!/usr/bin/env python3
"""Validate that a deployed TopicLink Zvec collection is readable and populated."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def validate_collection(
    collection_path: Path,
    *,
    min_doc_count: int,
    expected_dimensions: int,
) -> dict[str, object]:
    manifests = sorted(collection_path.glob("manifest.*"))
    if not manifests:
        raise RuntimeError(f"No manifest.* found in {collection_path}")

    import zvec

    collection = zvec.open(str(collection_path))
    stats = json.loads(str(collection.stats))
    doc_count = int(stats.get("doc_count") or 0)
    vector_schema = collection.schema.vector("embedding")
    dimensions = None if vector_schema is None else int(vector_schema.dimension)
    completeness = float(
        (stats.get("index_completeness") or {}).get("embedding") or 0.0
    )

    if doc_count < min_doc_count:
        raise RuntimeError(
            f"Zvec document count {doc_count} is below required minimum {min_doc_count}"
        )
    if dimensions != expected_dimensions:
        raise RuntimeError(
            f"Zvec embedding dimension {dimensions} does not match {expected_dimensions}"
        )
    if completeness < 1.0:
        raise RuntimeError(f"Zvec embedding index completeness is {completeness}, expected 1.0")

    return {
        "status": "ready",
        "path": str(collection_path),
        "manifest": manifests[-1].name,
        "doc_count": doc_count,
        "dimensions": dimensions,
        "index_completeness": completeness,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("collection_path", type=Path)
    parser.add_argument("--min-doc-count", type=int, default=1)
    parser.add_argument("--expected-dimensions", type=int, default=4096)
    args = parser.parse_args()

    result = validate_collection(
        args.collection_path.expanduser().resolve(),
        min_doc_count=max(0, args.min_doc_count),
        expected_dimensions=args.expected_dimensions,
    )
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
