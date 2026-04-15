#!/usr/bin/env sh
set -eu

BOOTSTRAP_FILE="${GLITCHTIP_BOOTSTRAP_ENV_FILE:-/app/runtime/glitchtip.env}"

if [ -z "${GLITCHTIP_DSN:-}" ] && [ -f "$BOOTSTRAP_FILE" ]; then
  # shellcheck disable=SC1090
  . "$BOOTSTRAP_FILE"
fi

exec uvicorn src.main:app --host 0.0.0.0 --port 8080
