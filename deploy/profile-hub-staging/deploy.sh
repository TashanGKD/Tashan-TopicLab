#!/usr/bin/env bash
set -euo pipefail
umask 077
bundle=${1:?bundle required}
revision=${2:?revision required}
[[ "$bundle" =~ ^/data/panshi-staging-upload/profile-hub-[0-9]+-[0-9]+$ ]]
[[ "$revision" =~ ^[a-f0-9]{40}$ ]]
base=/opt/tashan-profile-hub-staging
install -d -m 700 "$base" "$base/releases" "$base/shared"
test "$(cat "$bundle/REVISION")" = "$revision"
release="$base/releases/$revision"
install -d -m 700 "$release"
cp -a "$bundle/topiclab-backend" "$bundle/deploy" "$release/"
# Reuse the already installed Python dependencies; pin the exact image ID.
base_image=$(docker inspect --format '{{.Image}}' tashan-topiclab-topiclab-backend-1)
docker tag "$base_image" "tashan-profile-hub-staging-base:$revision"
docker build --build-arg "BASE_IMAGE=tashan-profile-hub-staging-base:$revision" \
  -f "$release/deploy/profile-hub-staging/Dockerfile" -t "tashan-profile-hub-staging:$revision" "$release"
if ! test -f "$base/shared/database-password"; then
  openssl rand -hex 24 > "$base/shared/database-password"
fi
printf 'HUB_DATABASE_PASSWORD=%s\nPROFILE_HUB_REVISION=%s\n' "$(cat "$base/shared/database-password")" "$revision" > "$base/shared/hub.env.next"
printf 'PROFILE_HUB_FORUM_SECRET=%s\n' "$(cat "$bundle/hub-secret")" >> "$base/shared/hub.env.next"
cp "$release/deploy/profile-hub-staging/compose.yaml" "$base/compose.yaml"
test ! -f "$base/shared/hub.env" || cp "$base/shared/hub.env" "$base/shared/hub.env.previous"
mv "$base/shared/hub.env.next" "$base/shared/hub.env"
compose=(docker compose --project-name tashan-profile-hub-staging --env-file "$base/shared/hub.env" -f "$base/compose.yaml")
"${compose[@]}" up -d --wait --wait-timeout 120
ready=false
for attempt in {1..30}; do
  if curl --fail --silent http://127.0.0.1:18912/healthz > "$base/health.json"; then ready=true; break; fi
  sleep 2
done
if test "$ready" != true; then
  if test -f "$base/shared/hub.env.previous"; then
    cp "$base/shared/hub.env.previous" "$base/shared/hub.env"
    "${compose[@]}" up -d
  fi
  exit 1
fi
"${compose[@]}" exec -T api python scripts/verify_profile_hub_staging.py
printf '%s\n' "$revision" > "$base/accepted-revision"
cat "$base/health.json"
