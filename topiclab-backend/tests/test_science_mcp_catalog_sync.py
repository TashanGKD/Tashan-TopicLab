from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def test_science_mcp_catalog_sync_is_reproducible_and_publish_safe(tmp_path: Path):
    root = Path(__file__).resolve().parents[2]
    script = root / "scripts" / "sync_science_mcp_catalog.py"
    source = tmp_path / "science-mcp-catalog.json"
    destination = tmp_path / "science_mcp_catalog.json"
    payload = {
        "generated_at": "2026-08-05T00:00:00Z",
        "active_catalog_expansion": {
            "domains": ["生命科学"],
            "subdomains": ["蛋白与结构生物学"],
            "stages": ["分析验证"],
            "functions": ["分析推断"],
        },
        "entries": [
            {
                "id": "example-protein-mcp",
                "name": "Example Protein MCP",
                "status": "verified_source",
                "function": "检索并分析蛋白质结构记录。",
                "evidence": "README 明确说明这是处理蛋白质结构数据的 MCP server。",
                "overlap": "独立维护的蛋白质结构工具面。",
                "license": "MIT",
                "license_status": "identified",
                "license_source": "readme",
                "license_raw": "MIT License",
                "license_evidence": {
                    "license": "MIT",
                    "license_status": "identified",
                    "source_url": "https://github.com/example/protein-mcp/blob/main/LICENSE",
                    "content_path": "C:\\private\\cache\\LICENSE",
                    "content_sha256": "b" * 64,
                },
                "taxonomy": {
                    "domain": "生命科学",
                    "subdomain": "蛋白与结构生物学",
                    "stage": "分析验证",
                    "function": "分析推断",
                    "review_status": "taxonomy_reviewed",
                    "rationale": "一手说明明确给出研究对象和分析动作。",
                    "reviewed_at": "2026-08-05T00:00:00Z",
                    "source_url": "https://github.com/example/protein-mcp",
                    "evidence_scope": "source_reviewed",
                },
                "skillhub": {
                    "summary": "检索并分析蛋白质结构记录。",
                    "info_page": {
                        "summary": "Protein structure MCP server.",
                        "tool_names": ["protein_search", "protein_search", "not a tool name"],
                        "tool_names_source": "explicit_tool_section",
                        "transport": ["stdio"],
                    },
                },
                "source_metadata": {
                    "fetch_status": "fetched",
                    "http_status": 200,
                    "final_url": "https://raw.githubusercontent.com/example/protein-mcp/main/README.md",
                    "fetched_at": "2026-08-05T00:00:00Z",
                    "content_path": "C:\\private\\cache\\README.md",
                    "content_sha256": "a" * 64,
                    "content_bytes": 1024,
                },
            }
        ],
    }
    source.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    sync = subprocess.run(
        [sys.executable, str(script), "--source", str(source), "--destination", str(destination)],
        check=False,
        capture_output=True,
        text=True,
    )
    assert sync.returncode == 0, sync.stderr

    snapshot = json.loads(destination.read_text(encoding="utf-8"))
    assert snapshot["schema"] == "science_mcp_catalog_v1"
    assert snapshot["source"]["path"] == source.name
    item = snapshot["mcps"][0]
    assert item["classification_rationale"] == "一手说明明确给出研究对象和分析动作。"
    assert item["source_verification"]["content_sha256"] == "a" * 64
    assert item["source_verification"]["final_url"].startswith("https://raw.githubusercontent.com/")
    assert "source_metadata" not in item
    assert "source_repository" not in item
    assert "source_path" not in item
    assert "rationale" not in item
    assert "info_page" not in item
    assert "content_path" not in item["license_evidence"]
    assert "C:\\private" not in destination.read_text(encoding="utf-8")

    check = subprocess.run(
        [
            sys.executable,
            str(script),
            "--source",
            str(source),
            "--destination",
            str(destination),
            "--check",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert check.returncode == 0
    assert "snapshot is current" in check.stdout

    runtime_script = root / "topiclab-backend" / "scripts" / "build_science_mcp_catalog_db.py"
    runtime_database = tmp_path / "science_mcp_catalog.sqlite3"
    build = subprocess.run(
        [
            sys.executable,
            str(runtime_script),
            "--source",
            str(destination),
            "--destination",
            str(runtime_database),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert build.returncode == 0, build.stderr
    assert runtime_database.is_file()

    runtime_check = subprocess.run(
        [
            sys.executable,
            str(runtime_script),
            "--source",
            str(destination),
            "--destination",
            str(runtime_database),
            "--check",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert runtime_check.returncode == 0, runtime_check.stdout

    snapshot["mcps"][0]["source_verification"]["content_path"] = "/private/cache/README.md"
    destination.write_text(json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
    unsafe_build = subprocess.run(
        [
            sys.executable,
            str(runtime_script),
            "--source",
            str(destination),
            "--destination",
            str(runtime_database),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert unsafe_build.returncode != 0
    assert "local cache metadata" in unsafe_build.stderr
