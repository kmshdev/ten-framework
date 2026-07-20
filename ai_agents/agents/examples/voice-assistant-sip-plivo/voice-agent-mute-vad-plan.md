# Restore Maya Media Routing and Sarvam Turn Detection

This is a living execution plan for the Maya Plivo voice-agent repair. It follows
the repository ExecPlan rules in `/Users/kmsh/.codex/.agent/PLANS.md`.

## Purpose / Big Picture

After this work, a caller can hear Maya's greeting, say "hello" or a support
question, and receive a response without the call going silent. Plivo remains the
transport, the coordinator owns the public WebSocket, each call owns an isolated
TEN graph, and Sarvam's speech-boundary events finalize user turns.

## Progress

- [x] (2026-07-20 11:20 IST) Confirmed the mute boundary: inbound media was dropped
  because the long-lived migration left `CallSession.graph_id` unset.
- [x] (2026-07-20 11:25 IST) Selected per-call graph isolation and Sarvam VAD events.
- [x] (2026-07-20 11:35 IST) Restored coordinator/worker graph ownership and worker
  TTS routing.
- [x] (2026-07-20 11:35 IST) Enabled Sarvam VAD signals and raw PCM encoding.
- [x] (2026-07-20 12:00 IST) Ran focused call-state tests, staging graph/data smoke,
  and production graph/readiness gates.
- [x] (2026-07-20 12:05 IST) Built and deployed the amd64 image through GitHub and
  Cloudflare; production workflow `29721679456` passed.
- [x] (2026-07-20 12:06 IST) Verified a live call reached streaming, persisted Maya's
  greeting, sent three Plivo `playAudio` chunks, and received playback acknowledgements.
- [ ] Verify a human-spoken live turn through Sarvam VAD; the acceptance call had
  no caller speech, so no user transcript was expected or recorded.
- [x] (2026-07-20 12:35 IST) Researched the official Plivo, Sarvam, TEN VAD, and
  TEN Turn Detection guidance and implemented VAD-to-controller barge-in handling.
- [x] (2026-07-20 12:37 IST) Rebuilt and deployed commit `c176536c0` to production;
  readiness, health, and full TEN graph smoke passed.

## Surprises & Discoveries

- Observation: the live Worker and greeting playback were healthy, but recent D1
  calls contained only assistant greetings and playback markers.
  Evidence: remote `transcripts` rows had no user entries for the latest calls.
- Observation: `MainControlExtension.on_audio_frame()` could not send worker TTS
  directly to Plivo after graph isolation because only the coordinator has the
  Plivo server instance.
  Evidence: the parent implementation routed worker frames to the coordinator.
- Observation: Sarvam's event handler tracked `END_SPEECH` but never flushed ASR.
  Evidence: `sarvam_asr_python/extension.py` changed `_speaking` without calling
  `finalize()`.
- Observation: Plivo playback was healthy, but the controller had no input-side
  event path for immediate barge-in. The only interruption trigger was a text ASR
  callback, which is too late when the caller starts speaking over TTS.
  Evidence: the latest production transcript rows contain only Maya's greeting
  and Plivo playback markers; no `user` rows or ASR event was recorded.
- Observation: official Sarvam guidance recommends `high_vad_sensitivity=true`,
  `vad_signals=true`, and the `flush_signal` capability for voice-agent barge-in;
  its response examples use `START_SPEECH`/`END_SPEECH`, while the response table
  also documents `speech_start`/`speech_end` names.
  Evidence: Firecrawl scrapes of Sarvam's streaming guide and WebSocket reference
  on 2026-07-20.
- Observation: official Plivo guidance requires bidirectional `audio/x-mulaw` at
  8 kHz and documents `clearAudio` as the interruption mechanism.
  Evidence: Firecrawl scrapes of Plivo's audio streaming guide and protocol
  reference on 2026-07-20.
- Observation: the first staging rollout deployed the new Worker but reused the
  previous container image because staging used a fixed Durable Object name.
  Evidence: the run's expected revision was `19fe2903ef5617a2`, while
  `/tenapp/readyz` reported `4105c05fc16ff35b`.
- Observation: a fresh full-graph smoke can fail once while vendor extensions
  initialize, then pass on immediate retry without a code or image change.
  Evidence: staging attempt 2 passed minimal smoke, returned one 500 for the
  first full smoke, and three direct full-graph retries passed on revision
  `3daeedb51e13501d`.

## Decision Log

- Decision: use per-call TEN graphs.
  Rationale: the existing `CallSession.graph_id`, `StartGraphCmd`, and cleanup
  path already model call-scoped ownership; this prevents ASR, LLM, memory, and
  TTS state from leaking between calls.
  Date/Author: 2026-07-20 / implementation session.
- Decision: use Sarvam VAD as the input boundary and keep TEN's turn state machine
  in `main_control`.
  Rationale: Sarvam already receives the correctly decoded 8 kHz PCM and documents
  voice-agent barge-in. The controller must still own interruption, transcript
  commitment, and output phases so provider events cannot race TTS or reset turn
  state. TEN Turn Detection remains useful for semantic finished/unfinished/wait
  classification, but its documented model is English/Chinese and would be an
  unnecessary dependency for this Hindi/English phone path.
  Date/Author: 2026-07-20 / implementation session.
- Decision: enable high-sensitivity VAD, explicit raw-PCM codec, and flush support.
  Rationale: Sarvam documents the shorter silence boundary and explicit codec/
  flush parameters for conversational agents; this reduces the window in which
  Maya can continue speaking after a caller has started.
  Date/Author: 2026-07-20 / implementation session.
