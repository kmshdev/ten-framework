#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
WORKER_NAME="ten-playground"
WORKFLOW_NAME="ten-playground-image.yml"

cd "$SCRIPT_DIR"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || fail ".env not found at $ENV_FILE"
npx wrangler whoami >/dev/null 2>&1 || fail "wrangler is not authenticated - run: npx wrangler login"
gh auth status >/dev/null 2>&1 || fail "GitHub CLI is not authenticated - run: gh auth login"

read_env() {
  grep -E "^${1}=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e "s/^['\"]//" -e "s/['\"]$//" || true
}

REQUIRED_KEYS=(AGORA_APP_ID DEEPGRAM_API_KEY OPENAI_API_KEY ELEVENLABS_TTS_KEY)
OPTIONAL_KEYS=(AGORA_APP_CERTIFICATE OPENAI_MODEL OPENAI_API_BASE OPENAI_PROXY_URL WEATHERAPI_API_KEY)

for key in "${REQUIRED_KEYS[@]}"; do
  [ -n "$(read_env "$key")" ] || fail "required key $key is missing or empty in $ENV_FILE"
done

SECRETS_FILE="$(mktemp)"
trap 'rm -f "$SECRETS_FILE"' EXIT

log "Installing Worker dependencies"
npm install --no-fund --no-audit

BRANCH="$(git -C "$REPO_DIR" branch --show-current)"
[ -n "$BRANCH" ] || fail "could not determine current git branch"

log "Starting native-amd64 GitHub Actions deploy on branch $BRANCH"
gh workflow run "$WORKFLOW_NAME" --repo kmshdev/ten-framework --ref "$BRANCH"
sleep 10

RUN_ID="$(gh run list --repo kmshdev/ten-framework --workflow "$WORKFLOW_NAME" --branch "$BRANCH" --limit 1 --json databaseId --jq '.[0].databaseId')"
[ -n "$RUN_ID" ] || fail "could not find the started workflow run"
gh run watch "$RUN_ID" --repo kmshdev/ten-framework --exit-status

log "Uploading runtime secrets"
{
  echo "{"
  first=true
  for key in "${REQUIRED_KEYS[@]}" "${OPTIONAL_KEYS[@]}"; do
    val="$(read_env "$key")"
    if [ "$key" = "OPENAI_MODEL" ] && [ -z "$val" ]; then
      val="gpt-4o-mini"
    fi
    [ -n "$val" ] || continue
    $first || echo ","
    first=false
    printf '  "%s": %s' "$key" "$(printf '%s' "$val" | jq -Rs .)"
  done
  echo
  echo "}"
} > "$SECRETS_FILE"
npx wrangler secret bulk "$SECRETS_FILE"

WORKER_URL="$(npx wrangler deployments list 2>/dev/null | grep -Eo "https://${WORKER_NAME}[a-zA-Z0-9.-]*\.workers\.dev" | head -1 || true)"
if [ -z "$WORKER_URL" ]; then
  WORKER_URL="https://${WORKER_NAME}.gateway-worker-ai.workers.dev"
fi

log "Warming up the container"
for i in $(seq 1 36); do
  if curl -sf --max-time 15 "$WORKER_URL/health" >/dev/null 2>&1; then
    echo "API server is healthy"
    break
  fi
  echo "  waiting for container... ($i/36)"
  sleep 5
done

if ! curl -sf --max-time 15 "$WORKER_URL/health" >/dev/null 2>&1; then
  fail "container did not become healthy at $WORKER_URL/health"
fi

log "Smoke-testing playground"
curl -sf --max-time 15 "$WORKER_URL" >/dev/null

cat <<EOF

============================================================
 TEN playground deployed
============================================================
 Playground: $WORKER_URL
 Health:     $WORKER_URL/health
 Logs:       npx wrangler tail $WORKER_NAME
============================================================
EOF
