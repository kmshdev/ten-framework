import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from turn_state import ConversationTurnState, TurnPhase  # noqa: E402


class ConversationTurnStateTests(unittest.TestCase):
    def test_speech_during_agent_output_interrupts_once(self):
        state = ConversationTurnState()
        state.agent_output_started()

        self.assertTrue(state.speech_started())
        self.assertFalse(state.speech_started())
        self.assertEqual(state.phase, TurnPhase.USER_SPEAKING)

    def test_speech_after_end_can_commit_next_turn(self):
        state = ConversationTurnState()
        state.agent_output_started()
        state.speech_started()
        state.speech_ended()

        self.assertEqual(state.commit_user_turn(), 1)
        self.assertEqual(state.phase, TurnPhase.THINKING)
        state.agent_output_started()
        self.assertTrue(state.speech_started())

    def test_transcript_fallback_interrupts_when_vad_is_missing(self):
        state = ConversationTurnState(phase=TurnPhase.AGENT_SPEAKING)

        self.assertTrue(state.transcript_observed())
        self.assertFalse(state.transcript_observed())


if __name__ == "__main__":
    unittest.main()
