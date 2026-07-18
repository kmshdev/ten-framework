"""Caller memory (mem0.ai) and transcript persistence for the SuperYou demo.

Implements the production patterns from mem0's voice-agent architecture
guide (https://mem0.ai/blog/ai-memory-for-voice-agents) and the
support-inbox cookbook:

- pre-loaded context:  curated, reranked v3 hybrid search at call start,
                       injected once into the LLM context (0 ms per turn)
- per-round writes:    each user<->assistant exchange is written async as
                       soon as it completes - resilient to mid-call hangups
- domain extraction:   custom_instructions keep the store clean (order
                       issues, preferences, language - never greetings)
- entity scoping:      user_id = caller phone, agent_id = this agent,
                       run_id = call UUID, so memories are per-customer
                       and traceable per call
- on-demand recall:    search() powers the recall_customer_memory LLM tool
                       for targeted mid-call lookups (hybrid retrieval)

All writes are fire-and-forget; recall has a hard timeout so memory can
never add latency to the voice path.
"""

import asyncio
from typing import Optional

import aiohttp

from .persistence import CallIdentitySnapshot, TranscriptEvent, TranscriptSequencer

MEM0_BASE = "https://api.mem0.ai"
AGENT_ID = "superyou-voice-agent"

# Blog decision #2 (domain-specific extraction) is enforced at the mem0
# PROJECT level (Store/Ignore rules for support calls) - see
# cloudflare/setup_mem0_project.py. Per-call custom_instructions/includes/
# excludes were tested against the live v3 API and are unreliable on this
# workspace (excludes suppressed valid facts; custom_instructions ignored),
# so project-level instructions are the single source of truth.

# Blog decision #3: pre-load a curated set at session start.
PRELOAD_QUERY = (
    "customer's open order issues, complaints, claims, product preferences, "
    "language preference, promised follow-ups"
)

RECALL_TIMEOUT_S = 2.5


