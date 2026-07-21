import json
import subprocess
import sys
from pathlib import Path

import pytest


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPOSITORY_ROOT / "scripts" / "prepare_docker_build_env.py"


def _proxy_env(path: Path) -> None:
    path.write_text(
        "\n".join(
            [
                "APP_SETTING=preserved",
                "HTTP_PROXY=http://host.docker.internal:1081",
                'HTTPS_PROXY="http://host.docker.internal:1081"',
                "http_proxy=http://host.docker.internal:1081",
                "https_proxy=http://host.docker.internal:1081",
                "NO_PROXY=localhost,127.0.0.1",
            ]
        )
        + "\n",
        encoding="utf-8",
    )


def test_prepare_build_env_rewrites_only_host_proxy_alias(tmp_path):
    source = tmp_path / ".env"
    destination = tmp_path / ".env.build"
    _proxy_env(source)

    completed = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--source",
            str(source),
            "--destination",
            str(destination),
            "--gateway",
            "172.17.0.1",
        ],
        capture_output=True,
        text=True,
        check=True,
    )

    assert json.loads(completed.stdout) == {
        "configured_proxy_variables": 4,
        "rewritten_host_aliases": 4,
    }
    value = destination.read_text(encoding="utf-8")
    assert "host.docker.internal" not in value
    assert "HTTP_PROXY=http://172.17.0.1:1081" in value
    assert 'HTTPS_PROXY="http://172.17.0.1:1081"' in value
    assert "APP_SETTING=preserved" in value
    assert "NO_PROXY=localhost,127.0.0.1" in value
    assert destination.stat().st_mode & 0o777 == 0o600


def test_prepare_build_env_rejects_missing_proxy_variants(tmp_path):
    source = tmp_path / ".env"
    destination = tmp_path / ".env.build"
    source.write_text("HTTP_PROXY=http://host.docker.internal:1081\n", encoding="utf-8")

    completed = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--source",
            str(source),
            "--destination",
            str(destination),
            "--gateway",
            "172.17.0.1",
        ],
        capture_output=True,
        text=True,
    )

    assert completed.returncode != 0
    assert "required deployment proxy variables are missing" in completed.stderr
    assert not destination.exists()


def test_deploy_example_contains_complete_build_proxy_contract(tmp_path):
    destination = tmp_path / ".env.build"

    completed = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--source",
            str(REPOSITORY_ROOT / ".env.deploy.example"),
            "--destination",
            str(destination),
            "--gateway",
            "172.17.0.1",
        ],
        capture_output=True,
        text=True,
        check=True,
    )

    assert json.loads(completed.stdout)["configured_proxy_variables"] == 4
    assignments = {
        line.split("=", 1)[0]: line.split("=", 1)[1]
        for line in destination.read_text(encoding="utf-8").splitlines()
        if line.split("=", 1)[0] in {"HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"}
    }
    assert len(assignments) == 4
    assert all("host.docker.internal" not in value for value in assignments.values())


@pytest.mark.parametrize("gateway", ["not-an-ip", "host.docker.internal"])
def test_prepare_build_env_rejects_non_ip_gateway(tmp_path, gateway):
    source = tmp_path / ".env"
    _proxy_env(source)

    completed = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--source",
            str(source),
            "--destination",
            str(tmp_path / ".env.build"),
            "--gateway",
            gateway,
        ],
        capture_output=True,
        text=True,
    )

    assert completed.returncode != 0


def test_build_env_does_not_expose_proxy_values_in_stdout(tmp_path):
    source = tmp_path / ".env"
    destination = tmp_path / ".env.build"
    source.write_text(
        "\n".join(
            f"{name}=http://user:secret@host.docker.internal:1081"
            for name in (
                "HTTP_PROXY",
                "HTTPS_PROXY",
                "http_proxy",
                "https_proxy",
            )
        )
        + "\n",
        encoding="utf-8",
    )

    completed = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--source",
            str(source),
            "--destination",
            str(destination),
            "--gateway",
            "172.17.0.1",
        ],
        capture_output=True,
        text=True,
        check=True,
    )

    assert "secret" not in completed.stdout
    assert "secret" not in completed.stderr
