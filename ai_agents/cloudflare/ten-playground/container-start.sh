#!/bin/bash
set -euo pipefail

cd /app/playground
bun start &
frontend_pid=$!

/app/server/bin/api -tenapp_dir=/app/agents &
api_pid=$!

term() {
  kill "$frontend_pid" "$api_pid" 2>/dev/null || true
}
trap term INT TERM

wait -n "$frontend_pid" "$api_pid"
term
