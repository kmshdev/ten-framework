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

export interface ParsedTool {
  fn: string;
  args: Record<string, unknown>;
  argsLabel: string;
}

/** Tool transcript entries arrive as `tool_name({"arg": "value"})`. */
export function parseToolMessage(content: string): ParsedTool | null {
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
    <div className="my-1.5 mb-2.5 overflow-hidden rounded-xl border border-hairline bg-card shadow-[0_16px_44px_rgba(0,0,0,0.24),0_1px_0_rgba(255,231,184,0.04)_inset]">
      <div className="flex items-center gap-2.5 border-b border-hairline-soft bg-control/45 px-4 py-2.5">
        <span className="type-ui text-ink">{title}</span>
        {badge && (
          <span
            className={`type-caps ml-auto rounded-sm px-2 py-0.5 ${
              badgeTone === "ok"
                ? "bg-ok-bg text-ok"
                : "bg-attention-bg text-attention"
            }`}
          >
            {badge}
          </span>
        )}
      </div>
      <div className="type-small px-4 py-3 text-ink-2">{children}</div>
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
            <table className="type-small w-full border-collapse">
              <tbody>
                {order.items.map((item, i) => (
                  <tr key={i}>
                    <td className="border-b border-hairline-soft py-1.5 text-ink last:border-0">
                      {item.title} ×{item.quantity}
                    </td>
                    <td className="type-number border-b border-hairline-soft py-1.5 text-right text-[0.75rem] last:border-0">
                      {formatINR(item.price)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="type-small mt-1 flex justify-between border-t border-hairline-soft pt-2.5">
              <span>Total {formatINR(order.total_price_inr)}</span>
              {shipment && (
                <span className="type-mono text-ink-3">
                  {shipment.courier} · AWB {shipment.awb}
                </span>
              )}
            </div>
            {shipment?.last_checkpoint && !delivered && (
              <div className="type-small mt-2.5 rounded-sm bg-attention-bg px-2.5 py-2 text-attention">
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
  const query = args.query ? String(args.query) : "";
  const [results, setResults] = useState<KbResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query) return;
    let cancelled = false;
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
  }, [query]);

  if (!query)
    return (
      <ArtifactShell
        title="Knowledge base"
        badge="NO QUERY"
        badgeTone="attention"
      >
        The tool call did not include a query.
      </ArtifactShell>
    );
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
          <p className="type-small mb-2 border-l-2 border-hairline pl-3">
            {hit.text}
          </p>
          <span className="type-mono text-ink-3">{hit.section}</span>
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
            <p className="type-mono mt-2 text-ink-3">{tool.argsLabel}</p>
          )}
        </>
      ) : (
        <span className="type-mono">{tool.argsLabel}</span>
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
      <div className="type-mono animate-rise my-1 border-l-2 border-hairline py-1 pl-4 text-ink-3">
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
      <summary className="type-mono flex cursor-pointer select-none items-center gap-2.5 py-1 text-ink-3 transition-colors duration-150 hover:text-ink-2">
        <span className="trace-arrow inline-block text-[0.6rem] text-ink-mute transition-transform duration-200">
          ▶
        </span>
        <span className="font-medium text-ink">{tool.fn}</span>
        <span className="truncate">{tool.argsLabel}</span>
        <span className="type-mono ml-auto shrink-0 text-ink-3">
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
        <span className="type-caps flex items-center gap-1.5 text-ink-2">
          {isAgent && (
            <i className="h-1.5 w-1.5 rounded-full bg-voice" aria-hidden />
          )}
          {isAgent ? "Maya" : `${callerLabel} · caller`}
        </span>
        {hasHindi && (
          <span className="type-caps rounded-sm bg-inset px-1.5 py-0.5 text-ink-2">
            HI
          </span>
        )}
        <span className="type-number ml-auto text-[0.72rem] text-ink-3">
          {formatClock(message.ts)}
        </span>
      </div>
      <p
        className={`type-body max-w-[62ch] whitespace-pre-wrap break-words ${
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
      className="relative z-0 flex min-h-0 flex-col border-t border-line bg-panel/72 shadow-[0_-1px_0_rgba(255,231,184,0.05)_inset]"
      aria-label="Call transcript"
    >
      <div className="type-caps mx-auto flex w-full max-w-[920px] items-baseline gap-3 px-4 pb-2 pt-3 text-ink-tertiary sm:px-6">
        <span className="text-ink-secondary">Call tape</span>
        {callId && <span className="normal-case">{callId}</span>}
        {startedAtLabel && <span>started {startedAtLabel}</span>}
        <span className="type-caps ml-auto rounded-full bg-control px-2.5 py-1 text-ink-secondary ring-1 ring-line-soft">
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
        <div className="mx-auto w-full max-w-[920px] px-4 pb-7 pt-3 sm:px-6">
          {error ? (
            <p className="type-small py-6 text-left text-attention">{error}</p>
          ) : messages.length === 0 ? (
            <div className="mx-auto my-4 max-w-xl rounded-2xl border border-line-soft bg-inset/60 px-5 py-5 text-left shadow-[0_1px_0_rgba(255,231,184,0.04)_inset]">
              <div className="type-caps mb-3 flex w-max items-center gap-1.5 rounded-full border border-line-soft bg-control px-2.5 py-1 text-ink-tertiary">
                <span className="h-1.5 w-1.5 rounded-full bg-voice shadow-[0_0_14px_rgba(255,59,46,0.45)]" />
                transcript standby
              </div>
              <p className="type-small font-medium text-ink-tertiary">
                {callId
                  ? "No messages in this call yet."
                  : "Choose a seeded persona, enter your phone number, and Maya’s live call transcript will stream here."}
              </p>
            </div>
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
