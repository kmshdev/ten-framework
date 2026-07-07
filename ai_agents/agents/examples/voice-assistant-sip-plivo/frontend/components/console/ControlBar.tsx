"use client";

// AgentControlBar analog (LiveKit Agents UI media controls), adapted for a
// SIP ops console: no browser mic/audio track exists over Plivo SIP, so the
// bar carries session actions. When idle it morphs into the outbound dialer,
// with an optional persona picker so a demo call can "pose as" one of the
// seeded SuperYou customers (cloudflare/seed.sql) — the call still rings the
// number typed in, but order lookups and memory recall use the persona.

import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentVisualState } from "@/hooks/useAgentSession";
import { demoAPI, type Customer } from "@/app/demoApi";

export interface CallPersona {
  phone: string;
  name: string;
}

interface ControlBarProps {
  state: AgentVisualState;
  isLive: boolean;
  /** Set when the operator started this call and we can hang it up. */
  canEnd: boolean;
  busy: boolean;
  onStartCall: (phone: string, persona?: CallPersona) => void;
  onEndCall: () => void;
}

function Divider() {
  return <span className="my-2.5 w-px bg-line-soft" aria-hidden />;
}

function validatePhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Enter a phone number.";
  // Loose E.164-ish check: optional +, 8-15 digits total, no leading zero
  // after the country code. Good enough to catch typos before dialing --
  // Plivo itself is the source of truth for real validity.
  if (!/^\+?[1-9]\d{7,14}$/.test(trimmed.replace(/[\s-]/g, ""))) {
    return "Enter a valid phone number with country code, e.g. +919876543210.";
  }
  return null;
}

