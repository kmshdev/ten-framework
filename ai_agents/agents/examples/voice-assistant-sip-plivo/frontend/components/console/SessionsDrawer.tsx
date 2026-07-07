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
    <div className="fixed inset-0 z-40" role="dialog" aria-label="Past sessions">
      {/* scrim */}
      <button
        type="button"
        aria-label="Close past sessions"
        onClick={onClose}
        className="absolute inset-0 bg-ink/10"
      />

      <aside className="animate-rise absolute bottom-0 right-0 top-0 flex w-[340px] flex-col border-l border-hairline bg-paper">
        <div className="flex items-center gap-3 border-b border-hairline-soft px-5 py-4">
          <span className="font-brand text-[13px] font-semibold uppercase tracking-[0.16em] text-ink">
            Past sessions
          </span>
          <span className="font-mono text-[10.5px] text-ink-3">
            {calls.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-sm px-1.5 py-0.5 text-[15px] leading-none text-ink-3 transition-colors hover:text-ink"
          >
            ×
          </button>
        </div>

        {isPinned && (
          <button
            type="button"
            onClick={onBackToLive}
            className="mx-5 mt-4 rounded border border-hairline bg-card px-3 py-2 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
          >
            ← Back to live view
          </button>
        )}

        <div className="tape-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {calls.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-ink-3">
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
                  className={`mb-1 block w-full rounded border px-3 py-2.5 text-left transition-colors ${
                    isActive
                      ? "border-hairline bg-card"
                      : "border-transparent hover:border-hairline-soft hover:bg-card"
                  }`}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="text-[13.5px] font-semibold text-ink">
                      {call.caller || "Unknown caller"}
                    </span>
                    <span className="ml-auto font-mono text-[10.5px] text-ink-3">
                      {call.messages} msgs
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-baseline gap-2">
                    <span className="text-[12px] text-ink-3">
                      {formatWhen(call.started_at)}
                    </span>
                    <span className="ml-auto max-w-[120px] truncate font-mono text-[10px] text-ink-3">
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
