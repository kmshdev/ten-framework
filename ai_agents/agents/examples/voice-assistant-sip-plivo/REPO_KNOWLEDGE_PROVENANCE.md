# Repository Knowledge Provenance

## Refresh: 2026-07-19

### Scope

This refresh covers the SuperYou Plivo example and the permanent architecture work through the start of Phase 3 graph-startup isolation. It does not attempt to repair unrelated repository-wide documentation findings.

### Claims updated

| Documentation claim | Evidence |
|---|---|
| Staging has a separate public hostname and deployment-versioned container identity. | `.github/workflows/superyou-staging.yml`, `cloudflare/scripts/generate-staging-config.mjs`, and successful staging workflow run `29655400120`. |
| Container traffic is gated by semantic readiness, not only listening ports. | `cloudflare/src/index.ts`, `tenapp/ten_packages/extension/main_python/server.py`, and commits `7500e0479`, `c875f405d`. |
| The coordinator starts call-scoped graphs and routes media by call identity, but full concurrent isolation is not yet proven. | `tenapp/property.json`, `main_python/extension.py`, `main_python/call_state.py`; minimal staging graph lifecycle passed while the full graph exceeded 130 seconds. |
| Graph lifecycle diagnostics accept only named allowlisted probes. | `main_python/graph_probe.py`, `server.py`, `property.json`, and `test_graph_probe.py`. |

### Validation evidence

- `python3 -m json.tool agents/examples/voice-assistant-sip-plivo/tenapp/property.json`
- `python3 .../main_python/tests/test_graph_probe.py` — 4 passed.
- `python3 .../main_python/tests/test_call_state.py` — 5 passed.
- `uv run --with aiohttp python .../main_python/tests/test_persistence.py` — 3 passed.
- Editor diagnostics reported no errors or warnings in `server.py` and `graph_probe.py`.

### Knowledge-store findings not changed

`check_knowledge_store.py` reported 87 errors and 53 warnings across the full TEN Framework repository. Most are pre-existing missing indexes or broken links in unrelated examples, packages, and vendored third-party documentation. The relevant adapter warning for `ai_agents/CLAUDE.md` also predates this scoped work. These findings were not changed because they are not supported by, or necessary for, the SuperYou architecture work.

### Open questions

- Which node or connection prevents `va_in_hybrid_stack` from completing startup within the 60-second graph command budget?
- Do all provider extensions complete local lifecycle startup without waiting indefinitely for an external vendor connection?
- After the full graph starts within budget, does the two-call synthetic suite prove ASR, context, TTS, interruption, late-frame, and cleanup isolation?
