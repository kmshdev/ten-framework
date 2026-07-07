"use client";

// The call tape: flowing transcript with turns and tool traces. Tool calls
// render collapsed (`fn args`) and expand into the artifact the agent
// retrieved — order lookups and KB hits are re-fetched from the same /demo
// endpoints the agent's tools use, so the console shows real data.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  demoAPI,
  type KbResult,
  type Order,
  type TranscriptMessage,
} from "@/app/demoApi";

/* ---------- helpers ---------- */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function formatINR(value: string | number): string {
  const n = typeof value === "string" ? Number.parseFloat(value) : value;
  return Number.isNaN(n) ? String(value) : inr.format(n);
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

const DEVANAGARI = /[\u0900-\u097F]/;

interface ParsedTool {
  fn: string;
  args: Record<string, unknown>;
  argsLabel: string;
}

/** Tool transcript entries arrive as `tool_name({"arg": "value"})`. */
function parseToolMessage(content: string): ParsedTool | null {
  const match = content.match(/^\s*([a-zA-Z_][\w]*)\s*\(([\s\S]*)\)\s*$/);
  if (!match) return null;
  const [, fn, rawArgs] = match;
  let args: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawArgs || "{}");
    if (parsed && typeof parsed === "object") args = parsed;
  } catch {
    // keep raw label below
  }
  const argsLabel =
    Object.entries(args)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(" · ") || rawArgs.slice(0, 80);
  return { fn, args, argsLabel };
}

/* ---------- artifact cards ---------- */

function ArtifactShell({
  title,
  badge,
  badgeTone = "ok",
  children,
}: {
  title: string;
  badge?: string;
  badgeTone?: "ok" | "attention";
  children: React.ReactNode;
}) {
  return (
    <div className="my-1.5 mb-2.5 overflow-hidden rounded border border-hairline bg-card">
      <div className="flex items-center gap-2.5 border-b border-hairline-soft px-4 py-2.5">
        <span className="text-[13.5px] font-semibold text-ink">{title}</span>
        {badge && (
          <span
            className={`ml-auto rounded-sm px-2 py-0.5 font-mono text-[10.5px] tracking-wide ${
              badgeTone === "ok"
                ? "bg-ok-bg text-ok"
                : "bg-attention-bg text-attention"
            }`}
          >
            {badge}
          </span>
        )}
      </div>
      <div className="px-4 py-3 text-[13px] text-ink-2">{children}</div>
    </div>
  );
}

