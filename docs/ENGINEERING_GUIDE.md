# Engineering guide

Current implementation reference for the [portfolio README](../README.md). This replaces the README's chronological milestone notes; source modules and tests remain the executable contracts.

## Repository map

| Area | Responsibility |
| --- | --- |
| `client/src/` | Customer conversation, session orchestration, owner finalization and coordination views |
| `server/src/app.ts` / `server.ts` | Express app creation separate from the listener (loopback locally, all interfaces in production) |
| `server/src/domain/` | Lead factories, extraction patches, requirements, pricing and quote types |
| `server/src/integrations/openai/` | Bounded context, prompt, wire schema, provider boundary and domain conversion |
| `server/src/demo/` | Single-session orchestration, owner actions, quote lifecycle and explicit distance adapter |
| `server/src/safety/` | Durable operator-controlled AI admission, cumulative beta reservations and readiness checks |
| `server/src/evals/` | Offline fixture runner, historical input adapters and evidence validation |
| `data/evals/` | Public anonymized/synthetic datasets, evidence and provenance documentation |
| `server/tests/`, `client/tests/` | Node test-runner suites, with no live provider calls |

One root npm install and lockfile cover both workspaces. TypeScript is strict; server modules use Node ESM resolution and the client uses bundler resolution. Tests are typechecked separately from emitted server production code.

See the [extension guide](EXTENDING.md) for the module-level architecture map, change/verification table and item identity limitations. Historical moving-business references inform the provisional rules; this portfolio demo does not represent an active business pilot.

## Running and configuration

Use Node.js 20.18+ and npm 9+. On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`. The [offline walkthrough](#offline-demo-walkthrough) is the reproducible, credential-free entry point:

```sh
npm install
npm run build
npm run demo:quote --workspace server
```

`server/src/scripts/demoQuoteFixture.ts` binds to `127.0.0.1:3101`, serves `client/dist` and injects the exact synthetic messages in `quoteFixture.ts`. Date/photo/acceptance handlers also run normally. Other free-form messages may fail; this is a workflow fixture, not a language model. Rebuild after client edits before using it.

For ordinary development, run `npm run dev:server` and `npm run dev:client` in separate terminals. Copy root `.env.example` to `.env` only when configuration overrides are needed. Startup, view switching and draft/example loading do not send extraction requests. The default AI gate is closed: setting `OPENAI_API_KEY` alone does not enable real extraction. Use the fixture for a complete no-provider walkthrough.

| Setting | Current behavior |
| --- | --- |
| `OPENAI_API_KEY` | Required only for a real provider request; missing/placeholder keys fail explicitly |
| `OPENAI_MODEL` | Optional override; default is centralized in [openai.ts](../server/src/config/openai.ts), not a benchmarked model-selection claim |
| `PORT` | Backend port, default 3001; changing it also requires updating the Vite dev proxy target |
| `NODE_ENV` | `production` binds to `0.0.0.0` for containers; otherwise binds to `127.0.0.1` |
| `CLIENT_ORIGIN` | Optional exact CORS origin; blank/unset keeps the existing same-origin/proxy behavior |
| `AI_WINDOW_MODE` | Unset means extraction is disabled; `armed` and `public_beta` require separately provisioned operator permits and durable state |

The server and CLI load the root `.env`; existing environment variables take precedence. `.env` files are ignored except `.env.example`. Never put secrets in the client or `VITE_` variables. Configuration is lazy, so health checks, offline tests and imports need no API key.

The optional `npm run demo:ai -- "customer message"` CLI uses the same real extraction boundary and admission gate. It can make a paid provider request only with valid credentials, an authorized permit, durable state and matching configuration. It does not approve or send a quote and is separate from tests/evals. Permit provisioning, credential rotation and increasing or reopening an allowance are operator tasks outside ordinary development or this refactor. Use injected responses for tests and synthetic messages for separately authorized live work.

`npm run build` writes `client/dist` and `server/dist`. `npm start` runs the compiled backend only. `npm run preview --workspace client` previews the client build; the backend must run for API interactions. The combined offline fixture is simpler for portfolio review. None of these commands is a production deployment.

### Local and deployed runtime

| Concern | Local defaults | Deployed public demo |
| --- | --- | --- |
| Serving | Loopback development servers, or the combined offline fixture on `127.0.0.1:3101` | AWS Lightsail, Docker Compose, Caddy HTTPS and private Amazon ECR images; matching client assets are served by Caddy |
| Network admission | Direct mode ignores forwarded identity headers; local HTTP cookie | Canonical HTTPS origin, Secure host-only cookie, CSRF checks and one exact trusted Caddy peer; backend port 3001 is unpublished |
| Business state | One temporary session per cookie jar, shared across that profile's tabs | The same bounded process-local sessions; backend replacement loses leads, conversations, reviews and quotes; one replica |
| AI admission | Gate closed without operator provisioning; ordinary process-local HTTP/AI quotas still apply | Existing public-beta permit and durable cumulative ledger additionally restrict provider dispatch; fixed expiry and spent reservations survive backend replacement |

The durable ledger in `server/src/safety/aiWindow.ts` records AI admission/accounting and allowlisted diagnostics. It is separate from lead/quote storage and does not make business state persistent. Process-local minute/hour/day counters may restart with the process; the beta ledger does not replenish, reset daily or refund failed attempts. Invalid/missing durable state, exhausted budget or expiry closes admission. Health and deterministic workflow paths do not prove live AI availability.

Keep the existing ledger mount, permit, consumed reservations, expiry, credentials, Caddy/TLS and release/rollback evidence across a deployment. `deploy/compose.yaml` is the packaging/topology baseline; its local Caddy image reference and lack of operator ledger mounts mean it is not a complete copy of deployed private overrides. Use the established operator release configuration. See [deployment notes](DEPLOYMENT.md#current-runtime-boundaries) for runtime injection and the distinction between current controls and dated preparation reports.

### Offline demo walkthrough

With the fixture server running at `http://127.0.0.1:3101`, send these synthetic messages in order as the agent asks for missing details:

