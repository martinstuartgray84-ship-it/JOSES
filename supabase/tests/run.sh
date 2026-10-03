#!/usr/bin/env bash
# Applies the migrations to a throwaway Postgres cluster and runs the SQL tests.
# Needs Postgres 15+ server binaries (initdb, pg_ctl) on PATH or in /usr/lib/postgresql/*/bin.
set -euo pipefail
cd "$(dirname "$0")/../.."

if ! command -v initdb >/dev/null; then
  PATH="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1):$PATH"
fi
INITDB=$(command -v initdb)
PG_CTL=$(command -v pg_ctl)

DATA=$(mktemp -d)
PORT=${PGTEST_PORT:-54329}
RUN_AS=()
if [ "$(id -u)" = 0 ]; then
  # initdb refuses to run as root.
  chown postgres "$DATA"
  RUN_AS=(sudo -u postgres)
fi
cleanup() { "${RUN_AS[@]}" "$PG_CTL" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT

"${RUN_AS[@]}" "$INITDB" -D "$DATA" -U postgres -A trust >/dev/null
"${RUN_AS[@]}" "$PG_CTL" -D "$DATA" -o "-p $PORT -k /tmp -c listen_addresses=localhost" -w start >/dev/null

PSQL=(psql -h /tmp -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f supabase/tests/supabase_stub.sql
for f in supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -c "begin" -f supabase/seed.sql -c "rollback" -o /dev/null  # seed must apply cleanly
for f in supabase/tests/*.test.sql; do
  echo "== $f"
  "${PSQL[@]}" -o /dev/null -f "$f"
done
echo "== integration tests"
DATABASE_URL="postgres://postgres@localhost:$PORT/postgres" npx vitest run src/server
echo "All database tests passed."
