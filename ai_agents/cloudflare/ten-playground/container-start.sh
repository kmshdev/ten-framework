#!/bin/bash
set -euo pipefail

cd /app/playground
bun start &
frontend_pid=$!

/app/server/bin/api -tenapp_dir=/app/agents &
api_pid=$!

cd /app/agents
tman designer &
designer_pid=$!

socat TCP-LISTEN:49484,fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:49483 &
designer_proxy_pid=$!

term() {
  kill "$frontend_pid" "$api_pid" "$designer_pid" "$designer_proxy_pid" 2>/dev/null || true
}
trap term INT TERM

wait -n "$frontend_pid" "$api_pid" "$designer_pid" "$designer_proxy_pid"
term
