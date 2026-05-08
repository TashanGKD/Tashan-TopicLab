#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ARCADE_REVIEWER_SOURCE_ENV:-$ROOT_DIR/.env}"
CLAWARCADE_DIR="${ARCADE_REVIEWER_CLAWARCADE_DIR:-$ROOT_DIR/ClawArcade}"
SERVICE_NAME="${ARCADE_REVIEWER_SYSTEMD_SERVICE:-clawarcade-reviewer.service}"
SERVICE_USER="${ARCADE_REVIEWER_SYSTEMD_USER:-$(id -un)}"
RUNTIME_ENV_FILE="${ARCADE_REVIEWER_RUNTIME_ENV:-$ROOT_DIR/.arcade-reviewer.env}"
BASE_URL_DEFAULT="${ARCADE_REVIEWER_BASE_URL:-https://world.tashan.chat}"
SMOKE_TIMEOUT="${ARCADE_REVIEWER_SMOKE_TIMEOUT_SECONDS:-300}"
SKIP_SMOKE="${ARCADE_REVIEWER_SKIP_SMOKE:-0}"

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

require_file "$ENV_FILE" "deploy env file"
require_file "$CLAWARCADE_DIR/arcade_reviewer.py" "ClawArcade reviewer"
require_file "$CLAWARCADE_DIR/deploy/systemd/clawarcade-reviewer.service" "ClawArcade systemd template"
require_file "$CLAWARCADE_DIR/generated/reviewer_registry.json" "ClawArcade reviewer registry"

SECRET_VALUE="$(read_env_value "ARCADE_EVALUATOR_SECRET_KEY" "$ENV_FILE")"
if [[ -z "$SECRET_VALUE" ]]; then
  warn "ARCADE_EVALUATOR_SECRET_KEY is not configured; skipping ClawArcade reviewer deployment"
  exit 0
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "::error::python3 is required for the ClawArcade reviewer"
  exit 1
fi

sudo -u "$SERVICE_USER" /bin/bash -lc '
  export PATH="$HOME/.local/bin:$PATH"
  if command -v uv >/dev/null 2>&1; then
    exit 0
  fi
  python3 -m pip install --user uv >/dev/null 2>&1 && exit 0
  if command -v curl >/dev/null 2>&1; then
    curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null
    exit 0
  fi
  echo "uv is required but could not be installed" >&2
  exit 1
'

mkdir -p "$(dirname "$RUNTIME_ENV_FILE")"
umask 077
{
  grep -E '^(ARCADE_|TOPICLAB_)' "$ENV_FILE" 2>/dev/null || true
  if ! grep -q '^ARCADE_BASE_URL=' "$ENV_FILE" 2>/dev/null; then
    printf 'ARCADE_BASE_URL=%s\n' "$BASE_URL_DEFAULT"
  fi
  if ! grep -q '^ARCADE_LOG_DIR=' "$ENV_FILE" 2>/dev/null; then
    printf 'ARCADE_LOG_DIR=%s\n' "$CLAWARCADE_DIR/logs"
  fi
} > "$RUNTIME_ENV_FILE"

mkdir -p "$CLAWARCADE_DIR/logs"
sudo chown "$SERVICE_USER" "$RUNTIME_ENV_FILE"
sudo chown -R "$SERVICE_USER" "$CLAWARCADE_DIR/logs"

if [[ "$SKIP_SMOKE" != "1" ]]; then
  sudo -u "$SERVICE_USER" /bin/bash -lc "
    export PATH=\"\$HOME/.local/bin:\$PATH\"
    cd '$CLAWARCADE_DIR'
    python3 scripts/build_cabinets.py
    python3 scripts/validate_cabinets.py
    python3 scripts/reviewer_smoke_test.py \
      --repo-root '$CLAWARCADE_DIR' \
      --timeout '$SMOKE_TIMEOUT' \
      --probe 102-variable-star-evaluator
    python3 scripts/reviewer_e2e_smoke.py \
      --repo-root '$CLAWARCADE_DIR' \
      --source cabinets/citizen-science-harbor/103-data-sample-relay-review \
      --submission-file forum_post_template.txt \
      --expected-min-score 1 \
      --timeout '$SMOKE_TIMEOUT'
  "
fi

sed \
  -e "s|__DEPLOY_DIR__|$CLAWARCADE_DIR|g" \
  -e "s|__SERVICE_USER__|$SERVICE_USER|g" \
  -e "s|__ENV_FILE__|$RUNTIME_ENV_FILE|g" \
  "$CLAWARCADE_DIR/deploy/systemd/clawarcade-reviewer.service" \
  | sudo tee "/etc/systemd/system/$SERVICE_NAME" >/dev/null

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl is-active "$SERVICE_NAME"
sudo systemctl --no-pager --full status "$SERVICE_NAME"
