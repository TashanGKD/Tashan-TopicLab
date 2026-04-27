ARG NODE_BASE_IMAGE=docker.m.daocloud.io/library/node:20-slim

FROM ${NODE_BASE_IMAGE} AS builder

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM ${NODE_BASE_IMAGE}

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3020
ENV HOST=0.0.0.0
ENV WORLD_HOST=0.0.0.0

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/src ./src
COPY --from=builder /app/docs ./docs
COPY --from=builder /app/research ./research
COPY --from=builder /app/next.config.ts ./next.config.ts

RUN mkdir -p .cache

EXPOSE 3020

CMD ["node", "scripts/world-start.mjs"]
