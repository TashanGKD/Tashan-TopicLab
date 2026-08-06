"""Build and open the low-memory runtime index for the science MCP catalog."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import zlib
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit


DATABASE_SCHEMA_VERSION = 2
REQUIRED_DIMENSIONS = ("domains", "subdomains", "stages", "functions")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SEARCH_FIELDS = (
    "id",
    "name",
    "summary",
    "task",
    "domain",
    "subdomain",
    "stage",
    "function",
    "status",
    "evidence",
    "overlap_difference",
    "rationale",
    "tags",
    "capabilities",
    "framework",
    "compatibility_level",
    "license",
    "latest_version",
    "install_command",
    "transport",
    "source_name",
    "info_page",
)
FINDER_FIELDS = (
    "id",
    "name",
    "task",
    "summary",
    "description",
    "tags",
    "capabilities",
    "subdomain",
    "domain",
    "stage",
    "function",
    "quality_score",
    "readiness",
    "review_status",
    "evidence_scope",
)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def search_tokens(value: str) -> set[str]:
    normalized = value.casefold()
    tokens = set(re.findall(r"[a-z0-9][a-z0-9+._-]{1,}", normalized))
    for run in re.findall(r"[\u4e00-\u9fff]+", normalized):
        tokens.update(
            run[index : index + width]
            for width in (2, 3, 4)
            for index in range(max(0, len(run) - width + 1))
        )
    return tokens


def _hashed_token(value: str) -> str:
    return hashlib.blake2s(value.encode("utf-8"), digest_size=8).hexdigest()


def hashed_search_terms(value: str) -> list[str]:
    """Return FTS-safe opaque terms without exposing catalog text to SQL syntax."""

    return sorted(_hashed_token(token) for token in search_tokens(value))


def _search_document(item: dict[str, Any]) -> str:
    values: list[str] = []
    for field in SEARCH_FIELDS:
        value = item.get(field)
        if isinstance(value, str):
            values.append(value)
        else:
            values.append(json.dumps(value or "", ensure_ascii=False, sort_keys=True))
    return " ".join(values)


def normalize_canonical_url(value: str) -> str:
    """Normalize a source URL for identity checks without rewriting evidence."""

    raw = str(value or "").strip()
    parsed = urlsplit(raw)
    if not parsed.scheme or not parsed.netloc:
        return raw.casefold().rstrip("/")
    try:
        port = parsed.port
    except ValueError:
        return raw.casefold().rstrip("/")
    host = (parsed.hostname or "").casefold()
    if (parsed.scheme.casefold(), port) in {("http", 80), ("https", 443)}:
        port = None
    netloc = host + (f":{port}" if port is not None else "")
    path = parsed.path.rstrip("/") or "/"
    return urlunsplit((parsed.scheme.casefold(), netloc, path, parsed.query, ""))


def validate_catalog_snapshot(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Validate every invariant needed by both JSON and compiled runtimes."""

    if payload.get("schema") != "science_mcp_catalog_v1" or not isinstance(payload.get("mcps"), list):
        raise RuntimeError("Invalid science MCP catalog snapshot")
    dimensions = payload.get("dimensions")
    if not isinstance(dimensions, dict) or any(not isinstance(dimensions.get(key), list) for key in REQUIRED_DIMENSIONS):
        raise RuntimeError("Science MCP catalog dimensions are invalid")
    items = payload["mcps"]
    if payload.get("active_catalog_count") != len(items):
        raise RuntimeError("Science MCP catalog count does not match payload")
    ids = [str(item.get("id") or "") for item in items]
    urls = [str(item.get("source_url") or "") for item in items]
    if any(not value for value in ids + urls) or len(ids) != len(set(ids)) or len(urls) != len(set(urls)):
        raise RuntimeError("Science MCP catalog contains duplicate or empty identity fields")
    normalized_urls = [normalize_canonical_url(value) for value in urls]
    if len(normalized_urls) != len(set(normalized_urls)):
        raise RuntimeError("Science MCP catalog contains duplicate normalized canonical URLs")
    allowed = {key: set(dimensions[key]) for key in REQUIRED_DIMENSIONS}
    for item in items:
        if item.get("domain") not in allowed["domains"] or item.get("subdomain") not in allowed["subdomains"]:
            raise RuntimeError(f"Science MCP catalog has invalid domain taxonomy: {item.get('id')}")
        if item.get("stage") not in allowed["stages"] or item.get("function") not in allowed["functions"]:
            raise RuntimeError(f"Science MCP catalog has invalid stage/function taxonomy: {item.get('id')}")
        if item.get("evidence_scope") not in {"fast_metadata_triage", "source_reviewed"}:
            raise RuntimeError(f"Science MCP catalog has invalid evidence scope: {item.get('id')}")
        if item.get("review_status") != "taxonomy_reviewed" or not str(
            item.get("classification_rationale") or ""
        ).strip():
            raise RuntimeError(f"Science MCP catalog has incomplete taxonomy review: {item.get('id')}")
        verification = item.get("source_verification")
        if not isinstance(verification, dict) or not verification.get("observed_path"):
            raise RuntimeError(f"Science MCP catalog lacks source verification: {item.get('id')}")
        if verification.get("fetch_status") == "fetched" and not SHA256_RE.fullmatch(
            str(verification.get("content_sha256") or "")
        ):
            raise RuntimeError(f"Science MCP catalog has untraceable fetched content: {item.get('id')}")
        if "source_metadata" in item or "content_path" in verification:
            raise RuntimeError(f"Science MCP catalog exposes local cache metadata: {item.get('id')}")
    return items


