#!/bin/bash
# Deploys the SuperYou voice agent (voice-assistant-sip-plivo) to Cloudflare
# Containers. Reads credentials from ai_agents/.env, deploys the Worker +
# container image, sets secrets (including the public Worker URL that Plivo
# uses for webhooks/media WS), and warms up the container.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
WORKER_NAME="superyou-voice-agent"

cd "$SCRIPT_DIR"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# --- 0. Preconditions -------------------------------------------------------
[ -f "$ENV_FILE" ] || fail ".env not found at $ENV_FILE"
npx wrangler whoami >/dev/null 2>&1 || fail "wrangler is not authenticated - run: npx wrangler login"

# Read a key from .env (last occurrence wins), stripping quotes.
read_env() {
  grep -E "^${1}=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e "s/^['\"]//" -e "s/['\"]$//"
}

REQUIRED_KEYS=(PLIVO_AUTH_ID PLIVO_AUTH_TOKEN PLIVO_FROM_NUMBER DEEPGRAM_API_KEY OPENAI_API_KEY ELEVENLABS_TTS_KEY)
OPTIONAL_KEYS=(OPENAI_MODEL ELEVENLABS_VOICE_ID SARVAM_API_KEY WEATHERAPI_API_KEY)

for key in "${REQUIRED_KEYS[@]}"; do
  val="$(read_env "$key")"
  [ -n "$val" ] || fail "required key $key is missing or empty in $ENV_FILE"
done

missing_optional=()
for key in "${OPTIONAL_KEYS[@]}"; do
  [ -n "$(read_env "$key")" ] || missing_optional+=("$key")
done
if [ "${#missing_optional[@]}" -gt 0 ]; then
  echo "NOTE: optional keys not set (ok for the default graph): ${missing_optional[*]}"
  echo "      SARVAM_API_KEY is required for the va_in_sarvam_stack / va_in_hybrid_stack graphs."
fi

# --- 1. Install Worker dependencies ----------------------------------------
log "Installing Worker dependencies"
npm install --no-fund --no-audit

# --- 2. Deploy Worker + container image ------------------------------------
log "Deploying to Cloudflare (uses the pre-built image from the managed registry)"
DEPLOY_LOG="$(mktemp)"
npx wrangler deploy 2>&1 | tee "$DEPLOY_LOG"

WORKER_URL="$(grep -Eo "https://${WORKER_NAME}[a-zA-Z0-9.-]*\.workers\.dev" "$DEPLOY_LOG" | head -1)"
[ -n "$WORKER_URL" ] || fail "could not determine the deployed Worker URL from wrangler output"
log "Worker URL: $WORKER_URL"

# --- 3. Upload secrets (incl. the public URL Plivo will call back to) ------
log "Uploading secrets"
SECRETS_FILE="$(mktemp)"
trap 'rm -f "$SECRETS_FILE" "$DEPLOY_LOG"' EXIT
{
  echo "{"
  first=true
  for key in "${REQUIRED_KEYS[@]}" "${OPTIONAL_KEYS[@]}"; do
    val="$(read_env "$key")"
    [ -n "$val" ] || continue
    $first || echo ","
    first=false
    printf '  "%s": %s' "$key" "$(printf '%s' "$val" | jq -Rs .)"
  done
  $first || echo ","
  printf '  "PLIVO_PUBLIC_SERVER_URL": %s\n' "$(printf '%s' "$WORKER_URL" | jq -Rs .)"
  echo "}"
} > "$SECRETS_FILE"
npx wrangler secret bulk "$SECRETS_FILE"

# --- 4. Warm up the container ----------------------------------------------
log "Warming up the container (cold start + tenapp boot can take ~1-2 minutes)"
for i in $(seq 1 24); do
  if curl -sf --max-time 10 "$WORKER_URL/health" >/dev/null 2>&1; then
    echo "launcher is healthy"
    break
  fi
  echo "  waiting for container... ($i/24)"
  sleep 5
done
for i in $(seq 1 24); do
  if curl -sf --max-time 10 "$WORKER_URL/api/calls" >/dev/null 2>&1; then
    echo "tenapp Plivo server is up"
    break
  fi
  echo "  waiting for tenapp... ($i/24)"
  sleep 5
done

# --- 5. Summary --------------------------------------------------------------
FROM_NUMBER="$(read_env PLIVO_FROM_NUMBER)"
cat <<EOF

============================================================
 SuperYou voice agent deployed
============================================================
 Dashboard:   $WORKER_URL
 Health:      $WORKER_URL/health
 Call API:    $WORKER_URL/api/calls

 Start an outbound demo call:
   curl -X POST $WORKER_URL/api/call \\
     -H "Content-Type: application/json" \\
     -d '{"phone_number": "+91XXXXXXXXXX", "message": "Namaste!"}'

 Inbound calls: in the Plivo console, create an XML Application with
   Answer URL:  $WORKER_URL/webhook/answer   (POST)
   Hangup URL:  $WORKER_URL/webhook/status   (POST)
 and assign it to $FROM_NUMBER.

 Logs:  npx wrangler tail $WORKER_NAME
============================================================
EOF
