#!/usr/bin/env bash
# Code-only deployment: preserves environment, dependencies and unrelated services.
set -euo pipefail
umask 077
bundle=$(cd "$1" && pwd)
revision=$(cat "$bundle/revision")
[[ "$revision" =~ ^[0-9a-f]{40}$ ]]
repo=/var/www/github-actions/repos/Tashan-TopicLab
cd "$repo"
exec 9>.deploy.lock
flock -n 9
old=$(git rev-parse HEAD)
git fetch --quiet https://github.com/TashanGKD/Tashan-TopicLab.git "$revision"
git merge-base --is-ancestor "$old" "$revision"
# Dependency/runtime changes require the full deployment workflow.
git diff --exit-code "$old" "$revision" -- docker-compose.yml topiclab-backend/pyproject.toml topiclab-backend/Dockerfile frontend/Dockerfile frontend/nginx.root.conf frontend/nginx.conf >/dev/null
[[ -z "$(git diff --name-only --ignore-submodules)" ]]
backup="/var/backups/tashan-auth/$revision"
mkdir -p "$backup"
printf '%s\n' "$old" > "$backup/previous-revision"
for service in topiclab-backend frontend; do
  id=$(docker inspect -f '{{.Image}}' "tashan-topiclab-$service-1")
  docker tag "$id" "tashan-auth-rollback-$service:$revision"
done
cat > "$backup/rollback.yml" <<YAML
services:
  topiclab-backend:
    image: tashan-auth-rollback-topiclab-backend:$revision
  frontend:
    image: tashan-auth-rollback-frontend:$revision
YAML
# Only additive SSO schema is introduced; rollback keeps all account data intact.
docker exec tashan-topiclab-topiclab-backend-1 python -c 'from app.storage.database.postgres_client import get_db_session; from sqlalchemy import text; import json; s=get_db_session(); db=s.__enter__(); print(json.dumps({"user_count":db.execute(text("SELECT count(*) FROM users")).scalar(),"sso_tables":db.execute(text("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename LIKE '\''sso_%'\''")).scalars().all()})); s.__exit__(None,None,None)' > "$backup/database-before.json"
cat > "$bundle/Backend.Dockerfile" <<DOCKER
FROM tashan-auth-rollback-topiclab-backend:$revision
COPY --chown=appuser:appuser topiclab-backend/app /app/app
COPY --chown=appuser:appuser topiclab-backend/main.py /app/main.py
LABEL org.opencontainers.image.revision=$revision
DOCKER
cat > "$bundle/Frontend.Dockerfile" <<DOCKER
FROM tashan-auth-rollback-frontend:$revision
COPY frontend/dist /usr/share/nginx/html
LABEL org.opencontainers.image.revision=$revision
DOCKER
docker build --network=none -f "$bundle/Backend.Dockerfile" -t "tashan-topiclab-topiclab-backend:auth-$revision" "$bundle"
docker build --network=none -f "$bundle/Frontend.Dockerfile" -t "tashan-topiclab-frontend:auth-$revision" "$bundle"
cat > "$backup/release.yml" <<YAML
services:
  topiclab-backend:
    image: tashan-topiclab-topiclab-backend:auth-$revision
  frontend:
    image: tashan-topiclab-frontend:auth-$revision
YAML
compose=(docker compose -p tashan-topiclab --env-file "$repo/.env" -f "$repo/docker-compose.yml")
rollback() {
  echo 'Deployment failed; restoring previous application images.'
  "${compose[@]}" -f "$backup/rollback.yml" up -d --no-deps --no-build topiclab-backend frontend
}
trap rollback ERR
"${compose[@]}" -f "$backup/release.yml" up -d --no-deps --no-build topiclab-backend frontend
ready=false
for i in $(seq 1 60); do
  if curl -fsS --max-time 5 http://127.0.0.1:8011/health/ready >/dev/null && curl -fsS --max-time 5 http://127.0.0.1:3010/login >/dev/null; then ready=true; break; fi
  sleep 2
done
[[ "$ready" = true ]]
[[ "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8011/admin/sso/clients)" = 401 ]]
git merge --ff-only "$revision"
# Keep the standard Compose image names pointing at this accepted release.
docker tag "tashan-topiclab-topiclab-backend:auth-$revision" tashan-topiclab-topiclab-backend:latest
docker tag "tashan-topiclab-frontend:auth-$revision" tashan-topiclab-frontend:latest
trap - ERR
printf 'Deployed revision %s; rollback manifests: %s\n' "$revision" "$backup"
