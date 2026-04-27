#!/usr/bin/env bash
set -euo pipefail

# Optional PM2-based WorldWeave deploy helper.
# The main TopicLab deploy workflow uses the docker-compose WorldWeave service.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: WorldWeave deploy env file not found: $ENV_FILE"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

WORLDWEAVE_REPO_URL="${WORLDWEAVE_REPO_URL:-https://github.com/TashanGKD/worldweave.git}"
WORLDWEAVE_REF="${WORLDWEAVE_REF:-}"
WORLDWEAVE_DIR="${WORLDWEAVE_DIR:-$ROOT_DIR/worldweave}"
WORLDWEAVE_PORT="${WORLDWEAVE_PORT:-3020}"
WORLDWEAVE_HOST="${WORLDWEAVE_HOST:-127.0.0.1}"
WORLDWEAVE_PM2_NAME="${WORLDWEAVE_PM2_NAME:-worldweave}"
WORLDWEAVE_SOURCE_PM2_NAME="${WORLDWEAVE_SOURCE_PM2_NAME:-worldweave-source-refresh}"
WORLDWEAVE_SOURCE_DAEMON="${WORLDWEAVE_SOURCE_DAEMON:-1}"

missing=()
for key in MINIMAX_API_KEY METASO_API_KEY; do
  if [[ -z "${!key:-}" ]]; then
    missing+=("$key")
  fi
done

if (( ${#missing[@]} > 0 )); then
  echo "ERROR: missing WorldWeave variables in $ENV_FILE:"
  printf '  - %s\n' "${missing[@]}"
  exit 1
fi

is_git_worktree() {
  git -C "$1" rev-parse --is-inside-work-tree >/dev/null 2>&1
}

if [[ "$WORLDWEAVE_DIR" == "$ROOT_DIR/worldweave" ]]; then
  git -C "$ROOT_DIR" submodule update --init --recursive worldweave
elif ! is_git_worktree "$WORLDWEAVE_DIR"; then
  mkdir -p "$(dirname "$WORLDWEAVE_DIR")"
  git clone "$WORLDWEAVE_REPO_URL" "$WORLDWEAVE_DIR"
fi

cd "$WORLDWEAVE_DIR"
if [[ -n "${WORLDWEAVE_REF:-}" ]]; then
  git remote set-url origin "$WORLDWEAVE_REPO_URL"
  git fetch origin "$WORLDWEAVE_REF"
  git reset --hard "origin/$WORLDWEAVE_REF"
fi

cat > .env.local <<EOF
MINIMAX_API_KEY=$MINIMAX_API_KEY
METASO_API_KEY=$METASO_API_KEY
PORT=$WORLDWEAVE_PORT
HOST=$WORLDWEAVE_HOST
WORLD_HOST=$WORLDWEAVE_HOST
EOF

if ! command -v corepack >/dev/null 2>&1; then
  echo "ERROR: corepack is required to install pnpm for WorldWeave."
  exit 1
fi
corepack enable
corepack prepare pnpm@9.0.0 --activate

pnpm install --frozen-lockfile
pnpm build

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

if pm2 describe "$WORLDWEAVE_PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$WORLDWEAVE_PM2_NAME" --update-env
else
  pm2 start scripts/world-start.mjs \
    --interpreter "$(command -v node)" \
    --name "$WORLDWEAVE_PM2_NAME" \
    --time
fi

if [[ "$WORLDWEAVE_SOURCE_DAEMON" != "0" ]]; then
  if pm2 describe "$WORLDWEAVE_SOURCE_PM2_NAME" >/dev/null 2>&1; then
    pm2 restart "$WORLDWEAVE_SOURCE_PM2_NAME" --update-env
  else
    pm2 start scripts/world-source-refresh-daemon.mjs \
      --interpreter "$(command -v node)" \
      --name "$WORLDWEAVE_SOURCE_PM2_NAME" \
      --time
  fi
fi

pm2 save || true

for i in {1..30}; do
  if curl -fsS "http://127.0.0.1:${WORLDWEAVE_PORT}/api/v1/openclaw/skill.md" >/dev/null; then
    break
  fi
  if [[ "$i" == "30" ]]; then
    echo "ERROR: WorldWeave did not become healthy on port ${WORLDWEAVE_PORT}."
    pm2 logs "$WORLDWEAVE_PM2_NAME" --lines 80 --nostream || true
    exit 1
  fi
  sleep 2
done

curl -fsS "http://127.0.0.1:${WORLDWEAVE_PORT}/api/v1/world/state?scene=global" >/dev/null
curl -fsS "http://127.0.0.1:${WORLDWEAVE_PORT}/api/v1/world/livebench/questions" >/dev/null
curl -fsS "http://127.0.0.1:${WORLDWEAVE_PORT}/api/v1/world/source-knowledge/status" >/dev/null

echo "WorldWeave is running on ${WORLDWEAVE_HOST}:${WORLDWEAVE_PORT}"
