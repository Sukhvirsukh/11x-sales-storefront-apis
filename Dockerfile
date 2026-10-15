# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app

# ---------------------------------------------------------------------------
FROM base AS build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run typecheck
RUN npm run build
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
FROM base AS production
ENV NODE_ENV=production
ENV PORT=5100
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
# pino-roll writes rotating log files to logs/.
RUN mkdir -p logs && chown node:node logs
EXPOSE 5100
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null || exit 1
# No migrations here: the schema belongs to 11xsales-be.
CMD ["node", "dist/server.js"]
