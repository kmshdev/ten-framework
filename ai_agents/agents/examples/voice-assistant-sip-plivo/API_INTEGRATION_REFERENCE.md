# SuperYou Voice Agent — API Integration Reference

Base URL: `https://superyou-voice-agent.gateway-worker-ai.workers.dev`

This document is the exact, verified surface for integrating a frontend against the SuperYou voice-agent stack. Everything below was read directly from source — no invented endpoints. Source files are cited per section so you can jump straight to the implementation.

---

## 1. Two layers, one hostname

All traffic hits the **Cloudflare Worker** first (`cloudflare/src/index.ts`). It routes by path prefix to one of:

| Destination | What it is | Routing rule |
|---|---|---|
| **Worker itself** | D1 + Vectorize + Workers AI, no container involved | `path.startsWith("/demo/")` |
| **Worker admin** | Force-restart the container | `path === "/admin/restart"` |
| **Container : 9000** (`tenapp`) | FastAPI: Plivo webhooks, call control, media WebSocket | `/webhook/*`, `/api/*`, `/media`, WS upgrade |
| **Container : 8080** (launcher) | Health/config passthrough | `/health`, `/backend/*` (prefix stripped) |
| **Container : 3000** (Next.js) | Ops dashboard frontend | everything else, and `/tenapp/*` (prefix stripped) |

Source: `agents/examples/voice-assistant-sip-plivo/cloudflare/src/index.ts:68-125`

**Practical effect for a frontend:** you always call the one public hostname above. The Worker's routing table decides whether Cloudflare answers directly (fast, `/demo/*`) or proxies into the container (`/api/*`, `/webhook/*`, `/media`). There is no separate origin to configure and no CORS setup needed for `/demo/*` (`Access-Control-Allow-Origin: *` is set explicitly) — but note **`/api/*` and `/webhook/*` currently have no auth and no CORS headers**, see §5.

Cold start: the container sleeps after 2h idle (`sleepAfter: "2h"`, `wrangler.jsonc:16`). First request after sleep can take 60–120s while the tenapp process boots — the Worker's `waitForTenapp()` blocks on port 9000 becoming ready before proxying (`index.ts:113-118`).

---

## 2. Call-control API (container, port 9000)

Source: `agents/examples/voice-assistant-sip-plivo/tenapp/ten_packages/extension/main_python/server.py`

### `POST /api/call` — place an outbound call

```
POST https://superyou-voice-agent.gateway-worker-ai.workers.dev/api/call
Content-Type: application/json

{
  "phone_number": "+917011457245",
  "message": "Hello from Plivo!",       // optional, cosmetic only
  "persona_phone": "+919876543210",     // optional: pose as a seeded customer
  "persona_name": "Rahul Verma"         // optional, cosmetic only
}
```

`persona_phone` lets the demo console dial the operator's real phone but have the agent look up orders/memory under a different (seeded) customer identity — useful for demos where the tester's own number isn't in the D1 seed data. Source: `server.py:92-96`.

**Response `200`:**
```json
{
  "success": true,
  "call_uuid": "a6febc37-5dff-4f41-8c3d-99840b8f461a",
  "status": "initiated",
  "phone_number": "+917011457245",
  "message": "Hello from Plivo!",
  "persona_phone": null,
  "persona_name": null
}
```
**Errors:** `400` if `phone_number` missing or `plivo_public_server_url` unset server-side; `500` on Plivo API failure (e.g. malformed `from` number). Source: `server.py:85-162`.

### `GET /api/call/{call_uuid}` — poll call status

```
GET /api/call/a6febc37-5dff-4f41-8c3d-99840b8f461a
```
```json
{
  "success": true,
  "call_uuid": "a6febc37-...",
  "status": "in-progress",
  "phone_number": "+917011457245",
  "message": "Hello from Plivo!",
  "created_at": "2026-07-04T21:28:16.123456",
  "ended_at": null
}
```
`404` if the call isn't tracked (never existed or already cleaned up post-hangup). Source: `server.py:197-220`.

### `DELETE /api/call/{call_uuid}` — hang up

