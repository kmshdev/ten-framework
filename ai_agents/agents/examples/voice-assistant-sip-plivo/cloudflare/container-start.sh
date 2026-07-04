#!/bin/bash
# Container entrypoint: dashboard frontend (3000) + launcher (8080),
# which spawns the tenapp Plivo server (9000).
set -e

cd /app/frontend && bun start &

# Launcher runs as the main process; if the tenapp dies, the launcher exits
# and the container stops (matching upstream behavior).
cd /app
exec python3 /app/server/main.py --tenapp-dir /app/agents --port 8080
