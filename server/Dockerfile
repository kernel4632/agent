FROM oven/bun:1.3.14

RUN apt-get update \
    && apt-get install -y --no-install-recommends procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /agent
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY . .
RUN bun run build

ENV HOST=0.0.0.0
ENV PORT=3000
ENV AGENT_HOME=/data/.agent
VOLUME ["/data/.agent"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD bun -e "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "run", "dist/server.js"]