```json
{ "success": true, "call_uuid": "a6febc37-...", "status": "completed" }
```
`404` if not found; `500` on Plivo hangup failure. Source: `server.py:164-195`.

### `GET /api/calls` — list all tracked calls

```json
{ "success": true, "active_calls": 1, "calls": ["a6febc37-5dff-4f41-8c3d-99840b8f461a"] }
```
Source: `server.py:222-231`.

### `GET /api/config` — server-side config snapshot

```json
{
  "plivo_from_number": "+912269986967",
  "server_port": 9000,
  "public_server_url": "superyou-voice-agent.gateway-worker-ai.workers.dev",
  "use_https": true,
  "use_wss": true,
  "media_stream_enabled": true,
  "media_ws_url": "wss://superyou-voice-agent.gateway-worker-ai.workers.dev/media",
  "webhook_enabled": true,
  "webhook_url": "https://superyou-voice-agent.gateway-worker-ai.workers.dev/webhook/status"
}
```
Useful for a frontend to discover the live media WS URL rather than hardcoding it. Source: `server.py:517-548`.

### `GET /health` — liveness probe

```json
{ "status": "healthy", "active_calls": 1, "server_time": "2026-07-05T03:17:02.000000" }
```
Source: `server.py:506-515`.

### `POST /api/transfer` — escalate active call to a human (used internally by the `transfer_to_human` LLM tool, but callable directly)

```json
{ "reason": "Customer requested to speak with a real person." }
```
Picks whichever tracked call currently has a live media websocket. If `HUMAN_AGENT_NUMBER` is unset (demo mode today), responds without touching Plivo:
```json
{
  "escalation_registered": true,
  "demo_mode": true,
  "message": "Escalation registered successfully. Tell the caller a human support agent will call them back within 15 minutes. Do NOT apologize or say the transfer failed.",
  "reason": "..."
}
```
If configured, it calls `plivo_client.calls.transfer(...)` to bridge the live leg to `/webhook/transfer-xml`, which plays a hold message and dials `HUMAN_AGENT_NUMBER`. Source: `server.py:233-352`.

### `POST /api/memory/search` — targeted mem0 recall (used internally by the `recall_customer_memory` LLM tool)

```json
{ "query": "previous order" }
```
```json
{ "results": [ { "...": "mem0 result shape" } ] }
```
Returns `{"results": []}` if mem0 isn't configured for this call. Source: `server.py:321-337`.

---

## 3. Plivo webhooks (container, port 9000) — not for frontend use

These are called by Plivo's telephony platform, not by a browser. Documented here for completeness / debugging.

| Endpoint | Method | Purpose |
|---|---|---|
| `/webhook/answer` | GET/POST | Plivo calls this the instant a call is answered. Returns Plivo XML `<Stream>` pointing at `/media` (WSS), which starts the bidirectional audio stream. Source: `server.py:354-445`. |
| `/webhook/status` | GET/POST | Call lifecycle callback (`ringing`, `in-progress`, `completed`, `failed`, etc). On terminal status, triggers `on_call_ended` (mem0 flush) and drops the session. Source: `server.py:447-504`. |
| `/webhook/transfer-xml` | GET/POST | XML played to the caller during a human transfer (`<Speak>` + `<Dial>`). Source: `server.py:339-352`. |

Manually exercising `/webhook/answer` (e.g. to force-warm a cold container) requires the exact Plivo form fields:
```bash
curl -X POST .../webhook/answer -d 'CallUUID=test&From=%2B917011457245&Direction=inbound'
```

---

## 4. Media WebSocket — the real-time audio channel

```
wss://superyou-voice-agent.gateway-worker-ai.workers.dev/media
```

This is Plivo's **Audio Streaming** protocol (bidirectional). Source: `server.py:550-656` (inbound handling) and `extension.py:395-611` (main_python extension, outbound send + barge-in).

### Inbound events (Plivo → server)

