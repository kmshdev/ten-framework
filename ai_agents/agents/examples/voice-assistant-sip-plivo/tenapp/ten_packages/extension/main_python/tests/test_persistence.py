import importlib.util
import sys
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "persistence.py"
SPEC = importlib.util.spec_from_file_location("main_python_persistence", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Unable to load {MODULE_PATH}")
PERSISTENCE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PERSISTENCE
SPEC.loader.exec_module(PERSISTENCE)

TranscriptSequencer = PERSISTENCE.TranscriptSequencer


class TranscriptSequencerTests(unittest.TestCase):
    def test_event_identity_is_immutable_after_rebind(self):
        sequencer = TranscriptSequencer()
        sequencer.bind("call-a", "+911111111111")
        event = sequencer.create("user", "hello", turn_id=1)

        sequencer.bind("call-b", "+922222222222")

        self.assertEqual(event.identity.call_uuid, "call-a")
        self.assertEqual(event.identity.caller, "+911111111111")
        self.assertEqual(event.idempotency_key, "call-a:1")

    def test_sequence_is_monotonic_and_resets_per_call(self):
        sequencer = TranscriptSequencer()
        sequencer.bind("call-a", "+911111111111")
        first = sequencer.create("assistant", "welcome")
        second = sequencer.create("user", "hello")
        sequencer.bind("call-b", "+922222222222")
        third = sequencer.create("assistant", "welcome")

        self.assertEqual((first.sequence, second.sequence), (1, 2))
        self.assertEqual(third.sequence, 1)
        self.assertEqual(third.idempotency_key, "call-b:1")

    def test_payload_contains_source_ordering_and_identity(self):
        sequencer = TranscriptSequencer()
        sequencer.bind("call-a", "+911111111111")
        payload = sequencer.create("assistant", "hi", turn_id=4).as_payload()

        self.assertEqual(payload["call_id"], "call-a")
        self.assertEqual(payload["caller"], "+911111111111")
        self.assertEqual(payload["sequence"], 1)
        self.assertEqual(payload["turn_id"], 4)
        self.assertGreater(payload["source_timestamp_ms"], 0)


if __name__ == "__main__":
    unittest.main()