class CallMemory:
    def __init__(
        self,
        ten_env,
        mem0_api_key: str = "",
        demo_api_base: str = "",
        demo_api_token: str = "",
    ):
        self.ten_env = ten_env
        self.mem0_api_key = mem0_api_key
        self.demo_api_base = demo_api_base.rstrip("/")
        self.demo_api_token = demo_api_token
        self.session: Optional[aiohttp.ClientSession] = None
        # Per-call state
        self.call_uuid: str = ""
        self.caller: str = ""
        self.messages: list[dict] = []  # full call transcript (for flush)
        self._unsaved: list[dict] = []  # turns not yet written per-round
        self._write_tasks: set[asyncio.Task] = set()
        self._transcripts = TranscriptSequencer()

    async def start(self):
        self.session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=10)
        )

    async def stop(self):
        if self._write_tasks:
            await asyncio.gather(*self._write_tasks, return_exceptions=True)
        if self.session:
            await self.session.close()
            self.session = None

    def begin_call(self, call_uuid: str, caller: str):
        self.call_uuid = call_uuid
        self.caller = caller or "unknown"
        self.messages = []
        self._unsaved = []
        self._transcripts.bind(self.call_uuid, self.caller)

    def _has_identity(self) -> bool:
        return bool(
            self.mem0_api_key and self.caller and self.caller != "unknown"
        )

    # ---- mem0 (v3 API) --------------------------------------------------

    def _mem0_headers(self) -> dict:
        return {
            "Authorization": f"Token {self.mem0_api_key}",
            "Content-Type": "application/json",
        }

    async def _search(
        self, query: str, top_k: int = 8, rerank: bool = True
    ) -> list[dict]:
        """v3 hybrid search (semantic + BM25 + entity), scoped to the caller."""
        async with self.session.post(
            f"{MEM0_BASE}/v3/memories/search/",
            headers=self._mem0_headers(),
            json={
                "query": query,
                # v3: entity IDs must live inside filters
                "filters": {"AND": [{"user_id": self.caller}]},
                "top_k": top_k,
                "rerank": rerank,
            },
        ) as resp:
            if resp.status != 200:
                self.ten_env.log_warn(f"[memory] mem0 search HTTP {resp.status}")
                return []
            data = await resp.json()
        results = data.get("results", data) if isinstance(data, dict) else data
        return [r for r in (results or []) if isinstance(r, dict)]

    async def recall(self) -> str:
        """Pre-load curated caller context at call start (blog decision #3).

        Hard timeout keeps memory off the voice path's critical latency
        budget - a slow recall must never delay the greeting.
        """
        if not (self._has_identity() and self.session):
            return ""
        try:
            results = await asyncio.wait_for(
                self._search(PRELOAD_QUERY), timeout=RECALL_TIMEOUT_S
            )
        except asyncio.TimeoutError:
            self.ten_env.log_warn("[memory] mem0 recall timed out - skipping")
            return ""
        except Exception as e:
            self.ten_env.log_warn(f"[memory] mem0 recall failed: {e}")
            return ""

        lines = []
        for r in results[:10]:
            text = r.get("memory", "")
            if not text:
                continue
            # Surface recency so the LLM can time-weight (memory decay):
            # a six-month-old preference should carry less weight.
            date = (r.get("updated_at") or r.get("created_at") or "")[:10]
            lines.append(f"- {text}" + (f" (as of {date})" if date else ""))
        if not lines:
            return ""
        self.ten_env.log_info(
            f"[memory] pre-loaded {len(lines)} memories for {self.caller}"
        )
        return "\n".join(lines)

    async def search(self, query: str, top_k: int = 5) -> list[dict]:
        """Targeted mid-call recall - powers the recall_customer_memory tool."""
        if not (self._has_identity() and self.session):
            return []
        try:
            results = await self._search(query, top_k=top_k)
        except Exception as e:
            self.ten_env.log_warn(f"[memory] mem0 tool search failed: {e}")
            return []
        return [
            {
                "memory": r.get("memory", ""),
                "as_of": (r.get("updated_at") or r.get("created_at") or "")[:10],
                "score": round(r.get("score", 0.0), 3),
            }
            for r in results
            if r.get("memory")
        ]

    def _track_task(self, coroutine):
        task = asyncio.create_task(coroutine)
        self._write_tasks.add(task)
        task.add_done_callback(self._write_tasks.discard)

    def _spawn_write(self, turns: list[dict]):
        """Fire-and-forget mem0 write with immutable call identity."""
        identity = CallIdentitySnapshot(self.call_uuid, self.caller)
        self._track_task(self._add_memories(turns, identity))

    async def _add_memories(
        self, turns: list[dict], identity: CallIdentitySnapshot
    ):
        try:
            async with self.session.post(
                f"{MEM0_BASE}/v3/memories/add/",
                headers=self._mem0_headers(),
                json={
                    "messages": turns,
                    # Entity scoping: per-customer store, traceable per call
                    "user_id": identity.caller,
                    "agent_id": AGENT_ID,
                    "run_id": identity.call_uuid or None,
                    "metadata": {
                        "channel": "voice",
                        "call_uuid": identity.call_uuid,
                        "brand": "superyou",
                    },
                },
            ) as resp:
                if resp.status not in (200, 201, 202):
                    self.ten_env.log_warn(
                        f"[memory] mem0 add HTTP {resp.status}"
                    )
                else:
                    self.ten_env.log_info(
                        f"[memory] queued {len(turns)} turns for extraction "
                        f"(user {identity.caller})"
                    )
        except Exception as e:
            self.ten_env.log_warn(f"[memory] mem0 add failed: {e}")

    async def save(self):
        """Call-end safety net: flush any turns the per-round writer missed."""
        if not (self._has_identity() and self._unsaved and self.session):
            return
        turns, self._unsaved = self._unsaved, []
        identity = CallIdentitySnapshot(self.call_uuid, self.caller)
        await self._add_memories(turns, identity)

    # ---- turn recording -------------------------------------------------

    def record_turn(
        self, role: str, content: str, turn_id: int | None = None
    ):
        """Buffer a finished turn, mirror it to the dashboard, and run
        per-round memory writes (blog decision #1)."""
        if not content:
            return
        if role in ("user", "assistant"):
            self.messages.append({"role": role, "content": content})
            self._unsaved.append({"role": role, "content": content})
            # Per-round write: flush once each exchange completes (an
            # assistant reply following at least one user turn). Skipping
            # user-less rounds avoids extracting the canned greeting.
            if (
                role == "assistant"
                and self._has_identity()
                and any(t["role"] == "user" for t in self._unsaved)
            ):
                turns, self._unsaved = self._unsaved, []
                self._spawn_write(turns)
        if self.demo_api_base and self.call_uuid:
            event = self._transcripts.create(role, content, turn_id)
            self._track_task(self._post_transcript(event))

    # ---- transcripts (D1 via Worker) -----------------------------------

    async def _post_transcript(self, event: TranscriptEvent):
        headers = (
            {
                "x-admin-token": self.demo_api_token,
                "x-idempotency-key": event.idempotency_key,
            }
            if self.demo_api_token
            else {"x-idempotency-key": event.idempotency_key}
        )
        for attempt in range(3):
            try:
                async with self.session.post(
                    f"{self.demo_api_base}/demo/transcripts",
                    headers=headers,
                    json=event.as_payload(),
                ) as resp:
                    if resp.status == 200:
                        return
                    if resp.status < 500:
                        self.ten_env.log_warn(
                            f"[memory] transcript POST HTTP {resp.status}"
                        )
                        return
                    self.ten_env.log_warn(
                        f"[memory] transcript POST HTTP {resp.status}; retrying"
                    )
            except Exception as e:
                if attempt == 2:
                    self.ten_env.log_warn(
                        f"[memory] transcript POST failed: {e}"
                    )
                    return
            await asyncio.sleep(0.1 * (2**attempt))
