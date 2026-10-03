#!/usr/bin/env bash
# A persistent local Postgres for running the app without Supabase.
#   scripts/local-db.sh start   # create (first time) and start on :54322, with schema + seed;
#                               # on later starts, applies any new migrations
#   scripts/local-db.sh stop
#   scripts/local-db.sh reset   # wipe and recreate
# Then: DATABASE_URL=postgres://postgres@localhost:54322/postgres npm run dev
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v initdb >/dev/null; then
  PATH="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1):$PATH"
fi
INITDB=$(command -v initdb)
PG_CTL=$(command -v pg_ctl)
DATA="$PWD/.localdb"
PORT=${LOCAL_DB_PORT:-54322}
RUN_AS=()
[ "$(id -u)" = 0 ] && RUN_AS=(sudo -u postgres)
PSQL=(psql -h localhost -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)

start() {
  local fresh=0
  if [ ! -d "$DATA" ]; then
    mkdir -p "$DATA"
    [ "$(id -u)" = 0 ] && chown postgres "$DATA"
    "${RUN_AS[@]}" "$INITDB" -D "$DATA" -U postgres -A trust >/dev/null
    fresh=1
  fi
  "${RUN_AS[@]}" "$PG_CTL" -D "$DATA" -l "$DATA/server.log" -o "-p $PORT -k /tmp -c listen_addresses=localhost" -w start >/dev/null
  if [ "$fresh" = 1 ]; then
    "${PSQL[@]}" -f supabase/tests/supabase_stub.sql
    "${PSQL[@]}" -c "create table _local_migrations (name text primary key, applied_at timestamptz default now())"
  fi
  if [ -z "$("${PSQL[@]}" -tAc "select to_regclass('_local_migrations')")" ]; then
    echo "This local database predates migration tracking. Run: npm run db:reset" >&2
    exit 1
  fi
  # Apply any migrations this database hasn't seen yet.
  for f in supabase/migrations/*.sql; do
    name=$(basename "$f")
    if [ -z "$("${PSQL[@]}" -tAc "select 1 from _local_migrations where name = '$name'")" ]; then
      echo "applying $name"
      "${PSQL[@]}" -f "$f"
      "${PSQL[@]}" -c "insert into _local_migrations (name) values ('$name')"
    fi
  done
  if [ "$fresh" = 1 ]; then
    "${PSQL[@]}" -f supabase/seed.sql
  fi
  echo "DATABASE_URL=postgres://postgres@localhost:$PORT/postgres"
}
stop() { [ -d "$DATA" ] && "${RUN_AS[@]}" "$PG_CTL" -D "$DATA" -m fast stop >/dev/null 2>&1 || true; }

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  reset) stop; rm -rf "$DATA"; start ;;
  *) echo "usage: $0 start|stop|reset" >&2; exit 1 ;;
esac
