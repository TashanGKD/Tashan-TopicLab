#!/usr/bin/env python3
"""Validate and sync a generated find-science-skills catalog snapshot."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


DEFAULT_DESTINATION = (
    Path(__file__).resolve().parents[1]
    / "topiclab-backend"
    / "app"
    / "data"
    / "science_skill_catalog.json"
)
REQUIRED_DIMENSIONS = {"domains", "subdomains", "stages", "functions"}
SOURCE_PROBE_STATES = {
    "not_checked",
    "baseline_established",
    "unchanged",
    "updated",
    "moved",
    "renamed",
    "missing",
}
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def validate_catalog(raw: bytes) -> dict:
    payload = json.loads(raw.decode("utf-8"))
    skills = payload.get("skills")
    if payload.get("schema") != "science_skill_catalog_v1" or not isinstance(skills, list):
        raise ValueError("expected science_skill_catalog_v1 payload with a skills list")
    if payload.get("skill_count") != len(skills):
        raise ValueError("skill_count does not match the skills list")
    ids = [str(item.get("id") or "") for item in skills]
    if any(not item for item in ids) or len(ids) != len(set(ids)):
        raise ValueError("catalog has empty or duplicate canonical IDs")
    dimensions = payload.get("dimensions")
    if not isinstance(dimensions, dict) or set(dimensions) != REQUIRED_DIMENSIONS:
        raise ValueError("catalog dimensions must be domains/subdomains/stages/functions")
    return payload


def load_source_registry(path: Path) -> dict[str, dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    entries = payload.get("entries")
    if payload.get("schema") != "science_skill_source_registry_v1" or not isinstance(entries, list):
        raise ValueError("expected science_skill_source_registry_v1 payload with an entries list")
    index: dict[str, dict] = {}
    for entry in entries:
        canonical_id = str(entry.get("canonical_id") or "") if isinstance(entry, dict) else ""
        if not canonical_id or canonical_id in index:
            raise ValueError(f"source registry has invalid or duplicate canonical ID: {canonical_id!r}")
        index[canonical_id] = entry
    return index


def enrich_source_verification(payload: dict, registry: dict[str, dict]) -> dict:
    catalog_ids = {str(item["id"]) for item in payload["skills"]}
    if catalog_ids != set(registry):
        raise ValueError("source registry canonical IDs do not exactly match the published catalog")
    enriched_skills = []
    for item in payload["skills"]:
        entry = registry[str(item["id"])]
        published = entry.get("published_state")
        if not isinstance(published, dict) or any(
            str(published.get(key) or "") != str(item.get(key) or "")
            for key in ("readiness", "review_status")
        ):
            raise ValueError(f"source registry published state drift: {item['id']}")
        probe = entry.get("remote_probe")
        if not isinstance(probe, dict) or probe.get("status") not in SOURCE_PROBE_STATES:
            raise ValueError(f"source registry has invalid remote probe: {item['id']}")
        status = str(probe["status"])
        checked_at = probe.get("checked_at")
        evidence_sha = probe.get("evidence_report_sha256")
        observed_path = probe.get("observed_path")
        if status != "not_checked":
            if not checked_at or not isinstance(evidence_sha, str) or not SHA256_RE.fullmatch(evidence_sha):
                raise ValueError(f"source registry probe lacks timestamp or evidence hash: {item['id']}")
            if status != "missing" and not observed_path:
                raise ValueError(f"source registry probe lacks observed path: {item['id']}")
        enriched_skills.append(
            {
                **item,
                "source_verification": {
                    "status": status,
                    "checked_at": checked_at,
                    "observed_path": observed_path,
                    "evidence_report_sha256": evidence_sha,
                    "review_required": bool(probe.get("review_required")),
                },
            }
        )
    return {**payload, "skills": enriched_skills}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Generated science_skill_catalog.json")
    parser.add_argument("--source-registry", type=Path, help="Validated source registry candidate")
    parser.add_argument("--destination", type=Path, default=DEFAULT_DESTINATION)
    parser.add_argument("--check", action="store_true", help="Fail if destination differs; do not write")
    args = parser.parse_args()

    raw = args.source.resolve().read_bytes()
    payload = validate_catalog(raw)
    if args.source_registry:
        payload = enrich_source_verification(payload, load_source_registry(args.source_registry.resolve()))
        raw = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    destination = args.destination.resolve()
    current = destination.read_bytes() if destination.exists() else None
    if args.check:
        if current != raw:
            print(f"OUTDATED: {destination}")
            return 1
        print(f"OK: {payload['skill_count']} skills; snapshot is current")
        return 0

    destination.parent.mkdir(parents=True, exist_ok=True)
    if current != raw:
        destination.write_bytes(raw)
        print(f"UPDATED: {payload['skill_count']} skills -> {destination}")
    else:
        print(f"UNCHANGED: {payload['skill_count']} skills")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
