import asyncio
import importlib.util
import sys
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "call_state.py"
SPEC = importlib.util.spec_from_file_location("main_python_call_state", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Unable to load {MODULE_PATH}")
CALL_STATE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = CALL_STATE
SPEC.loader.exec_module(CALL_STATE)

CallCapacityError = CALL_STATE.CallCapacityError
CallRegistry = CALL_STATE.CallRegistry
CallStatus = CALL_STATE.CallStatus


class CallRegistryTests(unittest.IsolatedAsyncioTestCase):
    async def test_concurrent_reservations_are_atomic(self):
        registry = CallRegistry(capacity=1)

        async def reserve():
            try:
                return await registry.reserve(phone_number="+911234567890")
            except CallCapacityError:
                return None

        results = await asyncio.gather(reserve(), reserve())

        self.assertEqual(sum(result is not None for result in results), 1)
        self.assertEqual(len(registry.active()), 1)

    async def test_request_uuid_is_rekeyed_to_call_uuid(self):
        registry = CallRegistry()
        reserved = await registry.reserve(
            phone_number="+911234567890", campaign_context="campaign facts"
        )
        await registry.bind_request_uuid(reserved.operation_id, "request-1")

        session = await registry.bind_call_uuid(
            "call-1",
            request_uuid="request-1",
            caller="+911234567890",
            direction="outbound",
        )

        self.assertNotIn("request-1", registry)
        self.assertIs(registry["call-1"], session)
        self.assertEqual(session.request_uuid, "request-1")
        self.assertEqual(session.call_uuid, "call-1")
        self.assertEqual(session.campaign_context, "campaign facts")
        self.assertEqual(session.status, CallStatus.ANSWERED)

    async def test_termination_is_idempotent(self):
        registry = CallRegistry()
        reserved = await registry.reserve(phone_number="+911234567890")
        await registry.bind_request_uuid(reserved.operation_id, "request-1")
        await registry.bind_call_uuid("call-1", request_uuid="request-1")

        first_session, first_transition = await registry.terminate(
            "call-1", "status:completed"
        )
        ended_at = first_session.ended_at
        second_session, second_transition = await registry.terminate(
            "call-1", "websocket:disconnect"
        )

        self.assertTrue(first_transition)
        self.assertFalse(second_transition)
        self.assertIs(first_session, second_session)
        self.assertEqual(second_session.termination_reason, "status:completed")
        self.assertEqual(second_session.ended_at, ended_at)

    async def test_websocket_detach_only_affects_owner(self):
        registry = CallRegistry(capacity=2)
        first = await registry.bind_call_uuid("call-1")
        second = await registry.bind_call_uuid("call-2")
        first_socket = object()
        second_socket = object()
        await registry.mark_streaming("call-1", "stream-1", first_socket)
        await registry.mark_streaming("call-2", "stream-2", second_socket)

        detached = await registry.detach_websocket(first_socket)

        self.assertEqual(detached, "call-1")
        self.assertIsNone(first.websocket)
        self.assertIs(second.websocket, second_socket)


if __name__ == "__main__":
    unittest.main()
