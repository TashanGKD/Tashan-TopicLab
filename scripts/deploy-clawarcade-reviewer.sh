#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ARCADE_REVIEWER_SOURCE_ENV:-$ROOT_DIR/.env}"
CLAWARCADE_DIR="${ARCADE_REVIEWER_CLAWARCADE_DIR:-$ROOT_DIR/ClawArcade}"
SERVICE_NAME="${ARCADE_REVIEWER_COMPOSE_SERVICE:-clawarcade-reviewer}"
SMOKE_TIMEOUT="${ARCADE_REVIEWER_SMOKE_TIMEOUT_SECONDS:-300}"
SKIP_SMOKE="${ARCADE_REVIEWER_SKIP_SMOKE:-0}"
DEPLOYMENT_PROFILE="${ARCADE_REVIEWER_DEPLOYMENT_PROFILE:-cpu}"

warn() {
  echo "::warning::$*"
}

require_file() {
  local path="$1"
  local label="$2"
  if [[ ! -f "$path" ]]; then
    warn "$label not found at $path; skipping ClawArcade reviewer deployment"
    exit 0
  fi
}

read_env_value() {
  local key="$1"
  local file="$2"
  grep -E "^${key}=" "$file" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r' || true
}

compose() {
  ENV_FILE="$ENV_FILE" \
  ARCADE_REVIEWER_DEPLOYMENT_PROFILE="$DEPLOYMENT_PROFILE" \
  docker compose --env-file "$ENV_FILE" --profile reviewer "$@"
}

require_file "$ENV_FILE" "deploy env file"
require_file "$ROOT_DIR/docker-compose.yml" "TopicLab docker-compose.yml"
require_file "$CLAWARCADE_DIR/arcade_reviewer.py" "ClawArcade reviewer"
require_file "$CLAWARCADE_DIR/Dockerfile.reviewer" "ClawArcade reviewer Dockerfile"
require_file "$CLAWARCADE_DIR/generated/reviewer_registry.json" "ClawArcade reviewer registry"

SECRET_VALUE="$(read_env_value "ARCADE_EVALUATOR_SECRET_KEY" "$ENV_FILE")"
if [[ -z "$SECRET_VALUE" ]]; then
  warn "ARCADE_EVALUATOR_SECRET_KEY is not configured; skipping ClawArcade reviewer deployment"
  exit 0
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "::error::docker compose is required for the ClawArcade reviewer"
  exit 1
fi

echo "[reviewer-deploy] building $SERVICE_NAME image profile=$DEPLOYMENT_PROFILE"
compose build "$SERVICE_NAME"

if [[ "$SKIP_SMOKE" != "1" ]]; then
  echo "[reviewer-deploy] validating generated cabinet metadata in container"
  compose run --rm --no-deps --entrypoint python "$SERVICE_NAME" scripts/build_cabinets.py --check
  compose run --rm --no-deps --entrypoint python "$SERVICE_NAME" scripts/validate_cabinets.py

  echo "[reviewer-deploy] running CPU reviewer smoke probes"
  compose run --rm --no-deps --entrypoint python "$SERVICE_NAME" \
    scripts/reviewer_smoke_test.py \
      --repo-root /app \
      --timeout "$SMOKE_TIMEOUT" \
      --probe 102-variable-star-evaluator
  compose run --rm --no-deps --entrypoint python "$SERVICE_NAME" \
    scripts/reviewer_e2e_smoke.py \
      --repo-root /app \
      --source cabinets/citizen-science-harbor/103-data-sample-relay-review \
      --submission-file forum_post_template.txt \
      --expected-min-score 1 \
      --timeout "$SMOKE_TIMEOUT"
fi

echo "[reviewer-deploy] starting $SERVICE_NAME container"
compose up -d --no-deps "$SERVICE_NAME"
compose ps "$SERVICE_NAME"
