"use client";

import {
  CreditCard,
  MapPin,
  Package,
  Search,
  Truck,
} from "lucide-react";
import { useRef, useState } from "react";
import { demoAPI, type Order, type OrderStatusResponse } from "@/app/demoApi";

const STATUS_STYLES: Record<string, string> = {
  delivered: "bg-green-100 text-green-800",
  in_transit: "bg-blue-100 text-blue-800",
  out_for_delivery: "bg-blue-100 text-blue-800",
  attempted_delivery: "bg-amber-100 text-amber-800",
  failure: "bg-red-100 text-red-800",
  label_created: "bg-gray-100 text-gray-600",
};

function statusBadgeClass(status: string): string {
  return STATUS_STYLES[status.toLowerCase()] ?? "bg-gray-100 text-gray-600";
}

function humanizeStatus(status: string): string {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

function formatInr(value: string | number): string {
  const num = typeof value === "string" ? Number.parseFloat(value) : value;
  if (Number.isNaN(num)) return String(value);
  return inr.format(num);
}

function formatDate(ts: string | null): string {
  if (!ts) return "—";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 10+ digits without an SY prefix → treat as a phone number. */
function detectQueryType(raw: string): "phone" | "order_number" {
  const trimmed = raw.trim();
  if (trimmed.toUpperCase().startsWith("SY")) return "order_number";
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 10 ? "phone" : "order_number";
}

function OrderCard({ order }: { order: Order }) {
  const shipment = order.shipment;
  return (
    <div className="card space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-orange-500" />
            <h3 className="font-semibold text-gray-900">
              {order.order_number}
            </h3>
          </div>
          <p className="mt-1 text-gray-500 text-sm">
            {order.customer_name} · placed {formatDate(order.placed_at)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-600 text-xs">
            <CreditCard className="h-3 w-3" />
            {humanizeStatus(order.payment_status)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-600 text-xs">
            <MapPin className="h-3 w-3" />
            {order.shipping_city}
          </span>
        </div>
      </div>

      {/* Items */}
      <div className="overflow-hidden rounded-xl border border-gray-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase tracking-wide">
              <th className="px-4 py-2.5 font-medium">Item</th>
              <th className="px-4 py-2.5 text-right font-medium">Qty</th>
              <th className="px-4 py-2.5 text-right font-medium">Price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {order.items.map((item, index) => (
              <tr key={`${item.title}-${index}`}>
                <td className="px-4 py-2.5 text-gray-900">{item.title}</td>
                <td className="px-4 py-2.5 text-right text-gray-600">
                  {item.quantity}
                </td>
                <td className="px-4 py-2.5 text-right text-gray-600">
                  {formatInr(item.price)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-gray-100 border-t bg-orange-50/50">
              <td className="px-4 py-2.5 font-semibold text-gray-900">
                Total
              </td>
              <td />
              <td className="px-4 py-2.5 text-right font-semibold text-gray-900">
                {formatInr(order.total_price_inr)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Shipment */}
      {shipment ? (
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-gray-700 text-sm">
              <Truck className="h-4 w-4 text-orange-500" />
              <span className="font-medium">{shipment.courier}</span>
              <span className="font-mono text-gray-400 text-xs">
                AWB {shipment.awb}
              </span>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 font-semibold text-xs ${statusBadgeClass(shipment.status)}`}
            >
              {humanizeStatus(shipment.status)}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div>
              <p className="text-gray-400 text-xs">Estimated delivery</p>
              <p className="text-gray-800">
                {formatDate(shipment.estimated_delivery)}
              </p>
            </div>
            <div>
              <p className="text-gray-400 text-xs">Last checkpoint</p>
              <p className="text-gray-800">
                {shipment.last_checkpoint || "—"}
                {shipment.last_checkpoint_at && (
                  <span className="ml-1 text-gray-400 text-xs">
                    ({formatDate(shipment.last_checkpoint_at)})
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <p className="rounded-xl border border-gray-100 bg-gray-50/60 p-4 text-gray-400 text-sm">
          No shipment created yet for this order.
        </p>
      )}
    </div>
  );
}

export default function OrderLookupTab() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<OrderStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchedAs, setSearchedAs] = useState<"phone" | "order_number" | null>(
    null
  );
  const abortRef = useRef<AbortController | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const type = detectQueryType(trimmed);
    setIsLoading(true);
    setError(null);
    setSearchedAs(type);

    try {
      const data =
        type === "phone"
          ? await demoAPI.lookupOrderByPhone(trimmed, controller.signal)
          : await demoAPI.lookupOrderByNumber(trimmed, controller.signal);
      setResult(data);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setResult(null);
      setError(err instanceof Error ? err.message : "Order lookup failed");
    } finally {
      if (abortRef.current === controller) setIsLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="card">
        <h2 className="mb-1 font-semibold text-gray-900 text-lg">
          Order Lookup
        </h2>
        <p className="mb-4 text-gray-500 text-sm">
          Search by customer phone number or order number (e.g. SY-1042).
          Numbers with 10+ digits are treated as phone numbers.
        </p>
        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Phone number or order number…"
            className="input-field"
            aria-label="Phone number or order number"
          />
          <button
            type="submit"
            disabled={!query.trim() || isLoading}
            className="btn-primary flex flex-shrink-0 items-center disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? (
              <div className="mr-2 h-4 w-4 animate-spin rounded-full border-white border-b-2" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            Search
          </button>
        </form>
        {searchedAs && !isLoading && !error && (
          <p className="mt-3 text-gray-400 text-xs">
            Searched as{" "}
            {searchedAs === "phone" ? "phone number" : "order number"}
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700 text-sm">
          {error}
        </div>
      )}

      {isLoading && (
        <div className="card">
          <div className="space-y-3">
            <div className="h-5 w-1/3 animate-pulse rounded bg-gray-100" />
            <div className="h-24 animate-pulse rounded-xl bg-gray-100" />
            <div className="h-16 animate-pulse rounded-xl bg-gray-100" />
          </div>
        </div>
      )}

      {!isLoading && result && !result.found && (
        <div className="card flex flex-col items-center gap-2 py-10 text-center text-gray-400">
          <Package className="h-8 w-8" />
          <p className="text-sm">No orders found for that query.</p>
        </div>
      )}

      {!isLoading &&
        result?.found &&
        result.orders.map((order) => (
          <OrderCard key={order.order_number} order={order} />
        ))}
    </div>
  );
}
