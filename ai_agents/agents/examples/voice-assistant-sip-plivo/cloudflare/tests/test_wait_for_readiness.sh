#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
GATE="$SCRIPT_DIR/../wait-for-readiness.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

cat > "$TMP_DIR/curl" <<'EOF'
#!/bin/sh
count=0
if [ -f "$READINESS_COUNT_FILE" ]; then
  count=$(cat "$READINESS_COUNT_FILE")
fi
count=$((count + 1))
printf '%s' "$count" > "$READINESS_COUNT_FILE"
[ "$count" -ge "$READINESS_SUCCEEDS_AT" ]
EOF
cat > "$TMP_DIR/sleep" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$TMP_DIR/curl" "$TMP_DIR/sleep" "$GATE"

READINESS_COUNT_FILE="$TMP_DIR/success-count" \
READINESS_SUCCEEDS_AT=2 \
PATH="$TMP_DIR:$PATH" \
  "$GATE" "http://example.test/readyz" "application" 3 0 >/dev/null

[ "$(cat "$TMP_DIR/success-count")" = "2" ]

if READINESS_COUNT_FILE="$TMP_DIR/failure-count" \
  READINESS_SUCCEEDS_AT=99 \
  PATH="$TMP_DIR:$PATH" \
  "$GATE" "http://example.test/readyz" "application" 3 0 >/dev/null 2>&1; then
  echo "expected exhausted readiness probes to fail" >&2
  exit 1
fi

[ "$(cat "$TMP_DIR/failure-count")" = "3" ]
echo "readiness gate tests passed"
