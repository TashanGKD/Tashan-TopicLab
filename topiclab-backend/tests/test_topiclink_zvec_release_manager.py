import base64
import hashlib
import hmac
import io
import json
import sys
import zipfile
from pathlib import Path

import pytest


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

import scripts.topiclink_zvec_release as release_manager  # noqa: E402
from scripts.topiclink_zvec_release import (  # noqa: E402
    OssCredentials,
    activate_release,
    active_resolved_path,
    build_oss_get_request,
    build_release_paths,
    download_archive,
    load_release_spec,
    load_oss_credentials,
    prepare_release,
)


COLLECTION_DIR = "qwen3-embedding-8b-4096"


def _write_archive(path: Path, *, traversal: bool = False) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        bundle.writestr(f"{COLLECTION_DIR}/manifest.3", "manifest")
        bundle.writestr(f"{COLLECTION_DIR}/0/embedding.index", "vectors")
        if traversal:
            bundle.writestr("../escaped.txt", "unsafe")


def _write_lock(path: Path, archive: Path, *, digest: str | None = None) -> None:
    checksum = digest or hashlib.sha256(archive.read_bytes()).hexdigest()
    path.write_text(
        json.dumps(
            {
                "schema_version": 2,
                "version": "20260717",
                "storage": "aliyun-oss",
                "object_key": f"topiclink-zvec/releases/20260717/{archive.name}",
                "asset": archive.name,
                "sha256": checksum,
                "collection_dir": COLLECTION_DIR,
                "min_doc_count": 2386,
                "expected_dimensions": 4096,
            }
        ),
        encoding="utf-8",
    )


def _oss_credentials() -> OssCredentials:
    return OssCredentials(
        access_key_id="test-access-key-id",
        access_key_secret="test-access-key-secret",
        bucket="test-bucket",
        endpoint="https://oss-cn-beijing.aliyuncs.com",
    )


def test_prepares_and_atomically_activates_release_while_preserving_legacy(tmp_path):
    archive = tmp_path / "topiclink-zvec-qwen3-embedding-8b-4096-20260717.zip"
    lock = tmp_path / "topiclink-zvec.lock.json"
    workspace = tmp_path / "workspace"
    _write_archive(archive)
    _write_lock(lock, archive)

    spec = load_release_spec(lock)
    paths = build_release_paths(workspace, spec)
    legacy = paths.active_collection
    legacy.mkdir(parents=True)
    (legacy / "manifest.1").write_text("legacy", encoding="utf-8")

    prepared = prepare_release(spec, paths, archive_override=archive)
    marker = activate_release(spec, paths)

    assert prepared == paths.release_collection
    assert (prepared / "manifest.3").is_file()
    assert paths.active_collection.is_symlink()
    assert active_resolved_path(paths) == str(paths.release_collection)
    assert marker["version"] == "20260717"
    assert Path(str(marker["legacy_path"]), "manifest.1").read_text(encoding="utf-8") == "legacy"
    installed = json.loads(paths.installed_marker.read_text(encoding="utf-8"))
    assert installed["sha256"] == spec.sha256

    assert prepare_release(spec, paths, archive_override=archive) == paths.release_collection
    activate_release(spec, paths)
    assert paths.active_collection.resolve() == paths.release_collection


def test_rejects_archive_with_wrong_checksum(tmp_path):
    archive = tmp_path / "topiclink-zvec-qwen3-embedding-8b-4096-20260717.zip"
    lock = tmp_path / "topiclink-zvec.lock.json"
    _write_archive(archive)
    _write_lock(lock, archive, digest="0" * 64)
    spec = load_release_spec(lock)

    with pytest.raises(RuntimeError, match="SHA-256 mismatch"):
        prepare_release(
            spec,
            build_release_paths(tmp_path / "workspace", spec),
            archive_override=archive,
        )


def test_activation_restores_legacy_directory_if_symlink_creation_fails(
    tmp_path, monkeypatch
):
    archive = tmp_path / "topiclink-zvec-qwen3-embedding-8b-4096-20260717.zip"
    lock = tmp_path / "topiclink-zvec.lock.json"
    _write_archive(archive)
    _write_lock(lock, archive)
    spec = load_release_spec(lock)
    paths = build_release_paths(tmp_path / "workspace", spec)
    prepare_release(spec, paths, archive_override=archive)
    paths.active_collection.mkdir(parents=True)
    legacy_manifest = paths.active_collection / "manifest.1"
    legacy_manifest.write_text("legacy", encoding="utf-8")

    def fail_symlink(*_args, **_kwargs):
        raise OSError("simulated symlink failure")

    monkeypatch.setattr(release_manager.os, "symlink", fail_symlink)
    with pytest.raises(OSError, match="simulated symlink failure"):
        activate_release(spec, paths)

    assert paths.active_collection.is_dir()
    assert not paths.active_collection.is_symlink()
    assert legacy_manifest.read_text(encoding="utf-8") == "legacy"