1. `צריך להעביר מקרר גדול, שידה קטנה וכ-15 ארגזים מרמת גן לתל אביב. האיסוף ברחוב הדגמה 11, קומה 2 בלי מעלית.`
2. `הפריקה ברחוב הדגמה 22, קומה 1 בלי מעלית.`
3. `8/11`, stored as `2026-11-08` against the fixture reference date `2026-10-07`.
4. `אין לי כרגע`, answering the refrigerator photo request without restarting a loop.

The engine produces a **₪950 partial subtotal**: refrigerator 425 + boxes 150 + pickup stairs 250 + dropoff stairs 125. Dresser transport/access and distance remain unpriced.

Switch to **בעל העסק**, choose **השלם ואשר מחיר סופי**, enter **1200**, confirm whole-job scope/omitted costs and proceeding without the photo, then send the local demo quote. Switch to **לקוח** and choose **אישור ההצעה**. Both views show accepted **₪1,200** and pending coordination; the original **₪950** calculation stays separate. Reset clears the session after confirmation when meaningful progress exists. The requested date is not a reserved appointment.

### Guided interface and recovery

The public demonstration starts with **מה צריך להעביר?** and the customer conversation.
**טעינת הודעה לדוגמה** fills an editable message draft only. It creates no structured lead,
and processing starts only when the visitor deliberately submits the message. Structured
collection leads to owner review and price approval, explicit customer acceptance and pending
manual coordination. There is no visitor-facing prepared-lead loading action.

The synthetic `POST /api/demo/owner/sample` route remains useful for automated tests and
guarded verification. It does not invoke extraction or consume AI allowance; it is not an
entry point offered by the public interface.

The progress guide derives its current step from the server's lead/quote state. The owner
overview keeps workflow status, the relevant calculated or approved amount, missing information
and next action together. Detailed confidence deductions and developer JSON are secondary,
collapsed disclosures; the score remains an information-completeness measure.

