FROM ghcr.io/ten-framework/ten_agent_build:0.7.14 AS builder

ARG USE_AGENT=agents/examples/voice-assistant

WORKDIR /app

COPY .env.example .env
COPY server/ server/
COPY agents/scripts/ agents/scripts/
COPY agents/ten_packages/ agents/ten_packages/
COPY playground/ playground/

COPY ${USE_AGENT}/tenapp/go.* ${USE_AGENT}/tenapp/
COPY ${USE_AGENT}/tenapp/main.go ${USE_AGENT}/tenapp/
COPY ${USE_AGENT}/tenapp/manifest* ${USE_AGENT}/tenapp/
COPY ${USE_AGENT}/tenapp/property.json ${USE_AGENT}/tenapp/
COPY ${USE_AGENT}/tenapp/scripts/ ${USE_AGENT}/tenapp/scripts/
COPY ${USE_AGENT}/tenapp/ten_packages/extension/main_python/ ${USE_AGENT}/tenapp/ten_packages/extension/main_python/
COPY ${USE_AGENT}/README.md ${USE_AGENT}/
COPY ${USE_AGENT}/Taskfile*.yml ${USE_AGENT}/

RUN cd /app/${USE_AGENT} && \
    task install && task release

ENV NEXT_PUBLIC_EDIT_GRAPH_MODE=true
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/playground
RUN bun run build

FROM ubuntu:22.04

RUN apt-get clean && apt-get update && apt-get install -y --no-install-recommends \
    libasound2 \
    libgstreamer1.0-dev \
    libunwind-dev \
    libc++1 \
    libssl-dev \
    python3 \
    python3-venv \
    python3-pip \
    python3-dev \
    jq vim \
    ca-certificates \
    curl \
    unzip \
    && apt-get clean && rm -rf /var/lib/apt/lists/* && rm -rf /tmp/*

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

RUN curl -fsSL https://bun.com/install | bash
ENV PATH="/root/.bun/bin:$PATH"

WORKDIR /app

COPY --from=builder /app/agents/examples/voice-assistant/tenapp/.release/ /app/agents/
COPY --from=builder /app/server/bin/api /app/server/bin/api
COPY --from=builder /usr/local/lib /usr/local/lib
COPY --from=builder /usr/lib/python3 /usr/lib/python3
COPY --from=builder /usr/local/bin/tman /usr/local/bin/tman
COPY --from=builder /app/playground/ /app/playground/
COPY cloudflare/ten-playground/container-start.sh /app/container-start.sh

RUN chmod +x /app/container-start.sh

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV SERVER_PORT=8080
ENV GRAPH_DESIGNER_SERVER_PORT=49483
ENV AGENT_SERVER_URL=http://127.0.0.1:8080
ENV TEN_DEV_SERVER_URL=http://127.0.0.1:49483
ENV NEXT_PUBLIC_EDIT_GRAPH_MODE=true

EXPOSE 3000 8080 49483

ENTRYPOINT ["/app/container-start.sh"]