- Decision: label outbound Sarvam audio as `pcm_s16le`.
  Rationale: the implementation sends raw little-endian PCM bytes without a WAV
  header, so `audio/wav` did not describe the actual payload.
  Date/Author: 2026-07-20 / implementation session.
- Decision: include the staging image revision in the container instance name.
  Rationale: Cloudflare Container instances are stateful; a stable staging name
  can retain an older image across Worker deployments. Production keeps its
  stable name because it is intentionally a single live instance.
  Date/Author: 2026-07-20 / implementation session.

## Outcomes & Retrospective

The code restores the coordinator/worker boundary, adds focused Sarvam protocol
behavior, makes staging image identity explicit, and is live in production. The
remaining acceptance gap is operational: a caller must speak during a live call
to verify the end-to-end Sarvam `START_SPEECH`/`END_SPEECH` turn.

Deployment evidence:

- Staging image/data smoke: workflow `29721244762` built revision `b802db3c229cc269`;
  direct current-revision smoke passed after the runner hit a transient Cloudflare
  1101 during its first health request.
- Production deploy: workflow `29721679456` passed build, registry push, D1 migration,
  Worker deploy, container restart, readiness, and full graph smoke.
- Production VAD deploy: workflow `29723123674` passed build, registry push, D1
  migration, Worker deploy, stable container restart, readiness, and full graph
  smoke for commit `c176536c0`.
- Post-deploy live checks: `/health` returned `healthy`, `/tenapp/readyz` returned
  `ready`, and `/api/calls` returned an empty active-call set at 2026-07-20 12:36
  IST.
- Live call `6d2e2fdf-ebd2-446e-ae3b-a942b8a1de23`: streaming, greeting transcript,
  `playAudio` chunks 1-3, and `playedStream` acknowledgements were recorded.

## Context and Orientation

`cloudflare/src/index.ts` routes `/media` WebSocket upgrades to container port 9000
using `super.fetch()`. `main_python/server.py` accepts Plivo `start`, `media`, and
`stop` events. The coordinator's `MainControlExtension` owns that server and sends
inbound audio to the graph ID stored in `CallSession`. The worker graph receives
`call_start`, runs Sarvam ASR, OpenAI LLM, and ElevenLabs TTS, and routes TTS frames
back to the coordinator. The coordinator converts TTS PCM16 to Plivo μ-law/8 kHz.

## Plan of Work

`property.json` now makes `plivo_coordinator` auto-started and
`va_in_hybrid_stack` per-call. Worker initialization no longer starts a second
port-9000 server. `on_websocket_connected()` starts and binds the call graph before
sending `call_start`. Worker audio frames are marked with `call_uuid` and routed to
the coordinator graph.

Sarvam configuration now exposes `vad_signals`, `high_vad_sensitivity`,
`flush_signal`, and `audio_encoding`. VAD boundaries are forwarded as graph data
to `main_control`, which owns a per-call `LISTENING -> USER_SPEAKING -> THINKING ->
AGENT_SPEAKING` state machine. `START_SPEECH` clears LLM/TTS/Plivo playback once
per user segment; `END_SPEECH` flushes Sarvam once for an active utterance, and
raw PCM is sent with the `pcm_s16le` encoding label. Lowercase `speech_start` and
`speech_end` provider variants are accepted as well.

Focused tests cover graph binding, Sarvam URL parameters, PCM envelope shape,
provider event variants, duplicate speech-end events, and one-interruption-per-
speech-segment state transitions. The remaining integration test must simulate
Plivo media through Sarvam output into one LLM/TTS turn.

## Concrete Steps

Run from `/Users/kmsh/kmsh-personal/ten-framework/ai_agents`:

    python3 -m json.tool agents/examples/voice-assistant-sip-plivo/tenapp/property.json
    python3 -m py_compile agents/examples/voice-assistant-sip-plivo/tenapp/ten_packages/extension/main_python/extension.py
    python3 -m py_compile agents/ten_packages/extension/sarvam_asr_python/extension.py

Then run the example and extension tests using the repository's TEN test command.
The expected result is a clean test run with the new graph and VAD tests passing.

## Validation and Acceptance

Acceptance requires a synthetic `start -> media -> stop` flow with a non-empty
graph ID and logs showing `Forwarded inbound audio chunk`. A mocked Sarvam stream
must produce `START_SPEECH`, `END_SPEECH`, one final transcript, one LLM turn, and
one TTS response. A live call must keep `/api/calls` active while the caller speaks,
respond to repeated "hello", and persist both user and assistant transcript rows.

Before production deployment, run `actionlint`, the image build, and
`npx wrangler deploy --dry-run`. Deploy staging first, verify `/readyz` and the
full graph smoke test, then deploy the production Worker.

## Idempotence and Recovery

Graph start is call-scoped and cleanup is idempotent. A failed `call_start` stops
the newly created graph. If staging graph startup or the live call fails, stop the
rollout and restore the previous Worker/image version; do not apply a D1 migration.
Unrelated dirty files in the repository must remain untouched.

## Artifacts and Notes

The important failure message before this repair was:

    Dropping inbound audio before graph is ready for <call_uuid>

The important success message after this repair is:

    Forwarded inbound audio chunk for <call_uuid>: chunk=1 graph_id=<graph_id>

## Interfaces and Dependencies

The call-state interface requires `CallSession.graph_id` to be assigned before
media forwarding. The Sarvam interface uses query parameter `vad_signals=true` and
audio messages with `encoding=pcm_s16le`, `sample_rate=8000`, and base64 PCM data.
The Plivo interface remains bidirectional μ-law/8 kHz audio with `playAudio`,
`checkpoint`, and `clearAudio` server-to-provider messages.
