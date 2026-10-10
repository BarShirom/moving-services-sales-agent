# Engineering guide

Current implementation reference for the [portfolio README](../README.md). This replaces the README's chronological milestone notes; source modules and tests remain the executable contracts.

## Repository map

| Area | Responsibility |
| --- | --- |
| `client/src/` | Customer conversation, lead presentation, owner finalization and coordination views |
| `server/src/app.ts` / `server.ts` | Express app creation separate from the listener (loopback locally, all interfaces in production) |
| `server/src/domain/` | Lead factories, extraction patches, requirements, pricing and quote types |
| `server/src/integrations/openai/` | Bounded context, prompt, wire schema, provider boundary and domain conversion |
| `server/src/demo/` | Single-session orchestration, owner actions, quote lifecycle and explicit distance adapter |
| `server/src/evals/` | Offline fixture runner, historical input adapters and evidence validation |
| `data/evals/` | Public anonymized/synthetic datasets, evidence and provenance documentation |
| `server/tests/`, `client/tests/` | Node test-runner suites, with no live provider calls |

One root npm install and lockfile cover both workspaces. TypeScript is strict; server modules use Node ESM resolution and the client uses bundler resolution. Tests are typechecked separately from emitted server production code.

## Running and configuration

Use Node.js 20.18+ and npm 9+. The [offline walkthrough](#offline-demo-walkthrough) is the reproducible, credential-free entry point:

```sh
npm install
npm run build
npm run demo:quote --workspace server
```

`server/src/scripts/demoQuoteFixture.ts` binds to `127.0.0.1:3101`, serves `client/dist` and injects the exact synthetic messages in `quoteFixture.ts`. Date/photo/acceptance handlers also run normally. Other free-form messages may fail; this is a workflow fixture, not a language model. Rebuild after client edits before using it.

For real extraction, copy root `.env.example` to `.env`, set `OPENAI_API_KEY`, then run `npm run dev:server` and `npm run dev:client` in separate terminals. These commands do not themselves send a message; customer messages that reach the provider boundary can make paid API requests.

| Setting | Current behavior |
| --- | --- |
| `OPENAI_API_KEY` | Required only for a real provider request; missing/placeholder keys fail explicitly |
| `OPENAI_MODEL` | Optional override; default is centralized in [openai.ts](../server/src/config/openai.ts), not a benchmarked model-selection claim |
| `PORT` | Backend port, default 3001; changing it also requires updating the Vite dev proxy target |
| `NODE_ENV` | `production` binds to `0.0.0.0` for containers; otherwise binds to `127.0.0.1` |
| `CLIENT_ORIGIN` | Optional exact CORS origin; blank/unset keeps the existing same-origin/proxy behavior |

The server and CLI load the root `.env`; existing environment variables take precedence. `.env` files are ignored except `.env.example`. Never put secrets in the client or `VITE_` variables. Configuration is lazy, so health checks, offline tests and imports need no API key.

The optional `npm run demo:ai -- "customer message"` CLI exercises one real extraction workflow and prints structured results. It does not approve or send a quote and is separate from tests/evals. Use synthetic messages when demonstrating it.

`npm run build` writes `client/dist` and `server/dist`. `npm start` runs the compiled backend only. `npm run preview --workspace client` previews the client build; the backend must run for API interactions. The combined offline fixture is simpler for portfolio review. None of these commands is a production deployment.

See [backend Docker preparation](DEPLOYMENT.md) for runtime environment injection, Linux image verification and the future ECR/ECS boundary.

### Offline demo walkthrough

With the fixture server running at `http://127.0.0.1:3101`, send these synthetic messages in order as the agent asks for missing details:

1. `צריך להעביר מקרר גדול, שידה קטנה וכ-15 ארגזים מרמת גן לתל אביב. האיסוף ברחוב הדגמה 11, קומה 2 בלי מעלית.`
2. `הפריקה ברחוב הדגמה 22, קומה 1 בלי מעלית.`
3. `8/11`, stored as `2026-11-08` against the fixture reference date `2026-10-07`.
4. `אין לי כרגע`, answering the refrigerator photo request without restarting a loop.

The engine produces a **₪950 partial subtotal**: refrigerator 425 + boxes 150 + pickup stairs 250 + dropoff stairs 125. Dresser transport/access and distance remain unpriced.

Switch to **בעל העסק**, choose **השלם ואשר מחיר סופי**, enter **1200**, confirm whole-job scope/omitted costs and proceeding without the photo, then send the local demo quote. Switch to **לקוח** and reply **כן**. Both views show accepted **₪1,200** and pending coordination; the original **₪950** calculation stays separate. Reset clears the session. The requested date is not a reserved appointment.

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
| `POST /api/demo/reset` | Clear the entire in-memory session |
| `GET /api/demo/owner` | Pricing, reviews, quote history, available actions and coordination summary |
| `POST /api/demo/owner/sample` | Replace the session with a synthetic owner-review sample |
| `POST /api/demo/owner/pricing` | Prepare/recalculate a recommendation, without sending a quote |
| `POST /api/demo/owner/action` | Approve, adjust, request information or take over |

Body validation is strict: 32 KB JSON limit, 4,000-character nonblank customer messages, safe positive final amounts and explicit action tokens. Concurrent mutations while extraction is running return `409 BUSY`; stale owner/quote actions return conflict responses. Missing AI configuration returns 503, extraction failures 502; the client retains its draft and previous state. Raw provider errors and internal owner reasons are not exposed in customer responses.

The router owns one process-local session. It is not tenant isolation, authentication or a distributed lock. Anyone with access to the demo server can access owner routes; keep it local. Switching views/actions refreshes snapshots, not a live subscription.

`GET /api/health` returns `status: "ok"`, `service: "Moving Services Sales Agent"`, `version: "0.1"`. There are no payments, crew allocation or image uploads/analysis. Relative dates, ambiguous same-type item identity, removal services and some additive/clearing updates remain limited or unsupported. Offline checks do not establish live extraction accuracy, latency, cost or commercial impact.

## Verification and extension

Run `npm test`, `npm run eval`, `npm run typecheck`, `npm run build` and `git diff --check` from the root. Test files are explicitly listed in workspace scripts for Windows/Node compatibility. Tests use Node's runner through `tsx`; frontend tests use React DOM and JSDOM, not Vitest.

See the [eval guide](../data/evals/README.md) for fixture authoring, privacy checks, exit codes, unscored constraints and source-quality semantics. [Pricing evidence validation](../server/src/evals/loadPricingEvidence.ts) runs through tests separately from the six pricing eval inputs. Compiled loaders still require repository-level `data/evals`; those JSON files are not bundled into `server/dist`.

When extending the system, preserve extraction/workflow/pricing separation, add a regression for the actual failure, and keep requested dates distinct from scheduling. Production storage, channel adapters and authenticated roles should strengthen these boundaries rather than give the model control of money or lifecycle.
