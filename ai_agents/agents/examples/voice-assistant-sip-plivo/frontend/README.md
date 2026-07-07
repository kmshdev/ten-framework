# SuperYou Voice Agent — Console Frontend

Next.js console for the SuperYou voice-AI customer support demo. The agent
(Maya, running on the TEN Framework behind Plivo SIP) is the interface: a
particle-ring visualizer shows her live state, the TEN pipeline trace shows
which stage is active, and the call tape streams the conversation with the
agent's tool calls expandable into the artifacts she retrieved.

Design system: [`../.interface-design/system.md`](../.interface-design/system.md)
· approved mockups in [`../.design/`](../.design/).

## Layout

Locked viewport, three rows:

1. **Header** — brand mark, backend health dot, past-sessions drawer.
2. **Stage** — caller identity, agent visualizer (canvas port of LiveKit
   Agents UI `AgentAudioVisualizerCustom`), state word, `SIP → ASR → LLM → TTS`
   pipeline trace, control bar (outbound dialer when idle; session controls
   when live).
3. **Call tape** (34vh) — flowing transcript. Tool invocations
   (`get_order_status`, `search_superyou_kb`, `recall_customer_memory`,
   `transfer_to_human`) render as collapsed traces; expanding one fetches and
   shows the real order/KB artifact from the `/demo` endpoints.

## Setup

```bash
cd frontend
bun install       # or npm install
bun run dev       # http://localhost:3000
```

All API calls default to same-origin relative paths (the app is served behind
the same Cloudflare Worker origin as the backend). Optional overrides for
local development via `.env.local`:

```bash
NEXT_PUBLIC_TWILIO_SERVER_URL=http://localhost:8080   # call-control server
NEXT_PUBLIC_TENAPP_SERVER_URL=http://localhost:8080   # tenapp server
```

## Project structure

```
frontend/
├── app/
│   ├── globals.css              # Quiet Stage design tokens
│   ├── layout.tsx               # Fonts (Antonio / Archivo / JetBrains Mono)
│   ├── page.tsx                 # Stage composition
│   ├── api.ts                   # Call-control client (callAPI)
│   └── demoApi.ts               # /demo endpoints (transcripts, orders, KB)
├── hooks/
│   └── useAgentSession.ts       # Single polling source + derived agent state
├── components/console/
│   ├── AgentVisualizer.tsx      # Canvas port of AgentAudioVisualizerCustom
│   ├── PipelineTrace.tsx        # SIP → ASR → LLM → TTS indicator
│   ├── ControlBar.tsx           # AgentControlBar analog / outbound dialer
│   ├── CallTape.tsx             # Flowing transcript + tool-call artifacts
│   └── SessionsDrawer.tsx       # Past sessions / replay
└── tailwind.config.js           # Token → Tailwind mapping
```

## Backend endpoints used

- `GET /demo/transcripts` · `GET /demo/transcripts?call_id=…` — tape polling
- `GET /demo/customers` · `GET /demo/customers?q=…` — seeded persona picker (cloudflare/seed.sql)
- `GET /demo/order-status?order_number|phone=…` — order artifacts
- `GET /demo/kb/query?q=…` — KB artifacts
- `POST /api/call` · `DELETE /api/call/{call_uuid}` — outbound call control.
  `POST /api/call` accepts `{ phone_number, message?, persona_phone?, persona_name? }`:
  the call rings `phone_number`, but when `persona_phone`/`persona_name` are
  set, the agent's order lookups and memory recall use that seeded
  customer's identity instead of the real dialed number — i.e. it "poses as"
  that customer for the demo.
- `GET /health` — header status dot

## Agent state (no LiveKit room)

Calls flow over Plivo SIP into the TEN agent — there is no browser audio
track. `useAgentSession` derives LiveKit-style visualizer states from
transcript activity: latest `tool` message → `thinking`, recent `assistant`
message → `speaking`, live call otherwise → `listening`, no live call →
`idle`. The visualizer component is prop-compatible with the real
`AgentAudioVisualizerCustom`, so it can be swapped in if the app ever joins a
LiveKit room.

## Tech stack

- **Next.js 16** + **TypeScript 6** (with a TypeScript 7 RC fast-typecheck script — see `package.json`)
- **Tailwind CSS 4** (tokens via CSS custom properties)
- `@livekit/components-react` / `livekit-client` / `@livekit/components-styles` — the visualizer is a canvas port of Agents UI's `AgentAudioVisualizerCustom`, kept prop-compatible so a real LiveKit room can be swapped in later
- Fonts via `next/font`: Antonio (brand caps), Archivo (body), JetBrains Mono (data)
- No other component library — the console components are self-contained
