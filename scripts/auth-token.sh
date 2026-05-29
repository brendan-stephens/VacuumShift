#!/usr/bin/env bash
# Print a user access_token for local API calls. Usage:
#   eval "$(./scripts/auth-token.sh email@example.com password)"
#   curl ... -H "Authorization: Bearer $USER_TOKEN"
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
set -a && source "$ROOT/.env.local" && set +a

EMAIL="${1:-${DEFAULT_ADMIN_EMAIL:-}}"
PASSWORD="${2:-${DEFAULT_ADMIN_PASSWORD:-}}"
if [[ -z "$EMAIL" || -z "$PASSWORD" ]]; then
  echo "Usage: $0 <email> <password>" >&2
  echo "Or set DEFAULT_ADMIN_EMAIL and DEFAULT_ADMIN_PASSWORD in .env.local" >&2
  exit 1
fi

TMP=$(mktemp)
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" \
  "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
  -H "apikey: ${SUPABASE_PUBLISHABLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")

if [[ "$HTTP" != "200" ]]; then
  echo "sign-in failed (HTTP $HTTP):" >&2
  jq . "$TMP" 2>/dev/null || cat "$TMP" >&2
  rm -f "$TMP"
  exit 1
fi

# -r = raw string, no JSON quotes (required for Bearer tokens)
TOKEN=$(jq -r '.access_token' "$TMP")
rm -f "$TMP"

if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
  echo "sign-in response missing access_token" >&2
  exit 1
fi

printf 'export USER_TOKEN=%q\n' "$TOKEN"
