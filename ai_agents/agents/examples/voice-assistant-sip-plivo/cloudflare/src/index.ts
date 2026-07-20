import { Container } from "@cloudflare/containers";
import kbSeed from "../kb_seed.json";

interface Env {
  SUPERYOU_AGENT: DurableObjectNamespace<SuperYouAgent>;
  DB: D1Database;
  KB: VectorizeIndex;
  AI: Ai;
  PLIVO_AUTH_ID: string;
  PLIVO_AUTH_TOKEN: string;
  PLIVO_FROM_NUMBER: string;
  PLIVO_PUBLIC_SERVER_URL?: string;
  DEEPGRAM_API_KEY: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL?: string;
  ELEVENLABS_TTS_KEY: string;
  ELEVENLABS_VOICE_ID?: string;
  SARVAM_API_KEY?: string;
  MEM0_API_KEY?: string;
  HUMAN_AGENT_NUMBER?: string;
  WEATHERAPI_API_KEY?: string;
  DEPLOY_REVISION?: string;
}

const EMBEDDING_MODEL = "@cf/baai/bge-m3";

function containerInstanceName(env: Env): string {
  // Staging receives a new identity per image revision so a deployment cannot
  // reuse a warm container running the previous image. Production has no
  // revision var and keeps one stable instance for the live Plivo number.
  return env.DEPLOY_REVISION
    ? `superyou-demo-${env.DEPLOY_REVISION}`
    : "superyou-demo";
}

export class SuperYouAgent extends Container<Env> {
  // Plivo media WebSocket lives on 9000; super.fetch() proxies WS here.
  defaultPort = 9000;
  // The dashboard is not usable until the launcher, frontend, and TEN call API
  // are all ready. Requiring every port prevents the frontend from exposing an
  // active Call button while port 9000 is still booting.
  requiredPorts = [8080, 3000, 9000];
  sleepAfter = "2h";
  enableInternet = true;
  private ready = false;
  private lastReadyCheck = 0;

  constructor(ctx: ConstructorParameters<typeof Container>[0], env: Env) {
    super(ctx, env);
    const publicHost = (env.PLIVO_PUBLIC_SERVER_URL ?? "")
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    this.envVars = {
      PLIVO_AUTH_ID: env.PLIVO_AUTH_ID ?? "",
      PLIVO_AUTH_TOKEN: env.PLIVO_AUTH_TOKEN ?? "",
      PLIVO_FROM_NUMBER: env.PLIVO_FROM_NUMBER ?? "",
      PLIVO_PUBLIC_SERVER_URL: env.PLIVO_PUBLIC_SERVER_URL ?? "",
      PLIVO_USE_HTTPS: "true",
      PLIVO_USE_WSS: "true",
      DEEPGRAM_API_KEY: env.DEEPGRAM_API_KEY ?? "",
      OPENAI_API_KEY: env.OPENAI_API_KEY ?? "",
      OPENAI_MODEL: env.OPENAI_MODEL ?? "gpt-4o-mini",
      ELEVENLABS_TTS_KEY: env.ELEVENLABS_TTS_KEY ?? "",
      ELEVENLABS_VOICE_ID: env.ELEVENLABS_VOICE_ID ?? "",
      SARVAM_API_KEY: env.SARVAM_API_KEY ?? "",
      MEM0_API_KEY: env.MEM0_API_KEY ?? "",
      HUMAN_AGENT_NUMBER: env.HUMAN_AGENT_NUMBER ?? "",
      // Base URL the container uses to reach the Worker's /demo API
      // (order lookups, KB search, transcript persistence).
      DEMO_API_BASE: publicHost ? `https://${publicHost}` : "",
      WEATHERAPI_API_KEY: env.WEATHERAPI_API_KEY ?? "",
      DEPLOY_REVISION: env.DEPLOY_REVISION ?? "",
    };
  }

  // RPC used by /admin/restart: hard-stop the container so the next
  // request boots a fresh instance (new image + secrets, clean state).
  async destroyContainer(): Promise<void> {
    this.ready = false;
    this.lastReadyCheck = 0;
    try {
      await this.destroy();
    } catch (error) {
      // Restart is idempotent: an already-crashed or absent container is
      // already in the desired stopped state. The next request will start the
      // image currently attached to this Worker version.
      console.warn("Container was already absent during restart", error);
    }
  }