function OrderArtifact({ args }: { args: Record<string, unknown> }) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const orderNumber = args.order_number ? String(args.order_number) : null;
    const phone = args.phone ? String(args.phone) : null;

    const load = async () => {
      try {
        const res = orderNumber
          ? await demoAPI.lookupOrderByNumber(orderNumber)
          : phone
            ? await demoAPI.lookupOrderByPhone(phone)
            : null;
        if (cancelled) return;
        setOrders(res?.found ? res.orders : []);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Lookup failed");
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [args]);

  if (error)
    return (
      <ArtifactShell title="Order lookup" badge="ERROR" badgeTone="attention">
        {error}
      </ArtifactShell>
    );
  if (orders === null)
    return (
      <div className="my-2 h-20 animate-pulse rounded border border-hairline-soft bg-inset" />
    );
  if (orders.length === 0)
    return (
      <ArtifactShell
        title="Order lookup"
        badge="NO MATCH"
        badgeTone="attention"
      >
        No orders found for this query.
      </ArtifactShell>
    );

  return (
    <>
      {orders.map((order) => {
        const shipment = order.shipment;
        const status = (shipment?.status ?? order.payment_status ?? "")
          .replace(/_/g, " ")
          .toUpperCase();
        const delivered = shipment?.status === "delivered";
        return (
          <ArtifactShell
            key={order.order_number}
            title={`Order #${order.order_number}`}
            badge={status || undefined}
            badgeTone={delivered ? "ok" : "attention"}
          >
            <table className="w-full border-collapse text-[12.5px]">
              <tbody>
                {order.items.map((item, i) => (
                  <tr key={i}>
                    <td className="border-b border-hairline-soft py-1.5 text-ink last:border-0">
                      {item.title} ×{item.quantity}
                    </td>
                    <td className="border-b border-hairline-soft py-1.5 text-right font-mono text-[11.5px] last:border-0">
                      {formatINR(item.price)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-1 flex justify-between border-t border-hairline-soft pt-2.5 text-[12px]">
              <span>Total {formatINR(order.total_price_inr)}</span>
              {shipment && (
                <span className="font-mono text-[11px] text-ink-3">
                  {shipment.courier} · AWB {shipment.awb}
                </span>
              )}
            </div>
            {shipment?.last_checkpoint && !delivered && (
              <div className="mt-2.5 rounded-sm bg-attention-bg px-2.5 py-2 text-[12px] leading-relaxed text-attention">
                Last scan — {shipment.last_checkpoint}
                {shipment.estimated_delivery
                  ? ` · ETA ${shipment.estimated_delivery}`
                  : ""}
              </div>
            )}
          </ArtifactShell>
        );
      })}
    </>
  );
}

function KbArtifact({ args }: { args: Record<string, unknown> }) {
  const [results, setResults] = useState<KbResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const query = args.query ? String(args.query) : "";
    if (!query) {
      setResults([]);
      return;
    }
    demoAPI
      .queryKb(query)
      .then((res) => {
        if (!cancelled) setResults(res.results.slice(0, 2));
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Query failed");
      });
    return () => {
      cancelled = true;
    };
  }, [args]);

  if (error)
    return (
      <ArtifactShell title="Knowledge base" badge="ERROR" badgeTone="attention">
        {error}
      </ArtifactShell>
    );
  if (results === null)
    return (
      <div className="my-2 h-16 animate-pulse rounded border border-hairline-soft bg-inset" />
    );
  if (results.length === 0)
    return (
      <ArtifactShell
        title="Knowledge base"
        badge="NO HIT"
        badgeTone="attention"
      >
        No passages matched.
      </ArtifactShell>
    );

  return (
    <>
      {results.map((hit, i) => (
        <ArtifactShell
          key={i}
          title={hit.title}
          badge={`SCORE ${hit.score.toFixed(2)}`}
          badgeTone={hit.score >= 0.5 ? "ok" : "attention"}
        >
          <p className="mb-2 border-l-2 border-hairline pl-3 text-[12.5px] leading-relaxed">
            {hit.text}
          </p>
          <span className="font-mono text-[10.5px] text-ink-3">
            {hit.section}
          </span>
        </ArtifactShell>
      ))}
    </>
  );
}

function GenericArtifact({ tool }: { tool: ParsedTool }) {
  const copy: Record<string, { title: string; body: string }> = {
    recall_customer_memory: {
      title: "Caller memory recall",
      body: "Maya queried mem0 for this caller's history — prior orders, preferences, and past issues inform her next reply.",
    },
    transfer_to_human: {
      title: "Warm transfer",
      body: "Conversation summary and order context are shared with the human agent. The caller will not repeat anything.",
    },
  };
  const known = copy[tool.fn];
  return (
    <ArtifactShell
      title={known?.title ?? tool.fn}
      badge={known ? "DONE" : undefined}
      badgeTone="ok"
    >
      {known ? (
        <>
          <p className="leading-relaxed">{known.body}</p>
          {tool.argsLabel && (
            <p className="mt-2 font-mono text-[11px] text-ink-3">
              {tool.argsLabel}
            </p>
          )}
        </>
      ) : (
        <span className="font-mono text-[11.5px]">{tool.argsLabel}</span>
      )}
    </ArtifactShell>
  );
}

/* ---------- tape entries ---------- */

function ToolTrace({ message }: { message: TranscriptMessage }) {
  const [opened, setOpened] = useState(false);
  const tool = parseToolMessage(message.content);

  if (!tool) {
    return (
      <div className="animate-rise my-1 border-l-2 border-hairline py-1 pl-4 font-mono text-[12px] text-ink-3">
        {message.content}
      </div>
    );
  }

  return (
    <details
      className="trace animate-rise my-1 border-l-2 border-hairline pl-4"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open) setOpened(true);
      }}
    >
      <summary className="flex cursor-pointer select-none items-center gap-2.5 py-1 font-mono text-[12px] text-ink-3 transition-colors duration-150 hover:text-ink-2">
        <span className="trace-arrow inline-block text-[9px] text-ink-mute transition-transform duration-200">
          ▶
        </span>
        <span className="font-medium text-ink">{tool.fn}</span>
        <span className="truncate">{tool.argsLabel}</span>
        <span className="ml-auto shrink-0 text-[10.5px] text-ink-3">
          {formatClock(message.ts)}
        </span>
      </summary>
      {opened &&
        (tool.fn === "get_order_status" ? (
          <OrderArtifact args={tool.args} />
        ) : tool.fn === "search_superyou_kb" ? (
          <KbArtifact args={tool.args} />
        ) : (
          <GenericArtifact tool={tool} />
        ))}
    </details>
  );
}

