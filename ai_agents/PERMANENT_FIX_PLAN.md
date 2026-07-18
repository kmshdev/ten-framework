# SuperYou Voice Agent Permanent-Fix Plan

## Objective

Replace the shared, graph-global voice-agent lifecycle with call-scoped ownership, deterministic routing, idempotent cleanup, semantic readiness, and production-grade observability.

The implementation must preserve the currently proven Plivo μ-law/8 kHz playback format while eliminating shared mutable conversation state and ambiguous lifecycle behavior.

## Delivery rules

- Implement phases in order unless a prerequisite is discovered.
- Keep each commit focused on one permanent fix or one independently testable prerequisite.
- Run targeted tests before every implementation commit.
- Do not claim concurrent-call support until the multi-call isolation acceptance test passes.
- Do not use assistant transcript records as playback proof; require `playAudio` transmission and Plivo playback acknowledgement.
- Never place live calls unless explicitly authorized for that validation run.
- Do not add mock/test hints to agent context.
- Preserve unrelated and untracked workspace files.

## Phase 0 — Baseline and execution harness

### Goals

- Capture the architectural plan in version control.
- Identify available unit/integration test entrypoints.
- Add deterministic local tests where existing coverage cannot validate lifecycle behavior.

### Deliverables

- This plan.
- A test map covering server lifecycle, call-state ownership, transcript identity, readiness, and media routing.

### Exit criteria

- Baseline tests and diagnostics are recorded.
- No production behavior changes are included in the planning commit.

---

## Phase 1 — Call coordinator and lifecycle correctness

### 1.1 Explicit call domain model

Introduce typed call records rather than loosely structured dictionaries.

Required identities:

- Local operation ID
- Plivo `RequestUUID`
- Plivo `CallUUID`
- Plivo `StreamUUID`
- TEN graph ID

Required lifecycle states:

- `requested`
- `ringing`
- `answered`
- `streaming`
- `draining`
- `terminal`

### 1.2 Atomic outbound reservation

Replace the non-atomic `find active → await Plivo → insert` sequence with an explicit reservation/registration flow. Concurrent API requests must not bypass configured capacity limits.

### 1.3 Idempotent termination

Create one terminalization path used by:

- Plivo terminal status webhook
- Media `stop`
- WebSocket disconnect timeout
- Explicit API hangup
- Graph shutdown
- Container shutdown

Termination must affect only the identified call and tolerate duplicate signals.

### 1.4 Stable API errors

Preserve intentional `HTTPException` statuses. Map provider, capacity, validation, and internal errors to stable structured responses instead of wrapping expected errors as `500`.

### Tests

- Concurrent reservation test.
- RequestUUID-to-CallUUID reconciliation test.
- Duplicate termination test.
- Stop/status/disconnect convergence tests.
- Expected 400/404/409 responses remain non-500.

### Exit criteria

- Every call has one typed runtime record.
- All terminal signals converge on one idempotent operation.
- Call API error-contract tests pass.

---

## Phase 2 — Immutable identity and persistence correctness

### 2.1 Preserve media identity

Remove the hardcoded TEN stream ID. Carry immutable `call_uuid`, `stream_id`, and graph identity from Plivo ingress through ASR, LLM, TTS, tools, diagnostics, and egress.

### 2.2 Immutable transcript events

Replace persistence tasks that read mutable `CallMemory.call_uuid` and `caller` at execution time with immutable events containing:

- call UUID
- caller/customer identity
- per-call sequence
- role
- content
- source timestamp
- turn ID when applicable

### 2.3 Managed persistence queue

Track transcript writes, add bounded retry behavior for transient failures, support shutdown draining, and use an idempotency key.

### Tests

- Rebinding memory cannot change an already-enqueued transcript’s identity.
- Transcript sequence remains deterministic under delayed concurrent writes.
- Shutdown waits for queued persistence up to a bounded deadline.
- Media frames retain the correct stream/call identity.

### Exit criteria

- No asynchronous persistence operation reads mutable current-call identity.
- No call identity is represented by a constant or inferred from dictionary order.

---

## Phase 3 — Per-call TEN graph isolation

### 3.1 Process-level coordinator

Move Plivo HTTP/WebSocket coordination out of the conversation graph lifecycle. The coordinator owns call records and starts/stops call graphs.

