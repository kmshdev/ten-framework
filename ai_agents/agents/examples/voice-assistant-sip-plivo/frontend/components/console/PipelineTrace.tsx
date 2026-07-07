"use client";

// Signature element: the TEN pipeline, visualized. The active stage lights
// with the agent state — listening -> ASR, thinking -> LLM, speaking -> TTS.

import type { AgentVisualState } from "@/hooks/useAgentSession";

const STAGES = [
  { id: "sip", label: "SIP", sub: "plivo" },
  { id: "asr", label: "ASR", sub: "sarvam" },
  { id: "llm", label: "LLM", sub: "gpt-4o-mini" },
  { id: "tts", label: "TTS", sub: "elevenlabs" },
] as const;

const STATE_STAGE: Record<AgentVisualState, string> = {
  idle: "sip",
  listening: "asr",
  thinking: "llm",
  speaking: "tts",
};

export default function PipelineTrace({ state }: { state: AgentVisualState }) {
  const active = STATE_STAGE[state];

  return (
    <div className="flex items-center" aria-label={`Pipeline — ${state}`}>
      {STAGES.map((stage, i) => {
        const isActive = stage.id === active;
        return (
          <span key={stage.id} className="flex items-center">
            {i > 0 && (
              <span className="mx-2.5 h-px w-6 bg-hairline" aria-hidden />
            )}
            <span
              className={`flex items-center gap-1.5 font-mono text-[11px] tracking-wider transition-colors duration-200 ${
                isActive ? "font-medium text-ink" : "text-ink-3"
              }`}
            >
              <i
                className={`inline-block h-1.5 w-1.5 rounded-full transition-colors duration-200 ${
                  isActive ? "bg-voice" : "bg-ink-mute opacity-50"
                }`}
                aria-hidden
              />
              {stage.label} <span className="text-ink-3">{stage.sub}</span>
            </span>
          </span>
        );
      })}
    </div>
  );
}
