# Backend Docker deployment preparation

This packages the existing single-session API for local Linux-container verification.
No AWS resources are created. Authentication, durable storage and public production
deployment remain future work. Every quote still needs human approval; acceptance
still means manual coordination is pending.

## Image architecture

Build context is the **repository root**, not `server/`. The root lockfile and both
workspace manifests are copied before source files so dependency layers can be reused.

- `packages`: official `node:22-bookworm`, compatible with the project's Node 20.18+
  engine range and the local Node 22 runtime.
- `build`: `npm ci --workspace server --include-workspace-root=false --include=dev`,
  then the existing server TypeScript build.
- `production-dependencies`: a separate, clean install from the same lockfile with
  `--workspace server --include-workspace-root=false --omit=dev`. No client packages
  or compiler are installed in this stage.
- `runtime`: `node:22-bookworm-slim`, compiled API and production dependencies,
  including the server workspace manifest/link and any nested server dependencies.
  Runs as `node` (UID/GID 1000), from `/app`, using
  `node server/dist/server.js` directly so shutdown signals reach Node.

No application environment values, credentials or `.env` files are baked into the
image. `.dockerignore` also excludes local dependencies, builds, Git/editor files,
tests, documentation and data. The build removes emitted offline scripts, evals and
the quote fixture before copying the compiled output to runtime. The ordinary API
does not read those files. Pricing evidence paths in responses are provenance labels,
not runtime file reads. URL-relative local paths and TypeScript's case checks remain
portable; no Windows-specific runtime path fixes were needed.

