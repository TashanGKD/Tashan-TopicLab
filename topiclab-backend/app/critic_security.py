"""Shared secret minimization and authentication helpers for Critic services."""

from __future__ import annotations

import hashlib
import hmac
import os
import re
from urllib.parse import urlparse


WORKER_TOKEN_CONTEXT = b"topiclab-skillhub-critic-worker-v1"
NPM_PACKAGE_RE = re.compile(
    r"^(?:@[a-z0-9][a-z0-9._~-]*/)?[a-z0-9][a-z0-9._~-]*$",
    re.IGNORECASE,
)


def derive_worker_token(api_key: str | None = None) -> str:
    """Derive a worker-only credential from the single configured provider key."""

    secret = (api_key if api_key is not None else os.environ.get("skillhub_scnet_api_key", "")).strip()
    if not secret:
        return ""
    return hmac.new(secret.encode("utf-8"), WORKER_TOKEN_CONTEXT, hashlib.sha256).hexdigest()


def is_supported_github_target(target: str) -> bool:
    """Accept only an uncredentialed GitHub repository or /tree/ref/subpath URL."""

    try:
        parsed = urlparse(target)
        port = parsed.port
    except ValueError:
        return False
    if (
        parsed.scheme != "https"
        or parsed.hostname != "github.com"
        or parsed.username is not None
        or parsed.password is not None
        or port is not None
        or parsed.query
        or parsed.fragment
    ):
        return False
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) < 2 or any(part in {".", ".."} for part in parts):
        return False
    repository = parts[1][:-4] if parts[1].endswith(".git") else parts[1]
    if not parts[0] or not repository:
        return False
    return len(parts) == 2 or (len(parts) >= 5 and parts[2] == "tree")


def is_supported_npm_package(target: str) -> bool:
    """Reject option-like or path-like npm inputs before invoking the CLI."""

    return len(target) <= 214 and bool(NPM_PACKAGE_RE.fullmatch(target))
