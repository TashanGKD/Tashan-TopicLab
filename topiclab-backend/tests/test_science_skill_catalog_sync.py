from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def test_science_skill_catalog_sync_is_validated_and_deterministic(tmp_path: Path):
    root = Path(__file__).resolve().parents[2]
    script = root / "scripts" / "sync_science_skill_catalog.py"
    source = tmp_path / "source.json"
    destination = tmp_path / "destination.json"
    payload = {
        "schema": "science_skill_catalog_v1",
        "source_skill_count": 1,
        "excluded_non_scientific_count": 0,
        "skill_count": 1,
        "dimensions": {
            "domains": ["生命科学"],
            "subdomains": ["蛋白与结构生物学"],
            "stages": ["执行采集"],
            "functions": ["模拟建模"],
        },
        "skills": [{"id": "alphafold2"}],
    }
    source.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    sync = subprocess.run(
        [sys.executable, str(script), "--source", str(source), "--destination", str(destination)],
        check=False,
        capture_output=True,
        text=True,
    )
    assert sync.returncode == 0
    assert destination.read_bytes() == source.read_bytes()

    check = subprocess.run(
        [sys.executable, str(script), "--source", str(source), "--destination", str(destination), "--check"],
        check=False,
        capture_output=True,
        text=True,
    )
    assert check.returncode == 0
    assert "snapshot is current" in check.stdout


def test_science_skill_catalog_sync_adds_only_hash_backed_source_verification(tmp_path: Path):
    root = Path(__file__).resolve().parents[2]
    script = root / "scripts" / "sync_science_skill_catalog.py"
    source = tmp_path / "source.json"
    registry = tmp_path / "registry.json"
    destination = tmp_path / "destination.json"
    payload = {
        "schema": "science_skill_catalog_v1",
        "source_skill_count": 2,
        "excluded_non_scientific_count": 0,
        "skill_count": 2,
        "dimensions": {
            "domains": ["生命科学"],
            "subdomains": ["蛋白与结构生物学"],
            "stages": ["执行采集"],
            "functions": ["模拟建模"],
        },
        "skills": [
            {"id": "verified", "readiness": "trusted", "review_status": "manual_confirmed"},
            {"id": "unchecked", "readiness": "provisional", "review_status": "metadata_reviewed"},
        ],
    }
    source.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    registry.write_text(
        json.dumps(
            {
                "schema": "science_skill_source_registry_v1",
                "entries": [
                    {
                        "canonical_id": "verified",
                        "published_state": {"readiness": "trusted", "review_status": "manual_confirmed"},
                        "remote_probe": {
                            "status": "baseline_established",
                            "checked_at": "2026-07-16T19:03:18Z",
                            "observed_path": "skills/verified/SKILL.md",
                            "evidence_report_sha256": "a" * 64,
                            "review_required": False,
                        },
                    },
                    {
                        "canonical_id": "unchecked",
                        "published_state": {"readiness": "provisional", "review_status": "metadata_reviewed"},
                        "remote_probe": {
                            "status": "not_checked",
                            "checked_at": None,
                            "observed_path": None,
                            "evidence_report_sha256": None,
                            "review_required": False,
                        },
                    },
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    sync = subprocess.run(
        [
            sys.executable,
            str(script),
            "--source",
            str(source),
            "--source-registry",
            str(registry),
            "--destination",
            str(destination),
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert sync.returncode == 0, sync.stderr
    skills = json.loads(destination.read_text(encoding="utf-8"))["skills"]
    assert skills[0]["source_verification"] == {
        "status": "baseline_established",
        "checked_at": "2026-07-16T19:03:18Z",
        "observed_path": "skills/verified/SKILL.md",
        "evidence_report_sha256": "a" * 64,
        "review_required": False,
    }
    assert skills[1]["source_verification"] == {
        "status": "not_checked",
        "checked_at": None,
        "observed_path": None,
        "evidence_report_sha256": None,
        "review_required": False,
    }
