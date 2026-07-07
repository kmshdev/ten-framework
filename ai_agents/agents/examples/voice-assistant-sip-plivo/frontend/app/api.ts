// API client for the voice assistant call server.
// Defaults to same-origin relative paths (the app is served behind the same
// origin as the backend). Env vars remain as optional overrides for local dev
// (names kept for deployment compatibility).
const CALL_SERVER_URL = process.env.NEXT_PUBLIC_TWILIO_SERVER_URL || "";
const TENAPP_SERVER_URL = process.env.NEXT_PUBLIC_TENAPP_SERVER_URL || "";

export interface CallResponse {
  call_uuid: string;
  phone_number: string;
  message: string;
  status: string;
  created_at: number;
  persona_phone?: string | null;
  persona_name?: string | null;
}

export interface CallInfo {
  call_uuid: string;
  phone_number: string;
  status: string;
  created_at: number;
  has_websocket?: boolean;
}

export interface CallListResponse {
  calls: CallResponse[];
  total: number;
}

export interface ServerConfig {
  plivo_from_number: string;
  server_port: number;
  public_server_url: string;
  use_https: boolean;
  use_wss: boolean;
  media_stream_enabled: boolean;
  media_ws_url: string | null;
  webhook_enabled: boolean;
  webhook_url: string | null;
}

export interface HealthResponse {
  status: string;
  active_calls: number;
}

export interface CreateCallRequest {
  phone_number: string;
  message?: string;
  /** Pose as this seeded customer (cloudflare/seed.sql): order lookups and
   * memory recall use this identity instead of the dialed number. */
  persona_phone?: string;
  persona_name?: string;
}

function extractErrorMessage(rawBody: string): string {
  if (!rawBody) return "";
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const detail = parsed.detail ?? parsed.message ?? parsed.error;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object") {
      const nested = (detail as Record<string, unknown>).message;
      if (typeof nested === "string") return nested;
      return JSON.stringify(detail);
    }
  } catch {
    return rawBody.slice(0, 300);
  }
  return rawBody.slice(0, 300);
}

class CallAPI {
  private callServerUrl: string;
  private tenappServerUrl: string;
  private config: ServerConfig | null = null;

  constructor(
    callServerUrl: string = CALL_SERVER_URL,
    tenappServerUrl: string = TENAPP_SERVER_URL,
  ) {
    this.callServerUrl = callServerUrl;
    this.tenappServerUrl = tenappServerUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    useTenapp: boolean = false,
  ): Promise<T> {
    const baseUrl = useTenapp ? this.tenappServerUrl : this.callServerUrl;
    const url = `${baseUrl}${endpoint}`;

    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `API request failed: ${response.status} ${extractErrorMessage(errorText)}`,
      );
    }

    return response.json();
  }

  async createCall(data: CreateCallRequest): Promise<CallResponse> {
    return this.request<CallResponse>(
      "/api/call",
      {
        method: "POST",
        body: JSON.stringify(data),
      },
      true,
    ); // Use tenapp server
  }

  async getCall(callSid: string): Promise<CallInfo> {
    return this.request<CallInfo>(`/api/call/${callSid}`, {}, true); // Use tenapp server
  }

  async deleteCall(callSid: string): Promise<{ message: string }> {
    return this.request<{ message: string }>(
      `/api/call/${callSid}`,
      {
        method: "DELETE",
      },
      true,
    ); // Use tenapp server
  }

  async listCalls(): Promise<CallListResponse> {
    return this.request<CallListResponse>("/api/calls", {}, true); // Use tenapp server
  }

  async getHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/health", {}, true); // Use tenapp server
  }

  async getConfig(): Promise<ServerConfig> {
    if (!this.config) {
      this.config = await this.request<ServerConfig>("/api/config"); // Use call server
    }
    return this.config;
  }
}

// Export singleton instance
export const callAPI = new CallAPI();

// Export class for custom instances
export { CallAPI };