| `event` | Shape | Meaning |
|---|---|---|
| `start` | `{"event":"start","streamId":"...","start":{"callId":"...", ...}}` | Stream handshake; server binds `callId` to this websocket and notifies the extension via `on_websocket_connected`. |
| `media` | `{"event":"media","streamId":"...","media":{"payload":"<base64 mulaw>","track":"inbound"}}` | Raw audio chunk, forwarded straight into the TEN ASR pipeline (`_forward_audio_to_ten`). |
| `stop` | `{"event":"stop", ...}` | Stream ended. |

The server also sends one immediate confirmation frame on connect:
```json
{"type": "connected", "message": "WebSocket connection established"}
```

### Outbound events (server → Plivo)

| `event` | Shape | When |
|---|---|---|
| `playAudio` | `{"event":"playAudio","media":{"contentType":"audio/x-mulaw","sampleRate":8000,"payload":"<base64>"}}` | Every TTS chunk the agent speaks. **`contentType` MUST be the bare MIME type and `sampleRate` a separate numeric field** — Plivo silently drops frames that don't match this exact envelope (this was a real production bug; see `extension.py:593-606`). |
| `clearAudio` | `{"event":"clearAudio","streamId":"..."}` | Sent on barge-in (caller interrupts mid-sentence) to flush any queued audio Plivo hasn't played yet. Source: `extension.py:395-398`. |

**Audio format both directions:** `audio/x-mulaw` @ 8000 Hz, base64-encoded payload, matching the `contentType="audio/x-mulaw;rate=8000"` declared in the `<Stream>` XML from `/webhook/answer`.

