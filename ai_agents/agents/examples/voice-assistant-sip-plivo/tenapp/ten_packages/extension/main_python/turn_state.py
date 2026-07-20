from dataclasses import dataclass
from enum import Enum


class TurnPhase(str, Enum):
    """High-level phase of one phone conversation."""

    LISTENING = "listening"
    USER_SPEAKING = "user_speaking"
    THINKING = "thinking"
    AGENT_SPEAKING = "agent_speaking"


@dataclass
class ConversationTurnState:
    """State machine for VAD boundaries, barge-in, and committed turns."""

    phase: TurnPhase = TurnPhase.LISTENING
    speech_active: bool = False
    interruption_sent: bool = False
    turn_id: int = 0

    def speech_started(self) -> bool:
        """Record speech onset and return whether playback must be interrupted."""
        should_interrupt = self.phase in {
            TurnPhase.AGENT_SPEAKING,
            TurnPhase.THINKING,
        } and not self.interruption_sent
        self.speech_active = True
        self.phase = TurnPhase.USER_SPEAKING
        self.interruption_sent = True
        return should_interrupt

    def transcript_observed(self) -> bool:
        """Return whether a transcript requires a fallback interruption."""
        if self.interruption_sent:
            return False
        self.phase = TurnPhase.USER_SPEAKING
        self.interruption_sent = True
        return True

    def speech_ended(self) -> None:
        """Record the VAD speech-end boundary while awaiting ASR text."""
        self.speech_active = False
        if self.phase == TurnPhase.USER_SPEAKING:
            self.phase = TurnPhase.LISTENING

    def commit_user_turn(self) -> int:
        """Commit one user turn and return its monotonically increasing ID."""
        self.turn_id += 1
        self.phase = TurnPhase.THINKING
        self.interruption_sent = False
        return self.turn_id

    def agent_output_started(self) -> None:
        """Mark the agent as speaking so the next VAD onset can barge in."""
        self.phase = TurnPhase.AGENT_SPEAKING
        self.speech_active = False
        self.interruption_sent = False

