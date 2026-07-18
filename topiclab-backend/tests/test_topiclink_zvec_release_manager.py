import hashlib
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
    activate_release,
    active_resolved_path,
    build_release_paths,
    load_release_spec,
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
                "schema_version": 1,
                "version": "20260717",
                "repository": "TashanGKD/Tashan-TopicLab",
                "release_tag": "topiclink-zvec-20260717",
                "asset": archive.name,
                "sha256": checksum,
                "collection_dir": COLLECTION_DIR,
                "min_doc_count": 2386,
                "expected_dimensions": 4096,
            }
        ),
        encoding="utf-8",
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
    assert "--kind active-resolved" in workflow
    assert "docker compose start topiclink-zvec || true" in workflow