def _category_payload(payload: dict[str, Any], items: list[dict[str, Any]]) -> dict[str, Any]:
    dimensions = payload["dimensions"]
    counts: dict[str, dict[str, int]] = {
        key: {str(value): 0 for value in values}
        for key, values in dimensions.items()
    }
    item_keys = {
        "domains": "domain",
        "subdomains": "subdomain",
        "stages": "stage",
        "functions": "function",
    }
    status_counts: dict[str, int] = {}
    for item in items:
        for dimension, item_key in item_keys.items():
            value = str(item.get(item_key) or "")
            if value not in counts[dimension]:
                raise RuntimeError(f"Science MCP catalog has invalid {item_key}: {item.get('id')}")
            counts[dimension][value] += 1
        status = str(item.get("status") or "unknown")
        status_counts[status] = status_counts.get(status, 0) + 1
    return {
        "dimensions": dimensions,
        "counts": counts,
        "status_counts": status_counts,
        "taxonomy_index": payload.get("taxonomy_index") or {},
        "hub_index": payload.get("hub_index") or {},
    }


def build_catalog_database(source: Path, destination: Path) -> tuple[int, str]:
    """Compile the checked-in JSON snapshot into an atomic SQLite/FTS index."""

    raw = source.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    payload = json.loads(raw.decode("utf-8"))
    items = validate_catalog_snapshot(payload)
    categories = _category_payload(payload, items)
    public_payload = {key: value for key, value in payload.items() if key != "mcps"}

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    if temporary.exists():
        temporary.unlink()

    connection = sqlite3.connect(temporary)
    try:
        connection.executescript(
            """
            PRAGMA journal_mode=OFF;
            PRAGMA synchronous=OFF;
            CREATE TABLE catalog_metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE mcps (
                position INTEGER NOT NULL UNIQUE,
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                name_sort TEXT NOT NULL,
                domain TEXT NOT NULL,
                subdomain TEXT NOT NULL,
                stage TEXT NOT NULL,
                function_name TEXT NOT NULL,
                status TEXT NOT NULL,
                readiness TEXT NOT NULL,
                evidence_rank INTEGER NOT NULL,
                quality_score INTEGER NOT NULL,
                tool_count INTEGER NOT NULL,
                finder_json BLOB NOT NULL,
                payload BLOB NOT NULL
            );
            CREATE INDEX idx_mcp_organized
                ON mcps(domain, subdomain, stage, function_name, name_sort, id);
            CREATE INDEX idx_mcp_filters
                ON mcps(status, readiness, evidence_rank, quality_score);
            CREATE VIRTUAL TABLE mcp_search USING fts5(
                terms,
                content='',
                tokenize='unicode61'
            );
            """
        )
        metadata = {
            "schema_version": str(DATABASE_SCHEMA_VERSION),
            "source_sha256": digest,
            "catalog_json": json.dumps(public_payload, ensure_ascii=False, separators=(",", ":")),
            "categories_json": json.dumps(categories, ensure_ascii=False, separators=(",", ":")),
        }
        connection.executemany(
            "INSERT INTO catalog_metadata(key, value) VALUES (?, ?)",
            metadata.items(),
        )
        for position, item in enumerate(items):
            capability_evidence = item.get("capability_evidence") or {}
            tool_count = max(
                len(item.get("capabilities") or []),
                int(capability_evidence.get("tool_count") or 0),
            )
            finder_payload = {field: item.get(field) for field in FINDER_FIELDS}
            compressed_payload = zlib.compress(
                json.dumps(item, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
                level=6,
            )
            connection.execute(
                """
                INSERT INTO mcps(
                    position, id, name, name_sort, domain, subdomain, stage,
                    function_name, status, readiness, evidence_rank,
                    quality_score, tool_count, finder_json, payload
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    position,
                    str(item["id"]),
                    str(item.get("name") or item["id"]),
                    str(item.get("name") or item["id"]).casefold(),
                    str(item["domain"]),
                    str(item["subdomain"]),
                    str(item["stage"]),
                    str(item["function"]),
                    str(item.get("status") or "unknown"),
                    str(item.get("readiness") or ""),
                    0 if item.get("evidence_scope") == "source_reviewed" else 1,
                    int(item.get("quality_score") or 0),
                    tool_count,
                    zlib.compress(
                        json.dumps(finder_payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
                        level=6,
                    ),
                    compressed_payload,
                ),
            )
            terms = " ".join(hashed_search_terms(_search_document(item)))
            connection.execute(
                "INSERT INTO mcp_search(rowid, terms) VALUES (?, ?)",
                (position + 1, terms),
            )
        connection.commit()
        connection.execute("INSERT INTO mcp_search(mcp_search) VALUES ('optimize')")
        connection.commit()
        connection.execute("VACUUM")
    finally:
        connection.close()
    os.replace(temporary, destination)
    return len(items), digest


def database_matches_source(source: Path, database: Path) -> bool:
    if not source.is_file() or not database.is_file():
        return False
    try:
        with sqlite3.connect(f"{database.resolve().as_uri()}?mode=ro", uri=True) as connection:
            metadata = dict(connection.execute("SELECT key, value FROM catalog_metadata"))
            item_count = int(connection.execute("SELECT COUNT(*) FROM mcps").fetchone()[0])
            search_count = int(connection.execute("SELECT COUNT(*) FROM mcp_search").fetchone()[0])
        expected_count = int(json.loads(metadata["catalog_json"])["active_catalog_count"])
    except (KeyError, OSError, TypeError, ValueError, sqlite3.Error):
        return False
    return (
        metadata.get("schema_version") == str(DATABASE_SCHEMA_VERSION)
        and metadata.get("source_sha256") == file_sha256(source)
        and item_count == expected_count
        and search_count == expected_count
    )


def open_catalog_database(database: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"{database.resolve().as_uri()}?mode=ro&immutable=1", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def decode_catalog_payload(value: bytes) -> dict[str, Any]:
    return json.loads(zlib.decompress(value).decode("utf-8"))
