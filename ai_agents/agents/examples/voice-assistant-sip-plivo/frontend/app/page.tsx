"use client";

// SuperYou Voice Agent console — Quiet Stage.
// Locked viewport, three rows: header / stage / flowing call tape.
// The agent (visualizer + pipeline) is the interface; ops context appears
// only as artifacts of tool calls, inline on the tape.

import { useCallback, useEffect, useState } from "react";
import { callAPI } from "@/app/api";
import { AgentAudioVisualizerCustom } from "@/components/agents-ui/agent-audio-visualizer-custom";
import CallTape from "@/components/console/CallTape";
import ControlBar, { type CallPersona } from "@/components/console/ControlBar";
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
        const res = await callAPI.getHealth();
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

  const handleStartCall = useCallback(
    async (phone: string, persona?: CallPersona) => {
      try {
        setCallBusy(true);
        setCallError(null);
        const res = await callAPI.createCall({
          phone_number: phone,
          ...(persona
            ? { persona_phone: persona.phone, persona_name: persona.name }
            : {}),
        });
        setOwnCallSid(res.call_uuid);
      } catch (err) {
        setCallError(
          err instanceof Error ? err.message : "Failed to start the call",
        );
      } finally {
        setCallBusy(false);
      }
    },
    [],
  );

  const handleEndCall = useCallback(async () => {
    if (!ownCallSid) return;
    try {
      setCallBusy(true);
      setCallError(null);
      await callAPI.deleteCall(ownCallSid);
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
    <div className="grid h-screen grid-rows-[auto_1fr_minmax(250px,32vh)] overflow-hidden text-ink">
      {/* ============ header ============ */}
      <header className="flex items-center gap-4 border-b border-line-soft bg-panel/80 px-7 py-4 shadow-[0_1px_0_rgba(255,255,255,0.65)_inset] backdrop-blur">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-voice pt-px font-brand text-[17px] font-bold text-white shadow-[0_8px_24px_rgba(226,37,24,0.24)]">
          S
        </div>
        <div>
          <div className="font-brand text-[18px] font-bold uppercase tracking-[0.08em] text-ink">
            SuperYou
          </div>
          <div className="-mt-0.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.22em] text-ink-tertiary">
            Voice Agent Console
          </div>
        </div>
        <div className="ml-auto flex items-center gap-4 font-mono text-[11px] font-medium text-ink-tertiary">
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
            className="rounded-full border border-line bg-control px-3.5 py-2 font-body text-[13px] font-semibold text-ink-secondary transition-colors duration-150 hover:bg-control-hover hover:text-ink"
          >
            Past sessions
            {session.calls.length ? ` · ${session.calls.length}` : ""}
          </button>
        </div>
      </header>

      {/* ============ stage ============ */}
      <main className="relative flex min-h-0 items-center justify-center px-6 py-6">
        <div className="grid w-full max-w-[1040px] grid-cols-[1fr_auto_1fr] items-center gap-8 rounded-[28px] border border-line-soft bg-panel/70 px-8 py-8 shadow-[0_24px_90px_rgba(38,32,24,0.09)] backdrop-blur">
          <section className="min-w-0 self-stretch rounded-2xl border border-line-soft bg-control/45 p-5">
            <div className="font-mono text-[10.5px] font-bold uppercase tracking-[0.24em] text-ink-tertiary">
              Current line
            </div>
            <div className="mt-4 flex items-baseline gap-2.5 text-[15px] text-ink-secondary">
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
                <span className="max-w-[18rem] text-[14px] leading-6 text-ink-tertiary">
                  No active call. Maya answers the support line automatically.
                </span>
              )}
            </div>
            <div className="mt-5 grid gap-2 font-mono text-[11px] font-medium text-ink-tertiary">
              <span>region · mumbai-1</span>
              <span>carrier · plivo sip</span>
              <span>memory · persona-aware</span>
            </div>
          </section>

          <section className="flex min-w-0 flex-col items-center">
            <AgentAudioVisualizerCustom
              size="xl"
              state={session.state}
              color="#EF1400"
              complexity={0.5}
              className="h-[min(36vh,340px)] w-[min(36vh,340px)]"
            />

            <div className="-mt-5 flex w-full flex-col items-center gap-3">
              <div className="font-brand text-[28px] font-bold uppercase tracking-[0.28em] text-ink drop-shadow-[0_1px_0_rgba(255,255,255,0.8)]">
                {stateLabel}
              </div>

              <PipelineTrace state={session.state} />

              <div className="mt-3 w-full">
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
                <p className="max-w-xl text-center font-mono text-[12px] font-medium text-attention">
                  {callError || session.listError}
                </p>
              )}
            </div>
          </section>

          <section className="min-w-0 self-stretch rounded-2xl border border-line-soft bg-control/45 p-5">
            <div className="font-mono text-[10.5px] font-bold uppercase tracking-[0.24em] text-ink-tertiary">
              Demo flow
            </div>
            <ol className="mt-4 space-y-3 text-[13px] font-medium leading-5 text-ink-secondary">
              <li>
                <b className="text-ink">1.</b> choose a seeded customer
              </li>
              <li>
                <b className="text-ink">2.</b> enter your real phone number
              </li>
              <li>
                <b className="text-ink">3.</b> Maya greets you with that order
                context
              </li>
            </ol>
            <div className="mt-5 rounded-xl border border-line-soft bg-panel p-3 font-mono text-[11px] leading-5 text-ink-tertiary">
              Ask: “Where is my order?” or “I received the wrong flavour.”
            </div>
          </section>
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