function Turn({
  message,
  callerLabel,
}: {
  message: TranscriptMessage;
  callerLabel: string;
}) {
  const isAgent = message.role === "assistant";
  const hasHindi = DEVANAGARI.test(message.content);

  return (
    <div className="animate-rise py-3">
      <div className="mb-1 flex items-baseline gap-2.5">
        <span className="flex items-center gap-1.5 font-brand text-[11.5px] font-semibold uppercase tracking-[0.16em] text-ink-2">
          {isAgent && (
            <i className="h-1.5 w-1.5 rounded-full bg-voice" aria-hidden />
          )}
          {isAgent ? "Maya" : `${callerLabel} · caller`}
        </span>
        {hasHindi && (
          <span className="rounded-sm bg-inset px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-ink-2">
            HI
          </span>
        )}
        <span className="ml-auto font-mono text-[10.5px] tabular-nums text-ink-3">
          {formatClock(message.ts)}
        </span>
      </div>
      <p
        className={`max-w-[62ch] whitespace-pre-wrap break-words text-[15px] leading-[1.6] ${
          isAgent ? "text-ink" : "text-ink-2"
        }`}
      >
        {message.content}
      </p>
    </div>
  );
}

/* ---------- the tape ---------- */

export interface CallTapeProps {
  messages: TranscriptMessage[];
  callId: string | null;
  caller: string | null;
  isLive: boolean;
  startedAtLabel: string | null;
  error: string | null;
}

export default function CallTape({
  messages,
  callId,
  caller,
  isLive,
  startedAtLabel,
  error,
}: CallTapeProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const countRef = useRef(0);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    if (messages.length !== countRef.current) {
      countRef.current = messages.length;
      const el = scrollRef.current;
      // Follow the stream unless the operator scrolled up to read something.
      if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const callerLabel = caller || "Caller";

  return (
    <section
      className="flex min-h-0 flex-col border-t border-hairline bg-paper"
      aria-label="Call transcript"
    >
      <div className="mx-auto flex w-full max-w-[780px] items-baseline gap-3 px-6 pb-1.5 pt-2.5 font-mono text-[10.5px] uppercase tracking-wider text-ink-3">
        <span>Call tape</span>
        {callId && <span className="normal-case">{callId}</span>}
        {startedAtLabel && <span>started {startedAtLabel}</span>}
        <span className="ml-auto">
          {error
            ? "connection issue"
            : isLive
              ? "streaming"
              : callId
                ? "ended"
                : "waiting"}
        </span>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="tape-scroll tape-mask min-h-0 flex-1 overflow-y-auto scroll-smooth"
      >
        <div className="mx-auto w-full max-w-[780px] px-6 pb-7 pt-2">
          {error ? (
            <p className="py-6 text-center text-[13px] text-attention">
              {error}
            </p>
          ) : messages.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-3">
              {callId
                ? "No messages in this call yet."
                : "The tape streams here the moment a call connects."}
            </p>
          ) : (
            messages.map((message, index) =>
              message.role === "tool" ? (
                <ToolTrace key={`${message.ts}-${index}`} message={message} />
              ) : (
                <Turn
                  key={`${message.ts}-${index}`}
                  message={message}
                  callerLabel={callerLabel}
                />
              ),
            )
          )}
        </div>
      </div>
    </section>
  );
}
