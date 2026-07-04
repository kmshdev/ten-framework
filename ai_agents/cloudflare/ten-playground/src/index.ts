import { Container } from "@cloudflare/containers";

interface Env {
  TEN_PLAYGROUND: DurableObjectNamespace<TenPlayground>;
  AGORA_APP_ID: string;
  AGORA_APP_CERTIFICATE?: string;
  DEEPGRAM_API_KEY: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL?: string;
  OPENAI_API_BASE?: string;
  OPENAI_PROXY_URL?: string;
  ELEVENLABS_TTS_KEY: string;
  WEATHERAPI_API_KEY?: string;
}

export class TenPlayground extends Container<Env> {
  defaultPort = 3000;
  requiredPorts = [8080, 3000];
  sleepAfter = "2h";
  enableInternet = true;

  constructor(ctx: ConstructorParameters<typeof Container>[0], env: Env) {
    super(ctx, env);
    this.envVars = {
      LOG_PATH: "/tmp/ten_agent",
      LOG_STDOUT: "true",
      SERVER_PORT: "8080",
      GRAPH_DESIGNER_SERVER_PORT: "49483",
      WORKERS_MAX: "20",
      WORKER_QUIT_TIMEOUT_SECONDS: "60",
      AGENT_SERVER_URL: "http://127.0.0.1:8080",
      TEN_DEV_SERVER_URL: "http://127.0.0.1:49483",
      NEXT_PUBLIC_EDIT_GRAPH_MODE: "false",
      AGORA_APP_ID: env.AGORA_APP_ID ?? "",
      AGORA_APP_CERTIFICATE: env.AGORA_APP_CERTIFICATE ?? "",
      DEEPGRAM_API_KEY: env.DEEPGRAM_API_KEY ?? "",
      OPENAI_API_KEY: env.OPENAI_API_KEY ?? "",
      OPENAI_MODEL: env.OPENAI_MODEL || "gpt-4o-mini",
      OPENAI_API_BASE: env.OPENAI_API_BASE || "https://api.openai.com/v1",
      OPENAI_PROXY_URL: env.OPENAI_PROXY_URL ?? "",
      ELEVENLABS_TTS_KEY: env.ELEVENLABS_TTS_KEY ?? "",
      WEATHERAPI_API_KEY: env.WEATHERAPI_API_KEY ?? "",
    };
  }

  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: [8080, 3000],
      cancellationOptions: { portReadyTimeoutMS: 120_000 },
    });

    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return this.containerFetch(request, 8080);
    }

    return this.containerFetch(request, 3000);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = env.TEN_PLAYGROUND.getByName("ten-playground");
    return container.fetch(request);
  },
} satisfies ExportedHandler<Env>;
