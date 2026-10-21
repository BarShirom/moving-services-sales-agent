# Runtime controls and Docker preparation history

## Current runtime boundaries

The public portfolio demo is deployed on AWS Lightsail using Docker Compose,
Caddy HTTPS and private Amazon ECR images. Local development still binds to
loopback; `npm run demo:quote --workspace server` uses injected synthetic fixtures
without provider requests. The application has no authenticated business-owner
role, durable lead/quote database or scheduling. Every quote requires owner
approval; acceptance leaves manual coordination pending.

Business sessions remain bounded and process-local. Restarting the backend loses
leads, messages, evaluations, reviews and quotes. The separate operator-provisioned
AI ledger in `server/src/safety/aiWindow.ts` persists cumulative public-beta
reservations and fixed expiry across backend replacements. Process-local HTTP/AI
counters are additional controls; restarting them does not replenish that durable
allowance. Failed attempts can consume reservations. Health and static serving
do not establish provider availability.

The deployed controls retain an unpublished backend port, one exact Caddy peer,
canonical HTTPS origin, Secure host-only cookies, CSRF admission, bounded container
resources and logs, and operator-owned backend secrets. Preserve the existing
ledger mount, permit, consumed reservations, expiry, credentials, TLS volumes and
matching release/rollback evidence during deployment. The repository Compose file
is a baseline: its local Caddy reference and absence of private ledger/permit
mounts do not reproduce the full deployed operator configuration. Local defaults
leave the AI gate closed, even when a provider key is present.

