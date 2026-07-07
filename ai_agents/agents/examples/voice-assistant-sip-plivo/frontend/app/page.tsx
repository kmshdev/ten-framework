"use client";

// SuperYou Voice Agent console — Quiet Stage.
// Locked viewport, three rows: header / stage / flowing call tape.
// The agent (visualizer + pipeline) is the interface; ops context appears
// only as artifacts of tool calls, inline on the tape.

import { useCallback, useEffect, useState } from "react";
import { callAPI } from "@/app/api";
import type { Customer } from "@/app/demoApi";
import { AgentAudioVisualizerCustom } from "@/components/agents-ui/agent-audio-visualizer-custom";
import CallTape from "@/components/console/CallTape";
import ControlBar, { type CallPersona } from "@/components/console/ControlBar";
import PipelineTrace from "@/components/console/PipelineTrace";
import SessionsDrawer from "@/components/console/SessionsDrawer";
import { useAgentSession } from "@/hooks/useAgentSession";

const HEALTH_POLL_MS = 30_000;

interface DemoBeat {
  label: string;
  say: string;
  expect: string;
}

const RAHUL_PHONE = "+917011457245";

const RAHUL_BEATS: DemoBeat[] = [
  {
    label: "WISMO proof",
    say: "Where is my order?",
    expect:
      "Maya should identify Rahul by caller ID, find #SY10004 and #SY10121, and call out #SY10121 as overdue in transit via DTDC from Bhiwandi.",
  },
  {
    label: "Follow-up memory",
    say: "Which order is the delayed one? What was in it?",
    expect:
      "She should name #SY10121 and read back the wafer items without asking Rahul to repeat context.",
  },
  {
    label: "Hindi / Hinglish",
    say: "Mera order kahan hai? Hindi mein batao.",
    expect:
      "She should switch languages and repeat tracking details naturally.",
  },
  {
    label: "Wrong item triage",
    say: "In my delivered order, the creatine flavour is wrong — I ordered Orange Kick but got something else.",
    expect:
      "She should reference #SY10004's actual line items and offer claim initiation or escalation.",
  },
  {
    label: "Brand knowledge",
    say: "Is your protein gluten free? I have a wheat allergy.",
    expect:
      "She should answer from the SuperYou FAQ / Vectorize knowledge base, not hallucinate.",
  },
  {
    label: "Escalation",
    say: "This is not helping. I want to talk to a real person.",
    expect:
      "In demo mode, she should register escalation and promise a callback within 15 minutes.",
  },
];

function scriptForPersona(persona: Customer | null): DemoBeat[] {
  if (persona?.phone === RAHUL_PHONE) return RAHUL_BEATS;

  const name = persona
    ? `${persona.first_name} ${persona.last_name}`
    : "the caller";
  const city = persona?.default_city ? ` in ${persona.default_city}` : "";
  const orderCount = persona?.orders_count ?? 0;

  return [
    {
      label: "Identity check",
      say: "Hi, can you help me with my latest order?",
      expect: persona
        ? `Maya should greet ${name}, use the seeded persona phone, and look up ${orderCount || "their"} order${orderCount === 1 ? "" : "s"}${city}.`
        : "Maya should treat the call as an unseeded customer and ask only for the minimum identity details needed.",
    },
    {
      label: "WISMO path",
      say: "Where is my order?",
      expect:
        "She should use the order-status tool, summarize the latest shipment state, and avoid asking for an order number if caller context is already known.",
    },
    {
      label: "Issue triage",
      say: "Something is wrong with one item in my order.",
      expect:
        "She should ask one clarifying question, then move toward replacement, claim, or human handoff depending on policy.",
    },
    {
      label: "Knowledge base",
      say: "How much protein is in the wafers?",
      expect:
        "She should answer from SuperYou product knowledge and keep the response concise enough for voice.",
    },
  ];
}

