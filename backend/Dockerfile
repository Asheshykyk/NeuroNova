FROM node:24-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/package.json
COPY backend/package.json ./backend/package.json
COPY blockchain/package.json ./blockchain/package.json
COPY services/agent/package.json ./services/agent/package.json
COPY packages/core ./packages/core

RUN npm ci --workspace=@trusttrace/backend --include-workspace-root

COPY backend ./backend

RUN mkdir -p /data/vault \
    && chmod 0755 /data/vault

ENV NODE_ENV=production
ENV DOCKER=true
ENV BACKEND_HOST=0.0.0.0
ENV BACKEND_PORT=3000
ENV RSYSLOG_HOST=0.0.0.0
ENV RSYSLOG_PORT=5140
ENV EVIDENCE_DIRECTORY=/data/vault
ENV EVIDENCE_SQLITE_PATH=/data/vault/evidence-index.sqlite3

EXPOSE 3000 5140

VOLUME ["/data/vault"]

HEALTHCHECK --interval=2s --timeout=2s --retries=15 \
    CMD curl -f http://127.0.0.1:3000/health || exit 1

CMD ["npm", "run", "start", "--workspace=@trusttrace/backend"]
