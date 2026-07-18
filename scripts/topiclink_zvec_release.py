#!/usr/bin/env python3
"""Download, stage, and atomically activate a TopicLink Zvec artifact."""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import re
import shutil
import stat
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import formatdate
from pathlib import Path, PurePosixPath


SAFE_COMPONENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
SAFE_BUCKET = re.compile(r"^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
LOCK_KEYS = {
    "schema_version",
    "version",
    "storage",
    "object_key",
    "asset",
    "sha256",
    "collection_dir",
    "min_doc_count",
    "expected_dimensions",
}


def log(message: str) -> None:
    print(f"[topiclink-zvec] {message}", file=sys.stderr, flush=True)


@dataclass(frozen=True)
class ReleaseSpec:
    version: str
    storage: str
    object_key: str
    asset: str
    sha256: str
    collection_dir: str
    min_doc_count: int
    expected_dimensions: int

    def metadata(self) -> dict[str, object]:
        return {
            "schema_version": 2,
            "version": self.version,
            "storage": self.storage,
            "object_key": self.object_key,
            "asset": self.asset,
            "sha256": self.sha256,
            "collection_dir": self.collection_dir,
            "min_doc_count": self.min_doc_count,
            "expected_dimensions": self.expected_dimensions,
        }


@dataclass(frozen=True)
class OssCredentials:
    access_key_id: str
    access_key_secret: str
    bucket: str
    endpoint: str
    security_token: str = ""


@dataclass(frozen=True)
class ReleasePaths:
    workspace: Path
    package_root: Path
    releases_root: Path
    release_root: Path
    release_collection: Path
    active_collection: Path
    archive: Path
    installed_marker: Path
    container_collection: PurePosixPath


def _required_string(payload: dict[str, object], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"{key} must be a non-empty string")
    return value


def _required_positive_int(payload: dict[str, object], key: str) -> int:
    value = payload.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ValueError(f"{key} must be a positive integer")
    return value


def load_release_spec(lock_path: Path) -> ReleaseSpec:
    payload = json.loads(lock_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("release lock must contain a JSON object")
    unknown = set(payload) - LOCK_KEYS
    missing = LOCK_KEYS - set(payload)
    if unknown:
        raise ValueError(f"unknown release lock keys: {', '.join(sorted(unknown))}")
    if missing:
        raise ValueError(f"missing release lock keys: {', '.join(sorted(missing))}")
    if payload.get("schema_version") != 2:
        raise ValueError("schema_version must be 2")

    version = _required_string(payload, "version")
    storage = _required_string(payload, "storage")
    object_key = _required_string(payload, "object_key")
    asset = _required_string(payload, "asset")
    digest = _required_string(payload, "sha256").lower()
    collection_dir = _required_string(payload, "collection_dir")

    for key, value in (
        ("version", version),
        ("asset", asset),
        ("collection_dir", collection_dir),
    ):
        if not SAFE_COMPONENT.fullmatch(value):
            raise ValueError(f"{key} contains unsafe characters")
    if storage != "aliyun-oss":
        raise ValueError("storage must be aliyun-oss")
    object_path = PurePosixPath(object_key)
    if (
        not object_key
        or object_key.startswith("/")
        or "\\" in object_key
        or any(part in {"", ".", ".."} for part in object_key.split("/"))
        or object_path.name != asset
    ):
        raise ValueError("object_key must be a safe relative OSS path ending in asset")
    if not asset.endswith(".zip"):
        raise ValueError("asset must be a .zip file")
    if not SHA256.fullmatch(digest):
        raise ValueError("sha256 must contain exactly 64 lower-case hex characters")

    return ReleaseSpec(
        version=version,
        storage=storage,
        object_key=object_key,
        asset=asset,
        sha256=digest,
        collection_dir=collection_dir,
        min_doc_count=_required_positive_int(payload, "min_doc_count"),
        expected_dimensions=_required_positive_int(payload, "expected_dimensions"),
    )


def _read_env_file(path: Path | None) -> dict[str, str]:
    if path is None:
        return {}
    values: dict[str, str] = {}
    lines = path.expanduser().resolve(strict=True).read_text(encoding="utf-8").splitlines()
    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, separator, value = line.partition("=")
        key = key.strip()
        if not separator or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value
    return values


def load_oss_credentials(env_file: Path | None = None) -> OssCredentials:
    values = _read_env_file(env_file)

    def required(name: str) -> str:
        value = (os.getenv(name) or values.get(name) or "").strip()
        if not value:
            raise ValueError(f"{name} is required for private OSS download")
        return value

    bucket = required("OSS_BUCKET")
    if not SAFE_BUCKET.fullmatch(bucket):
        raise ValueError("OSS_BUCKET is not a valid bucket name")
    return OssCredentials(
        access_key_id=required("OSS_ACCESS_KEY_ID"),
        access_key_secret=required("OSS_ACCESS_KEY_SECRET"),
        bucket=bucket,
        endpoint=required("OSS_ENDPOINT"),
        security_token=(
            os.getenv("OSS_SECURITY_TOKEN")
            or values.get("OSS_SECURITY_TOKEN")
            or ""
        ).strip(),
    )


def _oss_object_url(credentials: OssCredentials, object_key: str) -> str:
    endpoint = credentials.endpoint.strip()
    if "://" not in endpoint:
        endpoint = f"https://{endpoint}"
    parsed = urllib.parse.urlsplit(endpoint)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(
            "OSS_ENDPOINT must be an HTTP(S) endpoint without a path or credentials"
        )
    hostname = parsed.hostname
    if hostname != credentials.bucket and not hostname.startswith(f"{credentials.bucket}."):
        hostname = f"{credentials.bucket}.{hostname}"
    if parsed.port:
        hostname = f"{hostname}:{parsed.port}"
    quoted_key = urllib.parse.quote(object_key, safe="/~-._")
    return urllib.parse.urlunsplit((parsed.scheme, hostname, f"/{quoted_key}", "", ""))


def build_oss_get_request(
    spec: ReleaseSpec,
    credentials: OssCredentials,
    *,
    request_date: str | None = None,
) -> urllib.request.Request:
    date_header = request_date or formatdate(timeval=None, localtime=False, usegmt=True)
    headers = {
        "Accept": "application/octet-stream",
        "Date": date_header,
        "User-Agent": "TopicLab-Deploy/2.0",
    }
    canonical_headers = ""
    if credentials.security_token:
        headers["x-oss-security-token"] = credentials.security_token
        canonical_headers = f"x-oss-security-token:{credentials.security_token}\n"
    canonical_resource = f"/{credentials.bucket}/{spec.object_key}"
    string_to_sign = f"GET\n\n\n{date_header}\n{canonical_headers}{canonical_resource}"
    signature = base64.b64encode(
        hmac.new(
            credentials.access_key_secret.encode("utf-8"),
            string_to_sign.encode("utf-8"),
            hashlib.sha1,
        ).digest()
    ).decode("ascii")
    headers["Authorization"] = f"OSS {credentials.access_key_id}:{signature}"
    return urllib.request.Request(
        _oss_object_url(credentials, spec.object_key),
        headers=headers,
        method="GET",
    )


def build_release_paths(workspace: Path, spec: ReleaseSpec) -> ReleasePaths:
    resolved_workspace = workspace.expanduser().resolve(strict=False)
    package_root = resolved_workspace / "topiclink-zvec"
    releases_root = package_root / ".releases"
    release_root = releases_root / spec.version
    return ReleasePaths(
        workspace=resolved_workspace,
        package_root=package_root,
        releases_root=releases_root,
        release_root=release_root,
        release_collection=release_root / spec.collection_dir,
        active_collection=package_root / spec.collection_dir,
        archive=package_root / ".downloads" / spec.asset,
        installed_marker=package_root / ".installed-release.json",
        container_collection=(
            PurePosixPath("/app/workspace/topiclink-zvec/.releases")
            / spec.version
            / spec.collection_dir
        ),
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_checksum(path: Path, expected: str) -> None:
    actual = sha256_file(path)
    if actual != expected:
        raise RuntimeError(f"SHA-256 mismatch for {path.name}: expected {expected}, got {actual}")


def download_archive(
    spec: ReleaseSpec,
    destination: Path,
    credentials: OssCredentials,
) -> bool:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_file():
        try:
            verify_checksum(destination, spec.sha256)
            log(f"using cached archive {destination}")
            return False
        except RuntimeError:
            destination.unlink()

    part = destination.with_name(f".{destination.name}.part-{os.getpid()}-{uuid.uuid4().hex}")
    try:
        for attempt in range(1, 4):
            try:
                request = build_oss_get_request(spec, credentials)
                log(f"downloading private OSS object {spec.object_key} (attempt {attempt}/3)")
                with (
                    urllib.request.urlopen(request, timeout=120) as response,
                    part.open("wb") as handle,
                ):
                    shutil.copyfileobj(response, handle, length=1024 * 1024)
                verify_checksum(part, spec.sha256)
                os.replace(part, destination)
                log(f"downloaded and verified {destination}")
                return True
            except (OSError, urllib.error.URLError, RuntimeError) as exc:
                part.unlink(missing_ok=True)
                if attempt == 3:
                    if isinstance(exc, urllib.error.HTTPError):
                        detail = f"OSS returned HTTP {exc.code}"
                    elif isinstance(exc, urllib.error.URLError):
                        detail = f"OSS request failed ({type(exc.reason).__name__})"
                    else:
                        detail = str(exc)
                    raise RuntimeError(f"could not download verified OSS asset: {detail}") from exc
                time.sleep(attempt * 5)
    finally:
        part.unlink(missing_ok=True)
    raise AssertionError("download retry loop ended unexpectedly")


def validate_archive(archive: Path, collection_dir: str) -> None:
    manifest_found = False
    with zipfile.ZipFile(archive) as bundle:
        members = bundle.infolist()
        if not members:
            raise RuntimeError("release archive is empty")
        for member in members:
            name = member.filename
            path = PurePosixPath(name)
            if not name or name.startswith("/") or "\\" in name or ".." in path.parts:
                raise RuntimeError(f"unsafe archive member: {name!r}")
            if not path.parts or path.parts[0] != collection_dir:
                raise RuntimeError(f"archive member is outside {collection_dir}/: {name!r}")
            mode = (member.external_attr >> 16) & 0xFFFF
            if stat.S_ISLNK(mode):
                raise RuntimeError(f"archive symlinks are not allowed: {name!r}")
            if (
                len(path.parts) == 2
                and path.parts[1].startswith("manifest.")
                and not member.is_dir()
            ):
                manifest_found = True
        if not manifest_found:
            raise RuntimeError(f"archive does not contain {collection_dir}/manifest.*")
        corrupt_member = bundle.testzip()
        if corrupt_member is not None:
            raise RuntimeError(f"archive CRC check failed for {corrupt_member!r}")
def _metadata_matches(path: Path, spec: ReleaseSpec) -> bool:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return payload == spec.metadata()


def release_is_prepared(spec: ReleaseSpec, paths: ReleasePaths) -> bool:
    metadata = paths.release_root / ".topiclink-zvec-release.json"
    manifests = list(paths.release_collection.glob("manifest.*"))
    return (
        paths.release_collection.is_dir()
        and bool(manifests)
        and _metadata_matches(metadata, spec)
    )


def prepare_from_archive(spec: ReleaseSpec, paths: ReleasePaths, archive: Path) -> Path:
    verify_checksum(archive, spec.sha256)
    validate_archive(archive, spec.collection_dir)
    if release_is_prepared(spec, paths):
        log(f"release {spec.version} is already prepared")
        return paths.release_collection

    paths.releases_root.mkdir(parents=True, exist_ok=True)
    staging = paths.releases_root / f".staging-{spec.version}-{uuid.uuid4().hex}"
    quarantine: Path | None = None
    try:
        staging.mkdir()
        with zipfile.ZipFile(archive) as bundle:
            bundle.extractall(staging)
        manifests = list((staging / spec.collection_dir).glob("manifest.*"))
        if not manifests:
            raise RuntimeError(f"extracted release has no {spec.collection_dir}/manifest.*")
        metadata_path = staging / ".topiclink-zvec-release.json"
        metadata_path.write_text(
            json.dumps(spec.metadata(), ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        if paths.release_root.exists() or paths.release_root.is_symlink():
            quarantine = paths.releases_root / (
                f".invalid-{spec.version}-{int(time.time())}-{uuid.uuid4().hex}"
            )
            os.replace(paths.release_root, quarantine)
        os.replace(staging, paths.release_root)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        if quarantine is not None and not paths.release_root.exists():
            os.replace(quarantine, paths.release_root)
        raise

    if quarantine is not None:
        shutil.rmtree(quarantine, ignore_errors=True)
    log(f"prepared release {spec.version} at {paths.release_collection}")
    return paths.release_collection


def prepare_release(
    spec: ReleaseSpec,
    paths: ReleasePaths,
    *,
    archive_override: Path | None = None,
    oss_credentials: OssCredentials | None = None,
) -> Path:
    paths.package_root.mkdir(parents=True, exist_ok=True)
    if archive_override is None:
        if oss_credentials is None:
            raise ValueError("OSS credentials are required when no local archive is provided")
        download_archive(spec, paths.archive, oss_credentials)
        archive = paths.archive
    else:
        archive = archive_override.expanduser().resolve(strict=True)
    return prepare_from_archive(spec, paths, archive)


def active_resolved_path(paths: ReleasePaths) -> str:
    if not os.path.lexists(paths.active_collection):
        return ""
    return str(paths.active_collection.resolve(strict=False))


def activate_release(spec: ReleaseSpec, paths: ReleasePaths) -> dict[str, object]:
    if not release_is_prepared(spec, paths):
        raise RuntimeError(f"release {spec.version} is not prepared")

    paths.package_root.mkdir(parents=True, exist_ok=True)
    legacy_path: Path | None = None
    if os.path.lexists(paths.active_collection) and not paths.active_collection.is_symlink():
        legacy_root = paths.package_root / ".legacy" / (
            f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
        )
        legacy_root.mkdir(parents=True)
        legacy_path = legacy_root / spec.collection_dir
        os.replace(paths.active_collection, legacy_path)
        log(f"preserved legacy collection at {legacy_path}")

    relative_target = os.path.relpath(paths.release_collection, start=paths.package_root)
    next_link = paths.package_root / f".{spec.collection_dir}.next-{uuid.uuid4().hex}"
    next_marker = paths.package_root / (
        f".installed-release.next-{uuid.uuid4().hex}.json"
    )
    marker_payload: dict[str, object] = {
        **spec.metadata(),
        "activated_at": datetime.now(timezone.utc).isoformat(),
        "active_path": str(paths.active_collection),
    }
    if legacy_path is not None:
        marker_payload["legacy_path"] = str(legacy_path)

    try:
        os.symlink(relative_target, next_link, target_is_directory=True)
        next_marker.write_text(
            json.dumps(marker_payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        os.replace(next_link, paths.active_collection)
        os.replace(next_marker, paths.installed_marker)
    except Exception:
        if legacy_path is not None and not os.path.lexists(paths.active_collection):
            os.replace(legacy_path, paths.active_collection)
        raise
    finally:
        next_link.unlink(missing_ok=True)
        next_marker.unlink(missing_ok=True)

    log(f"activated release {spec.version} at {paths.active_collection}")
    return marker_payload


def _add_common_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--lock", required=True, type=Path)
    parser.add_argument("--workspace", required=True, type=Path)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare = subparsers.add_parser("prepare", help="download and extract the locked release")
    _add_common_arguments(prepare)
    prepare.add_argument("--archive", type=Path, help="use a local archive instead of downloading")
    prepare.add_argument(
        "--env-file",
        type=Path,
        help="read OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_BUCKET, and OSS_ENDPOINT",
    )

    activate = subparsers.add_parser(
        "activate", help="atomically point the runtime path at the release"
    )
    _add_common_arguments(activate)

    path = subparsers.add_parser("path", help="print one resolved release path")
    _add_common_arguments(path)
    path.add_argument(
        "--kind",
        required=True,
        choices=("release-host", "release-container", "active-host", "active-resolved", "archive"),
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        spec = load_release_spec(args.lock.expanduser().resolve(strict=True))
        paths = build_release_paths(args.workspace, spec)
        if args.command == "prepare":
            credentials = None if args.archive else load_oss_credentials(args.env_file)
            prepared = prepare_release(
                spec,
                paths,
                archive_override=args.archive,
                oss_credentials=credentials,
            )
            print(json.dumps({"status": "prepared", "path": str(prepared)}, sort_keys=True))
        elif args.command == "activate":
            print(json.dumps(activate_release(spec, paths), ensure_ascii=False, sort_keys=True))
        elif args.kind == "release-host":
            print(paths.release_collection)
        elif args.kind == "release-container":
            print(paths.container_collection)
        elif args.kind == "active-host":
            print(paths.active_collection)
        elif args.kind == "active-resolved":
            print(active_resolved_path(paths))
        elif args.kind == "archive":
            print(paths.archive)
        else:
            raise AssertionError(f"unsupported path kind: {args.kind}")
    except Exception as exc:
        print(f"::error::TopicLink Zvec release {args.command} failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
