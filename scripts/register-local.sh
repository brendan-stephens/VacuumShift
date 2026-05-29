#!/usr/bin/env bash
# Register a local Postgres instance (default: same Supabase DB). Usage:
#   ./scripts/register-local.sh email@example.com password
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
set -a && source "$ROOT/.env.local" && set +a

EMAIL="${1:?email required}"
PASSWORD="${2:?password required}"
LABEL="${3:-Local}"
# Edge Functions run in Docker — 127.0.0.1 is the container, not host Postgres.
# Override: LOCAL_TARGET_DATABASE_URL or pass connection string as 4th arg.
CONN="${4:-${LOCAL_TARGET_DATABASE_URL:-postgresql://postgres:postgres@host.docker.internal:54322/postgres}}"

eval "$("$ROOT/scripts/auth-token.sh" "$EMAIL" "$PASSWORD")"

TMP=$(mktemp)
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" -X POST \
  "http://127.0.0.1:54321/functions/v1/register-database" \
  -H "apikey: ${SUPABASE_PUBLISHABLE_KEY}" \
  -H "Authorization: Bearer ${USER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"label\":\"${LABEL}\",\"connectionString\":\"${CONN}\",\"preferences\":{\"runInitialCheck\":true}}")

cat "$TMP" | jq . 2>/dev/null || cat "$TMP"
rm -f "$TMP"

if [[ "$HTTP" != "201" ]]; then
  echo "register-database failed (HTTP $HTTP)" >&2
  exit 1
fi
