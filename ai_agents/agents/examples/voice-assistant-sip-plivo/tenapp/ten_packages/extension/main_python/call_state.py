from __future__ import annotations

import asyncio
import uuid
from collections.abc import Iterator, MutableMapping
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum
from typing import Any


class CallStatus(StrEnum):
    REQUESTED = "requested"
    INITIATED = "initiated"
    RINGING = "ringing"
    ANSWERED = "answered"
    STREAMING = "streaming"
    DRAINING = "draining"
    TERMINAL = "terminal"
    TRANSFERRED = "transferred"


TERMINAL_PROVIDER_STATUSES = frozenset(
    {"completed", "hangup", "failed", "busy", "no-answer", "timeout", "cancelled"}
)


@dataclass
class CallSession(MutableMapping[str, Any]):
    """Typed call identity with a mapping adapter for the legacy media path."""

    operation_id: str
    status: str = CallStatus.REQUESTED
    request_uuid: str | None = None
    call_uuid: str | None = None
    stream_id: str | None = None
    graph_id: str | None = None
    phone_number: str | None = None
    message: str = "Hello from Plivo!"
    persona_phone: str | None = None
    persona_name: str | None = None
    opening_message: str | None = None
    campaign_context: str | None = None
    caller: str | None = None
    direction: str | None = None
    websocket: Any = None
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    ended_at: str | None = None
    termination_reason: str | None = None
    _extra: dict[str, Any] = field(default_factory=dict, repr=False)

    def __getitem__(self, key: str) -> Any:
        if key in self.__dataclass_fields__ and not key.startswith("_"):
            return getattr(self, key)
        return self._extra[key]

    def __setitem__(self, key: str, value: Any) -> None:
        if key in self.__dataclass_fields__ and not key.startswith("_"):
            setattr(self, key, value)
        else:
            self._extra[key] = value

    def __delitem__(self, key: str) -> None:
        if key in self.__dataclass_fields__ and not key.startswith("_"):
            setattr(self, key, None)
        else:
            del self._extra[key]

    def __iter__(self) -> Iterator[str]:
        for key in self.__dataclass_fields__:
            if not key.startswith("_") and getattr(self, key) is not None:
                yield key
        yield from self._extra

    def __len__(self) -> int:
        return sum(1 for _ in self)

    @property
    def canonical_id(self) -> str:
        return self.call_uuid or self.request_uuid or self.operation_id

    @property
    def is_terminal(self) -> bool:
        return self.status == CallStatus.TERMINAL


class CallCapacityError(RuntimeError):
    def __init__(self, session: CallSession):
        super().__init__("call capacity reached")
        self.session = session


class CallRegistry(MutableMapping[str, CallSession]):
    """Owns call identity transitions and serializes capacity reservations."""

    def __init__(self, capacity: int = 1):
        if capacity < 1:
            raise ValueError("capacity must be at least 1")
        self.capacity = capacity
        self._sessions: dict[str, CallSession] = {}
        self._lock = asyncio.Lock()

    def __getitem__(self, key: str) -> CallSession:
        return self._sessions[key]

    def __setitem__(self, key: str, value: CallSession) -> None:
        self._sessions[key] = value

    def __delitem__(self, key: str) -> None:
        del self._sessions[key]

    def __iter__(self) -> Iterator[str]:
        return iter(self._sessions)

    def __len__(self) -> int:
        return len(self._sessions)

    def active(self, require_websocket: bool = False) -> list[CallSession]:
        sessions = [session for session in self._sessions.values() if not session.is_terminal]
        if require_websocket:
            sessions = [session for session in sessions if session.websocket is not None]
        return sessions

    async def reserve(self, **values: Any) -> CallSession:
        async with self._lock:
            active = self.active()
            if len(active) >= self.capacity:
                raise CallCapacityError(active[0])
            operation_id = str(uuid.uuid4())
            session = CallSession(operation_id=operation_id, **values)
            self._sessions[operation_id] = session
            return session

    async def release_reservation(self, operation_id: str) -> None:
        async with self._lock:
            session = self._sessions.get(operation_id)
            if session and not session.request_uuid and not session.call_uuid:
                self._sessions.pop(operation_id, None)

    async def bind_request_uuid(
        self, operation_id: str, request_uuid: str
    ) -> CallSession:
        async with self._lock:
            session = self._sessions.pop(operation_id)
            session.request_uuid = request_uuid
            session.status = CallStatus.INITIATED
            self._sessions[request_uuid] = session
            return session

    async def bind_call_uuid(
        self,
        call_uuid: str,
        request_uuid: str | None = None,
        **values: Any,
    ) -> CallSession:
        async with self._lock:
            session = self._sessions.get(call_uuid)
            if session is None and request_uuid:
                session = self._sessions.pop(request_uuid, None)
            if session is None:
                session = CallSession(operation_id=str(uuid.uuid4()))
            if session.request_uuid is None:
                session.request_uuid = request_uuid
            session.call_uuid = call_uuid
            session.status = CallStatus.ANSWERED
            for key, value in values.items():
                if value is not None and value != "":
                    session[key] = value
            self._sessions[call_uuid] = session
            return session

    async def mark_streaming(
        self, call_uuid: str, stream_id: str, websocket: Any
    ) -> CallSession:
        async with self._lock:
            session = self._sessions.get(call_uuid)
            if session is None:
                session = CallSession(operation_id=str(uuid.uuid4()), call_uuid=call_uuid)
                self._sessions[call_uuid] = session
            session.stream_id = stream_id
            session.websocket = websocket
            session.status = CallStatus.STREAMING
            return session

    async def detach_websocket(self, websocket: Any) -> str | None:
        async with self._lock:
            for key, session in self._sessions.items():
                if session.websocket is websocket:
                    session.websocket = None
                    return key
        return None

    async def terminate(self, call_uuid: str, reason: str) -> tuple[CallSession | None, bool]:
        """Mark a call terminal once; returns `(session, transitioned)`."""
        async with self._lock:
            session = self._sessions.get(call_uuid)
            if session is None:
                return None, False
            if session.is_terminal:
                return session, False
            session.status = CallStatus.TERMINAL
            session.termination_reason = reason
            session.ended_at = datetime.now(timezone.utc).isoformat()
            session.websocket = None
            return session, True

    async def remove_terminal(self, call_uuid: str) -> CallSession | None:
        async with self._lock:
            session = self._sessions.get(call_uuid)
            if session is None or not session.is_terminal:
                return None
            return self._sessions.pop(call_uuid)