**A frontend embedding a live-listen feature would**: open this same `wss://.../media` URL is *not* an option (it's the Plivo-facing leg, single consumer). For a browser "listen in" experience, the sane integration point is polling `/demo/transcripts` (see §5) or piping recorded audio, since the raw media WS is 1:1 with the live Plivo call.

---

## 5. Demo/data API (Worker itself — D1, Vectorize, Workers AI)

Source: `agents/examples/voice-assistant-sip-plivo/cloudflare/src/index.ts:143-397`. All `/demo/*` responses include `Access-Control-Allow-Origin: *` — safe to call directly from a browser.

### `GET /demo/order-status?phone=...` or `?order_number=...`

```
GET /demo/order-status?phone=%2B917011457245
GET /demo/order-status?order_number=SY10121
```
`order_number` accepts `"SY10042"`, `"#SY10042"`, or bare `"10042"` (normalized server-side). `phone` matches on the last 10 digits (ignores `+91` prefix variance).

```json
{
  "found": true,
  "orders": [
    {
      "order_number": "#SY10121",
      "customer_name": "Rahul Verma",
      "placed_at": "2026-06-04T10:00:00Z",
      "cancelled_at": null,
      "payment_status": "paid",
      "shipping_city": "Mumbai",
      "total_price_inr": "2083.00",
      "items": [
        { "title": "Cheese Protein Wafer 10-Pack", "quantity": 2, "price": "699.00" }
      ],
      "shipment": {
        "courier": "DTDC",
        "awb": "DT2553854176",
        "status": "in_transit",
        "estimated_delivery": "2026-06-10",
        "last_checkpoint": "Departed Bhiwandi sorting hub",
        "last_checkpoint_at": "2026-06-07T18:00:00Z"
      }
    }
  ]
}
```
Returns up to 3 most recent orders; `{"found": false, "message": "No orders found"}` if none match; `400` if neither param given. Source: `index.ts:143-216`.

### `GET /demo/customers?q=...&limit=...`

Search seeded customers by name/phone/city (`limit` capped at 200, default 200).
```json
{ "customers": [ { "id": 20, "first_name": "Rahul", "last_name": "Verma", "phone": "+917011457245", "default_city": "Mumbai", "orders_count": 2 } ] }
```
Source: `index.ts:218-247`.

### `GET /demo/kb/query?q=...&top_k=3`

Vector search over the SuperYou knowledge base (embedded with `@cf/baai/bge-m3` via Workers AI, stored in Vectorize).
```json
{
  "query": "is protein gluten free",
  "results": [
    { "score": 0.92, "title": "Allergen Information", "section": "Protein Wafers", "text": "All wafer SKUs are manufactured in a facility that processes tree nuts and peanuts..." }
  ]
}
```
`top_k` capped at 10. `400` if `q` missing. Source: `index.ts:287-305`.

### `POST /demo/kb/seed` — admin-gated, re-embed the KB from `kb_seed.json`

```
POST /demo/kb/seed
x-admin-token: <PLIVO_AUTH_TOKEN>
```
```json
{ "ok": true, "upserted": 42 }
```
`401` without the correct `x-admin-token` header (reuses the Plivo auth token as a lightweight admin secret — no separate credential exists yet). Source: `index.ts:256-285`.

### `GET/POST /demo/transcripts` — call transcript store

**List calls:**
```
GET /demo/transcripts
```
```json
{ "calls": [ { "call_id": "a6febc37-...", "caller": "+917011457245", "messages": 12, "started_at": "2026-07-04 21:28:16", "last_at": "2026-07-04 21:29:28" } ] }
```

**Get one call's transcript:**
```
GET /demo/transcripts?call_id=a6febc37-5dff-4f41-8c3d-99840b8f461a
```
```json
{
  "call_id": "a6febc37-...",
  "messages": [
    { "role": "assistant", "content": "Namaste! Welcome to SuperYou support...", "caller": "+917011457245", "ts": "2026-07-04 21:28:16" },
    { "role": "user", "content": "Hello?", "caller": "+917011457245", "ts": "2026-07-04 21:28:34" },
    { "role": "tool", "content": "get_order_status({\"phone\": \"+917011457245\"})", "caller": "+917011457245", "ts": "2026-07-04 21:29:12" }
  ]
}
```
`role` is one of `assistant | user | tool`. This is the **best integration point for a live-updating frontend transcript view** — poll it (no SSE/websocket push exists for this yet, see Gaps below).

**Append a message** (used internally by the agent extension during a call, but is a plain unauthenticated POST):
```json
POST /demo/transcripts
{ "call_id": "...", "caller": "+91...", "role": "assistant", "content": "..." }
```
`400` if any of `call_id`/`role`/`content` missing. Source: `index.ts:307-346`.

### `POST /admin/restart` — force-recycle the container

```
POST /admin/restart
x-admin-token: <PLIVO_AUTH_TOKEN>
```
```json
{ "restarted": true }
```
Destroys the Durable Object-backed container instance; the next request boots a fresh one (picks up new image tags/secrets, clears any extension stuck in a fatal state). `401` without the token. Source: `index.ts:382-391`.

---

## 6. What does NOT exist yet (do not build against these)

- **No SSE endpoint anywhere in this stack.** Any "live transcript streaming" UI must poll `/demo/transcripts?call_id=...` on an interval (2-3s is reasonable) or be added as new work.
- **No auth on `/api/*` or `/webhook/*`** — anyone with the Worker URL can place outbound calls (toll fraud risk) or hang up/transfer arbitrary live calls. `/demo/transcripts` (PII: phone numbers + conversation content) has no auth either, only `/demo/kb/seed` and `/admin/restart` are gated, and only by a reused Plivo secret, not a purpose-built admin credential.
- **No websocket for frontend consumption of the live call audio.** `/media` is Plivo's dedicated leg.
- **No pagination cursor** on `/demo/transcripts` calls list — hardcoded `LIMIT 50`.

---

## 7. Source file index

| File | Role |
|---|---|
| `cloudflare/src/index.ts` | Worker: routing table + all `/demo/*` + `/admin/restart` |
| `cloudflare/wrangler.jsonc` | Bindings (D1 `DB`, Vectorize `KB`, Workers AI `AI`), container image pin |
| `tenapp/.../main_python/server.py` | Container FastAPI: `/api/*`, `/webhook/*`, `/media`, `/health` |
| `tenapp/.../main_python/extension.py` | TTS→Plivo audio send (`playAudio`/`clearAudio`), barge-in, call lifecycle hooks |
| `tenapp/.../superyou_tools_python/extension.py` | LLM tool implementations that call `/demo/*` and local `/api/*` |
| `frontend/app/api.ts` | Existing same-origin frontend client (reference implementation) |
