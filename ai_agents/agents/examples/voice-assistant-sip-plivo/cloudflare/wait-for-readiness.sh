#!/bin/sh
set -eu

if [ "$#" -lt 2 ] || [ "$#" -gt 4 ]; then
  echo "usage: $0 <url> <service-name> [attempts] [delay-seconds]" >&2
  exit 2
fi

url="$1"
service_name="$2"
attempts="${3:-24}"
delay_seconds="${4:-5}"
attempt=1

while [ "$attempt" -le "$attempts" ]; do
  if curl -sf --max-time 10 "$url" >/dev/null 2>&1; then
    echo "$service_name is ready"
    exit 0
  fi
  echo "  waiting for $service_name readiness... ($attempt/$attempts)"
  if [ "$attempt" -lt "$attempts" ]; then
    sleep "$delay_seconds"
  fi
  attempt=$((attempt + 1))
done

echo "ERROR: $service_name did not become ready after $attempts probes" >&2
exit 1
