#!/usr/bin/env bash
set -euo pipefail

# Always run from repo root so .env and docker-compose.yml resolve consistently.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found in $ROOT_DIR"
  echo "Create it first, for example: cp .env.example .env"
  exit 1
fi

# Load .env once for local validation (deploy workflow also validates env before compose).
set -a
source "$ENV_FILE"
set +a

required_vars=(
  ANTHROPIC_API_KEY
  AI_GENERATION_BASE_URL
  AI_GENERATION_API_KEY
  AI_GENERATION_MODEL
)

missing=()
for key in "${required_vars[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    missing+=("$key")
  fi
done

if (( ${#missing[@]} > 0 )); then
  echo "ERROR: missing required variables in $ENV_FILE:"
  printf '  - %s\n' "${missing[@]}"
  exit 1
fi

if [[ $# -eq 0 ]]; then
  set -- up -d --build --force-recreate
fi

exec docker compose --env-file "$ENV_FILE" "$@"