Resetting a meaningful conversation requires confirmation.
Session-expiration errors instead disable stale mutations and offer an explicit new session.
Starting it discards old customer/owner snapshots and quote identity/version, while retaining
an unsent draft where possible. No message, acceptance or owner action is automatically replayed.

When AI is unavailable, the interface retains the conversation and unsent draft, explains the
limit, and allows review of existing information and deterministic quote actions where the
server permits them. An empty conversation cannot collect move details without extraction.
Resetting does not restore the shared allowance, and no automatic retry or provider call is
introduced.

Photo requests explain that upload is unavailable and offer the existing deterministic
unavailable-photo reply. It preserves `NOT_AVAILABLE`; finalization still needs the owner's
explicit missing-photo acknowledgement. **עצור אוטומציה לטיפול ידני** requires confirmation
and stops automation for that lead. There is no owner chat/reply interface or resume action;
continuation happens outside the demo. Starting another demonstration is a separate action.

The local page uses Hebrew RTL metadata, an SVG favicon and secondary repository/portfolio
links. Customer and owner layouts use desktop columns and return to a single column on narrow
screens. Existing business rules, pricing, AI limits and deployment controls are unchanged.

## Structured state and extraction

- Lead facts use explicit unknowns: `null` is not `false`, and floor `0` is known ground floor. Dimensions are centimeters; normalized requested dates are `YYYY-MM-DD`, times `HH:mm`, and audit timestamps UTC ISO strings.
- `mergeExtraction` applies explicit fields, retains unrelated facts and nested location fields, and returns ambiguous item patches without selecting a guessed target. Multiple items of the same type and additive/clearing updates have limits.
- The wire schema uses `keep`, `set` and `correct`; it is converted into the restricted domain patch. No model-supplied price, lifecycle status, approval or arbitrary state mutation is accepted.
- The Responses boundary uses schema parsing plus domain validation, with `store: false`, a 30-second timeout, zero SDK retries and no automatic model/deterministic fallback.
- Context contains move details, at most six recent messages, the actual last question and an explicit reference date. It excludes full Lead history, IDs and lifecycle state. Limits are 4,000 characters for the latest message, 2,000 per retained history message, 24,000 for structured state, 1,000 for a question with up to three requirement references, and 48,000 total serialized characters. Oversized history messages are omitted whole; oversized current input is rejected.
- The async conversation path snapshots before awaiting and merges only a completed extraction. Errors preserve the prior business state. Injected custom extractors are trusted to honor the domain contract; provider data crosses the separate validation boundary.

The synchronous pattern extractor is a deliberately narrow offline baseline. Its limitations must not be mistaken for the broader AI-backed conversation path. The ordinary React server uses the AI boundary; the fixture server explicitly injects a different extractor.

### Dates and contextual replies

The conversation path supports ISO dates and Israeli numeric dates with slash/dot separators and optional four-digit years. The router supplies the local reference date in `Asia/Jerusalem`; missing years never come from Lead timestamps. If the date in the reference year is today/upcoming, use that year; otherwise use the next year.

With reference date `2026-10-07`, `10/10`, `10.10`, `10/10/2026` and `10.10.2026` normalize to `2026-10-10`; `06/10` becomes `2027-10-06`. Impossible/unsupported dates do not erase an accepted date. Relative-date language remains unsupported.

The actual displayed question provides context for short replies. Unavailable-photo replies preserve `NOT_AVAILABLE`, and temporary measurement unavailability leaves dimensions missing while avoiding a repeat loop. Corrections and extra information are acknowledged through deterministic response composition; no additional model call is made just to phrase the reply.

## Requirements and collection

Requirements are derived from current Lead state and item/context policy. They distinguish `PRICING` from `REVIEW` stages and `MISSING`, `SATISFIED`, `NOT_APPLICABLE` statuses. They are not a persisted missing-fields list.

The selector prioritizes collectable pricing questions, groups related fields and asks at most two ordinary requirements or three missing dimension axes. Unsupported item pricing has no customer question; it must not suppress askable review information. Pickup/dropoff access is independent, and known floor zero/no-elevator values remain valid.

