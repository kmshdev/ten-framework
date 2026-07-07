"use client";

// SuperYou Voice Agent console — Quiet Stage.
// Locked viewport, three rows: header / stage / flowing call tape.
// The agent (visualizer + pipeline) is the interface; ops context appears
// only as artifacts of tool calls, inline on the tape.

import { useCallback, useEffect, useState } from "react";
import { twilioAPI } from "@/app/api";
import AgentVisualizer from "@/components/console/AgentVisualizer";
import CallTape from "@/components/console/CallTape";
import ControlBar from "@/components/console/ControlBar";
import PipelineTrace from "@/components/console/PipelineTrace";
import SessionsDrawer from "@/components/console/SessionsDrawer";
import { useAgentSession } from "@/hooks/useAgentSession";

const HEALTH_POLL_MS = 30_000;

const STATE_LABEL: Record<string, string> = {
  idle: "Standing by",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

function formatDuration(sec: number): string {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

export default function Home() {
  const session = useAgentSession();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [ownCallSid, setOwnCallSid] = useState<string | null>(null);
  const [callBusy, setCallBusy] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);

  // Quiet health poll for the header dot.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await twilioAPI.getHealth();
        if (!cancelled)
          setHealthy(res.status === "ok" || res.status === "healthy");
      } catch {
        if (!cancelled) setHealthy(false);
      }
    };
    check();
    const interval = setInterval(check, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const handleStartCall = useCallback(async (phone: string) => {
    try {
      setCallBusy(true);
      setCallError(null);
      const res = await twilioAPI.createCall({ phone_number: phone });
      setOwnCallSid(res.call_sid);
    } catch (err) {
      setCallError(
        err instanceof Error ? err.message : "Failed to start the call",
      );
    } finally {
      setCallBusy(false);
    }
  }, []);

  const handleEndCall = useCallback(async () => {
    if (!ownCallSid) return;
    try {
      setCallBusy(true);
      setCallError(null);
      await twilioAPI.deleteCall(ownCallSid);
      setOwnCallSid(null);
    } catch (err) {
      setCallError(
        err instanceof Error ? err.message : "Failed to end the call",
      );
    } finally {
      setCallBusy(false);
    }
  }, [ownCallSid]);

  const handleSelectCall = useCallback(
    (callId: string) => {
      session.selectCall(callId);
      setIsPinned(true);
    },
    [session],
  );

  const handleBackToLive = useCallback(() => {
    session.selectCall(null);
    setIsPinned(false);
  }, [session]);

  const stateLabel = STATE_LABEL[session.state] ?? session.state;

  return (
    <div className="grid h-screen grid-rows-[auto_1fr_34vh] overflow-hidden">
      {/* ============ header ============ */}
      <header className="flex items-center gap-3 border-b border-hairline-soft px-7 py-3.5">
        <div className="grid h-6 w-6 place-items-center rounded-sm bg-voice pt-px font-brand text-[15px] font-bold text-white">
          S
        </div>
        <div className="font-brand text-[16px] font-bold uppercase tracking-wide text-ink">
          SuperYou{" "}
          <span className="ml-1 text-[13px] font-semibold tracking-[0.12em] text-ink-3">
            Voice Agent
          </span>
        </div>
        <div className="ml-auto flex items-center gap-4 font-mono text-[11px] text-ink-3">
          <span className="hidden sm:inline">plivo · mumbai-1</span>
          <span className="flex items-center gap-1.5 text-ink-2">
            <i
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                healthy === false ? "bg-attention" : "bg-ok"
              }`}
              aria-hidden
            />
            {healthy === false ? "agent unreachable" : "agent online"}
          </span>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="rounded border border-hairline bg-card px-3 py-1.5 font-body text-[12.5px] font-medium text-ink-2 transition-colors duration-150 hover:border-ink-3 hover:text-ink"
          >
            Past sessions
            {session.calls.length ? ` · ${session.calls.length}` : ""}
          </button>
        </div>
      </header>

      {/* ============ stage ============ */}
      <main className="relative flex min-h-0 flex-col items-center justify-center gap-1">
        <div className="flex items-baseline gap-2.5 text-[15px] text-ink-2">
          {session.isLive || session.activeCallId ? (
            <>
              <b className="font-semibold text-ink">
                {session.caller || "Unknown caller"}
              </b>
              {session.durationSec !== null && (
                <span className="border-l border-hairline pl-2.5 font-mono text-[12.5px] tabular-nums">
                  {formatDuration(session.durationSec)}
                </span>
              )}
              {isPinned && !session.isLive && (
                <span className="rounded-sm bg-inset px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-ink-2">
                  REPLAY
                </span>
              )}
            </>
          ) : (
            <span className="text-ink-3">
              No active call — Maya answers the support line automatically
            </span>
          )}
        </div>

        <AgentVisualizer
          state={session.state}
          color="#EF1400"
          className="h-[min(40vh,380px)] w-[min(40vh,380px)]"
        />

        <div className="-mt-4 flex flex-col items-center gap-3">
          <div className="font-brand text-[21px] font-bold uppercase tracking-[0.2em] text-ink">
            {stateLabel}
          </div>

          <PipelineTrace state={session.state} />

          <div className="mt-2">
            <ControlBar
              state={session.state}
              isLive={session.isLive}
              canEnd={ownCallSid !== null}
              busy={callBusy}
              onStartCall={handleStartCall}
              onEndCall={handleEndCall}
            />
          </div>

          {(callError || session.listError) && (
            <p className="max-w-md text-center text-[12.5px] text-attention">
              {callError || session.listError}
            </p>
          )}
        </div>
      </main>

      {/* ============ call tape ============ */}
      <CallTape
        messages={session.messages}
        callId={session.activeCallId}
        caller={session.caller}
        isLive={session.isLive}
        startedAtLabel={session.startedAtLabel}
        error={session.detailError}
      />

      <SessionsDrawer
        open={drawerOpen}
        calls={session.calls}
        activeCallId={session.activeCallId}
        isPinned={isPinned}
        onSelect={handleSelectCall}
        onBackToLive={handleBackToLive}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