  override onStop(): void {
    this.ready = false;
    this.lastReadyCheck = 0;
  }

  override onError(error: unknown): void {
    this.ready = false;
    this.lastReadyCheck = 0;
    console.error("SuperYou container error", error);
    throw error;
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      await this.ensureReady();
    } catch (error) {
      console.error("SuperYou application is not ready", error);
      return Response.json(
        {
          error: "service_starting",
          message: "The voice service is starting. Please retry shortly.",
        },
        {
          status: 503,
          headers: { "Retry-After": "2" },
        },
      );
    }

    // Plivo media WebSocket -> tenapp (9000). MUST go through fetch()
    // (containerFetch does not support WebSocket upgrades).
    if (path === "/media" || request.headers.get("Upgrade") === "websocket") {
      await this.waitForTenapp();
      return super.fetch(request);
    }

    // Plivo webhooks + call API -> tenapp (9000)
    if (path.startsWith("/webhook/") || path.startsWith("/api/")) {
      await this.waitForTenapp();
      return this.containerFetch(request, 9000);
    }

    // Frontend same-origin prefixes (baked at build time)
    if (path.startsWith("/tenapp/")) {
      await this.waitForTenapp();
      return this.containerFetch(
        this.stripPrefix(request, url, "/tenapp"),
        9000,
      );
    }
    if (path.startsWith("/backend/")) {
      return this.containerFetch(
        this.stripPrefix(request, url, "/backend"),
        8080,
      );
    }

    // Launcher health check
    if (path === "/health") {
      return this.containerFetch(request, 8080);
    }

    // Everything else -> dashboard frontend
    return this.containerFetch(request, 3000);
  }

  private async ensureReady(): Promise<void> {
    const now = Date.now();
    if (this.ready && now - this.lastReadyCheck < 5_000) return;

    await this.ctx.blockConcurrencyWhile(async () => {
      const checkTime = Date.now();
      if (this.ready && checkTime - this.lastReadyCheck < 5_000) return;

      await this.startAndWaitForPorts({
        ports: this.requiredPorts,
        cancellationOptions: { portReadyTimeoutMS: 120_000 },
      });
      await this.waitForApplicationReady();
      this.ready = true;
      this.lastReadyCheck = Date.now();
    });
  }

  private async waitForApplicationReady(): Promise<void> {
    let lastStatus = 0;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const response = await this.containerFetch(
          "http://container/readyz",
          {},
          9000,
        );
        lastStatus = response.status;
        if (response.ok) return;
      } catch {
        lastStatus = 0;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    this.ready = false;
    this.lastReadyCheck = 0;
    throw new Error(`semantic readiness failed (last status ${lastStatus})`);
  }

  // The tenapp (9000) is spawned by the launcher and loads the TEN runtime +
  // Python extensions, so give it a generous port-ready timeout.
  private async waitForTenapp(): Promise<void> {
    await this.startAndWaitForPorts({
      ports: [9000],
      cancellationOptions: { portReadyTimeoutMS: 120_000 },
    });
  }

  private stripPrefix(request: Request, url: URL, prefix: string): Request {
    const rewritten = new URL(url);
    rewritten.pathname = url.pathname.slice(prefix.length) || "/";
    return new Request(rewritten, request);
  }
}

// ---------------------------------------------------------------------------
// /demo API - served directly by the Worker (D1 + Vectorize + Workers AI).
// The voice agent's Python tools call these endpoints during live calls, and
// the dashboard reads transcripts from here.
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

