#!/bin/bash
# Runs a tool against the Supabase project with the secrets it needs, read
# from ~/.config/sail-away.env (never from the repo):
#
#   tools/run.sh seed          fill an empty database (tools/seed.mjs)
#   tools/run.sh test [args]   the Playwright tests
#   tools/run.sh sql           run SQL from stdin as the database owner
#
# The service key is fetched from the Supabase management API for this run
# only and never written anywhere.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${SAIL_AWAY_ENV:-$HOME/.config/sail-away.env}"
# Plain KEY=VALUE lines; nothing in the file is run as shell.
while IFS='=' read -r k v; do
  [[ "$k" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
  export "$k=$v"
done < "$ENV_FILE"

export SUPABASE_URL="https://$SUPABASE_PROJECT_REF.supabase.co"
api() { curl -sf -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/$1" "${@:2}"; }
service_key() {
  api "api-keys?reveal=true" | python3 -I -c '
import json, sys
keys = json.load(sys.stdin)
pick = [k for k in keys if k.get("type") == "secret"] or [k for k in keys if k.get("name") == "service_role"]
print(pick[0]["api_key"])'
}

cmd="${1:-}"; shift || true
case "$cmd" in
  seed)
    SUPABASE_SERVICE_KEY="$(service_key)" node tools/seed.mjs "$@" ;;
  test)
    SUPABASE_SERVICE_KEY="$(service_key)" npx playwright test "$@" ;;
  sql)
    python3 -I -c 'import json,sys;print(json.dumps({"query":sys.stdin.read()}))' \
      | api "database/query" -X POST -H "Content-Type: application/json" --data-binary @-
    echo ;;
  *)
    echo "usage: tools/run.sh seed | test [args] | sql < file.sql" >&2; exit 2 ;;
esac