### 3.2 Graph per connected call

Disable the shared auto-start conversation graph. Start one predefined or dynamic graph for each connected Plivo call, injecting immutable call-scoped properties.

Each graph must own its own:

- ASR extension and provider connection
- agent queues
- LLM context and active request
- TTS extension and active request
- memory session
- interruption state
- turn counters

### 3.3 Directed media routing

Replace broadcast output with direct routing:

`graph_id → call_uuid → stream_id → websocket`

Barge-in and `clearAudio` must target only the originating call.

### Tests

- Two simultaneous synthetic calls receive only their own audio.
- ASR from call A cannot enter call B’s context or transcript.
- Barge-in on A does not cancel or clear B.
- Ending A does not reset B.
- Late output from a terminated graph is discarded.

### Exit criteria

- No graph-global conversation state is shared by calls.
- No TTS frame is broadcast across active sessions.
- Synthetic multi-call isolation suite passes.

---

## Phase 4 — Semantic readiness and process supervision

### 4.1 Health contracts

Add:

- `/livez` for process/event-loop liveness
- `/readyz` for coordinator and TEN control-plane readiness
- operator-only dependency diagnostics for provider degradation

### 4.2 Worker readiness

Use port readiness only to establish transport availability, then require a successful semantic `/readyz` probe. During startup, return controlled `503` responses with `Retry-After` rather than raw proxy `500` errors.

### 4.3 Process supervision

Ensure required processes are supervised. Unexpected exit of frontend, coordinator, TEN runtime, or the internal HTTP server must fail the container rather than leave stale readiness state.

### 4.4 Deployment gate

Deployment must fail if readiness probes never succeed. A printed success message must imply that the readiness gate actually passed.

### Tests

- Cold-start request concurrency.
- Port open but semantic readiness false.
- TEN child death after readiness.
- Frontend process death after readiness.
- Readiness timeout produces controlled 503.
- Deployment script exits non-zero after exhausted probes.

### Exit criteria

- Public readiness represents application readiness, not only listening sockets.
- Required child-process failure invalidates readiness and restarts/fails the container predictably.

---

## Phase 5 — Call-scoped observability

### 5.1 Diagnostic event model

Record call-scoped lifecycle timestamps for:

- webhook receipt
- media start/stop
- first inbound frame
- first ASR partial/final
- filter decision
- LLM queued/started/first token/completed
- TTS queued/first chunk/completed
- `playAudio` sent
- checkpoint sent/acknowledged
- `clearAudio` sent/acknowledged
- graph start/stop
- persistence enqueue/commit/failure

### 5.2 Separate diagnostics from transcripts

Customer-visible conversation transcripts must contain only conversation/tool content. Playback and lifecycle diagnostics belong in a separate store or stream.

### 5.3 Correlation and latency

Every diagnostic must include call, stream, graph, turn, and monotonic sequence where applicable. Derive stage latency without relying on log ordering across processes.

### Tests

- Complete synthetic call produces a coherent ordered event timeline.
- Missing stages can be identified deterministically.
- Diagnostics never appear as assistant transcript content.

### Exit criteria

- A “stuck after hello” report can be classified to one pipeline stage from persisted evidence.

---

## Phase 6 — Production concurrency proof and rollout

### Synthetic proof

Run deterministic local/integration tests with at least two concurrent call streams and injected delays, interruptions, disconnects, and provider failures.

### Authorized live proof

Only after explicit authorization:

- Use at least two different approved numbers.
- Have both calls answered simultaneously.
- Verify greeting, user transcript, assistant response, playback acknowledgement, interruption isolation, and independent termination.

### Rollout

- Deploy behind a concurrency limit.
- Observe readiness and per-stage latency.
- Increase capacity only after isolation evidence remains clean.
- Merge into the stable production branch only after all phase acceptance criteria pass.

## Definition of done

The architecture is complete only when:

1. Each answered call owns an isolated TEN graph.
2. Identity remains immutable across the full media and persistence path.
3. Every lifecycle exit converges on idempotent call-scoped termination.
4. Readiness is semantic and process failures cannot leave stale healthy state.
5. Diagnostics identify the exact failed pipeline stage.
6. Two or more concurrent answered calls pass isolation tests without audio, context, transcript, interruption, or cleanup crossover.
