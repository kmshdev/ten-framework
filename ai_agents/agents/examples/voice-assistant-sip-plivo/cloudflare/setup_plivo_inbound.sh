#!/bin/sh
# Wire the purchased Plivo number to the SuperYou voice agent for INBOUND calls.
# - Creates (or reuses) a Plivo XML Application pointing at the Worker webhooks
# - Attaches the application to the purchased number
#
# Requires in env: PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN, PLIVO_FROM_NUMBER
# Usage: set -a; . ../../../../.env; set +a; sh setup_plivo_inbound.sh
set -eu

BASE_URL="${PLIVO_PUBLIC_SERVER_URL:-superyou-voice-agent.gateway-worker-ai.workers.dev}"
# strip any scheme
BASE_URL="${BASE_URL#https://}"
BASE_URL="${BASE_URL#http://}"
APP_NAME="superyou-voice-agent"
ANSWER_URL="https://${BASE_URL}/webhook/answer"
HANGUP_URL="https://${BASE_URL}/webhook/status"
# Plivo Number API wants the number without '+'
NUMBER="$(printf '%s' "$PLIVO_FROM_NUMBER" | tr -d '+')"
API="https://api.plivo.com/v1/Account/${PLIVO_AUTH_ID}"

echo "==> Looking for existing application '${APP_NAME}'..."
APP_ID="$(curl -s "${API}/Application/" -u "${PLIVO_AUTH_ID}:${PLIVO_AUTH_TOKEN}" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);m=[a['app_id'] for a in d.get('objects',[]) if a['app_name']=='${APP_NAME}'];print(m[0] if m else '')")"

if [ -z "$APP_ID" ]; then
  echo "==> Creating application '${APP_NAME}'..."
  APP_ID="$(curl -s -X POST "${API}/Application/" \
    -u "${PLIVO_AUTH_ID}:${PLIVO_AUTH_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"app_name\":\"${APP_NAME}\",\"answer_url\":\"${ANSWER_URL}\",\"answer_method\":\"POST\",\"hangup_url\":\"${HANGUP_URL}\",\"hangup_method\":\"POST\",\"fallback_answer_url\":\"${ANSWER_URL}\",\"fallback_method\":\"POST\"}" \
    | python3 -c "import sys,json;print(json.load(sys.stdin).get('app_id',''))")"
else
  echo "==> Updating existing application ${APP_ID}..."
  curl -s -X POST "${API}/Application/${APP_ID}/" \
    -u "${PLIVO_AUTH_ID}:${PLIVO_AUTH_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"answer_url\":\"${ANSWER_URL}\",\"answer_method\":\"POST\",\"hangup_url\":\"${HANGUP_URL}\",\"hangup_method\":\"POST\",\"fallback_answer_url\":\"${ANSWER_URL}\",\"fallback_method\":\"POST\"}" >/dev/null
fi

[ -n "$APP_ID" ] || { echo "ERROR: could not create/find application"; exit 1; }
echo "    app_id=${APP_ID}"

echo "==> Attaching application to number ${NUMBER}..."
curl -s -X POST "${API}/Number/${NUMBER}/" \
  -u "${PLIVO_AUTH_ID}:${PLIVO_AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"app_id\":\"${APP_ID}\"}"
echo

echo "==> Verifying..."
curl -s "${API}/Number/${NUMBER}/" -u "${PLIVO_AUTH_ID}:${PLIVO_AUTH_TOKEN}" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('number:',d['number']);print('application:',d.get('application'))"
echo "==> Done. Inbound calls to ${PLIVO_FROM_NUMBER} will hit ${ANSWER_URL}"