const STATE_LABEL: Record<string, string> = {
  idle: "Standing by",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

function MobileDemoGuide({ persona }: { persona: Customer | null }) {
  const beats = scriptForPersona(persona);
  const firstBeat = beats[0];
  const personaName = persona
    ? `${persona.first_name} ${persona.last_name}`
    : "Choose a persona";

  return (
    <details className="trace mt-1 w-full rounded-2xl border border-line-soft bg-control/45 p-3 lg:hidden">
      <summary className="type-ui flex cursor-pointer list-none items-center gap-2 text-ink-secondary">
        <span className="min-w-0 flex-1">Demo guide · {personaName}</span>
        <span className="trace-arrow text-ink-faint">▶</span>
      </summary>
      <div className="mt-3 grid gap-2 border-t border-line-soft pt-3">
        <p className="type-small text-ink">
          <b className="font-semibold">First ask:</b> “{firstBeat.say}”
        </p>
        <p className="type-small text-ink-tertiary">{firstBeat.expect}</p>
      </div>
    </details>
  );
}

function DemoGuide({ persona }: { persona: Customer | null }) {
  const beats = scriptForPersona(persona);
  const isRahul = persona?.phone === RAHUL_PHONE;
  const personaName = persona
    ? `${persona.first_name} ${persona.last_name}`
    : "No persona selected";

  return (
    <section className="hidden min-w-0 self-stretch rounded-3xl border border-line-soft bg-control/55 p-5 shadow-[0_1px_0_rgba(255,231,184,0.05)_inset] lg:flex lg:flex-col">
      <div className="type-caps text-ink-tertiary">Demo guide</div>
      <div className="mt-4 border-b border-line-soft pb-4">
        <div className="type-title text-ink">{personaName}</div>
        <p className="type-small mt-2 text-ink-tertiary">
          {isRahul
            ? "Primary pilot script: delayed order, Hindi switch, wrong-flavour triage, FAQ retrieval, memory, and escalation."
            : persona
              ? "Progressive demo path for this seeded caller. Select Rahul Verma for the full canonical client script."
              : "Choose a seeded customer first. The guide updates to match the persona so the operator knows what to ask next."}
        </p>
      </div>

      <div className="tape-scroll mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
        {beats.map((beat, index) => (
          <details
            key={`${beat.label}-${index}`}
            className="trace rounded-xl border border-transparent px-3 py-2 open:border-line-soft open:bg-inset/55"
            open={index === 0}
          >
            <summary className="type-ui flex cursor-pointer list-none items-baseline gap-2 text-ink-secondary">
              <span className="type-number text-voice">{index + 1}</span>
              <span className="min-w-0 flex-1">{beat.label}</span>
              <span className="trace-arrow text-ink-faint">▶</span>
            </summary>
            <div className="mt-2 grid gap-2 pl-5">
              <p className="type-small text-ink">
                <b className="font-semibold">Say:</b> “{beat.say}”
              </p>
              <p className="type-small text-ink-tertiary">
                <b className="font-semibold text-ink-secondary">Expect:</b>{" "}
                {beat.expect}
              </p>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  const session = useAgentSession();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [ownCallSid, setOwnCallSid] = useState<string | null>(null);
  const [callBusy, setCallBusy] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [selectedPersona, setSelectedPersona] = useState<Customer | null>(null);

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
    <div className="grid min-h-screen grid-rows-[auto_minmax(0,1fr)_minmax(170px,22vh)] overflow-x-hidden text-ink lg:overflow-hidden max-lg:h-auto max-lg:min-h-screen max-lg:grid-rows-[auto_auto_minmax(220px,36vh)]">
      {/* ============ header ============ */}
      <header className="flex items-center gap-3 border-b border-line-soft bg-panel/78 px-4 py-4 shadow-[0_1px_0_rgba(255,231,184,0.08)_inset] backdrop-blur sm:gap-4 sm:px-7">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-voice pt-px font-heading text-[1rem] font-bold text-white shadow-[0_0_34px_rgba(255,59,46,0.42)]">
          S
        </div>
        <div>
          <div className="type-title uppercase tracking-[0.08em] text-ink">
            SuperYou
          </div>
          <div className="type-caps text-ink-tertiary">Voice Agent Console</div>
        </div>
        <div className="type-mono ml-auto flex items-center gap-3 font-medium text-ink-tertiary sm:gap-4">
          <span className="hidden sm:inline">plivo · mumbai-1</span>
          <span
            className="flex items-center gap-1.5 text-ink-2"
            title={
              healthy === false
                ? "Backend not running in this local preview"
                : "agent online"
            }
          >
            <i
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                healthy === false ? "bg-attention" : "bg-ok"
              }`}
              aria-hidden
            />
            <span className="hidden sm:inline">
              {healthy === false ? "local preview" : "agent online"}
            </span>
          </span>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="type-ui rounded-full border border-line bg-control px-3.5 py-2 text-ink-secondary transition-colors duration-150 hover:bg-control-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-voice"
          >
            <span className="hidden sm:inline">Past sessions</span>
            <span className="sm:hidden">Sessions</span>
            {session.calls.length ? ` · ${session.calls.length}` : ""}
          </button>
        </div>
      </header>

      {/* ============ stage ============ */}
      <main className="relative z-20 flex min-h-0 items-stretch justify-stretch p-3 sm:p-4 lg:p-5">
        <div className="grid min-h-0 w-full grid-cols-1 items-stretch gap-5 rounded-[24px] border border-line bg-panel/74 px-4 py-5 shadow-[0_30px_110px_rgba(0,0,0,0.34),0_0_0_1px_rgba(255,231,184,0.03)_inset] backdrop-blur sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-7 lg:rounded-[30px] lg:px-7 lg:py-5">
          <section className="relative flex min-h-0 min-w-0 flex-col items-center justify-center rounded-[28px] border border-line-soft bg-inset/55 px-3 pb-5 pt-1 shadow-[0_0_90px_rgba(255,59,46,0.08)_inset] sm:px-6">
            <AgentAudioVisualizerCustom
              size="xl"
              state={session.state}
              color="#FF3B2E"
              complexity={0.68}
              className="h-[min(28vh,240px)] w-[min(28vh,240px)] sm:h-[min(28vh,260px)] sm:w-[min(28vh,260px)] lg:h-[min(30vh,280px)] lg:w-[min(30vh,280px)]"
            />

            <div className="-mt-3 flex w-full flex-col items-center gap-3 sm:-mt-5">
              <div className="text-center">
                <div className="type-caps text-voice">
                  Maya · SIP voice agent
                </div>
                <div className="type-display mt-1 uppercase tracking-[0.11em] text-ink">
                  {stateLabel}
                </div>
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
                  onPersonaChange={setSelectedPersona}
                />
              </div>

              <MobileDemoGuide persona={selectedPersona} />

              {(callError || session.listError) && (
                <p className="type-mono max-w-xl text-left font-medium text-attention">
                  {callError || session.listError}
                </p>
              )}
            </div>
          </section>

          <DemoGuide persona={selectedPersona} />
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
