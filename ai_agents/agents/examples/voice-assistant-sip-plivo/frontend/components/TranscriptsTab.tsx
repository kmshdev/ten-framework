"use client";

import { MessageSquare, Phone, RefreshCw, Wrench } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  demoAPI,
  type TranscriptCallSummary,
  type TranscriptMessage,
} from "@/app/demoApi";

const LIST_POLL_MS = 5000;
const DETAIL_POLL_MS = 3000;

function formatTime(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatClock(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function MessageBubble({ message }: { message: TranscriptMessage }) {
  if (message.role === "tool") {
    return (
      <div className="flex justify-center">
        <div className="flex max-w-[85%] items-start gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-gray-500">
          <Wrench className="mt-0.5 h-3 w-3 flex-shrink-0" />
          <span className="break-words font-mono text-[11px] leading-relaxed">
            {message.content}
          </span>
        </div>
      </div>
    );
  }

  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
          isUser
            ? "rounded-br-md bg-gray-900 text-white"
            : "rounded-bl-md bg-orange-100 text-orange-950"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
        <p
          className={`mt-1 text-[10px] ${
            isUser ? "text-gray-400" : "text-orange-700/60"
          }`}
        >
          {formatClock(message.ts)}
        </p>
      </div>
    </div>
  );
}

export default function TranscriptsTab() {
  const [calls, setCalls] = useState<TranscriptCallSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TranscriptMessage[] | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const messageCountRef = useRef(0);

  // Poll the call list.
  useEffect(() => {
    let cancelled = false;

    const fetchList = async () => {
      try {
        const data = await demoAPI.listTranscripts();
        if (cancelled) return;
        setCalls(data.calls ?? []);
        setListError(null);
      } catch (err) {
        if (cancelled) return;
        setListError(
          err instanceof Error ? err.message : "Failed to load calls"
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

  // Poll the selected call's transcript.
  useEffect(() => {
    if (!selectedCallId) {
      setMessages(null);
      setDetailError(null);
      return;
    }

    let cancelled = false;
    setMessages(null);
    setDetailError(null);
    setIsDetailLoading(true);
    messageCountRef.current = 0;

    const fetchDetail = async () => {
      try {
        const data = await demoAPI.getTranscript(selectedCallId);
        if (cancelled) return;
        setMessages(data.messages ?? []);
        setDetailError(null);
      } catch (err) {
        if (cancelled) return;
        setDetailError(
          err instanceof Error ? err.message : "Failed to load transcript"
        );
      } finally {
        if (!cancelled) setIsDetailLoading(false);
      }
    };

    fetchDetail();
    const interval = setInterval(fetchDetail, DETAIL_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedCallId]);

  // Auto-scroll to the bottom when new messages stream in.
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    if (messages && messages.length !== messageCountRef.current) {
      messageCountRef.current = messages.length;
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  const selectedSummary = calls?.find((c) => c.call_id === selectedCallId);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px,1fr]">
      {/* Call list */}
      <div className="card flex max-h-[70vh] flex-col !p-0">
        <div className="flex items-center justify-between border-gray-100 border-b px-5 py-4">
          <h2 className="font-semibold text-gray-900">Calls</h2>
          <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
            <RefreshCw className="h-3 w-3" />
            auto-refresh 5s
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {listError ? (
            <div className="p-5 text-red-600 text-sm">{listError}</div>
          ) : calls === null ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-xl bg-gray-100"
                />
              ))}
            </div>
          ) : calls.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center text-gray-400">
              <Phone className="h-8 w-8" />
              <p className="text-sm">
                No calls yet. Transcripts appear here as soon as a call starts.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {calls.map((call) => {
                const isSelected = call.call_id === selectedCallId;
                return (
                  <li key={call.call_id}>
                    <button
                      onClick={() => setSelectedCallId(call.call_id)}
                      className={`w-full px-5 py-3.5 text-left transition-colors ${
                        isSelected
                          ? "bg-orange-50 ring-1 ring-orange-200 ring-inset"
                          : "hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-900 text-sm">
                          {call.caller || "Unknown caller"}
                        </span>
                        <span className="flex items-center gap-1 text-gray-400 text-xs">
                          <MessageSquare className="h-3 w-3" />
                          {call.messages}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-gray-400 text-xs">
                        <span>{formatTime(call.started_at)}</span>
                        <span className="max-w-[120px] truncate font-mono text-[10px]">
                          {call.call_id}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Conversation */}
      <div className="card flex max-h-[70vh] min-h-[420px] flex-col !p-0">
        {!selectedCallId ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-gray-400">
            <MessageSquare className="h-10 w-10" />
            <p className="text-sm">Select a call to view its conversation.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-gray-100 border-b px-5 py-4">
              <div>
                <h2 className="font-semibold text-gray-900">
                  {selectedSummary?.caller || "Unknown caller"}
                </h2>
                <p className="font-mono text-[11px] text-gray-400">
                  {selectedCallId}
                </p>
              </div>
              <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
                <RefreshCw className="h-3 w-3" />
                auto-refresh 3s
              </span>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-5">
              {detailError ? (
                <p className="text-red-600 text-sm">{detailError}</p>
              ) : isDetailLoading && messages === null ? (
                <div className="space-y-3">
                  <div className="ml-auto h-12 w-2/3 animate-pulse rounded-2xl bg-gray-100" />
                  <div className="h-12 w-2/3 animate-pulse rounded-2xl bg-orange-100/60" />
                  <div className="ml-auto h-12 w-1/2 animate-pulse rounded-2xl bg-gray-100" />
                </div>
              ) : messages && messages.length > 0 ? (
                <div className="space-y-3">
                  {messages.map((message, index) => (
                    <MessageBubble
                      key={`${message.ts}-${index}`}
                      message={message}
                    />
                  ))}
                </div>
              ) : (
                <p className="py-8 text-center text-gray-400 text-sm">
                  No messages in this call yet.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
