#!/usr/bin/env python3
"""Prepare a Docker build env whose host proxy is reachable from Linux BuildKit."""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
from pathlib import Path
from urllib.parse import SplitResult, urlsplit, urlunsplit


PROXY_KEYS = ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy")
HOST_ALIAS = "host.docker.internal"


def _replace_proxy_host(value: str, gateway: str) -> tuple[str, bool]:
    quote = value[:1] if value[:1] in {"'", '"'} and value[-1:] == value[:1] else ""
    unquoted = value[1:-1] if quote else value
    parsed = urlsplit(unquoted)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("proxy values must be absolute HTTP(S) URLs")
    if parsed.hostname.casefold() != HOST_ALIAS:
        return value, False

    host = f"[{gateway}]" if ":" in gateway else gateway
    userinfo, separator, host_port = parsed.netloc.rpartition("@")
    replacement = host_port.replace(parsed.hostname, host, 1)
    netloc = f"{userinfo}{separator}{replacement}" if separator else replacement
    rewritten = urlunsplit(
        SplitResult(parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment)
    )
    return f"{quote}{rewritten}{quote}" if quote else rewritten, True


def prepare_build_env(source: Path, destination: Path, gateway: str) -> dict[str, object]:
    ipaddress.ip_address(gateway)
    lines = source.read_text(encoding="utf-8").splitlines()
    configured: set[str] = set()
    rewritten: set[str] = set()
    output: list[str] = []

    for raw_line in lines:
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#") or "=" not in raw_line:
            output.append(raw_line)
            continue
        key_part, value_part = raw_line.split("=", 1)
        key = key_part.strip()
        if key not in PROXY_KEYS:
            output.append(raw_line)
            continue
        if not value_part.strip():
            output.append(raw_line)
            continue
        configured.add(key)
        leading = value_part[: len(value_part) - len(value_part.lstrip())]
        trailing = value_part[len(value_part.rstrip()) :]
        replacement, changed = _replace_proxy_host(value_part.strip(), gateway)
        if changed:
            rewritten.add(key)
        output.append(f"{key_part}={leading}{replacement}{trailing}")

    missing = sorted(set(PROXY_KEYS) - configured)
    if missing:
        raise ValueError(f"required deployment proxy variables are missing: {', '.join(missing)}")

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text("\n".join(output) + "\n", encoding="utf-8")
    os.chmod(destination, 0o600)
    return {
        "configured_proxy_variables": len(configured),
        "rewritten_host_aliases": len(rewritten),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--gateway", required=True)
    args = parser.parse_args()
    result = prepare_build_env(args.source, args.destination, args.gateway)
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
