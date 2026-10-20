# Moving Services Sales Agent

[Try the public demo](https://sales.barshirom.com/) · [Portfolio](https://barshirom.com/) · [Engineering guide](docs/ENGINEERING_GUIDE.md)

A Hebrew RTL sales-workflow demo: customer messages become structured move details, a deterministic pricing recommendation and an owner-approved quote. Customer acceptance means **pending manual coordination**, with no reserved date or crew.

Built by Bar Shirom to explore a clear separation between AI extraction, business rules and human decisions. Rick & GO supplied the moving-business context; this repository does not claim ongoing commercial use or measured business results.

## Try the prepared lead

1. Choose **טעינת פנייה מוכנה** to load an existing synthetic lead into owner review.
2. Review the deterministic recommendation and acknowledge the missing-photo condition before approving the quote.
3. Switch directly to the customer view and select **אישור ההצעה**. Approval uses the current quote identity/version through a deterministic path, without extraction.
4. The accepted quote remains **ממתין לתיאום**. Coordination happens outside the demo.

Use synthetic data only. The prepared scenario needs an available temporary session, but no provider request. Replacing meaningful progress requires confirmation. If a session expires, explicit recovery clears stale quote/review state and preserves the unsent draft without replaying messages or approvals.

## Engineering boundaries

- **AI extracts facts.** OpenAI Responses, Structured Outputs, Zod and domain conversion form separate validation boundaries. Known facts are retained; corrections are explicit. Shape validation is not a claim that every extracted fact is accurate.
- **Code calculates recommendations.** Versioned deterministic rules expose a breakdown and unsupported components. Prices and tariffs remain provisional; box/distance rates include engineering assumptions. See the [pricing evidence](data/evals/PRICING_EVIDENCE.md#current-pricing-engine-audit).
- **The owner approves every quote.** Recommendations, final approved amounts, quote versions and acceptance remain separate records. Missing-photo and omitted-cost acknowledgements, scope checks and stale-quote rejection stay enforced.
- **Acceptance is deterministic.** An explicit customer action carries the current quote identity/version. Conditional replies do not approve a quote. Recovery never replays acceptance or owner mutations.
- **Handoff stops automation.** There is no representative inbox, live human chat or resume mechanism. Further messages stay only in the temporary demo session; any follow-up occurs outside the app.

The deployed app serves HTTPS with isolated cookie sessions, request limits and bounded AI admission. Customer/lead sessions remain in memory and disappear on expiry or backend recreation. The public beta's separate cumulative AI ledger durably preserves consumed attempts and conservative reservations across backend recreation. It does not replenish automatically or guarantee the provider's billing total.

Local defaults use process-local request/token counters; they are distinct from the deployed cumulative public-beta controls. The public demo may stop AI admission when its shared allowance or fixed expiry is reached. The prepared-lead workflow remains usable when a session is available.

## Verification

Offline tests use injected responses and synthetic fixtures. Conversation evals, pricing evidence, component tests and browser walkthroughs cover different boundaries; they do not establish live Hebrew extraction accuracy or commercial impact.

The previously deployed source checkpoint `5aa84bf1262dd03cc5c9498367024b0c73095384` passed **585 server and 64 frontend tests** in its exact committed Docker verification stage on 20 October 2026. Unrelated pending-work tests are excluded from those release counts. The [current change verification](docs/DEMO_APPROVAL_RELEASE_20261020.md) records this release's scoped checks and visual-verification limits.

## Run locally

Requires Node.js 20.18+ and npm 9+. On Windows use `npm.cmd` if PowerShell blocks `npm.ps1`.

```sh
npm install
npm run build
npm run demo:quote --workspace server
```

Open **http://127.0.0.1:3101**. No API key or provider request is needed. The fixture supports the prepared lead and [documented synthetic messages](docs/ENGINEERING_GUIDE.md#offline-demo-walkthrough), not arbitrary free-form extraction.

For development with real extraction, follow the [configuration guide](docs/ENGINEERING_GUIDE.md#running-and-configuration). Keys remain server-side. Customer messages reaching the provider boundary can incur charges.

```sh
npm run dev:server
# In another terminal:
npm run dev:client
```

Validate with:

```sh
npm test
npm run eval
npm run typecheck
npm run build
git diff --check
```

## Stack and limitations

React 19, Vite 6, TypeScript, Node.js/Express 5, OpenAI Responses and Zod 4; npm workspaces, Node's test runner and JSDOM.

The current demo has no authenticated owner access, durable lead database, photo uploads, WhatsApp, maps, availability checks, booking or scheduling. Browser tabs in one profile share the same temporary session. Supported pricing is provisional, and unsupported work requires owner review. Persistent business records and external integrations are future work.

- [Architecture, workflow and setup](docs/ENGINEERING_GUIDE.md)
- [Local container packaging and security controls](docs/DEPLOYMENT.md)
- [Conversation and pricing evals](data/evals/README.md)
- [Earlier local screenshots](docs/screenshots/README.md), historical synthetic captures rather than current production evidence
