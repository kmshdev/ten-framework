"use client";

// Past sessions: progressive disclosure for call history. A quiet corner
// button opens a right-hand panel; picking a call pins the tape to it.

import { useEffect } from "react";
import type { TranscriptCallSummary } from "@/app/demoApi";

function formatWhen(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface SessionsDrawerProps {
  open: boolean;
  calls: TranscriptCallSummary[];
  activeCallId: string | null;
  isPinned: boolean;
  onSelect: (callId: string) => void;
  onBackToLive: () => void;
  onClose: () => void;
}

export default function SessionsDrawer({
  open,
  calls,
  activeCallId,
  isPinned,
  onSelect,
  onBackToLive,
  onClose,
}: SessionsDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40"
      role="dialog"
      aria-label="Past sessions"
    >
      {/* scrim */}
      <button
        type="button"
        aria-label="Close past sessions"
        onClick={onClose}
        className="absolute inset-0 bg-black/48 backdrop-blur-[2px]"
      />

      <aside className="animate-rise absolute bottom-0 right-0 top-0 flex w-[min(360px,calc(100vw-1rem))] flex-col border-l border-hairline bg-panel shadow-[0_0_90px_rgba(0,0,0,0.58),-1px_0_0_rgba(255,231,184,0.04)_inset]">
        <div className="flex items-center gap-3 border-b border-hairline-soft bg-control/35 px-5 py-4">
          <span className="type-caps text-ink">Past sessions</span>
          <span className="type-mono text-ink-3">{calls.length}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="type-ui ml-auto rounded-sm px-1.5 py-0.5 text-ink-3 transition-colors hover:text-ink"
          >
            ×
          </button>
        </div>

        {isPinned && (
          <button
            type="button"
            onClick={onBackToLive}
            className="type-ui mx-5 mt-4 rounded-xl border border-hairline bg-card px-3 py-2 text-ink-2 transition-colors hover:border-voice/60 hover:text-ink focus-visible:outline-2 focus-visible:outline-voice"
          >
            ← Back to live view
          </button>
        )}

        <div className="tape-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {calls.length === 0 ? (
            <p className="type-small px-3 py-6 text-left text-ink-3">
              No calls recorded yet.
            </p>
          ) : (
            calls.map((call) => {
              const isActive = call.call_id === activeCallId;
              return (
                <button
                  key={call.call_id}
                  type="button"
                  onClick={() => {
                    onSelect(call.call_id);
                    onClose();
                  }}
                  className={`type-ui mb-1 block w-full rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-voice ${
                    isActive
                      ? "border-voice/50 bg-card shadow-[0_0_24px_rgba(255,59,46,0.08)]"
                      : "border-transparent hover:border-hairline-soft hover:bg-card"
                  }`}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="font-semibold text-ink">
                      {call.caller || "Unknown caller"}
                    </span>
                    <span className="type-mono ml-auto text-ink-3">
                      {call.messages} msgs
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-baseline gap-2">
                    <span className="type-small text-ink-3">
                      {formatWhen(call.started_at)}
                    </span>
                    <span className="type-mono ml-auto max-w-[120px] truncate text-ink-3">
                      {call.call_id}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
}
