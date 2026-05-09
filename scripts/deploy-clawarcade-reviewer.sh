#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ARCADE_REVIEWER_SOURCE_ENV:-$ROOT_DIR/.env}"
CLAWARCADE_DIR="${ARCADE_REVIEWER_CLAWARCADE_DIR:-$ROOT_DIR/ClawArcade}"
SERVICE_NAME="${ARCADE_REVIEWER_COMPOSE_SERVICE:-clawarcade-reviewer}"
LEGACY_SYSTEMD_SERVICE="${ARCADE_REVIEWER_LEGACY_SYSTEMD_SERVICE:-clawarcade-reviewer.service}"
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

stop_legacy_systemd_reviewer() {
  if ! command -v systemctl >/dev/null 2>&1; then
    return 0
  fi
  if ! systemctl list-unit-files --no-legend "$LEGACY_SYSTEMD_SERVICE" 2>/dev/null | grep -q .; then
    return 0
  fi

  echo "[reviewer-deploy] stopping legacy systemd reviewer $LEGACY_SYSTEMD_SERVICE"
  sudo -n systemctl disable --now "$LEGACY_SYSTEMD_SERVICE"
  sudo -n systemctl reset-failed "$LEGACY_SYSTEMD_SERVICE" >/dev/null 2>&1 || true
}

stop_legacy_cifar_processes() {
  local cifar_dir="$CLAWARCADE_DIR/cabinets/turing-teahouse/101-CIFAR"
  if [[ ! -d /proc || ! -d "$cifar_dir" ]]; then
    return 0
  fi

  local pids=()
  local proc cwd
  for proc in /proc/[0-9]*; do
    if [[ ! -L "$proc/cwd" ]]; then
      continue
    fi
    cwd="$(readlink "$proc/cwd" 2>/dev/null || true)"
    if [[ "$cwd" == "$cifar_dir"* ]]; then
      pids+=("${proc##*/}")
    fi
  done
  if [[ "${#pids[@]}" -eq 0 ]]; then
    return 0
  fi

  echo "[reviewer-deploy] stopping legacy CIFAR reviewer processes: ${pids[*]}"
  kill -TERM "${pids[@]}" 2>/dev/null || true
  sleep 2
  kill -KILL "${pids[@]}" 2>/dev/null || true
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

stop_legacy_systemd_reviewer
stop_legacy_cifar_processes

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
compose rm -sf "$SERVICE_NAME" >/dev/null 2>&1 || true
compose up -d --force-recreate --no-deps "$SERVICE_NAME"
compose ps "$SERVICE_NAME"
