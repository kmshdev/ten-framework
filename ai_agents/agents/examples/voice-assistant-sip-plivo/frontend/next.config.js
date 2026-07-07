/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: __dirname,
  },
  env: {
    TWILIO_SERVER_URL: process.env.TWILIO_SERVER_URL || "http://localhost:8080",
  },
};

module.exports = nextConfig;