def test_rejects_archive_path_traversal(tmp_path):
    archive = tmp_path / "topiclink-zvec-qwen3-embedding-8b-4096-20260717.zip"
    lock = tmp_path / "topiclink-zvec.lock.json"
    _write_archive(archive, traversal=True)
    _write_lock(lock, archive)
    spec = load_release_spec(lock)

    with pytest.raises(RuntimeError, match="unsafe archive member"):
        prepare_release(
            spec,
            build_release_paths(tmp_path / "workspace", spec),
            archive_override=archive,
        )
    assert not (tmp_path / "escaped.txt").exists()


def test_builds_authenticated_private_oss_request(tmp_path):
    archive = tmp_path / "topiclink-zvec-qwen3-embedding-8b-4096-20260717.zip"
    lock = tmp_path / "topiclink-zvec.lock.json"
    _write_archive(archive)
    _write_lock(lock, archive)
    spec = load_release_spec(lock)
    credentials = _oss_credentials()
    request_date = "Sat, 18 Jul 2026 14:00:00 GMT"

    request = build_oss_get_request(spec, credentials, request_date=request_date)

    string_to_sign = (
        f"GET\n\n\n{request_date}\n"
        f"/{credentials.bucket}/{spec.object_key}"
    )
    signature = base64.b64encode(
        hmac.new(
            credentials.access_key_secret.encode(),
            string_to_sign.encode(),
            hashlib.sha1,
        ).digest()
    ).decode()
    assert request.full_url == (
        "https://test-bucket.oss-cn-beijing.aliyuncs.com/"
        f"{spec.object_key}"
    )
    assert request.get_header("Authorization") == (
        f"OSS {credentials.access_key_id}:{signature}"
    )
    assert credentials.access_key_secret not in request.full_url


def test_downloads_private_oss_archive_and_verifies_checksum(tmp_path, monkeypatch):
    archive = tmp_path / "topiclink-zvec-qwen3-embedding-8b-4096-20260717.zip"
    lock = tmp_path / "topiclink-zvec.lock.json"
    destination = tmp_path / "downloads" / archive.name
    _write_archive(archive)
    _write_lock(lock, archive)
    payload = archive.read_bytes()
    spec = load_release_spec(lock)
    requests = []

    class FakeResponse(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            self.close()

    def fake_urlopen(request, *, timeout):
        requests.append((request, timeout))
        return FakeResponse(payload)

    monkeypatch.setattr(release_manager.urllib.request, "urlopen", fake_urlopen)

    assert download_archive(spec, destination, _oss_credentials()) is True
    assert destination.read_bytes() == payload
    assert requests[0][0].get_header("Authorization").startswith(
        "OSS test-access-key-id:"
    )
    assert requests[0][1] == 120


def test_loads_private_oss_credentials_from_env_file(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            [
                "OSS_ACCESS_KEY_ID=test-id",
                "OSS_ACCESS_KEY_SECRET='test-secret'",
                "OSS_BUCKET=test-bucket",
                "OSS_ENDPOINT=https://oss-cn-beijing.aliyuncs.com",
            ]
        ),
        encoding="utf-8",
    )
    for name in (
        "OSS_ACCESS_KEY_ID",
        "OSS_ACCESS_KEY_SECRET",
        "OSS_BUCKET",
        "OSS_ENDPOINT",
        "OSS_SECURITY_TOKEN",
    ):
        monkeypatch.delenv(name, raising=False)

    credentials = load_oss_credentials(env_file)

    assert credentials.access_key_id == "test-id"
    assert credentials.access_key_secret == "test-secret"
    assert credentials.bucket == "test-bucket"


def test_rejects_unsafe_oss_object_key(tmp_path):
    archive = tmp_path / "topiclink-zvec-qwen3-embedding-8b-4096-20260717.zip"
    lock = tmp_path / "topiclink-zvec.lock.json"
    _write_archive(archive)
    _write_lock(lock, archive)
    payload = json.loads(lock.read_text(encoding="utf-8"))
    payload["object_key"] = f"../{archive.name}"
    lock.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(ValueError, match="safe relative OSS path"):
        load_release_spec(lock)


def test_deploy_validates_candidate_before_activation_and_restart():
    workflow = (REPOSITORY_ROOT / ".github" / "workflows" / "deploy.yml").read_text(
        encoding="utf-8"
    )

    prepare = workflow.index('"$ZVEC_MANAGER" prepare')
    validate = workflow.index("validate_topiclink_zvec_collection.py")
    stop_writer = workflow.index("docker compose stop -t 30 topiclink-zvec")
    activate = workflow.index('"$ZVEC_MANAGER" activate')
    restart = workflow.index("docker compose down")

    assert prepare < validate < stop_writer < activate < restart
    assert "topiclink-zvec.lock.json" in workflow
    assert '--env-file "$REPO_DIR/.env"' in workflow
    assert "--kind active-resolved" in workflow
    assert "docker compose start topiclink-zvec || true" in workflow
