"use client";

// Central polling source for the console. One instance drives the whole
// stage: transcript list (5s) -> active call detection -> transcript detail
// (2.5s) -> derived Agents UI `AgentState` for AgentAudioVisualizerCustom.
//
// Per docs.livekit.io/reference/components/react/concepts/contexts.md, room-
// bound components require a connected LiveKitRoom (server URL + token).
// This architecture has neither -- audio flows Plivo SIP -> TEN agent inside
// a Cloudflare Worker, never through a LiveKit room in the browser. So we
// drive the real `AgentAudioVisualizerCustom` component by its `state` prop
// alone (its documented, track-free mode of operation) instead of faking a
// room connection.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentState } from "@livekit/components-react";
import {
  demoAPI,
  type TranscriptCallSummary,
  type TranscriptMessage,
} from "@/app/demoApi";

/** The subset of AgentState this console can derive from transcript polling. */
export type AgentVisualState = Extract<
  AgentState,
  "idle" | "listening" | "thinking" | "speaking"
>;

const LIST_POLL_MS = 5000;
const DETAIL_POLL_MS = 2500;

/** A call is "live" if its transcript moved within this window. */
const LIVE_WINDOW_MS = 45_000;
/** How long a tool invocation keeps the agent in "thinking". */
const THINKING_WINDOW_MS = 4000;
/** How long an assistant turn keeps the agent in "speaking". */
const SPEAKING_WINDOW_MS = 7000;

export function parseTs(ts: string): number {
  const ms = new Date(ts).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

const EMPTY_MESSAGES: TranscriptMessage[] = [];

export interface AgentSession {
  /** All known calls, newest first. */
  calls: TranscriptCallSummary[];
  /** The call currently shown on the tape (live call, or manual selection). */
  activeCallId: string | null;
  /** Whether the active call is live (transcript still moving). */
  isLive: boolean;
  caller: string | null;
  messages: TranscriptMessage[];
  state: AgentVisualState;
  /** Seconds since the active call started. */
  durationSec: number | null;
  startedAtLabel: string | null;
  listError: string | null;
  detailError: string | null;
  /** Pin the tape to a past call (null returns to auto live-follow). */
  selectCall: (callId: string | null) => void;
}

export function useAgentSession(): AgentSession {
  const [calls, setCalls] = useState<TranscriptCallSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [pinnedCallId, setPinnedCallId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  // Tracks which call `messages` belongs to, so a stale transcript from the
  // previous call is never shown against a newly-selected one (derived at
  // render time instead of reset synchronously inside an effect).
  const [messagesCallId, setMessagesCallId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  // Ticks once per second so live-window state derivation stays fresh
  // between polls without extra network traffic.
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ---- poll the call list -------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    const fetchList = async () => {
      try {
        const data = await demoAPI.listTranscripts();
        if (cancelled) return;
        const sorted = [...(data.calls ?? [])].sort(
          (a, b) => parseTs(b.last_at) - parseTs(a.last_at),
        );
        setCalls(sorted);
        setListError(null);
      } catch (err) {
        if (cancelled) return;
        setListError(
          err instanceof Error ? err.message : "Failed to load calls",
        );
      }
    };

    fetchList();
    const interval = setInterval(fetchList, LIST_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // ---- active call: manual pin wins, else the freshest live call ----------
  const liveCall = useMemo(() => {
    const newest = calls[0];
    if (!newest) return null;
    return nowMs - parseTs(newest.last_at) <= LIVE_WINDOW_MS ? newest : null;
  }, [calls, nowMs]);

  const activeCallId = pinnedCallId ?? liveCall?.call_id ?? null;
  const activeSummary = calls.find((c) => c.call_id === activeCallId) ?? null;
  const isLive = liveCall !== null && liveCall.call_id === activeCallId;

  // ---- poll the active transcript -----------------------------------------
  useEffect(() => {
    if (!activeCallId) return;

    let cancelled = false;

    const fetchDetail = async () => {
      try {
        const data = await demoAPI.getTranscript(activeCallId);
        if (cancelled) return;
        setMessages(data.messages ?? []);
        setMessagesCallId(activeCallId);
        setDetailError(null);
      } catch (err) {
        if (cancelled) return;
        setDetailError(
          err instanceof Error ? err.message : "Failed to load transcript",
        );
      }
    };

    fetchDetail();
    const interval = setInterval(fetchDetail, DETAIL_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeCallId]);

  // Only trust `messages` while they belong to the currently active call —
  // avoids a one-tick flash of the previous call's transcript when switching.
  // A stable empty-array reference keeps this from invalidating the useMemo
  // below on every render while a new call's transcript is still loading.
  const displayedMessages = useMemo(
    () => (messagesCallId === activeCallId ? messages : EMPTY_MESSAGES),
    [messagesCallId, activeCallId, messages],
  );
  const displayedDetailError = activeCallId ? detailError : null;

  // ---- derive visualizer state --------------------------------------------
  const state = useMemo<AgentVisualState>(() => {
    if (!isLive || displayedMessages.length === 0) return "idle";
    const last = displayedMessages[displayedMessages.length - 1];
    const age = nowMs - parseTs(last.ts);
    if (last.role === "tool" && age <= THINKING_WINDOW_MS) return "thinking";
    if (last.role === "assistant" && age <= SPEAKING_WINDOW_MS)
      return "speaking";
    return "listening";
  }, [isLive, displayedMessages, nowMs]);

  // ---- duration ------------------------------------------------------------
  const durationSec = useMemo(() => {
    if (!activeSummary) return null;
    const start = parseTs(activeSummary.started_at);
    if (!start) return null;
    const end = isLive ? nowMs : parseTs(activeSummary.last_at) || nowMs;
    return Math.max(0, Math.floor((end - start) / 1000));
  }, [activeSummary, isLive, nowMs]);

  const startedAtLabel = useMemo(() => {
    if (!activeSummary) return null;
    const d = new Date(activeSummary.started_at);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [activeSummary]);

  const selectCall = useCallback((callId: string | null) => {
    setPinnedCallId(callId);
  }, []);

  return {
    calls,
    activeCallId,
    isLive,
    caller: activeSummary?.caller ?? null,
    messages: displayedMessages,
    state,
    durationSec,
    startedAtLabel,
    listError,
    detailError: displayedDetailError,
    selectCall,
  };
}
