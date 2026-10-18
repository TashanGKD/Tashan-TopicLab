#!/usr/bin/env bash
# Deploy only the isolated unified-login staging stack. Production resources are untouched.
set -euo pipefail
umask 077
release="${1:?release directory required}"
revision="${2:?commit sha required}"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]]
base=/data/tashan-auth-staging
project=tashan-auth-staging

test -f "$release/images.tar.gz"
cd "$release"
sha256sum -c images.tar.gz.sha256 >/dev/null
docker load -i images.tar.gz

install -d -m 700 "$base/shared"
install -m 600 "$release/auth-staging.env" "$base/shared/auth-staging.env"
# The password must be the same value the API uses in DATABASE_URL.
password="$(grep -E '^POSTGRES_PASSWORD=' "$base/shared/auth-staging.env" | cut -d= -f2-)"
[[ "$password" =~ ^[A-Za-z0-9_-]{32,}$ ]]

cp "$release/compose.auth-staging.yaml" "$base/compose.auth-staging.yaml"
printf 'IMAGE_TAG=%s\nSTAGING_ENV_FILE=%s\nPOSTGRES_PASSWORD=%s\n' \
  "$revision" "$base/shared/auth-staging.env" "$password" > "$base/compose.env"

compose=(docker compose --project-name "$project" --env-file "$base/compose.env" -f "$base/compose.auth-staging.yaml")
"${compose[@]}" pull --ignore-buildable postgres || true
"${compose[@]}" up -d --no-build

for _ in $(seq 1 60); do
  if curl -fsS --max-time 5 http://127.0.0.1:18984/health/ready >/dev/null 2>&1; then
    printf '%s\n' "$revision" > "$base/REVISION"
    echo "Staging stack healthy at revision $revision"
    exit 0
  fi
  sleep 5
done
"${compose[@]}" ps
echo 'Staging stack did not become healthy' >&2
exit 1
