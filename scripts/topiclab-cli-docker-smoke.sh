#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found in $ROOT_DIR"
  echo "Create it first, for example: cp .env.example .env"
  exit 1
fi

TMP_ENV_FILE="$(mktemp "${TMPDIR:-/tmp}/topiclab-cli-smoke.XXXXXX.env")"
trap 'rm -f "$TMP_ENV_FILE"' EXIT
cp "$ENV_FILE" "$TMP_ENV_FILE"
printf '\nREGISTER_SKIP_SMS_UNTIL=2099-01-01T00:00:00+08:00\n' >> "$TMP_ENV_FILE"

if [[ ! -f "$ROOT_DIR/topiclab-cli/package.json" ]]; then
  echo "ERROR: topiclab-cli submodule is not initialized."
  echo "Run: git submodule update --init --recursive"
  exit 1
fi

set -a
source "$TMP_ENV_FILE"
set +a

TOPICLAB_BACKEND_PORT="${TOPICLAB_BACKEND_PORT:-8001}"
BACKEND_PORT="${BACKEND_PORT:-8000}"

if [[ -z "${OSS_ACCESS_KEY_ID:-}" || -z "${OSS_ACCESS_KEY_SECRET:-}" || -z "${OSS_BUCKET:-}" || -z "${OSS_ENDPOINT:-}" ]]; then
  export TOPICLAB_SMOKE_SKIP_MEDIA_UPLOAD=1
  echo "[warn] OSS env is incomplete; media upload will be skipped in the CLI smoke run."
fi

wait_for_health() {
  local url="$1"
  local label="$2"
  local attempts="${3:-60}"

  for ((i=1; i<=attempts; i++)); do
    if curl --fail --silent --show-error "$url" >/dev/null 2>&1; then
      echo "[ok] $label is healthy at $url"
      return 0
    fi
    sleep 2
  done

  echo "ERROR: $label did not become healthy at $url"
  return 1
}

ENV_FILE="$TMP_ENV_FILE" "$ROOT_DIR/scripts/docker-compose-local.sh" up -d --build --force-recreate topiclab-backend backend
wait_for_health "http://127.0.0.1:${TOPICLAB_BACKEND_PORT}/health" "topiclab-backend"
wait_for_health "http://127.0.0.1:${BACKEND_PORT}/health" "backend"

ENV_FILE="$TMP_ENV_FILE" docker compose --env-file "$TMP_ENV_FILE" --profile cli build topiclab-cli-runner
ENV_FILE="$TMP_ENV_FILE" docker compose --env-file "$TMP_ENV_FILE" --profile cli run --rm --no-deps \
  -e TOPICLAB_SMOKE_SKIP_MEDIA_UPLOAD="${TOPICLAB_SMOKE_SKIP_MEDIA_UPLOAD:-0}" \
  topiclab-cli-runner node scripts/docker-smoke.mjs
