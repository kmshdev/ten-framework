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
      className="flex items-center rounded-full border border-line-soft bg-control/75 px-3 py-1.5 shadow-[0_1px_0_rgba(255,255,255,0.65)_inset]"
      aria-label={`Pipeline — ${state}`}
    >
      {STAGES.map((stage, i) => {
        const isActive = stage.id === active;
        return (
          <span key={stage.id} className="flex items-center">
            {i > 0 && <span className="mx-2.5 h-px w-6 bg-line" aria-hidden />}
            <span
              className={`flex items-center gap-1.5 font-mono text-[11px] font-bold tracking-[0.12em] transition-colors duration-200 ${
                isActive ? "text-ink" : "text-ink-tertiary"
              }`}
            >
              <i
                className={`inline-block h-2 w-2 rounded-full transition-colors duration-200 ${
                  isActive
                    ? "bg-voice shadow-[0_0_0_3px_rgba(226,37,24,0.12)]"
                    : "bg-ink-faint opacity-65"
                }`}
                aria-hidden
              />
              {stage.label}{" "}
              <span className="font-medium text-ink-tertiary">{stage.sub}</span>
            </span>
          </span>
        );
      })}
    </div>
  );
}
