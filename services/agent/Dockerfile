FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/package.json
COPY backend/package.json ./backend/package.json
COPY blockchain/package.json ./blockchain/package.json
COPY services/agent/package.json ./services/agent/package.json
COPY packages/core ./packages/core

RUN npm ci --workspace=@trusttrace/host-agent --include-workspace-root

COPY services/agent ./services/agent

RUN mkdir -p /var/log /var/lib/trusttrace-agent \
    && chmod 0755 /var/log \
    && chmod 0700 /var/lib/trusttrace-agent

VOLUME ["/var/log", "/var/lib/trusttrace-agent"]

CMD ["npm", "run", "start", "--workspace=@trusttrace/host-agent"]
