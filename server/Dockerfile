# Approved local release candidate. Build from repository root; Linux/amd64 only.
# Same signed Wolfi/Node 26 artifact in every stage; refresh pins deliberately.
FROM cgr.dev/chainguard/node@sha256:fa7d6d61223b68391843b13d1ced9d51293103dacb7dbaae28d0516234295e2e AS packages
USER root
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json

FROM packages AS verification
RUN npm ci --no-audit --no-fund
COPY server/tsconfig*.json ./server/
COPY server/src ./server/src
COPY server/tests ./server/tests
COPY client/tsconfig.json client/vite.config.ts client/index.html ./client/
COPY client/src ./client/src
COPY client/public ./client/public
COPY client/tests ./client/tests
COPY data/evals ./data/evals
RUN --network=none npm test && npm run typecheck && npm run build && npm run eval
# Audit evidence only; do not auto-fix or modify the lockfile.
RUN npm audit --json > /tmp/npm-audit.json; result=$?; test "$result" -le 1
RUN npm audit --omit=dev --json > /tmp/npm-audit-production.json; result=$?; test "$result" -le 1

FROM packages AS production-dependencies
RUN npm ci --workspace server --include-workspace-root=false --omit=dev --no-audit --no-fund

FROM verification AS runtime-files
# Preserve the established production packaging boundary.
RUN rm -rf server/dist/evals server/dist/scripts server/dist/demo/quoteFixture.js

FROM cgr.dev/chainguard/node@sha256:fa7d6d61223b68391843b13d1ced9d51293103dacb7dbaae28d0516234295e2e AS runtime
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/server ./server
COPY --from=runtime-files /app/server/dist ./server/dist
USER 65532:65532
# Replace the vendor Node entrypoint to preserve the established command contract.
ENTRYPOINT []
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT ?? 3001) + '/api/health', { signal: AbortSignal.timeout(4000) }).then(r => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "server/dist/server.js"]