The [official Node image documentation](https://hub.docker.com/_/node) describes the
Debian variants. The [Dockerfile reference](https://docs.docker.com/reference/dockerfile/)
covers the multi-stage, exec-form command and health-check instructions used here.
The major-version tags receive updates; record/pin reviewed image digests before a
release requiring byte-for-byte reproducibility.

## Build and run

Start Docker Desktop with Linux containers. Run these commands from the repository
root; the single-line commands work in PowerShell and POSIX shells.

```sh
docker build -f server/Dockerfile -t moving-services-sales-agent-server .
docker run --rm --name moving-sales-api -p 127.0.0.1:3001:3001 -e NODE_ENV=production -e PORT=3001 moving-services-sales-agent-server
```

No API key is required to start, check health, inspect state or use the synthetic
owner sample. Without a key, messages requiring AI return `503 AI_NOT_CONFIGURED`.
Startup and health checks never call OpenAI. The published host port is loopback-only
because owner/customer routes have no authentication. The image serves the backend
only; it does not serve the React client. The existing Vite `/api` proxy works with
the default port: run `npm run dev:client` locally in another terminal.

For deliberate live extraction, populate the ignored root `.env` locally, then:

```sh
docker run --rm --name moving-sales-api -p 127.0.0.1:3001:3001 --env-file .env -e NODE_ENV=production -e PORT=3001 moving-services-sales-agent-server
```

PowerShell multiline equivalent:

```powershell
docker run --rm --name moving-sales-api `
  -p 127.0.0.1:3001:3001 `
  --env-file .env `
  -e NODE_ENV=production `
  -e PORT=3001 `
  moving-services-sales-agent-server
```

`--env-file` injects values at container creation; it does not copy the file into the
image. Do not add credentials to build arguments, Dockerfiles, client/Vite variables
or version control. Avoid sharing full container environment inspection output.
Customer messages can incur real provider requests only in the explicitly configured
live mode. No live call is part of the verification below.

## Runtime configuration

| Variable | Behavior |
| --- | --- |
| `NODE_ENV` | Set `production` for Docker: listens on `0.0.0.0`. Unset/development retains the existing `127.0.0.1` listener. |
| `PORT` | Integer 1-65535, default `3001`. Use an unprivileged port such as 3001/8080 for the non-root container. |
| `OPENAI_API_KEY` | Optional for startup; required only at the real extraction boundary. Backend-only. |
| `OPENAI_MODEL` | Optional; blank/unset uses the existing default in `server/src/config/openai.ts`. |
| `CLIENT_ORIGIN` | Optional single exact browser origin, e.g. `http://localhost:5173`, without a trailing slash. Unset/blank preserves same-origin behavior. |

The current client uses relative `/api` requests; its Vite proxy does not need CORS.
An explicitly configured origin receives CORS response headers and JSON POST
preflight support; other origins receive no CORS permission. No wildcard or cookie
credentials are enabled. CORS is a browser policy, not authentication.

`EXPOSE 3001` documents the default, not a fixed port or an automatic publication.
The listener and Docker health check both read runtime `PORT`. To use another port:

```sh
docker run --rm --name moving-sales-api -p 127.0.0.1:8080:8080 -e NODE_ENV=production -e PORT=8080 moving-services-sales-agent-server
```

Update the Vite proxy or future target/task port mapping to match. `GET /api/health`
returns only status, service name and version. Docker probes it using built-in Node
`fetch`, with a four-second request timeout; no curl package is needed. `SIGTERM` and
`SIGINT` close the listener and drain requests, with an eight-second forced deadline.
An unfinished request at that deadline is terminated and the process exits with code 1.

## Local verification (no provider calls)

Run the API in another terminal using the no-key command above. In PowerShell:

```powershell
$base = 'http://127.0.0.1:3001'
(Invoke-WebRequest -UseBasicParsing "$base/api/health").StatusCode
Invoke-RestMethod "$base/api/health"
$initial = Invoke-RestMethod "$base/api/demo"
$owner = Invoke-RestMethod "$base/api/demo/owner"
$token = @{ leadId = $owner.customer.lead.id; revision = $owner.revision } | ConvertTo-Json
$sample = Invoke-RestMethod -Method Post "$base/api/demo/owner/sample" -ContentType 'application/json' -Body $token
$sample.pricingEvaluation
docker inspect --format '{{.State.Health.Status}}' moving-sales-api
docker logs moving-sales-api
```

Expect HTTP 200, `status: ok`, loaded customer/owner snapshots, a synthetic pricing
sample, and Docker status `healthy` once a probe runs. Logs should contain only the
listener message, without keys or customer data. To inspect size and identity safely:

```sh
docker image inspect --format '{{.Size}}' moving-services-sales-agent-server
docker image inspect --format '{{.Config.User}} {{json .Config.Cmd}} {{json .Config.ExposedPorts}}' moving-services-sales-agent-server
```

To verify restart/stop, initially run with `-d` instead of `--rm` so the stopped
container can be inspected. After creating the sample, `docker restart moving-sales-api`
must produce a new Lead ID with empty messages/items, no quotes and no owner reviews.
`docker stop moving-sales-api` must exit cleanly:

```sh
docker stop moving-sales-api
docker inspect --format '{{.State.ExitCode}}' moving-sales-api
docker rm moving-sales-api
```

Expect exit code 0 on an idle stop. For CORS testing, create a container with
`-e CLIENT_ORIGIN=http://localhost:5173`, then check:

```powershell
$headers = @{ Origin = 'http://localhost:5173'; 'Access-Control-Request-Method' = 'POST'; 'Access-Control-Request-Headers' = 'content-type' }
$preflight = Invoke-WebRequest -UseBasicParsing -Method Options "$base/api/demo/message" -Headers $headers
$preflight.StatusCode
$preflight.Headers['Access-Control-Allow-Origin']
```

Expect 204 and the exact origin. Repeat with another origin and expect no
`Access-Control-Allow-Origin`. Without `CLIENT_ORIGIN`, no CORS permission is added.
The automated HTTP suites also cover injected extraction, human approval and quote
acceptance without contacting a provider.

The standalone offline UI remains separate and unchanged:

```sh
npm run build
npm run demo:quote --workspace server
```

That command uses repository fixtures and `client/dist`; it is intentionally not
included in the backend image. Full repository checks remain `npm test`,
`npm run eval`, `npm run typecheck`, `npm run build` and `git diff --check`.

## Future ECR / ECS Fargate flow

After local verification and a separate deployment decision, build for the chosen
task architecture, scan/review the image and dependencies, tag the verified image,
authenticate to ECR and push it. Then define a Fargate task with the same container
port/`PORT`, `NODE_ENV=production`, explicit health checks and a stop timeout longer
than the eight-second drain deadline. Inject the API key through a managed secret
reference, with appropriately scoped task execution permissions; configure logs and
the intended client origin independently of the image.

These are future steps, not resources or deployment commands executed by this work.
The current unauthenticated, single-session API must remain access-restricted. All
state is in one process: restart/replacement loses leads, approvals and quotes;
multiple tasks would have independent sessions. Durable storage and authenticated
access are prerequisites for a real multi-user production service. A successful
health check does not validate provider configuration or those missing capabilities.

Compose is omitted because verification needs only one backend container and no
database or other coordinated services.

### Proxy trust before a future ALB deployment

The application does not set `trust proxy` or provide an equivalent trust function.
The effective Express policy is the default **`false`**, verified in the compiled
runtime. Forwarded headers are not trusted for client IP/protocol inference. This is
appropriate for the current direct, local-only API and is left unchanged.

Behind an ALB, this conservative default can still serve the current API, but it
will not recover the original client IP or HTTPS protocol from forwarded headers.
Before adding features that rely on those values (secure cookies, redirects,
IP-based controls or client-IP logging), define and test a trust policy against the
actual ingress topology. Restrict task ingress to the intended load balancer,
verify how each forwarded header is supplied or sanitized, and test forged headers
and alternate/direct access paths. Do not assume `trust proxy = true`, a fixed hop
count or guessed AWS CIDRs are safe. A future ALB-specific setting requires that
deployment review; no such setting or infrastructure is added here. See
[Express behind proxies](https://expressjs.com/en/guide/behind-proxies/).

## Initial Docker verification on 2026-10-10

- `npm test`, `npm run eval`, `npm run typecheck`, `npm run build` and
  `git diff --check` passed. Conversation evals: 24 passed, 2 future cases not run;
  pricing evals: 6 evaluated, 5 partial, 1 unsupported, 0 invalid.
- The final Docker build succeeded on Linux/amd64. Image size reported by
  `docker image inspect`: **364,050,731 bytes** (364.1 MB, approximately 347.2 MiB;
  local image size, not compressed registry transfer size). Actual Node: 22.23.3.
- Ports 3001 and 8080 both returned health HTTP 200 and Docker `healthy`.
  Customer/owner routes loaded, optional exact-origin preflight passed, and default
  same-origin behavior was retained.
- A synthetic owner sample was priced, approved at 1200, then accepted through the
  contextual customer endpoint. Coordination remained pending. No provider was called.
  A separate no-key extraction request returned `503 AI_NOT_CONFIGURED`.
- Restart produced a fresh empty session. Both test containers stopped with exit
  code 0 and were removed; the built image was retained. Logs contained only listener
  messages. Runtime checks confirmed UID 1000, no API key or `.env` files, no client,
  development dependencies, eval data or offline scripts, and a valid workspace link.
- The unchanged `npm run demo:quote --workspace server` served the offline UI and
  its fixture messages still produced the 950 partial subtotal.

## Proxy dependency remediation on 2026-10-10

The original installed path was `server -> express@5.2.1 -> proxy-addr@2.0.7`;
the server manifest declared Express `^5.1.0`. The critical
[`proxy-addr` advisory GHSA-jqcg-44mw-7w3h / CVE-2026-90711](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h)
is fixed in 2.0.8.

Updated the direct parent to Express `^5.3.0`, locked at 5.3.0, which declares
`proxy-addr@^2.0.8`; the lockfile now resolves 2.0.8. The old parent's range also
allowed a lockfile-only proxy update, but the compatible parent release was selected
in the requested remediation order. No direct proxy dependency, override or forced
audit fix was needed. [Express 5.3.0 release notes](https://github.com/expressjs/express/releases/tag/v5.3.0)
were reviewed. The associated lock changes are limited to Express, proxy-addr,
Express's required content-disposition 2.0.1, and consolidation of its content-type
dependency at 2.1.0. Business and client source code are unchanged by this remediation.

After that change, the proxy advisory was gone and `npm audit --omit=dev` reported
zero vulnerabilities. The remaining high source-map-js advisory in client tooling
was addressed separately below. Audit report contents were inspected rather than
relying only on the local npm command's exit status.

Remediation verification: 382 server and 41 client tests passed; offline evals
passed (24 conversation cases, 2 future cases not run; 6 pricing cases, 0 invalid).
TypeScript checks, production builds and `git diff --check` passed. Rebuilt with the
unchanged Dockerfile and the repository-root build command above. The resulting
Linux/amd64 image is **363,946,756 bytes** (363.9 MB, approximately 347.1 MiB).
Express's own module resolution inside the image confirmed proxy-addr **2.0.8**.
Production startup, health HTTP 200, Docker `healthy`, customer/owner route HTTP
200 and idle shutdown exit 0 passed without a key or live provider call. The test
container was removed and the rebuilt image retained. No deployment was performed.

## Source-map build dependency remediation on 2026-10-10

The vulnerable path was
`client -> vite@6.4.3 -> postcss@8.5.28 -> source-map-js@1.2.1`.
Vite is a direct **devDependency**; PostCSS and source-map-js are transitive
development/build dependencies. The
[advisory GHSA-68fv-2mgg-jv7q / CVE-2026-93749](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)
concerns event-loop denial of service when processing malicious indexed source-map
offsets. Version 1.2.2 is patched. This project uses the package through CSS build
tooling, not in application runtime code; the backend image excludes it.

The compatible Vite 6.4.4 release retains the same PostCSS range (`^8.5.3`), so
updating Vite alone does not require a patched source-map-js. The immediate parent,
PostCSS 8.5.29, requires `source-map-js@^1.2.2` and fits the existing Vite range.
Ran `npm update postcss --workspace client` to refresh the lockfile with that patch.
The only package entries changed in this remediation are PostCSS 8.5.28 -> 8.5.29,
source-map-js 1.2.1 -> 1.2.2, and Nano ID 3.3.18 -> 3.3.20 to satisfy PostCSS's
updated `^3.3.19` range. Vite stays at 6.4.3. No manifest changes, new direct
dependencies, overrides, major upgrades or forced audit fixes were needed.

Final path: `client -> vite@6.4.3 -> postcss@8.5.29 -> source-map-js@1.2.2`.
Both full and production-only npm audits report **zero vulnerabilities**. The prior
Express 5.3.0 / proxy-addr 2.0.8 fix is retained.

Verification passed: `npm ls source-map-js`, `npm audit`, all 423 tests (382 server,
41 client), offline evals (24 conversation cases passed, 2 future cases not run;
6 pricing cases, 0 invalid), TypeScript checks, production builds, the existing
Docker build and `git diff --check`. SHA-256 hashes of all three generated client
files (HTML, JavaScript and CSS) match the pre-update build exactly. The rebuilt
backend image remains 363,946,756 bytes; runtime inspection confirms source-map-js,
PostCSS and Vite are absent and proxy-addr remains 2.0.8. No application source,
runtime configuration or Dockerfile changes were made for this fix. No deployment,
live provider call, commit or push was performed.
