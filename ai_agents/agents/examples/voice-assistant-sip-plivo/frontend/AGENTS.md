# AGENTS.md

This is the **SuperYou Voice Agent console** — a Next.js dashboard for a
phone support demo. It is a thin operator UI: it dials/monitors calls and
renders a live transcript. It is **not** a LiveKit Agents project and there
is no LiveKit Agents server runtime anywhere in this app.

See [`README.md`](./README.md) for the actual architecture, layout, backend
endpoints, and tech stack — keep that file, not this one, as the source of
truth for "what does this app do."

## What this project actually is

- **Real-time voice agent backend**: TEN Framework (Python) behind Plivo SIP
  telephony, in the sibling `../tenapp/` directory. That backend owns ASR,
  LLM, TTS, tool calls (order lookup, KB search, human transfer), and
  transcript persistence.
- **This frontend**: a Next.js 16 + React 19 + TypeScript console that polls
  the backend's `/api/*` and `/demo/*` HTTP endpoints (see README.md) to
  drive an outbound dialer, a live call-state visualizer, and a transcript
  tape. There is no WebSocket/SSE push channel and no browser audio track —
  calls are carried entirely over Plivo SIP, not WebRTC.
- **`@livekit/components-react` / `livekit-client`** are dependencies here
  for exactly one thing: `AgentAudioVisualizerCustom`, whose canvas rendering
  approach was ported into `components/console/AgentVisualizer.tsx`. There is
  no LiveKit room, token, or server SDK involved. Do not add LiveKit Agents
  server-side code to this app — if the demo ever needs a real LiveKit room,
  that is a separate, deliberate architecture change, not an incremental one.

## Package manager and scripts

This project uses **bun** (`bun.lock` is the committed lockfile); `npm` is
an accepted fallback. Do not introduce `pnpm` or a `pnpm-lock.yaml`.

Scripts available in `package.json` (there is no `test` script):

```bash
bun install
bun run dev             # http://localhost:3000
bun run build
bun run start
bun run lint             # eslint .
bun run typecheck        # TypeScript 7 RC, fast path
bun run typecheck:legacy # stable tsc
```

Run `lint` and `typecheck` after any non-trivial change; there is currently
no automated test suite for this app (see "Testing" below).

## Working on this codebase

- Backend contract changes (new fields on `/api/config`, `/api/call`,
  `/demo/*`, etc.) must be cross-checked against the real FastAPI/Worker
  source in `../tenapp/ten_packages/extension/main_python/server.py` and
  `../cloudflare/src/index.ts` — do not assume the TypeScript interfaces in
  `app/api.ts` / `app/demoApi.ts` are currently accurate; verify against the
  Python/Worker source and fix drift when you find it.
- `useAgentSession.ts` is the single polling source of truth for call state;
  prefer extending it over adding a second poller.
- `CallTape.tsx`'s tool-call rendering depends on the exact string shape
  `f"{name}({json.dumps(args)})"` written by
  `../tenapp/.../main_python/extension.py`. If you change one side, check
  the other.

## Testing

There is no test runner configured yet. If you add one, check current Next.js
16 / React 19 testing conventions (e.g. via the `find-docs`/Context7 workflow
or official Next.js docs) rather than assuming an older setup — Next's
recommended Vitest/Jest wiring has changed across major versions. Prioritize
tests for pure logic (`useAgentSession`'s derived state, `CallTape`'s
tool-message parser) over UI snapshot tests.
