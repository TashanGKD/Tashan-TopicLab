from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def _compose_build_sections(compose: str) -> list[str]:
    sections = []
    for service in (
        "topiclab-backend",
        "skillhub-critic-worker",
        "topiclink-zvec",
        "backend",
        "frontend",
        "clawarcade-reviewer",
        "topiclab-cli-runner",
    ):
        block = compose.split(f"  {service}:", 1)[1]
        sections.append(block.split("\n  ", 1)[0].split("    env_file:", 1)[0])
    return sections


def test_compose_builds_use_domestic_mirrors_without_proxy_arguments():
    compose = (REPOSITORY_ROOT / "docker-compose.yml").read_text(encoding="utf-8")

    assert "x-build-proxy-args" not in compose
    assert "*build-proxy-args" not in compose
    for build_section in _compose_build_sections(compose):
        assert "HTTP_PROXY:" not in build_section
        assert "HTTPS_PROXY:" not in build_section
        assert "http_proxy:" not in build_section
        assert "https_proxy:" not in build_section

    assert compose.count("APT_MIRROR: ${APT_MIRROR:-http://mirrors.aliyun.com/debian}") == 4
    assert compose.count("PIP_INDEX_URL: ${PIP_INDEX_URL:-https://mirrors.aliyun.com/pypi/simple/}") == 5
    assert compose.count("NPM_REGISTRY: ${NPM_REGISTRY:-https://registry.npmmirror.com}") == 3


def test_deploy_example_uses_domestic_build_mirrors():
    example = (REPOSITORY_ROOT / ".env.deploy.example").read_text(encoding="utf-8")
    assignments = {
        line.split("=", 1)[0]: line.split("=", 1)[1]
        for line in example.splitlines()
        if line and not line.startswith("#") and "=" in line
    }

    assert assignments["PYTHON_BASE_IMAGE"].startswith("docker.m.daocloud.io/")
    assert assignments["NODE_BASE_IMAGE"].startswith("docker.m.daocloud.io/")
    assert assignments["NGINX_BASE_IMAGE"].startswith("docker.m.daocloud.io/")
    assert assignments["APT_MIRROR"] == "http://mirrors.aliyun.com/debian"
    assert assignments["APT_SECURITY_MIRROR"] == "http://mirrors.aliyun.com/debian-security"
    assert assignments["PIP_INDEX_URL"] == "https://mirrors.aliyun.com/pypi/simple/"
    assert assignments["NPM_REGISTRY"] == "https://registry.npmmirror.com"
    for proxy_name in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
        assert proxy_name not in assignments
        assert proxy_name not in example


def test_topiclab_image_reuses_node_and_uses_aliyun_apt_and_pip():
    dockerfile = (REPOSITORY_ROOT / "topiclab-backend" / "Dockerfile").read_text(
        encoding="utf-8"
    )
    compose = (REPOSITORY_ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    apt_layer = dockerfile.split("> /etc/apt/apt.conf.d/80-topiclab-mirror", 1)[1].split(
        "WORKDIR /app", 1
    )[0]

    assert "FROM ${NODE_BASE_IMAGE} AS node-runtime" in dockerfile
    assert "COPY --from=node-runtime /usr/local/bin/node" in dockerfile
    assert "COPY --from=node-runtime /usr/local/lib/node_modules" in dockerfile
    assert "APT_MIRROR=http://mirrors.aliyun.com/debian" in dockerfile
    assert "APT_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security" in dockerfile
    assert "PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/" in dockerfile
    assert "Acquire::Retries" in dockerfile
    assert 'Acquire::http::Pipeline-Depth "0"' in dockerfile
    assert "nodejs" not in apt_layer
    assert " npm" not in apt_layer
    assert compose.count("NODE_BASE_IMAGE: ${NODE_BASE_IMAGE:-") >= 4


def test_resonnet_image_uses_domestic_base_apt_pip_and_npm_sources():
    dockerfile = (REPOSITORY_ROOT / "backend" / "Dockerfile").read_text(
        encoding="utf-8"
    )
    compose = (REPOSITORY_ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    backend_service = compose.split("  backend:", 1)[1].split("\n  frontend:", 1)[0]

    assert "PYTHON_BASE_IMAGE=docker.m.daocloud.io/" in dockerfile
    assert "NODE_BASE_IMAGE=docker.m.daocloud.io/" in dockerfile
    assert "FROM ${NODE_BASE_IMAGE} AS node-runtime" in dockerfile
    assert "COPY --from=node-runtime /usr/local/bin/node" in dockerfile
    assert "deb.nodesource.com" not in dockerfile
    assert "APT_MIRROR=http://mirrors.aliyun.com/debian" in dockerfile
    assert "PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/" in dockerfile
    assert "NPM_REGISTRY=https://registry.npmmirror.com" in dockerfile
    assert 'npm config set registry "${NPM_REGISTRY}"' in dockerfile
    assert "APT_MIRROR: ${APT_MIRROR:-" in backend_service
    assert "NPM_REGISTRY: ${NPM_REGISTRY:-" in backend_service


def test_frontend_and_reviewer_use_domestic_package_sources():
    frontend = (REPOSITORY_ROOT / "frontend" / "Dockerfile").read_text(encoding="utf-8")
    cli = (REPOSITORY_ROOT / "topiclab-cli" / "Dockerfile").read_text(encoding="utf-8")
    reviewer = (REPOSITORY_ROOT / "ClawArcade" / "Dockerfile.reviewer").read_text(
        encoding="utf-8"
    )

    assert "NPM_REGISTRY=https://registry.npmmirror.com" in frontend
    assert 'npm config set registry "$NPM_REGISTRY"' in frontend
    assert "NPM_REGISTRY=https://registry.npmmirror.com" in cli
    assert 'npm config set registry "$NPM_REGISTRY"' in cli
    assert "PYTHON_BASE_IMAGE=docker.m.daocloud.io/" in reviewer
    assert "PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/" in reviewer
    assert "PIP_DEFAULT_TIMEOUT=${PIP_TIMEOUT}" in reviewer


def test_deploy_limits_ssh_and_serializes_builds_using_the_runtime_env_file():
    deploy = (REPOSITORY_ROOT / ".github" / "workflows" / "deploy.yml").read_text(
        encoding="utf-8"
    )

    assert "timeout: 30s" in deploy
    assert "command_timeout: 120m" in deploy
    assert "trap cleanup_deploy EXIT" in deploy
    assert "trap exit_on_signal HUP INT TERM" in deploy
    assert 'kill -TERM "$child_pid"' in deploy
    assert "timeout --signal=TERM --kill-after=30s 60m" in deploy
    assert 'exec 9>"$DEPLOY_LOCK_FILE"' in deploy
    assert "flock -n 9" in deploy
    assert 'COMPOSE_ENV_FILE="$REPO_DIR/.env"' in deploy
    assert 'docker compose --parallel 1 --env-file "$COMPOSE_ENV_FILE" build' in deploy
    assert "prepare_docker_build_env.py" not in deploy
    assert "DOCKER_HOST_GATEWAY" not in deploy
    assert ".env.build" not in deploy
