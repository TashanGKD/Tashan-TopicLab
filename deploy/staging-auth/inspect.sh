#!/usr/bin/env bash
# Read-only inspection: no deploy, no restart, no database writes.
set -euo pipefail
base=/data/tashan-auth-staging
echo "== revision =="; cat "$base/REVISION" 2>/dev/null || echo none
echo "== containers =="
docker ps --filter "label=com.docker.compose.project=tashan-auth-staging" --format '{{.Names}} {{.Image}} {{.Status}} {{.Ports}}'
echo "== volumes =="
docker volume ls --filter "label=com.docker.compose.project=tashan-auth-staging" --format '{{.Name}}'
echo "== listener =="
ss -ltnp 2>/dev/null | grep -E ':18984|:8000|:5432' || true
echo "== staging tables =="
docker exec tashan-auth-staging-postgres-1 psql -U tashan_auth_staging -d tashan_auth_staging -Atc \
  "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'profile_import%' ORDER BY 1" 2>/dev/null || true
echo "== production untouched =="
docker ps --filter "label=com.docker.compose.project=tashan-topiclab" --format '{{.Names}} {{.Status}}' || true
