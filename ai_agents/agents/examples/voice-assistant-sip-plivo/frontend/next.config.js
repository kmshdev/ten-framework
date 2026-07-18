/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: __dirname,
  },
  env: {
    TWILIO_SERVER_URL: process.env.TWILIO_SERVER_URL || "http://localhost:8080",
  },
  async rewrites() {
    const demoApiBase =
      process.env.DEMO_API_BASE ||
      "https://superyou-voice-agent.gateway-worker-ai.workers.dev";

    return [
      {
        source: "/tenapp/:path*",
        destination: "http://127.0.0.1:9000/:path*",
      },
      {
        source: "/backend/:path*",
        destination: "http://127.0.0.1:8080/:path*",
      },
      {
        source: "/demo/:path*",
        destination: `${demoApiBase}/demo/:path*`,
      },
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:9000/api/:path*",
      },
      {
        source: "/webhook/:path*",
        destination: "http://127.0.0.1:9000/webhook/:path*",
      },
      {
        source: "/media",
        destination: "http://127.0.0.1:9000/media",
      },
      {
        source: "/health",
        destination: "http://127.0.0.1:9000/health",
      },
      {
        source: "/readyz",
        destination: "http://127.0.0.1:9000/readyz",
      },
    ];
  },
};

module.exports = nextConfig;