function PersonaPicker({
  persona,
  onChange,
}: {
  persona: Customer | null;
  onChange: (customer: Customer | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    demoAPI
      .listCustomers()
      .then((res) => {
        if (!cancelled) {
          setCustomers(res.customers ?? []);
          setLoadError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? customers.filter((c) =>
          `${c.first_name} ${c.last_name} ${c.default_city ?? ""} ${c.phone}`
            .toLowerCase()
            .includes(q),
        )
      : customers;
    return pool.slice(0, 40);
  }, [customers, query]);

  return (
    <div ref={rootRef} className="relative flex items-stretch">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Pose as a seeded SuperYou customer for this call (optional) — order lookups and memory recall use their identity"
        className={`group flex min-h-11 w-[15.5rem] items-center gap-2.5 px-4 py-2.5 text-[13px] font-semibold transition-colors duration-150 hover:bg-control-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-voice ${
          persona ? "text-ink" : "text-ink-tertiary"
        }`}
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-control text-ink-tertiary ring-1 ring-line-soft group-hover:text-ink">
          <PersonaIcon />
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate">
            {persona
              ? `${persona.first_name} ${persona.last_name}`
              : "Choose persona"}
          </span>
          {persona && (
            <span className="block truncate font-mono text-[10.5px] font-medium text-ink-tertiary">
              {persona.default_city ?? "Seeded customer"} ·{" "}
              {persona.orders_count} orders
            </span>
          )}
        </span>
        <span className="font-mono text-[11px] text-ink-faint">⌄</span>
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+10px)] z-50 w-[24rem] overflow-hidden rounded-xl border border-line bg-elevated shadow-[0_18px_60px_rgba(36,31,24,0.18)]">
          <div className="border-b border-line-soft p-3">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, city, or phone…"
              aria-label="Search seeded customers"
              className="h-10 w-full rounded-lg border border-line-soft bg-control px-3 font-body text-[13px] font-medium text-ink placeholder:text-ink-faint focus:border-voice focus:outline-none"
            />
          </div>
          <ul className="max-h-80 overflow-y-auto p-1.5">
            <li>
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-[13px] font-medium text-ink-secondary hover:bg-control-hover"
              >
                No persona — use real caller identity
              </button>
            </li>
            {loading && (
              <li className="px-3 py-3 text-[12px] text-ink-tertiary">
                Loading seeded customers…
              </li>
            )}
            {loadError && (
              <li className="px-3 py-3 text-[12px] text-attention">
                Couldn&apos;t load customers. Check /demo/customers.
              </li>
            )}
            {!loading && !loadError && matches.length === 0 && (
              <li className="px-3 py-3 text-[12px] text-ink-tertiary">
                No matches.
              </li>
            )}
            {matches.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(c);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-3 text-left transition-colors hover:bg-control-hover focus-visible:outline-2 focus-visible:outline-voice"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-semibold text-ink">
                      {c.first_name} {c.last_name}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-ink-tertiary">
                      {c.phone}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-control px-2.5 py-1 font-mono text-[10.5px] font-medium text-ink-secondary ring-1 ring-line-soft">
                    {c.default_city ?? "—"} · {c.orders_count} order
                    {c.orders_count === 1 ? "" : "s"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function ControlBar({
  isLive,
  canEnd,
  busy,
  onStartCall,
  onEndCall,
}: ControlBarProps) {
  const [phone, setPhone] = useState("");
  const [persona, setPersona] = useState<Customer | null>(null);
  const [touched, setTouched] = useState(false);

  const phoneError = validatePhone(phone);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (phoneError) return;
    onStartCall(
      phone.trim(),
      persona
        ? {
            phone: persona.phone,
            name: `${persona.first_name} ${persona.last_name}`,
          }
        : undefined,
    );
  };

  if (!isLive) {
    return (
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-[720px] flex-col items-stretch gap-2"
      >
        <div className="relative flex items-stretch rounded-2xl border border-line bg-panel shadow-[0_14px_50px_rgba(38,32,24,0.08)]">
          <PersonaPicker persona={persona} onChange={setPersona} />
          <Divider />
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="+91 98XXX XXXXX"
            aria-label="Phone number for outbound call"
            className="min-h-11 w-[15rem] bg-control px-4 py-2.5 font-mono text-[13px] font-medium tabular-nums text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <Divider />
          <button
            type="submit"
            disabled={busy || !!phoneError}
            className="flex min-h-11 items-center gap-2 rounded-r-2xl px-5 py-2.5 text-[13px] font-bold text-ink transition-colors duration-150 hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-35"
          >
            {busy ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border border-ink-3 border-t-transparent" />
            ) : (
              <PhoneIcon />
            )}
            Start outbound call
          </button>
        </div>
        {touched && phoneError && (
          <p className="px-2 font-mono text-[11.5px] font-medium text-attention">
            {phoneError}
          </p>
        )}
      </form>
    );
  }

  return (
    <div className="flex items-stretch overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_14px_50px_rgba(38,32,24,0.08)]">
      <button
        type="button"
        disabled
        title="Live audio monitoring is not available over SIP — coming with media streaming"
        className="flex cursor-not-allowed items-center gap-2 px-4 py-2.5 text-[13px] font-medium text-ink-mute"
      >
        <SpeakerIcon />
        Listen in
      </button>
      <Divider />
      <button
        type="button"
        disabled
        title="Maya performs warm transfers herself via the transfer_to_human tool — watch for it on the tape"
        className="flex cursor-not-allowed items-center gap-2 px-4 py-2.5 text-[13px] font-medium text-ink-mute"
      >
        <TransferIcon />
        Transfer to human
      </button>
      <Divider />
      <button
        type="button"
        onClick={onEndCall}
        disabled={!canEnd || busy}
        title={
          canEnd
            ? "Hang up this call"
            : "Only operator-initiated calls can be ended from the console"
        }
        className="flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium text-voice transition-colors duration-150 enabled:hover:bg-voice-soft disabled:cursor-not-allowed disabled:opacity-40"
      >
        <EndIcon />
        End call
      </button>
    </div>
  );
}

/* Inline 15px stroke icons (lucide-style, kept dependency-light) */

function PhoneIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[15px] w-[15px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function PersonaIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[15px] w-[15px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[15px] w-[15px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 5 6 9H3v6h3l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    </svg>
  );
}

function TransferIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[15px] w-[15px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M16 3h5v5" />
      <path d="M21 3 13 11" />
      <path d="M8 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function EndIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[15px] w-[15px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 12.5c-1.5-1.3-3.8-2.5-10-2.5S3.5 11.2 2 12.5c-.8.7-.8 2 .1 2.9l1.7 1.7c.7.7 1.8.8 2.6.2l1.9-1.4c.5-.4.8-1 .8-1.6v-1c1.9-.5 4-.5 5.9 0v1c0 .6.3 1.2.8 1.6l1.9 1.4c.8.6 1.9.5 2.6-.2l1.7-1.7c.9-.9.9-2.2 0-2.9z" />
    </svg>
  );
}
