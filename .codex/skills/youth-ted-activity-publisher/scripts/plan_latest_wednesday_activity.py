#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo


DEFAULT_MEETING_CODE = "49237646949"
DEFAULT_TITLE = "他山青年 TED：前沿 AI 进展专场讨论"


def find_repo_root(start: Path) -> Path:
    current = start.resolve()
    for candidate in [current, *current.parents]:
        if (candidate / ".git").exists() and (candidate / "topiclab-backend").exists():
            return candidate
    raise FileNotFoundError("Could not locate repo root containing .git and topiclab-backend")


def parse_now(value: str | None, timezone_name: str) -> datetime:
    tz = ZoneInfo(timezone_name)
    if not value:
        return datetime.now(tz)
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=tz)
    return parsed.astimezone(tz)


def latest_wednesday_event(now: datetime, *, event_hour: int, duration_hours: int, require_ended: bool) -> tuple[datetime, datetime]:
    days_since_wednesday = (now.weekday() - 2) % 7
    event_date = (now - timedelta(days=days_since_wednesday)).date()
    start = datetime.combine(event_date, time(event_hour, 0), tzinfo=now.tzinfo)
    end = start + timedelta(hours=duration_hours)
    cutoff = end if require_ended else start
    if now < cutoff:
        start -= timedelta(days=7)
        end -= timedelta(days=7)
    return start, end


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Plan the latest completed Wednesday 20:00 Youth TED activity.")
    parser.add_argument("--poster", default=None, help="Optional source poster path.")
    parser.add_argument("--now", default=None, help="ISO datetime for deterministic planning.")
    parser.add_argument("--timezone", default="Asia/Shanghai")
    parser.add_argument("--event-hour", type=int, default=20)
    parser.add_argument("--duration-hours", type=int, default=3)
    parser.add_argument("--meeting-code", default=DEFAULT_MEETING_CODE)
    parser.add_argument("--title", default=DEFAULT_TITLE)
    parser.add_argument("--label", default="往期回顾")
    parser.add_argument("--repo-root", default=None)
    parser.add_argument("--allow-in-progress", action="store_true", help="Use this Wednesday once 20:00 has started, even before the expected end time.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not 0 <= args.event_hour <= 23:
        raise ValueError("--event-hour must be between 0 and 23")
    if args.duration_hours <= 0:
        raise ValueError("--duration-hours must be positive")

    repo_root = Path(args.repo_root).expanduser().resolve() if args.repo_root else find_repo_root(Path.cwd())
    now = parse_now(args.now, args.timezone)
    start, end = latest_wednesday_event(
        now,
        event_hour=args.event_hour,
        duration_hours=args.duration_hours,
        require_ended=not args.allow_in_progress,
    )
    slug = f"youth-ted-{start:%Y-%m-%d}"
    transcript_dir = repo_root / "workspace" / "youth-ted" / "transcripts" / slug
    content_json = repo_root / "workspace" / "youth-ted" / "content" / f"{slug}.content.json"
    webp_out = repo_root / "workspace" / "youth-ted" / "posters" / f"{slug}.webp"
    query_start = start - timedelta(minutes=30)
    query_end = end + timedelta(minutes=45)
    poster = str(Path(args.poster).expanduser().resolve()) if args.poster else None

    payload = {
        "slug": slug,
        "label": args.label,
        "title": args.title,
        "meta": f"{start:%Y-%m-%d} 周三 {start:%H:%M}-{end:%H:%M}",
        "event": {
            "timezone": args.timezone,
            "started_at": start.isoformat(),
            "ended_at": end.isoformat(),
            "query_start": query_start.isoformat(),
            "query_end": query_end.isoformat(),
            "meeting_code": args.meeting_code,
        },
        "artifacts": {
            "poster": poster,
            "webp_out": str(webp_out),
            "transcript_dir": str(transcript_dir),
            "content_json": str(content_json),
        },
        "suggested_commands": {
            "find_ended_meeting": {
                "tool": "get_user_ended_meetings",
                "arguments": {
                    "start_time": query_start.isoformat(),
                    "end_time": query_end.isoformat(),
                    "page_size": 10,
                    "page_number": 1,
                },
            },
            "find_records": {
                "tool": "get_records_list",
                "arguments": {
                    "meeting_code": args.meeting_code,
                    "start_time": query_start.isoformat(),
                    "end_time": query_end.isoformat(),
                    "page_size": 20,
                    "page_number": 1,
                },
            },
            "save_transcript_template": (
                "topiclab-backend/.venv/bin/python "
                ".codex/skills/youth-ted-activity-publisher/scripts/save_tencent_transcript.py "
                f"--slug {slug} --meeting-id <meeting_id> --record-file-id <transcript_record_file_id>"
            ),
            "upsert_template": (
                "topiclab-backend/.venv/bin/python "
                ".codex/skills/youth-ted-activity-publisher/scripts/upsert_youth_ted_activity.py "
                f"--slug {slug} --poster {poster or '<poster_path>'} --webp-out {webp_out} "
                f"--label {args.label} --title \"{args.title}\" --meta \"{start:%Y-%m-%d} 周三 {start:%H:%M}-{end:%H:%M}\" "
                "--summary \"<one_sentence_summary>\" "
                f"--content-json {content_json} --sort-order <newest_first_sort_order>"
            ),
        },
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
