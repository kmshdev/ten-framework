from __future__ import annotations

import time
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class CallIdentitySnapshot:
    call_uuid: str
    caller: str


@dataclass(frozen=True, slots=True)
class TranscriptEvent:
    identity: CallIdentitySnapshot
    sequence: int
    role: str
    content: str
    source_timestamp_ms: int
    turn_id: int | None = None

    @property
    def idempotency_key(self) -> str:
        return f"{self.identity.call_uuid}:{self.sequence}"

    def as_payload(self) -> dict[str, object]:
        return {
            "call_id": self.identity.call_uuid,
            "caller": self.identity.caller,
            "sequence": self.sequence,
            "role": self.role,
            "content": self.content,
            "source_timestamp_ms": self.source_timestamp_ms,
            "turn_id": self.turn_id,
            "idempotency_key": self.idempotency_key,
        }


class TranscriptSequencer:
    """Creates immutable, monotonically ordered events for one bound call."""

    def __init__(self) -> None:
        self._identity = CallIdentitySnapshot("", "unknown")
        self._sequence = 0

    @property
    def identity(self) -> CallIdentitySnapshot:
        return self._identity

    def bind(self, call_uuid: str, caller: str) -> None:
        self._identity = CallIdentitySnapshot(call_uuid, caller or "unknown")
        self._sequence = 0

    def create(
        self, role: str, content: str, turn_id: int | None = None
    ) -> TranscriptEvent:
        if not self._identity.call_uuid:
            raise RuntimeError("cannot create transcript event without a call identity")
        self._sequence += 1
        return TranscriptEvent(
            identity=self._identity,
            sequence=self._sequence,
            role=role,
            content=content,
            source_timestamp_ms=time.time_ns() // 1_000_000,
            turn_id=turn_id,
        )
