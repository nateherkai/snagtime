#!/bin/sh
set -eu

if [ -n "${DATABASE_URL_FILE:-}" ]; then
  [ -f "$DATABASE_URL_FILE" ] || { echo '{"status":"error","code":"DATABASE_URL_FILE_MISSING"}' >&2; exit 78; }
  DATABASE_URL=$(tr -d '\r\n' < "$DATABASE_URL_FILE")
fi

case "${DATABASE_URL:-}" in
  postgres://*|postgresql://*) ;;
  *) echo '{"status":"error","code":"POSTGRES_URL_REQUIRED"}' >&2; exit 78 ;;
esac

case "$DATABASE_URL" in
  *sslmode=verify-full*sslrootcert=*) ;;
  *) echo '{"status":"error","code":"VERIFIED_TLS_REQUIRED"}' >&2; exit 78 ;;
esac

exec psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f /migrations/migration.sql
