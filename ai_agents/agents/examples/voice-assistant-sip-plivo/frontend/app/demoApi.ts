// Same-origin client for the SuperYou demo endpoints.
// All paths are relative — the app is served behind the same origin
// (Cloudflare Worker) as the backend, so no hostnames are used.

export interface TranscriptCallSummary {
  call_id: string;
  caller: string | null;
  messages: number;
  started_at: string;
  last_at: string;
}

export interface TranscriptListResponse {
  calls: TranscriptCallSummary[];
}

export type TranscriptRole = "user" | "assistant" | "tool";

export interface TranscriptMessage {
  role: TranscriptRole;
  content: string;
  caller: string | null;
  ts: string;
}

export interface TranscriptDetailResponse {
  call_id: string;
  messages: TranscriptMessage[];
}

export interface OrderItem {
  title: string;
  quantity: number;
  price: string | number;
}

export interface OrderShipment {
  courier: string;
  awb: string;
  status: string;
  estimated_delivery: string | null;
  last_checkpoint: string | null;
  last_checkpoint_at: string | null;
}

export interface Order {
  order_number: string;
  customer_name: string;
  placed_at: string;
  payment_status: string;
  shipping_city: string;
  total_price_inr: string | number;
  items: OrderItem[];
  shipment: OrderShipment | null;
}

export interface OrderStatusResponse {
  found: boolean;
  orders: Order[];
}

export interface Customer {
  id: number;
  first_name: string;
  last_name: string;
  phone: string;
  default_city: string | null;
  orders_count: number;
}

export interface CustomerListResponse {
  customers: Customer[];
}

export interface KbResult {
  score: number;
  title: string;
  section: string;
  text: string;
}

export interface KbQueryResponse {
  query: string;
  results: KbResult[];
}

const FALLBACK_CUSTOMERS: Customer[] = [
  {
    id: 20,
    first_name: "Rahul",
    last_name: "Verma",
    phone: "+917011457245",
    default_city: "Mumbai",
    orders_count: 2,
  },
  {
    id: 59,
    first_name: "Krishna",
    last_name: "Joshi",
    phone: "+916276777762",
    default_city: "Kolkata",
    orders_count: 8,
  },
  {
    id: 61,
    first_name: "Kiara",
    last_name: "Das",
    phone: "+919847959430",
    default_city: "Noida",
    orders_count: 6,
  },
  {
    id: 90,
    first_name: "Keshav",
    last_name: "Reddy",
    phone: "+918937643439",
    default_city: "Jaipur",
    orders_count: 5,
  },
];

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const isHtml =
      body.trimStart().startsWith("<!DOCTYPE") || body.includes("<html");
    throw new Error(
      isHtml
        ? `Request failed (${response.status}). Demo backend endpoint is not available locally.`
        : `Request failed (${response.status})${body ? `: ${body.slice(0, 200)}` : ""}`,
    );
  }

  return response.json() as Promise<T>;
}

export const demoAPI = {
  async listTranscripts(signal?: AbortSignal): Promise<TranscriptListResponse> {
    try {
      return await getJson<TranscriptListResponse>("/demo/transcripts", signal);
    } catch {
      // Local UI review/dev often runs without the Cloudflare Worker backend.
      // Treat missing transcript storage as an empty tape instead of rendering
      // a raw Next.js 404 document in the console.
      return { calls: [] };
    }
  },

  async listCustomers(
    query?: string,
    signal?: AbortSignal,
  ): Promise<CustomerListResponse> {
    const qs = query ? `?q=${encodeURIComponent(query)}` : "";
    try {
      return await getJson<CustomerListResponse>(
        `/demo/customers${qs}`,
        signal,
      );
    } catch {
      const q = query?.trim().toLowerCase();
      const customers = q
        ? FALLBACK_CUSTOMERS.filter((c) =>
            `${c.first_name} ${c.last_name} ${c.default_city ?? ""} ${c.phone}`
              .toLowerCase()
              .includes(q),
          )
        : FALLBACK_CUSTOMERS;
      return { customers };
    }
  },

  getTranscript(
    callId: string,
    signal?: AbortSignal,
  ): Promise<TranscriptDetailResponse> {
    return getJson<TranscriptDetailResponse>(
      `/demo/transcripts?call_id=${encodeURIComponent(callId)}`,
      signal,
    );
  },

  lookupOrderByPhone(
    phone: string,
    signal?: AbortSignal,
  ): Promise<OrderStatusResponse> {
    return getJson<OrderStatusResponse>(
      `/demo/order-status?phone=${encodeURIComponent(phone)}`,
      signal,
    );
  },

  lookupOrderByNumber(
    orderNumber: string,
    signal?: AbortSignal,
  ): Promise<OrderStatusResponse> {
    return getJson<OrderStatusResponse>(
      `/demo/order-status?order_number=${encodeURIComponent(orderNumber)}`,
      signal,
    );
  },

  queryKb(query: string, signal?: AbortSignal): Promise<KbQueryResponse> {
    return getJson<KbQueryResponse>(
      `/demo/kb/query?q=${encodeURIComponent(query)}`,
      signal,
    );
  },
};
