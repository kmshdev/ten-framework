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
    <div
      className="flex max-w-[calc(100vw-2rem)] items-center justify-center rounded-full border border-line-soft bg-control/75 px-3 py-1.5 shadow-[0_1px_0_rgba(255,231,184,0.06)_inset,0_12px_36px_rgba(0,0,0,0.22)]"
      aria-label={`Pipeline — ${state}`}
    >
      {STAGES.map((stage, i) => {
        const isActive = stage.id === active;
        return (
          <span key={stage.id} className="flex items-center">
            {i > 0 && (
              <span
                className="mx-2 h-px w-4 bg-line sm:mx-2.5 sm:w-6"
                aria-hidden
              />
            )}
            <span
              title={`${stage.label} · ${stage.sub}`}
              className={`type-caps flex items-center gap-1.5 transition-colors duration-200 ${
                isActive ? "text-ink" : "text-ink-tertiary"
              }`}
            >
              <i
                className={`inline-block h-2 w-2 rounded-full transition-colors duration-200 ${
                  isActive
                    ? "bg-voice shadow-[0_0_0_3px_rgba(255,59,46,0.16),0_0_18px_rgba(255,59,46,0.36)]"
                    : "bg-ink-faint opacity-55"
                }`}
                aria-hidden
              />
              {stage.label}
            </span>
          </span>
        );
      })}
    </div>
  );
}