async function handleOrderStatus(url: URL, env: Env): Promise<Response> {
  const phone = url.searchParams.get("phone")?.trim();
  const orderNumber = url.searchParams.get("order_number")?.trim();
  if (!phone && !orderNumber) {
    return json({ error: "phone or order_number is required" }, 400);
  }

  let where: string;
  let bind: string;
  if (orderNumber) {
    // Accept "SY10042", "#SY10042", or bare "10042"
    const normalized = orderNumber.replace(/^#?(SY)?/i, "");
    where = "o.order_number = ?";
    bind = `#SY${normalized}`;
  } else {
    // Match with or without +91 prefix
    const digits = phone!.replace(/[^0-9]/g, "").slice(-10);
    where = "o.phone LIKE ?";
    bind = `%${digits}`;
  }

  const orders = await env.DB.prepare(
    `SELECT o.id, o.order_number, o.financial_status, o.fulfillment_status,
            o.total_price, o.shipping_city, o.created_at, o.cancelled_at,
            c.first_name, c.last_name,
            f.status AS f_status, f.tracking_company, f.tracking_number,
            f.shipment_status, f.estimated_delivery_at,
            f.last_checkpoint, f.last_checkpoint_at
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN fulfillments f ON f.order_id = o.id
     WHERE ${where}
     ORDER BY o.created_at DESC
     LIMIT 3`,
  )
    .bind(bind)
    .all();

  if (!orders.results.length) {
    return json({ found: false, message: "No orders found" });
  }

  const enriched = await Promise.all(
    orders.results.map(async (o: Record<string, unknown>) => {
      const items = await env.DB.prepare(
        "SELECT title, quantity, price FROM order_line_items WHERE order_id = ?",
      )
        .bind(o.id)
        .all();
      return {
        order_number: o.order_number,
        customer_name: `${o.first_name} ${o.last_name}`,
        placed_at: o.created_at,
        cancelled_at: o.cancelled_at,
        payment_status: o.financial_status,
        shipping_city: o.shipping_city,
        total_price_inr: o.total_price,
        items: items.results,
        shipment: o.shipment_status
          ? {
              courier: o.tracking_company,
              awb: o.tracking_number,
              status: o.shipment_status,
              estimated_delivery: o.estimated_delivery_at,
              last_checkpoint: o.last_checkpoint,
              last_checkpoint_at: o.last_checkpoint_at,
            }
          : null,
      };
    }),
  );

  return json({ found: true, orders: enriched });
}

async function handleCustomers(url: URL, env: Env): Promise<Response> {
  const q = url.searchParams.get("q")?.trim();
  const limit = Math.min(
    Number(url.searchParams.get("limit") ?? 200) || 200,
    200,
  );

  const rows = q
    ? await env.DB.prepare(
        `SELECT id, first_name, last_name, phone, default_city, orders_count
         FROM customers
         WHERE (first_name || ' ' || last_name) LIKE ?
            OR phone LIKE ?
            OR default_city LIKE ?
         ORDER BY orders_count DESC, first_name ASC
         LIMIT ?`,
      )
        .bind(`%${q}%`, `%${q}%`, `%${q}%`, limit)
        .all()
    : await env.DB.prepare(
        `SELECT id, first_name, last_name, phone, default_city, orders_count
         FROM customers
         ORDER BY orders_count DESC, first_name ASC
         LIMIT ?`,
      )
        .bind(limit)
        .all();

  return json({ customers: rows.results });
}

async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const res = (await env.AI.run(EMBEDDING_MODEL, { text: texts })) as {
    data: number[][];
  };
  return res.data;
}

async function handleKbSeed(request: Request, env: Env): Promise<Response> {
  // Light admin gate: reuse an existing secret so no new credential is needed.
  if (request.headers.get("x-admin-token") !== env.PLIVO_AUTH_TOKEN) {
    return json({ error: "unauthorized" }, 401);
  }
  const chunks = (kbSeed as { chunks: Array<Record<string, string>> }).chunks;
  const BATCH = 20;
  let upserted = 0;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const vectors = await embed(
      env,
      batch.map((c) => c.text),
    );
    await env.KB.upsert(
      batch.map((c, j) => ({
        id: c.id,
        values: vectors[j],
        metadata: {
          title: c.title,
          section: c.section,
          source: c.source,
          text: c.text,
        },
      })),
    );
    upserted += batch.length;
  }
  return json({ ok: true, upserted });
}

