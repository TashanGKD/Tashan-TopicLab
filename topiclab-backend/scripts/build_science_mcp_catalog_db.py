#!/usr/bin/env python3
"""Compile or verify the low-memory science MCP runtime catalog."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services.science_mcp_catalog_db import (  # noqa: E402
    build_catalog_database,
    database_matches_source,
)


DEFAULT_SOURCE = ROOT / "app" / "data" / "science_mcp_catalog.json"
DEFAULT_DESTINATION = ROOT / "app" / "data" / "science_mcp_catalog.sqlite3"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--destination", type=Path, default=DEFAULT_DESTINATION)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    source = args.source.resolve()
    destination = args.destination.resolve()
    if args.check:
        if not database_matches_source(source, destination):
            print(f"OUTDATED: {destination}")
            return 1
        print(f"OK: runtime catalog matches {source.name}")
        return 0
    count, _ = build_catalog_database(source, destination)
    print(f"BUILT: {count} active MCPs -> {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
