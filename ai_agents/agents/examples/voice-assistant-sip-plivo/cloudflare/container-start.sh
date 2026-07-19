#!/bin/sh
# PID 1 supervises the frontend and launcher; the launcher supervises TEN.
set -eu

exec python3 /app/server/process_supervisor.py
