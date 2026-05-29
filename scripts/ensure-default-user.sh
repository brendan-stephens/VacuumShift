#!/usr/bin/env bash
# Ensure DEFAULT_ADMIN_EMAIL + DEFAULT_ADMIN_PASSWORD can sign in (local dev only).
# No-op unless both variables are set in .env.local. Called from stack:start.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ ! -f "$ROOT/.env.local" ]]; then
  exit 0
fi

# shellcheck disable=SC1091
set -a && source "$ROOT/.env.local" && set +a

EMAIL="${DEFAULT_ADMIN_EMAIL:-}"
PASSWORD="${DEFAULT_ADMIN_PASSWORD:-}"

if [[ -z "$EMAIL" || -z "$PASSWORD" ]]; then
  exit 0
fi

AUTH_URL="${SUPABASE_URL:-http://127.0.0.1:54321}/auth/v1"
SECRET="${SUPABASE_SECRET_KEY:-}"
PUBLISHABLE="${SUPABASE_PUBLISHABLE_KEY:-}"

if [[ -z "$SECRET" || -z "$PUBLISHABLE" ]]; then
  echo "ensure-default-user: SUPABASE_SECRET_KEY and SUPABASE_PUBLISHABLE_KEY required" >&2
  exit 1
fi

sign_in() {
  local tmp http
  tmp=$(mktemp)
  http=$(curl -s -o "$tmp" -w "%{http_code}" \
    "${AUTH_URL}/token?grant_type=password" \
    -H "apikey: ${PUBLISHABLE}" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")
  rm -f "$tmp"
  [[ "$http" == "200" ]]
}

find_user_id() {
  local tmp id
  tmp=$(mktemp)
  curl -s -o "$tmp" \
    "${AUTH_URL}/admin/users?page=1&per_page=200" \
    -H "apikey: ${SECRET}" \
    -H "Authorization: Bearer ${SECRET}"
  id=$(jq -r --arg e "$EMAIL" '.users[]? | select(.email == $e) | .id' "$tmp" | head -n1)
  rm -f "$tmp"
  if [[ -n "$id" && "$id" != "null" ]]; then
    printf '%s' "$id"
  fi
}

create_user() {
  local tmp http
  tmp=$(mktemp)
  http=$(curl -s -o "$tmp" -w "%{http_code}" -X POST "${AUTH_URL}/admin/users" \
    -H "apikey: ${SECRET}" \
    -H "Authorization: Bearer ${SECRET}" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"email_confirm\":true}")
  if [[ "$http" == "200" || "$http" == "201" ]]; then
    rm -f "$tmp"
    return 0
  fi
  if jq -e '.msg | test("already|exists|registered"; "i")' "$tmp" >/dev/null 2>&1; then
    rm -f "$tmp"
    return 2
  fi
  echo "ensure-default-user: admin create failed (HTTP ${http}):" >&2
  jq . "$tmp" 2>/dev/null || cat "$tmp" >&2
  rm -f "$tmp"
  return 1
}

update_password() {
  local user_id="$1" tmp http
  tmp=$(mktemp)
  http=$(curl -s -o "$tmp" -w "%{http_code}" -X PUT "${AUTH_URL}/admin/users/${user_id}" \
    -H "apikey: ${SECRET}" \
    -H "Authorization: Bearer ${SECRET}" \
    -H "Content-Type: application/json" \
    -d "{\"password\":\"${PASSWORD}\"}")
  rm -f "$tmp"
  [[ "$http" == "200" ]]
}

if sign_in; then
  echo "  ✓ Default user ready (${EMAIL})"
  exit 0
fi

set +e
create_user
created=$?
set -e

if [[ "$created" -eq 0 ]]; then
  echo "  ✓ Created default user (${EMAIL})"
  exit 0
fi

user_id=$(find_user_id)
if [[ -z "$user_id" ]]; then
  echo "ensure-default-user: could not find or create ${EMAIL}" >&2
  exit 1
fi

if ! update_password "$user_id"; then
  echo "ensure-default-user: failed to sync password for ${EMAIL}" >&2
  exit 1
fi

if sign_in; then
  echo "  ✓ Default user ready (${EMAIL}, password synced from .env.local)"
  exit 0
fi

echo "ensure-default-user: password sync did not yield a working sign-in for ${EMAIL}" >&2
exit 1