Use the established operator release procedure and private overrides for an
actual deployment. See the [engineering guide](ENGINEERING_GUIDE.md#local-and-deployed-runtime)
for local/deployed differences. The dated [20 October release report](DEMO_APPROVAL_RELEASE_20261020.md)
records workflow verification and accounting-preservation requirements; fresh
health, artifact and browser checks must be recorded for each new release.

The preparation and verification sections below preserve their original dated
context. Their references to planned AWS publication, public launch or allowances
that disappear on restart describe those earlier artifacts, not the current
deployed beta. Historical image identities and scan results are not current
release instructions or evidence of current provider readiness.

## Current image architecture - Chainguard adoption (2026-10-12)

The main Dockerfile now uses the approved Chainguard Node Starter Linux/amd64
base in **every stage**, pinned to
`sha256:fa7d6d61223b68391843b13d1ced9d51293103dacb7dbaae28d0516234295e2e`.
Node is 26.11.1, shared OpenSSL 4.0.3 and shared zlib 1.3.2.1-motley. Both original
backend CVEs are addressed in this implementation, with source, signed SBOM and
runtime-linkage evidence; no risk exception is needed for those two CVEs in this
artifact. See the [adoption report](security/chainguard-adoption-20261012/README.md)
for the final immutable identities, checks, remaining limitations and maintenance plan.

- `packages`: pinned Wolfi/glibc base plus unchanged workspace manifests/lockfile.
- `verification`: clean `npm ci`, both workspace tests/typechecks/builds and offline
  evals, followed by full/production npm audits. Test execution has no network.
- `production-dependencies`: separate production server install from the same lock.
- `runtime-files`: removes offline eval/demo tools from compiled server output.
- `runtime`: same pinned base, only app production dependencies and compiled server;
  UID/GID 65532:65532, working directory `/app`, direct `node server/dist/server.js`,
  established health check and graceful signal handling. Vendor shell/npm tooling
  is retained intact; the application never installs packages at startup.

Build from the repository root with `--platform linux/amd64` and build off-host.
`server/Dockerfile.dockerignore` overrides the root ignore file for this Dockerfile:
only needed source, tests/eval fixtures and manifests enter the build; credentials,
local environments, private keys, host node_modules/builds and unrelated files are
excluded. Tests/fixtures/client output are not copied to the backend runtime.
Frontend assets come from the matching verification stage and are served by Caddy.
Do not copy native dependencies from Debian, Windows or a different Node ABI.

Node 26 is **Current**, scheduled for LTS on **2026-10-28**, maintenance 2027-10-20
and EOL 2029-04-30 ([official schedule](https://github.com/nodejs/Release/blob/main/schedule.json)).
This pinned patch does not automatically receive future security updates or become
an updated LTS artifact. The public free offering tracks latest, without guaranteed
access to a particular major or a patch SLA. Check weekly (first 2026-10-19), at the
LTS transition and before activation; deliberately verify/pin/rebuild/test/scan
updates. Stop public serving if a required supported fix cannot be obtained.
No automatic vendor/runtime switch, custom crypto build or paid access is implied.

The historical Debian images below remain evidence only and are **not approved
public rollback targets**. On first-release failure, stop Caddy/backend; keep TLS
volumes and evidence, and leave the demo unavailable until a safe artifact is
verified. Future rollback requires a previously approved, still-safe digest plus
matching frontend/config. The adoption report contains operational commands,
monitoring thresholds, immutable Compose references and remaining activation steps.

## Historical Trixie security status (2026-10-11; not a public rollback target)

The main Dockerfile adopts the reviewed `server/Dockerfile.trixie` runtime exactly;
build stages, dependencies, non-root execution, health check and application behavior
are unchanged. The earlier experimental file/report are retained for provenance.

The existing private ECR candidate is
`438298964276.dkr.ecr.eu-north-1.amazonaws.com/moving-services-sales-agent-server:v0.1.2-trixie-candidate`
in `eu-north-1`. Its OCI index is
`sha256:0bac78fcef6d54b00ce63d201129786c08df28a409e84f2bd4e46407a717d130`;
its scanned Linux/amd64 runtime manifest is
`sha256:8e90cdd06c9d19495ea7ac76724c5a2eb141e932ad5ceebe9f68d8bf19608ab7`.
The local main-Dockerfile rebuild reproduced that exact runtime manifest; its outer
index differs only because it has a new build attestation. No push is part of adoption.

The completed ECR scan at **2026-10-11T16:48:41+03:00** reports **0 Critical,
1 High, 0 Medium, 0 Low and 0 Undefined**. Reviewed Bookworm had 2 Critical,
9 High, 2 Medium, 2 Low and 1 Undefined. This is not vulnerability-free clearance.

- **CVE-2026-85091 (High, zlib) remains unresolved.** Installed `zlib1g` is
  `1:1.3.dfsg+really1.3.1-1+b1`; no supported Trixie fix is listed. The reported
  nonblocking gzwrite issue concerns upstream 1.3.1.2–1.3.2 while Debian's source
  is based on 1.3.1. Applicability is uncertain, not an accepted false positive.
  Node does not dynamically link OS zlib; no affected application path was found.
- ECR omits Debian-open util-linux CVE-2026-78408, CVE-2026-76642,
  CVE-2026-78409 and CVE-2026-78410, plus glibc CVE-2026-86805,
  CVE-2026-95818 and CVE-2026-97399. These are **not claimed fixed**. Their local,
  privileged or architecture-specific prerequisites limit normal API exposure;
  Sid fixes are not supported Trixie updates and must not be mixed into this image.
- Additional vendor-open Perl entries and the full package/version/applicability
  accounting are preserved in the [current security review](IMAGE_SECURITY_REVIEW.md).
  GnuTLS removal and two util-linux backports are confirmed improvements; the
  lower ECR count also reflects scanner/vendor differences. No findings are suppressed.

The adopted runtime is 351.99 MiB on disk. A constrained local smoke run used
28.59 MiB RAM under a 512 MiB limit, not a capacity benchmark. A 1 GB Lightsail host
still needs headroom for Ubuntu, Docker and HTTPS ingress; build off-host. Before
public access, review residual risks, authentication/owner access, session isolation,
HTTPS, request limits, secrets and provider cost controls. The API now isolates
temporary browser sessions in memory but has no authenticated business-owner role
and does not serve the client. No Lightsail instance,
public deployment or AWS configuration change is authorized by this adoption.

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
| `NODE_ENV` | Set `production` for Docker: listens on `0.0.0.0` and issues Secure `__Host-` session cookies. Unset/development listens on `127.0.0.1` with a separate non-Secure local cookie. |
| `PORT` | Integer 1-65535, default `3001`. Use an unprivileged port such as 3001/8080 for the non-root container. |
| `OPENAI_API_KEY` | Optional for startup; required only at the real extraction boundary. Backend-only. |
| `OPENAI_MODEL` | Optional; blank/unset uses the existing default in `server/src/config/openai.ts`. |
| `CLIENT_ORIGIN` | Optional single trusted browser origin, without a trailing slash. Enables credentialed CORS; HTTPS required in production. Blank is preferred for the same-origin deployment. |
| `DEMO_PUBLIC_ORIGIN` | Canonical external origin, e.g. `https://demo.example.com`, for request-origin validation behind ingress. Set explicitly for deployment. Blank locally uses the request Host and local protocol; forwarded headers are not trusted. |
| `DEMO_TRUSTED_PROXY_IP` | Blank for direct local mode. The Caddy Compose template sets `172.30.30.2`, exactly one private proxy IP; no CIDR, hostname or hop count. Proxy mode requires production Secure cookies, an explicit HTTPS public origin and blank `CLIENT_ORIGIN`. |

The current client uses relative `/api` requests; its Vite proxy does not need CORS.
An explicitly configured origin receives credentialed CORS responses and preflight
permission for `Content-Type, X-Demo-Request`; other origins receive no CORS permission.
There is no wildcard. Cross-site embedding is not supported by SameSite=Lax cookies;
use one HTTPS origin for client and `/api`, or a carefully reviewed same-site setup.
CORS is a browser policy, not authentication.

## Temporary demo sessions

Each browser cookie jar receives a server-generated 256-bit random base64url ID.
The ID is never accepted from a URL/body or exposed in response JSON/localStorage.
It selects a fresh, independent lead, conversation, pricing history, owner reviews,
quotes and busy guard. Both demo roles belong to that visitor; anyone can try the
owner view of their own session. Reset changes only that visitor's state and does
not extend the session's absolute lifetime. The pricing/AI rules are unchanged.

`server/src/demo/sessions.ts` bounds storage to **100 sessions**, a **30-minute
absolute lifetime**, and **256 KiB of serialized state per session**. These are
server-side defaults, not caller-supplied limits. Timers remove expired idle entries
without traffic, and lookups/creation also sweep expired entries. Timers are unref'd
so they do not prevent shutdown. Expired in-flight extraction retains its capacity
slot until completion; its result cannot commit, and cleanup runs in `finally`.
This avoids eviction/race-based resurrection of expired state. Serialized size is
not a heap-memory guarantee: object, request and provider overhead must be measured.

- Capacity exhaustion returns `503 SESSION_CAPACITY`; existing sessions are not
  evicted. Per-session size exhaustion rejects the whole state update with
  `413 SESSION_FULL`; prior state remains and reset is available.
- Missing/expired/unknown/malformed/duplicate cookies never select an existing
  session. A valid initial customer/owner GET creates a new random ID if capacity
  permits. POST returns `409 SESSION_EXPIRED` with Hebrew refresh guidance instead
  of creating a new lead and replaying an old message or approval.
- Busy mutations in the same session return `409 BUSY`; another session can proceed.
  Reads see the last committed state. Existing stale-review and quote-version checks
  remain in place. Health checks and unsupported paths do not allocate sessions.
- Frontend fetch uses `credentials: include` and `X-Demo-Request: 1` on every demo
  request, including reset. Concurrent initial customer reads in one tab coalesce.
  There is no automatic replay after expiry; refresh starts a new demo. Tabs in the
  same profile share cookies/state; private profiles or different browsers isolate.
  Simultaneous first loads in separate tabs can create two temporary slots before
  the browser settles on its last received cookie; this does not cross visitor jars.

Production cookies use `__Host-moving-demo`, `HttpOnly`, `Secure`, `SameSite=Lax`,
`Path=/`, a 30-minute Max-Age and **no Domain**. The local HTTP cookie is `moving-demo`
with the same policy except Secure/prefix. The browser manages credentials; cookies
are bearer secrets and must not be logged. Host-only cookies are not port-scoped:
use a dedicated demo hostname and avoid hosting untrusted apps on that origin.

CSRF protection requires the non-simple `X-Demo-Request: 1` header even on session-
issuing GETs, validates any supplied Origin against the external/same origin or
explicit trusted client, and rejects inconsistent cross-site Fetch Metadata.
Browser forms, images and unapproved cross-origin JavaScript cannot satisfy this
policy. Missing Origin is supported for same-origin GETs and command-line clients
only when the custom header is present. The fixed header is not authentication or
an anti-bot token. SameSite is defense in depth; XSS or a compromised allowlisted
origin can still issue requests. See [OWASP's API CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
and [cookie prefix requirements](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).

Express `trust proxy` remains **false**. Cookie security is based on production
configuration, not spoofable `X-Forwarded-Proto`. For Lightsail, terminate HTTPS at
a reviewed reverse proxy, set `DEMO_PUBLIC_ORIGIN` to its canonical HTTPS origin,
preserve the public Host, and keep the API port private/loopback. Forward cookies
and the custom header; do not cache API responses or Set-Cookie. HTTP health probes
remain cookie-free. Production browser workflows require HTTPS; use the offline
fixture/local dev server for HTTP browser testing. The Caddy policy below provides
explicit client attribution without enabling Express proxy trust.

Restart/replacement loses all state. A stolen cookie permits that session's demo
roles until expiration; there is no real login or authorization boundary between
customer and owner. Multiple replicas would have separate stores, so this version
requires one process/replica. No database or persistent identifiers were added.

Server-side traffic and AI controls now supplement session isolation as described
below. Neither control replaces a reviewed HTTPS ingress or provider-account cost
monitoring. No live provider call or public deployment was used for verification.
The application changed after the recorded Trixie scan: its next image push and
new-digest ECR scan require separate approval.

Local verification on 2026-10-11 passed **438 tests** (394 server, 44 client),
including 12 new session/security tests and 3 new frontend API tests. Existing
HTTP tests now retain cookies like a browser. Type checks and production builds
passed for both workspaces; offline evals passed (24 conversation cases, 2 future
cases not run; 6 pricing cases, 0 invalid). Full and production npm audits report
zero vulnerabilities. No dependency versions changed.

The unchanged reviewed Trixie Dockerfile built the local-only tag
`moving-services-sales-agent-server:session-isolation-20261011` (Linux/amd64,
369,100,801 bytes). Its runtime manifest is
`sha256:d92ab1ab5c0accc09d3f129ab07cd67de790416511b8ab8d37da9cc3e22a9a33`.
A no-secret container test with separate cookie jars verified visitor/reset
isolation, 900 ILS synthetic pricing, human approval and contextual quote acceptance,
Docker health and shutdown exit 0. It used 30.4 MiB in one sample under the 512 MiB
limit, with read-only root, capabilities dropped and no-new-privileges. Node fetch
inside the disposable container explicitly forwarded cookies over loopback for this
test; it did not validate browser cookie persistence through an actual HTTPS ingress.
The test container was removed. No AWS call, image push or live extraction occurred.

## Traffic limits and AI usage cutoff

`server/src/demo/protection.ts` owns one controller shared by all demo routes in
the application. HTTP admission runs before preflight completion, JSON parsing,
session allocation and business operations. Health probes remain independent.
State mutations that are rejected by protection do not commit. Owner approval,
synthetic pricing and deterministic date/photo/quote paths do not spend an AI
reservation; they remain available within ordinary HTTP quotas after an AI cutoff.
All configuration is server-side and validated at startup; malformed/out-of-range
values fail startup rather than silently disabling protection. See `.env.example`.

| Environment variable | Default | Scope |
| --- | ---: | --- |
| `DEMO_SESSION_REQUESTS_PER_MINUTE` | 60 | Every admitted demo request within one session |
| `DEMO_CLIENT_REQUESTS_PER_MINUTE` | 120 | Admitted client-IP HTTP requests, including missing/invalid cookies, malformed bodies and preflights |
| `DEMO_GLOBAL_REQUESTS_PER_MINUTE` | 300 | All demo requests, including client-level rejections |
| `DEMO_CLIENT_SESSIONS_PER_HOUR` | 5 | New-session creation attempts per admitted client IP |
| `DEMO_GLOBAL_SESSIONS_PER_HOUR` | 30 | New-session creation attempts across all peers |
| `DEMO_MAX_TRACKED_CLIENTS` | 1000 | Maximum live client bookkeeping entries |
| `DEMO_AI_CONCURRENCY` | 2 | Concurrent extraction calls; maximum configurable value 10 |
| `DEMO_AI_REQUESTS_PER_SESSION` | 20 | Lifetime extraction attempts per session, unchanged by reset |
| `DEMO_AI_REQUESTS_PER_CLIENT_HOUR` | 30 | Extraction attempts across an admitted client IP's cookies/sessions |
| `DEMO_AI_REQUESTS_PER_MINUTE` | 10 | Application-wide extraction admission |
| `DEMO_AI_REQUESTS_PER_DAY` | 100 | Application-wide attempts per UTC day; zero disables extraction |
| `DEMO_AI_RESERVED_TOKENS_PER_DAY` | 2000000 | Conservative token-unit reservations per UTC day; zero disables extraction |
| `DEMO_AI_MAX_REQUEST_BYTES` | 196608 | Maximum UTF-8 size of the complete serialized extraction request (192 KiB) |

Minute/hour counters use fixed windows starting with the first attempt. They can
allow a burst on both sides of a window boundary; there is no claim of an exact
rolling-window throughput limit. Global counters and the concurrency ceiling bound
the aggregate effect. Session counters use the server-side session object and are
not part of the resettable lead state. New cookies cannot reset peer/global quotas.
Expired client records are cleaned on access and the minute telemetry tick; live
records are never evicted to make space for another client. At capacity, unfamiliar
clients receive `503 PROTECTION_CAPACITY`. Session counters use a WeakMap and leave
memory with their session. There is no unbounded queue or per-request log collection.

### AI admission and reservation accounting

The actual OpenAI transport accepts a server-side admission guard immediately
before the SDK call. Credentials/configuration and context validation happen first.
Admission checks all quotas and reserves usage synchronously before awaiting I/O.
At concurrency exhaustion, return **503 AI_BUSY** with `Retry-After: 5`; no queue
or automatic retry exists. The existing SDK timeout remains **30 seconds** and
`maxRetries=0`. A slot releases only when its promise settles, including failure;
an HTTP disconnect does not prematurely free the slot or refund its reservation.
Midnight resets daily counters but does not reset active-call concurrency.

Each attempt reserves:

```text
UTF-8 bytes of JSON.stringify(complete request) + 4,000 output tokens + 4,096 overhead units
```

The complete request includes instructions, structured context, output schema and
model. The existing output cap of 4,000 is unchanged and includes non-visible output,
as described in [OpenAI's token-counting documentation](https://developers.openai.com/api/docs/guides/token-counting).
Oversized requests are rejected before dispatch, not truncated or rewritten.
Reservations are deliberately **not refunded**, even for provider errors, invalid
structured output or timeouts, because the provider may have billed the attempt.

This is a conservative text-only heuristic, **not exact tokenization, actual usage
or a dollar spending guarantee**. It ignores cache discounts, treats input bytes
as token units and adds framing headroom. Provider framing/tokenization and model
prices can change. The independent daily request cutoff remains a hard local
attempt ceiling. Prompts, extraction decisions, model selection and pricing rules
are unchanged. Re-evaluate the reservation policy before adding tools, images,
different output limits or new provider endpoints. Local developer CLI commands
are outside the public HTTP controller and must not be exposed as public routes.

Quota rejection returns **429** (`RATE_LIMITED`, `SESSION_RATE_LIMITED`,
`AI_RATE_LIMITED`, `AI_BUDGET_EXHAUSTED` or `AI_INPUT_LIMIT`) with a safe Hebrew
message and `Retry-After`. Daily cutoff retries point to next UTC midnight;
session AI exhaustion points to session expiry. Input-size rejection requires a
smaller/fresh session or manual continuation, not merely waiting. The client shows
curated errors/retry guidance and retains drafts; it never replays a throttled
message or quote acceptance automatically. Credentialed CORS exposes `Retry-After`
only to the single configured trusted client origin.

### Caddy, source addresses and operating limits

**Express trust proxy remains explicitly false.** Without `DEMO_TRUSTED_PROXY_IP`,
all forwarding headers are ignored and quotas use the socket peer (local development).
With the exact Caddy IP configured, admission checks the backend socket peer first:
only Caddy may supply one `X-Demo-Client-IP` containing one literal IP. Missing,
duplicate, malformed, list, port, CIDR and zone-ID values fail closed with a safe
403 `REQUEST_FORBIDDEN`, before state or quota allocation. Every other socket peer
is rejected on `/api/demo`, even if a cookie or forged forwarding header is supplied.
Health remains cookie-free and does not require a proxy. No visitor IP is returned
to the browser or added to application logs. Equivalent IPv6 spellings and
IPv4-mapped IPv6 normalize to the same quota key.

Caddy overwrites that header from `{http.request.remote.host}`, its actual socket
peer, not `{client_ip}` or an incoming header. Incoming `Forwarded` and `X-Real-IP`
are removed; Caddy's default policy replaces untrusted X-Forwarded values. There
is no `trusted_proxies`, PROXY protocol, CDN or ALB ahead of Caddy in this topology.
Express ignores X-Forwarded-For/Host/Proto for identity, protocol and cookies.
This follows [Caddy's header policy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers)
and [remote-host placeholder](https://caddyserver.com/docs/caddyfile/concepts#placeholders).

The same admitted IP is used for HTTP, creation and AI client quotas; per-session
and global controls are unchanged. NAT users still share quotas. Rotating real IPs
(including IPv6 privacy addresses) can gain fresh client quotas but cannot bypass
global caps or bounded bookkeeping. This is abuse protection, not authentication.
Application quotas cannot prevent volumetric floods or CPU/TLS exhaustion at Caddy.
The exact template and deployment prerequisites are described below.

The listening server emits one `demo_limits` JSON event at startup and one
`demo_usage` event per minute. Usage contains UTC day, reserved daily request/token
counts, active AI count, tracked-client count and rejection counts by fixed code.
It contains **no IPs, session IDs, messages, lead fields, model responses or keys**.
Use `docker logs --since 15m <container>` locally to inspect these aggregate events;
do not enable request/SDK body logging. Watch daily headroom, AI_BUSY rejections,
creation/HTTP limits and bookkeeping-capacity rejections, and compare reservations
with the provider usage dashboard. They are not billing records. Existing global
shutdown handling is unchanged; an in-flight call may still incur provider charges
if the process is forcibly stopped.

All counters are in memory and reset on restart; each process/replica has its own
budget. Run **one replica**. A restart or redeployment can grant another day's
allowance; changing credentials or model also needs operator review. Use a dedicated
provider project/key with the smallest practical permissions and review its available
budget alerts/limits as a backstop. Do not describe an alert as a guaranteed hard
cutoff. To disable new extraction locally, set either daily allowance to zero and
restart; the deterministic workflow remains available. No provider settings,
infrastructure, IAM, networking or Docker runtime configuration changed in this task.

### Local abuse-control verification (2026-10-11)

- **457 tests passed**: 412 server and 45 client. This adds 18 protection tests and
  one client retry-guidance test to the preceding 438-test session baseline. Coverage
  includes peer/session/global limits, forged headers, cookie churn, bounded maps,
  overlapping AI calls, daily reservations, UTC rollover with active calls, zero
  budget, state preservation and the existing complete quote workflow.
- TypeScript checks and production builds passed for both workspaces. Offline evals:
  24 conversation cases passed, 2 future cases not run; 6 pricing cases, 0 invalid.
  Both full and production npm audits returned zero vulnerabilities. No new dependency.
- Built local-only `moving-services-sales-agent-server:abuse-controls-20261011` using
  the preserved Trixie Dockerfile. Linux/amd64, 369,115,806 bytes; runtime manifest
  `sha256:ab19670a48e2237b48d21c70abf52024308982fab9a9cab3248c4fbe86024cfc`.
- A production-mode container with no secrets/ports published verified secure-cookie
  sessions, 429/Retry-After, spoofed-header resistance, isolation and synthetic
  pricing/approval/acceptance with daily AI allowance zero. SDK/AI budget tests used
  fake transports; no paid or live provider calls were made.
- Docker health and graceful exit 0 passed with no OOM under 512 MiB, 1 CPU, 128 PIDs,
  read-only root and dropped capabilities. One post-burst sample was **76.35 MiB**,
  7 PIDs; this differs from earlier idle samples and is not a load/capacity guarantee.
  Aggregate telemetry showed zero AI reservations and the expected throttle counters,
  with no peer/session/message fields. The disposable container was removed.
- `git diff --check` passed. Existing Docker/security work, session-store code and
  lockfile were preserved; no AWS changes, image push, deployment or Git commit/push.

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

For browser-style cookie verification over local HTTP, run `npm run dev:server`
with `NODE_ENV=development`, or use the production API through HTTPS and set `$base`
accordingly. Secure production cookies are not supported over ordinary HTTP;
PowerShell's HTTP stack also may discard them there. Container health checks need
no cookie and still work over loopback HTTP. In PowerShell:

```powershell
$base = 'http://127.0.0.1:3001'
(Invoke-WebRequest -UseBasicParsing "$base/api/health").StatusCode
Invoke-RestMethod "$base/api/health"
$demoHeaders = @{ 'X-Demo-Request' = '1' }
$bootstrap = Invoke-WebRequest -UseBasicParsing "$base/api/demo" -Headers $demoHeaders -SessionVariable demoSession
$initial = $bootstrap.Content | ConvertFrom-Json
$owner = Invoke-RestMethod "$base/api/demo/owner" -Headers $demoHeaders -WebSession $demoSession
$token = @{ leadId = $owner.customer.lead.id; revision = $owner.revision } | ConvertTo-Json
$sample = Invoke-RestMethod -Method Post "$base/api/demo/owner/sample" -Headers $demoHeaders -WebSession $demoSession -ContentType 'application/json' -Body $token
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
`-e CLIENT_ORIGIN=https://demo.example.com`, then check:

```powershell
$headers = @{ Origin = 'https://demo.example.com'; 'Access-Control-Request-Method' = 'POST'; 'Access-Control-Request-Headers' = 'content-type,x-demo-request' }
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

## Planned ECR / Lightsail flow

The planned host remains Lightsail Ubuntu 24.04 with 1 GB RAM and Caddy ingress.
The adopted Chainguard backend is a **local** release candidate. Previously
published Debian images remain historical and blocked for public use. A separately
approved publication must upload a unique backend tag, verify its exact digest
and retrieve its ECR scan; no new AWS work is authorized by local adoption.
Reuse the unchanged verified Caddy image. For host pulling, use its private ECR
reference at the same digest through a reviewed image-only Compose override.
See the [current adoption report](security/chainguard-adoption-20261012/README.md)
for maintenance, rollback and monitoring. Do not substitute mutable tags.
Build off-host, keep `NODE_ENV=production`, explicit health checks and a stop
timeout longer than the eight-second drain deadline. Review HTTPS ingress,
backend-only secrets, logs, resource limits and client hosting before public access.

Host setup and public deployment remain future steps, not actions executed by this work.
The current demo must remain access-restricted pending rate/cost and ingress review.
Visitor sessions are isolated, but all state is in one process: restart/replacement
loses leads, approvals and quotes; multiple containers would have independent stores.
Durable storage and authenticated
access are prerequisites for a real multi-user production service. A successful
health check does not validate provider configuration or those missing capabilities.

### Caddy and Lightsail deployment template

The current local runtime gate and verification results are recorded in
[FINAL_RELEASE_REVIEW.md](FINAL_RELEASE_REVIEW.md) and the
[Chainguard adoption report](security/chainguard-adoption-20261012/README.md).
The old zlib/OpenSSL exception requests apply to historical Debian artifacts,
not the fixed candidate. Local readiness does not authorize publication or public
activation. [ECR_PUBLICATION_PLAN.md](ECR_PUBLICATION_PLAN.md) remains background
for private repositories and renewable pull authentication; use the new release
manifest, not historical backend image identities.

[`deploy/compose.yaml`](../deploy/compose.yaml) and
[`deploy/Caddyfile`](../deploy/Caddyfile) define this **not-yet-deployed** topology:

```text
Internet browser -> Lightsail host IPv4 TCP 80/443 -> Caddy (edge bridge)
                                                  |
                           backend bridge 172.30.30.0/29 (NAT)
                           Caddy .2 -> Express .3:3001
                           gateway .1 is NOT trusted
```

Only Caddy publishes host ports: HTTP redirects to HTTPS, then the canonical
hostname serves prebuilt React files and proxies `/api/*`. Backend port 3001 has
**no port publication**, host networking or public route. Caddy is on both bridges;
the backend is only on the backend bridge. This bridge is not marked `internal`
because the backend requires outbound HTTPS to OpenAI. It relies on ordinary
Docker bridge isolation/NAT, with no direct routing, routed/unprotected gateway,
trusted host interfaces or daemon-wide forwarding bypasses. See
[Docker port-publishing boundaries](https://docs.docker.com/engine/network/port-publishing/).
Ingress binds explicitly to `0.0.0.0` (IPv4), not an implicit dual-stack listener.
Use an A record only; do not publish an AAAA record with this template. Docker's
IPv6-to-IPv4 userland proxy can replace the original source with a bridge address.
Native IPv6 ingress requires a separate Docker/network review and source-preservation
test; the application's parser already supports IPv6, but that alone is insufficient.
If the chosen subnet conflicts with host/VPN/Docker routes, choose another unused
private /29 and change its gateway, both static addresses and the exact trusted IP
together; rerun the tests. These addresses describe our own bridge, not AWS ranges.

Only the Caddy container owns `172.30.30.2`. Do not attach other workloads to this
bridge, mount the Docker socket, use host networking, publish 3001, or change Caddy
to host-installed mode. A host root/Docker administrator or compromised Caddy is
inside the trust boundary and can impersonate a client. Direct accidental access
to 3001 from other peers still fails application admission; that defense does not
replace network isolation. No CIDR or guessed hop count is trusted.

Compose inputs (operator-controlled, not user request data):

| Variable | Required value |
| --- | --- |
| `DEMO_DOMAIN` | One canonical DNS hostname, e.g. `demo.example.com`; no scheme, port, path, whitespace or Caddyfile syntax |
| `DEMO_BACKEND_IMAGE` | Reviewed Linux/amd64 application image pinned by digest, after an approved push and new security scan |
| `DEMO_BACKEND_ENV_FILE` | Absolute path outside this repository to a private backend env file (0600, owned by the deployment operator); holds `OPENAI_API_KEY`, optional model and quota overrides |
| `DEMO_CLIENT_DIST` | Absolute path to prebuilt `client/dist` from the matching source revision; no frontend provider secrets |

Compose overrides the env file with `NODE_ENV=production`, `PORT=3001`,
`DEMO_TRUSTED_PROXY_IP=172.30.30.2`, `DEMO_PUBLIC_ORIGIN=https://${DEMO_DOMAIN}` and
blank `CLIENT_ORIGIN`. Do not run a second replica. Blank proxy configuration is
for direct development, not an alternative public deployment. Startup rejects
proxy mode without HTTPS origin/Secure cookies or with cross-origin CORS enabled.

Cookies remain `__Host-moving-demo`, Secure, HttpOnly, SameSite=Lax, Path=/ and no
Domain. Frontend relative `/api` calls include credentials and `X-Demo-Request: 1`.
The backend checks the explicit canonical origin, custom header and Fetch Metadata;
cross-origin preflights receive no CORS grant. Forwarded Host/Proto cannot influence
these checks. Same-origin XSS or a stolen cookie still compromises that visitor's
demo session; owner actions are a demo role, not real owner authentication. Session
state and all quotas disappear on restart. Browser refresh after expiry remains
necessary; no request is automatically replayed.

The backend retains 512 MiB RAM, no swap, PID limit 128, non-root execution,
read-only root filesystem and all capabilities dropped. Caddy gets 128 MiB, no
swap and PID limit 128, a read-only root, only NET_BIND_SERVICE, and persistent
volumes for TLS data/config. Both use no-new-privileges and bounded Docker logs
(two 5 MB files each). Caddy's admin API is disabled; restart it to change config.
Access/debug logs are not enabled and the runtime logger removes the structured
request object. Do not enable credential/body logging. Inspect aggregate backend
usage and restart/OOM counts. Caddy has 10s header, 15s body, 45s write and 60s idle
timeouts, a 32 KB API body cap, and 40s upstream response-header timeout. Slow body
uploads may get ingress errors rather than the application's curated JSON errors.
There is no automatic upstream retry. Backend health stays independent of sessions.

The combined 640 MiB container ceilings leave nominal host headroom on a 1 GiB
instance; actual available RAM is lower. Build both workspaces off-host. CPU shares
are bounded to 0.75 backend / 0.25 Caddy; these conservative settings need actual
Lightsail load/latency testing. TLS bursts and internet floods remain availability
risks. Compose now pins the locally verified custom Caddy 2.11.7 image, compiled
with Go 1.26.9 and x/net 0.60.0, by OCI digest with Linux/amd64 selected. It retains
the Alpine 3.23 branch and Caddyfile, with only libssl3/libcrypto3 3.5.9-r0 and
zlib 1.3.2-r1 security updates. The backend now excludes unused global package
managers; its build stages and direct Node startup remain unchanged.
See [Caddy security review](CADDY_SECURITY_REVIEW.md) for provenance, the three
resolved ingress blockers, the OpenPGP scanner finding with no affected imports,
and the final review's completed Grype assessment and coverage limits.
This local image has **not been published**;
separately approve its registry destination/push/scan and replace the local name
with the verified registry-qualified digest before deploying to Lightsail.
Maintain and scan both runtime images before public release.

Before accepting the pending Node OpenSSL exception, verify the private host
environment keeps `OPENAI_BASE_URL` unset/default and has no custom CA, proxy or
TLS-verification overrides. Do not display credentials during that check. Retain
the reviewed AI concurrency/budget defaults or stricter settings. These conditions
are deployment prerequisites, not checks already passed on a real Lightsail host.

Local verification, without published ports or provider calls:

First ensure the reviewed Caddy digest in Compose is available in the local image
store. On a fresh machine, follow the [locked build and verification procedure](CADDY_SECURITY_REVIEW.md)
and review/pin the resulting digest; do not fall back to the vulnerable official
image or a mutable tag. Rebuilds can produce different OCI metadata digests even
when their executable checksums match.

```powershell
npm run build
docker build -f server/Dockerfile -t moving-services-sales-agent-server:caddy-attribution-20261011 .
node deploy/test-proxy.mjs
```

The harness derives a temporary Compose override from the real template. It removes
all published ports, uses `demo.localhost` with an internal test CA (TLS verification
enabled), sets daily AI allowance to zero, lowers test client quotas, and adds two
independent edge clients, an HTTP/2 protocol client and an untrusted backend-bridge
client. It verifies HTTP redirect, HTTP/2 static Range and proxy responses as well
as the security assertions below, and stops both services cleanly. It cleans up only
its own containers, networks, volumes and temporary certificate directory. Docker
Compose must support `!reset` and `!override` (2.24.4+; tested with 5.5.1).

Before any public deployment, separately approve the new image push/scan and host
setup. On the actual host verify subnet availability, Docker bridge firewall rules,
no 3001 mapping, and inbound access restricted to Caddy 80/443 plus separately
restricted management access. Do not rely on UFW alone to hide published Docker
ports. Obtain the hostname/DNS and valid public TLS certificate; keep TLS volumes
private and persistent. Check two independent external source networks receive
separate client quotas (Docker Desktop/host-loopback NAT tests alone cannot prove
Lightsail source preservation), try forged headers, and confirm IPv4 **and IPv6**
public port 3001 are closed. Do not place a CDN/ALB upstream without another trust
review. Run a real-browser HTTPS cookie/CSRF smoke test and inspect quota, memory,
TLS renewal and restart monitoring. No such infrastructure or public changes were
made by this task.

### Local Caddy attribution verification (2026-10-11)

The following records the earlier official-image attribution test. The subsequent
[patched Caddy verification](CADDY_SECURITY_REVIEW.md) repeated these checks and
added HTTP/2 coverage. Updated memory samples were 79.3 MiB backend + 14.42 MiB
Caddy (93.72 MiB combined); neither sample is a capacity benchmark.

All **467 tests passed** (422 server, 45 client), including ten new client-identity
tests covering narrow trust, direct bypass attempts, malformed/duplicate headers,
independent HTTP/session-creation/AI quotas, canonical IPs, state preservation,
cookies and CSRF. Both TypeScript checks and production builds passed. Offline
evals: 24 conversation cases passed, two future cases not run; six pricing cases
evaluated, zero invalid (five partial, one unsupported). Production npm audit:
zero vulnerabilities. No dependency or business-rule changes were made.

The unchanged reviewed Dockerfile built local-only Linux/amd64 tag
`moving-services-sales-agent-server:caddy-attribution-20261011`, 369,121,279 bytes.
Its image index is
`sha256:968cf025b44de8c765e246c3437d5a64178715ac6cdad4bd94d1da890b01fd12`
and runtime manifest is
`sha256:dd74717492efdd00b68b9df574f8bb93dada0c5dda94bc944c6de35b4a74d1cf`.
This application image has not been pushed or ECR-scanned; the prior runtime
security review and residual zlib/Debian findings remain applicable, not rescanned.

The private Docker test passed TLS certificate validation, health, RTL static
serving, two independent visitor quotas, overwritten forged/duplicate identity
headers, session-creation limits, cross-origin rejection, a 900 ILS synthetic
owner approval and contextual quote acceptance. Edge clients could not connect
directly to the backend bridge address; a deliberately attached untrusted backend
client received 403. Neither service published a port. Shutdown exited 0 without
OOM. A forced upstream outage returned 502 while Caddy's runtime logs omitted
the structured request and the synthetic private URI/header marker. Final
post-test samples: backend 74.38 MiB / 512 MiB; Caddy 15.05 MiB / 128 MiB.
These are smoke-test samples, not a load benchmark or a Lightsail measurement.
`git diff --check` passed. The Dockerfile, dependency lockfile, frontend and all
domain/pricing code remained unchanged relative to this task's starting tree;
unrelated uncommitted work was preserved.
No live AI, AWS mutation, deployment or registry push was performed.

### Proxy trust before a future ALB deployment

The supported public-demo target is now Caddy on Lightsail, using the exact-peer
policy above. Express remains explicitly **`false`**. That Caddy-specific policy
does not authorize an ALB or other proxy to supply client identities.

Behind an ALB, the Caddy-mode admission policy would reject an unexpected peer.
Before changing to that architecture, define and test a trust policy against the
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
