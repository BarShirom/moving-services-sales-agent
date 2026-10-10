# Build from the repository root: docker build -f server/Dockerfile .
FROM node:22-bookworm AS packages
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json

FROM packages AS build
RUN npm ci --workspace server --include-workspace-root=false --include=dev
COPY server/tsconfig.json ./server/tsconfig.json
COPY server/src ./server/src
RUN npm run build --workspace server
# Offline tools have separate source-tree/client/data dependencies.
RUN rm -rf server/dist/evals server/dist/scripts server/dist/demo/quoteFixture.js

FROM packages AS production-dependencies
RUN npm ci --workspace server --include-workspace-root=false --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/server ./server
COPY --from=build /app/server/dist ./server/dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT ?? 3001) + '/api/health', { signal: AbortSignal.timeout(4000) }).then(r => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "server/dist/server.js"]
