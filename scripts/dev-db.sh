#!/usr/bin/env bash
# Starts (or creates) the local dev Postgres in Docker and applies migrations. Run by `npm run dev` (predev).
# Local only: .env points at localhost:55432, never at production.
set -euo pipefail
NAME=pc-dev-pg
if ! docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  docker run -d --name "$NAME" -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=pc -p 55432:5432 -v pc-dev-pgdata:/var/lib/postgresql/data postgres:17 >/dev/null
elif ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  docker start "$NAME" >/dev/null
fi
until docker exec "$NAME" pg_isready -U postgres -d pc >/dev/null 2>&1; do sleep 0.5; done
npx prisma migrate deploy
