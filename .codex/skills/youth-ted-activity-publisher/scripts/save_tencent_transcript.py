#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def find_repo_root(start: Path) -> Path:
    current = start.resolve()
    for candidate in [current, *current.parents]:
        if (candidate / ".git").exists() and (candidate / "topiclab-backend").exists():
            return candidate
    raise FileNotFoundError("Could not locate repo root containing .git and topiclab-backend")


def default_mcp_script() -> Path:
    return Path.home() / ".codex" / "skills" / "tencent-meeting-mcp" / "scripts" / "tencent_meeting.py"


def parse_json_or_none(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return None
    return value if isinstance(value, (dict, list)) else None


def extract_trace(raw: dict[str, Any]) -> dict[str, Any]:
    headers = raw.get("headers") if isinstance(raw.get("headers"), dict) else {}
    return {
        "status_code": raw.get("status_code"),
        "x_tc_trace": headers.get("X-Tc-Trace") or headers.get("x-tc-trace"),
        "rpc_uuid": headers.get("rpcUuid") or headers.get("Rpcuuid") or headers.get("rpcuuid"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def iter_text_fragments(value: Any, path: str = ""):
    if isinstance(value, dict):
        text = value.get("text") or value.get("content") or value.get("sentence") or value.get("paragraph")
        if isinstance(text, str) and text.strip():
            speaker = value.get("speaker") or value.get("speaker_name") or value.get("user_name") or value.get("name")
            start = value.get("start_time") or value.get("start") or value.get("begin_time")
            yield {
                "path": path,
                "speaker": speaker if isinstance(speaker, str) else None,
                "start": start,
                "text": text.strip(),
            }
        for key, child in value.items():
            yield from iter_text_fragments(child, f"{path}.{key}" if path else str(key))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from iter_text_fragments(child, f"{path}[{index}]")


def write_transcript_markdown(path: Path, *, slug: str, meeting_id: str | None, record_file_id: str, body: Any) -> int:
    fragments = list(iter_text_fragments(body))
    lines = [
        f"# {slug} transcript",
        "",
        f"- meeting_id: {meeting_id or ''}",
        f"- transcript_record_file_id: {record_file_id}",
        f"- extracted_at: {datetime.now(timezone.utc).isoformat()}",
        f"- paragraph_count_detected: {len(fragments)}",
        "",
    ]
    if not fragments:
        lines.extend(
            [
                "No text fragments were detected automatically. Inspect body.json directly.",
                "",
            ]
        )
    for index, fragment in enumerate(fragments, 1):
        prefix_parts = [str(index)]
        if fragment.get("speaker"):
            prefix_parts.append(str(fragment["speaker"]))
        if fragment.get("start") is not None:
            prefix_parts.append(f"t={fragment['start']}")
        lines.append(f"## {' | '.join(prefix_parts)}")
        lines.append("")
        lines.append(str(fragment["text"]))
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")
    return len(fragments)


def call_tencent_mcp(args: argparse.Namespace) -> dict[str, Any]:
    mcp_script = Path(args.mcp_script).expanduser().resolve()
    if not mcp_script.exists():
        raise FileNotFoundError(f"Tencent Meeting MCP script not found: {mcp_script}")
    arguments: dict[str, Any] = {
        "_client_info": {"os": "macOS", "agent": "Codex", "model": "GPT-5"},
        "record_file_id": args.record_file_id,
        "timezone": args.timezone,
    }
    if args.meeting_id:
        arguments["meeting_id"] = args.meeting_id
    if args.pid is not None:
        arguments["pid"] = args.pid
    if args.limit is not None:
        arguments["limit"] = str(args.limit)

    payload = {"name": "get_transcripts_details", "arguments": arguments}
    completed = subprocess.run(
        [sys.executable, str(mcp_script), "tools/call", json.dumps(payload, ensure_ascii=False)],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return json.loads(completed.stdout)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Save Tencent Meeting transcript response to local Youth TED artifacts.")
    parser.add_argument("--slug", required=True, help="Activity slug, e.g. youth-ted-2026-05-06.")
    parser.add_argument("--record-file-id", required=True, help="Tencent transcript record_file_id.")
    parser.add_argument("--meeting-id", default=None, help="Tencent meeting_id.")
    parser.add_argument("--timezone", default="Asia/Shanghai")
    parser.add_argument("--pid", default=None, help="Optional starting paragraph ID.")
    parser.add_argument("--limit", default=None, help="Optional paragraph count limit.")
    parser.add_argument("--repo-root", default=None)
    parser.add_argument("--output-dir", default=None)
    parser.add_argument("--mcp-script", default=str(default_mcp_script()))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).expanduser().resolve() if args.repo_root else find_repo_root(Path.cwd())
    output_dir = (
        Path(args.output_dir).expanduser().resolve()
        if args.output_dir
        else repo_root / "workspace" / "youth-ted" / "transcripts" / args.slug
    )
    output_dir.mkdir(parents=True, exist_ok=True)

    raw = call_tencent_mcp(args)
    body = parse_json_or_none(raw.get("body"))
    if body is None:
        body = raw.get("body", raw)
    trace = extract_trace(raw)
    trace.update(
        {
            "slug": args.slug,
            "meeting_id": args.meeting_id,
            "record_file_id": args.record_file_id,
            "timezone": args.timezone,
        }
    )

    raw_path = output_dir / "raw_response.json"
    body_path = output_dir / "body.json"
    trace_path = output_dir / "trace.json"
    markdown_path = output_dir / "transcript.md"
    raw_path.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")
    body_path.write_text(json.dumps(body, ensure_ascii=False, indent=2), encoding="utf-8")
    trace_path.write_text(json.dumps(trace, ensure_ascii=False, indent=2), encoding="utf-8")
    paragraph_count = write_transcript_markdown(
        markdown_path,
        slug=args.slug,
        meeting_id=args.meeting_id,
        record_file_id=args.record_file_id,
        body=body,
    )

    print(
        json.dumps(
            {
                "slug": args.slug,
                "output_dir": str(output_dir),
                "raw_response": str(raw_path),
                "body": str(body_path),
                "transcript_markdown": str(markdown_path),
                "trace": str(trace_path),
                "paragraph_count_detected": paragraph_count,
                "x_tc_trace": trace.get("x_tc_trace"),
                "rpc_uuid": trace.get("rpc_uuid"),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
