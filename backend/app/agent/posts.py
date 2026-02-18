"""Topic posts: file-backed persistence for human and agent posts."""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)


def _posts_dir(ws_path: Path) -> Path:
    d = ws_path / "posts"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _filename(created_at: str, post_id: str) -> str:
    """Derive a sortable filename from ISO timestamp + uuid."""
    safe_ts = created_at.replace(":", "-").replace("+", "p")
    return f"{safe_ts}_{post_id}.json"


def save_post(ws_path: Path, post: dict) -> Path:
    """Write a post dict to posts/{timestamp}_{uuid}.json. Returns file path."""
    posts_dir = _posts_dir(ws_path)
    filename = _filename(post["created_at"], post["id"])
    path = posts_dir / filename
    path.write_text(json.dumps(post, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info(f"Saved post {post['id']} to {path}")
    return path


def load_posts(ws_path: Path) -> list[dict]:
    """Load all posts from posts/ directory, sorted by created_at ascending."""
    posts_dir = ws_path / "posts"
    if not posts_dir.exists():
        return []
    posts = []
    for f in sorted(posts_dir.glob("*.json")):
        try:
            posts.append(json.loads(f.read_text(encoding="utf-8")))
        except Exception as e:
            logger.warning(f"Failed to load post file {f}: {e}")
    return posts


def load_post(ws_path: Path, post_id: str) -> dict | None:
    """Load a single post by id (scans posts/ directory)."""
    posts_dir = ws_path / "posts"
    if not posts_dir.exists():
        return None
    for f in posts_dir.glob(f"*_{post_id}.json"):
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


def make_post(
    topic_id: str,
    author: str,
    author_type: str,
    body: str,
    expert_name: str | None = None,
    expert_label: str | None = None,
    in_reply_to_id: str | None = None,
    status: str = "completed",
) -> dict:
    """Build a new post dict (not yet saved to disk)."""
    mentions = re.findall(r"@(\w+)", body)
    return {
        "id": str(uuid.uuid4()),
        "topic_id": topic_id,
        "author": author,
        "author_type": author_type,
        "expert_name": expert_name,
        "expert_label": expert_label,
        "body": body,
        "mentions": mentions,
        "in_reply_to_id": in_reply_to_id,
        "status": status,           # "pending" | "completed" | "failed"
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