Refrigerator and box collection profiles are the supported demo baseline. Other item profiles can still gather useful facts while retaining owner-only support issues. Requirements support and pricing-component support are separate: for example, a washing-machine price band exists without making every washer workflow automatically complete.

Photos are review information. `NOT_AVAILABLE` does not satisfy receipt, and owner acknowledgement of proceeding without a photo changes the decision record, not the factual requirement. No file upload or image analysis is implemented.

## Pricing and evidence boundaries

The [current-rule audit](../data/evals/PRICING_EVIDENCE.md#current-pricing-engine-audit) retains the full tariff table, historical support and engineering assumptions. The [calculator](../server/src/domain/pricing/calculatePrice.ts) implements the arithmetic. The evidence registry is offline governance data, never runtime coefficients or an automatic learning system.

Known eligible refrigerator/washer units use historical reference bands. Boxes use one aggregate volume band. The simple supported load is at most two appliances and 30 boxes; review thresholds are engineering assumptions. A narrow pricing-only singular refrigerator/wardrobe convention may use one unit without changing unknown quantities in the Lead.

Stairs apply once per endpoint to the eligible supported load, not per item. Unsupported furniture access remains omitted even when the supported subtotal is priced. Ground floor has no stairs charge; known no-elevator or explicit non-fit can trigger ordinary stair work. Special difficulty remains a separate unpriced issue.

Bed/wardrobe assembly services require explicit service needs, quantity one, standard complexity and no explicitly pending dimensions. Either or both services use one bundle. Service pricing never establishes furniture transport pricing, and disassembly does not imply assembly.

The demo distance adapter recognizes a small explicit route registry and returns an assumed 20 km for those fixtures. Unregistered routes remain unknown and cannot inherit an old distance. No coordinates, map lookup or geographic inference establish real kilometers.

The engine sums component ranges and midpoints, settles money to agorot, and rejects unsafe arithmetic. An eligible 10% discount scales the subtotal endpoints together. Confidence deductions explain uncertainty and review needs; they do not measure prediction probability. Complexity signals such as workers/duration do not invent labor charges.

Historical closed-job totals remain whole-job evidence. The six existing pricing cases are incomplete for full-job scoring. Owner approvals, accepted offers and settled final amounts are distinct future evidence events; none should automatically change a tariff.

The registry contains 29 records and 23 readiness categories, with none marked READY. Detailed classifications and the owner learning loop live in [PRICING_EVIDENCE.md](../data/evals/PRICING_EVIDENCE.md). These counts describe evidence coverage, not production validation.

## Owner review, quote freshness and acceptance

`PricingEvaluation` retains calculated amounts, omissions and input fingerprint. `OwnerReview` records the commercial decision, approved amount, private reason where supplied, scope snapshot/version and acknowledgements. The customer quote retains its own ID/version, final amount, scope and sent/acceptance timestamps.

Owner mutations require Lead identity and revision; finalization also references the current evaluation. Complete recommendations need explicit approval. Partial/cannot-price cases require a positive final amount and explicit scope/omitted-cost confirmation. Both approval and adjustment paths enforce amount/freshness/photo conditions server-side.

Acceptance checks the current quote, active question, owner decision and commercial-scope fingerprint. Ordinary elevator answers cannot accept a quote. Changed work invalidates an unaccepted quote or moves accepted work to review while preserving its immutable accepted scope. Repeated acceptance does not duplicate the acceptance or coordination summary. Questions/objections can hand off without becoming acceptance or automatically becoming `LOST`.

`WON` means commercial acceptance only. The owner receives a coordination summary from the accepted scope, including unresolved details and acknowledgements. No crew, availability or reserved appointment is invented. During human takeover, messages are recorded without resuming AI collection.

## Demo HTTP API

| Route | Behavior |
| --- | --- |
| `GET /api/health` | Product identity and health; no extraction |
| `GET /api/demo` | Customer-safe Lead/conversation and quote snapshot |
| `POST /api/demo/message` | Customer message; optional paired quote ID/version from the client |
| `POST /api/demo/reset` | Clear only the current browser's in-memory session |
| `GET /api/demo/owner` | Pricing, reviews, quote history, available actions and coordination summary |
| `POST /api/demo/owner/sample` | Synthetic owner-review sample for tests and guarded verification; no visitor-facing loading action |
| `POST /api/demo/owner/pricing` | Prepare/recalculate a recommendation, without sending a quote |
| `POST /api/demo/owner/action` | Approve, adjust, request information or take over |

Body validation is strict: 32 KB JSON limit, 4,000-character nonblank customer messages, safe positive final amounts and explicit action tokens. Concurrent mutations while extraction is running return `409 BUSY`; stale owner/quote actions return conflict responses. Missing AI configuration returns 503, extraction failures 502; the client retains its draft and previous state. Raw provider errors and internal owner reasons are not exposed in customer responses.

The router uses bounded process-local browser sessions. Every demo request sends
`X-Demo-Request: 1` and browser credentials; only initial GETs can create a session.
The server issues an opaque HttpOnly cookie, and state, reset and busy guards are
scoped to that cookie. Owner routes are demo roles within the same visitor session,
not business-owner authentication. Tabs sharing cookies share a session. See
[session limits, expiry and CSRF policy](DEPLOYMENT.md#temporary-demo-sessions).
Switching views/actions refreshes snapshots, not a live subscription. This is not
durable tenant storage or a distributed lock. Server-side rate and AI reservation
controls now protect the HTTP demo; see [limits and monitoring](DEPLOYMENT.md#traffic-limits-and-ai-usage-cutoff).
The public demo uses Caddy HTTPS ingress and operator-controlled AI admission.
Direct local mode ignores forwarding headers. The deployed Caddy mode uses
only one dedicated header overwritten by Caddy, admitted from its exact configured
private socket IP; Express proxy trust stays disabled. See the
[topology, Compose template and local spoof tests](DEPLOYMENT.md#caddy-and-lightsail-deployment-template).

HTTP throttling occurs before body parsing/session creation. Extraction admission
occurs only when the existing workflow calls the extractor, immediately before
provider transport; deterministic pricing and quote handling do not spend AI quota.
Protection errors are curated 429/503 responses with Retry-After, leaving state and
client drafts intact. No automatic retries or request queue are introduced.

`GET /api/health` returns `status: "ok"`, `service: "Moving Services Sales Agent"`, `version: "0.1"`. There are no payments, crew allocation or image uploads/analysis. Relative dates, ambiguous same-type item identity, removal services and some additive/clearing updates remain limited or unsupported. Offline checks do not establish live extraction accuracy, latency, cost or commercial impact.

## Verification and extension

Run `npm test`, `npm run eval`, `npm run typecheck`, `npm run build` and `git diff --check` from the root. Test files are explicitly listed in workspace scripts for Windows/Node compatibility. Adding a file requires adding it to the relevant `client/package.json` or `server/package.json` test command and confirming it appears in actual test output. Server tests preload `tests/offlineGuard.mjs`. Tests use Node's runner through `tsx`; frontend tests use React DOM and JSDOM, not Vitest.

See the [eval guide](../data/evals/README.md) for fixture authoring, privacy checks, exit codes, unscored constraints and source-quality semantics. [Pricing evidence validation](../server/src/evals/loadPricingEvidence.ts) runs through tests separately from the six pricing eval inputs. Compiled loaders still require repository-level `data/evals`; those JSON files are not bundled into `server/dist`.

Use the [practical extension guide](EXTENDING.md) before changing an item, collected field, tariff, lifecycle/quote action, recovery path or test registration. Preserve extraction/workflow/pricing separation, add a regression for the actual failure, and keep requested dates distinct from scheduling. Durable business storage, stable item identities, channel adapters and authenticated roles remain follow-up work. Dated release/security reports retain the results and limitations of their original revisions.
