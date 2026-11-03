#!/bin/bash
set -e

if [ -z "${MONGO_APP_USER:-}" ] || [ -z "${MONGO_APP_PASSWORD:-}" ]; then
  echo "MONGO_APP_USER and MONGO_APP_PASSWORD must be set." >&2
  exit 1
fi

json_quote() {
  local value=$1
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//$'\n'/\\n}
  value=${value//$'\r'/\\r}
  value=${value//$'\t'/\\t}
  printf '"%s"' "$value"
}

init_script=$(mktemp)
trap 'rm -f "$init_script"' EXIT

printf 'db = db.getSiblingDB("Samar");\ndb.createUser({ user: %s, pwd: %s, roles: [{ role: "readWrite", db: "Samar" }] });\n' \
  "$(json_quote "$MONGO_APP_USER")" \
  "$(json_quote "$MONGO_APP_PASSWORD")" > "$init_script"

mongosh --quiet --file "$init_script"