async function handleKbQuery(url: URL, env: Env): Promise<Response> {
  const q = url.searchParams.get("q")?.trim();
  if (!q) return json({ error: "q is required" }, 400);
  const topK = Math.min(Number(url.searchParams.get("top_k") ?? 3), 10);
  const [vector] = await embed(env, [q]);
  const matches = await env.KB.query(vector, {
    topK,
    returnMetadata: "all",
  });
  return json({
    query: q,
    results: matches.matches.map((m) => ({
      score: m.score,
      title: m.metadata?.title,
      section: m.metadata?.section,
      source: m.metadata?.source,
      text: m.metadata?.text,
    })),
  });
}

async function handleTranscripts(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  if (request.method === "POST") {
    // Writes come only from the Python backend (memory.py::_post_transcript),
    // never a browser - gate with the same shared secret used elsewhere.
    if (request.headers.get("x-admin-token") !== env.PLIVO_AUTH_TOKEN) {
      return json({ error: "unauthorized" }, 401);
    }
    const body = (await request.json()) as {
      call_id?: string;
      caller?: string;
      role?: string;
      content?: string;
      sequence?: number;
      source_timestamp_ms?: number;
      turn_id?: number | null;
      idempotency_key?: string;
    };
    if (!body.call_id || !body.role || !body.content) {
      return json({ error: "call_id, role, content are required" }, 400);
    }
    const idempotencyKey =
      body.idempotency_key ?? request.headers.get("x-idempotency-key");
    await env.DB.prepare(
      `INSERT OR IGNORE INTO transcripts
       (call_id, caller, role, content, sequence, source_timestamp_ms, turn_id, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        body.call_id,
        body.caller ?? null,
        body.role,
        body.content,
        body.sequence ?? null,
        body.source_timestamp_ms ?? null,
        body.turn_id ?? null,
        idempotencyKey,
      )
      .run();
    return json({ ok: true });
  }

  const callId = url.searchParams.get("call_id");
  if (callId) {
    const rows = await env.DB.prepare(
      `SELECT role, content, caller, sequence, source_timestamp_ms, turn_id, ts
       FROM transcripts WHERE call_id = ?
       ORDER BY COALESCE(sequence, id) ASC, id ASC`,
    )
      .bind(callId)
      .all();
    return json({ call_id: callId, messages: rows.results });
  }

  const calls = await env.DB.prepare(
    `SELECT call_id, MAX(caller) AS caller, COUNT(*) AS messages,
            MIN(ts) AS started_at, MAX(ts) AS last_at
     FROM transcripts GROUP BY call_id ORDER BY MIN(ts) DESC LIMIT 50`,
  ).all();
  return json({ calls: calls.results });
}

async function handleDemo(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  try {
    switch (url.pathname) {
      case "/demo/order-status":
        return await handleOrderStatus(url, env);
      case "/demo/customers":
        return await handleCustomers(url, env);
      case "/demo/kb/seed":
        return await handleKbSeed(request, env);
      case "/demo/kb/query":
        return await handleKbQuery(url, env);
      case "/demo/transcripts":
        return await handleTranscripts(request, url, env);
      default:
        return json({ error: "not found" }, 404);
    }
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // /demo/* is served by the Worker itself - no container involved.
    if (url.pathname.startsWith("/demo/")) {
      return handleDemo(request, url, env);
    }

    // Ops: force-restart the container (fresh boot picks up the newest
    // image + secrets, and resets any extension stuck in a fatal state).
    if (url.pathname === "/admin/restart" && request.method === "POST") {
      if (request.headers.get("x-admin-token") !== env.PLIVO_AUTH_TOKEN) {
        return json({ error: "unauthorized" }, 401);
      }
      const instance = env.SUPERYOU_AGENT.getByName(
        containerInstanceName(env),
      );
      await instance.destroyContainer();
      return json({ restarted: true });
    }

    // Single demo instance: Plivo webhooks, media WS, and the dashboard
    // must all land on the same container.
    const container = env.SUPERYOU_AGENT.getByName(
      containerInstanceName(env),
    );
    return container.fetch(request);
  },
} satisfies ExportedHandler<Env>;
