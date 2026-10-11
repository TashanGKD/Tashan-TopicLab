#!/usr/bin/env python3
"""Verify the locked Research Skills runtime before CI or deployment."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path


REQUIRED_FILES = (
    "skills/find-science-skills/scripts/run_agentscope_critic_provider.py",
    "skills/skill-criticagent/vendor/mcp_criticagent/src/core/skill_validator.py",
    "skills/mcp-criticagent/SKILL.md",
)


def _git(runtime: Path, *args: str) -> str:
    completed = subprocess.run(
        ["git", "-C", str(runtime), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=30,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or "git verification failed")
    return completed.stdout.strip()


def verify_runtime(repository: Path, runtime: Path) -> dict[str, object]:
    revision = (repository / ".critic-research-revision").read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("Critic research revision lock must be a full lowercase SHA")
    if _git(runtime, "rev-parse", "HEAD") != revision:
        raise ValueError("Research Skills checkout does not match the locked revision")
    if _git(runtime, "status", "--porcelain"):
        raise ValueError("Research Skills checkout contains uncommitted changes")

    missing = [relative for relative in REQUIRED_FILES if not (runtime / relative).is_file()]
    if missing:
        raise FileNotFoundError(f"Research Skills runtime is incomplete: {missing}")

    vendor = runtime / "skills" / "skill-criticagent" / "vendor" / "mcp_criticagent"
    manifest = json.loads((vendor / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("schema") != "vendored_mcp_criticagent_kernel_v1":
        raise ValueError("unsupported CriticAgent kernel manifest")
    files = manifest.get("files")
    if not isinstance(files, dict) or not files:
        raise ValueError("CriticAgent kernel manifest has no files")
    for relative, expected in files.items():
        path = vendor / str(relative)
        if not path.is_file():
            raise FileNotFoundError(f"vendored kernel file is missing: {relative}")
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != expected:
            raise ValueError(f"vendored kernel hash mismatch: {relative}")
    return {"revision": revision, "verified_kernel_files": len(files)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--runtime", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(verify_runtime(args.repository.resolve(), args.runtime.resolve()), sort_keys=True))


if __name__ == "__main__":
    main()
