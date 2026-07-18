#!/bin/bash
# Container entrypoint: dashboard frontend (3000) + launcher (8080),
# which spawns the tenapp Plivo server (9000).
set -e

# Railway injects PORT for the public launcher. Keep the internal Next.js
# process on its dedicated port so it cannot steal the launcher's socket.
cd /app/frontend && bun start --port 3000 &

# Launcher runs as the main process; if the tenapp dies, the launcher exits
# and the container stops (matching upstream behavior).
cd /app
exec python3 /app/server/main.py --tenapp-dir /app/agents --port 8080
