"use client";

// AgentControlBar analog (LiveKit Agents UI media controls), adapted for a
// SIP ops console: no browser mic/audio track exists over Plivo SIP, so the
// bar carries session actions. When idle it morphs into the outbound dialer.

import { useState } from "react";
import type { AgentVisualState } from "@/hooks/useAgentSession";

interface ControlBarProps {
  state: AgentVisualState;
  isLive: boolean;
  /** Set when the operator started this call and we can hang it up. */
  canEnd: boolean;
  busy: boolean;
  onStartCall: (phone: string) => void;
  onEndCall: () => void;
}

function Divider() {
  return <span className="my-2 w-px bg-hairline-soft" aria-hidden />;
}

export default function ControlBar({
  isLive,
  canEnd,
  busy,
  onStartCall,
  onEndCall,
}: ControlBarProps) {
  const [phone, setPhone] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = phone.trim();
    if (trimmed) onStartCall(trimmed);
  };

  if (!isLive) {
    return (
      <form
        onSubmit={handleSubmit}
        className="flex items-stretch overflow-hidden rounded-md border border-hairline bg-card shadow-[0_1px_2px_rgba(26,26,24,0.03)]"
      >
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+91 98XXX XXXXX"
          aria-label="Phone number for outbound call"
          className="w-48 bg-inset px-4 py-2.5 font-mono text-[12.5px] text-ink placeholder:text-ink-mute focus:outline-none"
        />
        <Divider />
        <button
          type="submit"
          disabled={busy || phone.trim().length < 8}
          className="flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:bg-inset hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border border-ink-3 border-t-transparent" />
          ) : (
            <PhoneIcon />
          )}
          Start outbound call
        </button>
      </form>
    );
  }

  return (
    <div className="flex items-stretch overflow-hidden rounded-md border border-hairline bg-card shadow-[0_1px_2px_rgba(26,26,24,0.03)]">
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
    <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 5 6 9H3v6h3l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    </svg>
  );
}

function TransferIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 3h5v5" />
      <path d="M21 3 13 11" />
      <path d="M8 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function EndIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 12.5c-1.5-1.3-3.8-2.5-10-2.5S3.5 11.2 2 12.5c-.8.7-.8 2 .1 2.9l1.7 1.7c.7.7 1.8.8 2.6.2l1.9-1.4c.5-.4.8-1 .8-1.6v-1c1.9-.5 4-.5 5.9 0v1c0 .6.3 1.2.8 1.6l1.9 1.4c.8.6 1.9.5 2.6-.2l1.7-1.7c.9-.9.9-2.2 0-2.9z" />
    </svg>
  );
}
