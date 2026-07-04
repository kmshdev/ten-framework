import { Container } from "@cloudflare/containers";

interface Env {
  SUPERYOU_AGENT: DurableObjectNamespace<SuperYouAgent>;
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
  WEATHERAPI_API_KEY?: string;
}

export class SuperYouAgent extends Container<Env> {
  // Plivo media WebSocket lives on 9000; super.fetch() proxies WS here.
  defaultPort = 9000;
  // Launcher (8080) and frontend (3000) come up fast; the tenapp (9000)
  // boots via the launcher and is awaited separately where needed.
  requiredPorts = [8080, 3000];
  sleepAfter = "2h";
  enableInternet = true;

  constructor(ctx: ConstructorParameters<typeof Container>[0], env: Env) {
    super(ctx, env);
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
      WEATHERAPI_API_KEY: env.WEATHERAPI_API_KEY ?? "",
    };
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    await this.startAndWaitForPorts({ ports: [8080, 3000] });

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Single demo instance: Plivo webhooks, media WS, and the dashboard
    // must all land on the same container.
    const container = env.SUPERYOU_AGENT.getByName("superyou-demo");
    return container.fetch(request);
  },
} satisfies ExportedHandler<Env>;
