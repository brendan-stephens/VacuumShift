#!/usr/bin/env bash
# Start/stop local VacuumShift dev stack (functions + worker + web).
# Requires Supabase already running: supabase start
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE="$ROOT/.stack.pids"
LOGDIR="$ROOT/.stack/logs"

usage() {
  echo "Usage: npm run stack:{start|stop|status|logs}"
  echo ""
  echo "  start   — functions, worker, web (background)"
  echo "  stop    — stop all stack processes"
  echo "  status  — show PIDs and health"
  echo "  logs    — tail -f all stack logs"
  echo ""
  echo "Prerequisite: supabase start"
}

load_env() {
  if [[ ! -f "$ROOT/.env.local" ]]; then
    echo "Missing $ROOT/.env.local (copy from .env.example)" >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env.local"
  set +a
}

check_supabase() {
  local url="${SUPABASE_URL:-http://127.0.0.1:54321}"
  local key="${SUPABASE_PUBLISHABLE_KEY:-}"
  if [[ -z "$key" ]]; then
    echo "SUPABASE_PUBLISHABLE_KEY not set in .env.local" >&2
    exit 1
  fi
  if ! curl -sf "${url}/rest/v1/" -H "apikey: ${key}" -o /dev/null; then
    echo "Supabase is not reachable at ${url}" >&2
    echo "Run: supabase start" >&2
    exit 1
  fi
}

is_running() {
  kill -0 "$1" 2>/dev/null
}

default_admin_configured() {
  [[ -n "${DEFAULT_ADMIN_EMAIL:-}" && -n "${DEFAULT_ADMIN_PASSWORD:-}" ]]
}

start_stack() {
  if [[ -f "$PIDFILE" ]]; then
    echo "Stack may already be running (found $PIDFILE). Run: npm run stack:stop" >&2
    exit 1
  fi

  load_env
  check_supabase

  if default_admin_configured; then
    echo "Ensuring default user (DEFAULT_ADMIN_EMAIL / DEFAULT_ADMIN_PASSWORD)…"
    bash "$ROOT/scripts/ensure-default-user.sh"
  else
    echo "Skipping default user (set DEFAULT_ADMIN_EMAIL and DEFAULT_ADMIN_PASSWORD in .env.local to enable)"
  fi

  mkdir -p "$LOGDIR"
  : >"$PIDFILE"

  echo "Starting Edge Functions…"
  (
    cd "$ROOT"
    exec supabase functions serve
  ) >"$LOGDIR/functions.log" 2>&1 &
  echo "$! functions" >>"$PIDFILE"

  echo "Starting worker…"
  (
    cd "$ROOT/packages/worker"
    exec npx tsx src/index.ts
  ) >"$LOGDIR/worker.log" 2>&1 &
  echo "$! worker" >>"$PIDFILE"

  echo "Starting web dashboard…"
  if [[ ! -f "$ROOT/apps/web/.next/server/vendor-chunks/next.js" ]]; then
    echo "Clearing stale Next.js build cache…"
    rm -rf "$ROOT/apps/web/.next"
  fi
  (
    cd "$ROOT/apps/web"
    exec npx next dev --port 3000
  ) >"$LOGDIR/web.log" 2>&1 &
  echo "$! web" >>"$PIDFILE"

  sleep 1
  echo ""
  echo "Stack started."
  if default_admin_configured; then
    echo "  Sign in:    ${DEFAULT_ADMIN_EMAIL}"
  fi
  echo "  Dashboard:  http://127.0.0.1:3000"
  echo "  Functions:  ${SUPABASE_URL}/functions/v1"
  echo "  Logs:       .stack/logs/  (npm run stack:logs)"
  echo "  Stop:       npm run stack:stop"
}

stop_stack() {
  echo "Stopping stack…"

  if [[ -f "$PIDFILE" ]]; then
    while read -r line; do
      pid="${line%% *}"
      [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
    done <"$PIDFILE"
    rm -f "$PIDFILE"
  fi

  # Orphans (npm/tsx children, prior background jobs)
  pkill -f "supabase functions serve" 2>/dev/null || true
  pkill -f "packages/worker.*src/index.ts" 2>/dev/null || true
  pkill -f "next dev --port 3000" 2>/dev/null || true

  echo "Stack stopped."
}

status_stack() {
  load_env 2>/dev/null || true

  echo "VacuumShift stack"
  echo ""

  if [[ -f "$PIDFILE" ]]; then
    while read -r line; do
      pid="${line%% *}"
      name="${line#* }"
      if is_running "$pid"; then
        echo "  ✓ $name (pid $pid)"
      else
        echo "  ✗ $name (pid $pid — not running)"
      fi
    done <"$PIDFILE"
  else
    echo "  (no pid file — stack not started via stack:start)"
  fi

  echo ""
  if curl -sf "${SUPABASE_URL:-http://127.0.0.1:54321}/rest/v1/" \
    -H "apikey: ${SUPABASE_PUBLISHABLE_KEY:-}" -o /dev/null 2>/dev/null; then
    echo "  ✓ Supabase API"
  else
    echo "  ✗ Supabase API — run: supabase start"
  fi

  if curl -sf "http://127.0.0.1:3000" -o /dev/null 2>/dev/null; then
    echo "  ✓ Web http://127.0.0.1:3000"
  else
    echo "  ✗ Web http://127.0.0.1:3000"
  fi
}

logs_stack() {
  mkdir -p "$LOGDIR"
  touch "$LOGDIR/functions.log" "$LOGDIR/worker.log" "$LOGDIR/web.log"
  tail -f "$LOGDIR/functions.log" "$LOGDIR/worker.log" "$LOGDIR/web.log"
}

cmd="${1:-}"
case "$cmd" in
  start) start_stack ;;
  stop) stop_stack ;;
  status) status_stack ;;
  logs) logs_stack ;;
  -h | --help | help) usage ;;
  *)
    usage >&2
    exit 1
    ;;
esac
