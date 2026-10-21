# Moving Services Sales Agent

[Try the public demo](https://sales.barshirom.com/) · [Portfolio](https://barshirom.com/) · [Engineering guide](docs/ENGINEERING_GUIDE.md)

A Hebrew RTL sales-workflow demo: customer messages become structured move details, a deterministic pricing recommendation and an owner-approved quote. Customer acceptance means **pending manual coordination**, with no reserved date or crew.

Built by Bar Shirom to make incomplete moving requests reviewable without giving an AI model control over prices or quote approval.

## Start with the customer conversation

1. **Start a customer conversation.** Describe a synthetic move and deliberately send the message. You can load an example message into the editable draft first; loading it does not submit a message or create structured move details.
2. Answer the conversation's relevant questions to build the structured move details.
3. **Switch to the owner view.** Review the pricing recommendation, complete any required price and acknowledgements, and approve the quote.
4. **Accept the quote in the customer view.** Use the explicit acceptance action for the current quote.
5. The accepted quote is **pending manual coordination** outside the demo. No date or crew is reserved.

Use synthetic data only. The application interface is in Hebrew with right-to-left layout; the instructions here describe its actions in English. Sending customer messages can invoke AI extraction. Resetting meaningful progress requires confirmation, and session recovery preserves an unsent draft without replaying messages or approvals.

## Engineering boundaries

- **AI extracts facts.** OpenAI Responses, Structured Outputs, Zod and domain conversion form separate validation boundaries. Known facts are retained; corrections are explicit. Shape validation is not a claim that every extracted fact is accurate.
- **Code calculates recommendations.** Versioned deterministic rules expose a breakdown and unsupported components. Prices and tariffs remain provisional; box/distance rates include engineering assumptions. See the [pricing evidence](data/evals/PRICING_EVIDENCE.md#current-pricing-engine-audit).
- **The owner approves every quote.** Recommendations, final approved amounts, quote versions and acceptance remain separate records. Missing-photo and omitted-cost acknowledgements, scope checks and stale-quote rejection stay enforced.
- **Acceptance is deterministic.** An explicit customer action carries the current quote identity/version. Conditional replies do not approve a quote. Recovery never replays acceptance or owner mutations.
- **Handoff stops automation.** There is no representative inbox, live human chat or resume mechanism. Further messages stay only in the temporary demo session; any follow-up occurs outside the app.

Sessions are temporary and stored in memory; expiry or backend recreation removes their lead and conversation state. AI availability is bounded by shared limits that resetting does not replenish. When AI is unavailable, existing information and drafts remain available, with deterministic quote actions permitted by the current workflow. See [availability and recovery](docs/ENGINEERING_GUIDE.md#guided-interface-and-recovery) and [technical usage controls](docs/DEPLOYMENT.md#traffic-limits-and-ai-usage-cutoff) for details.

## Verification

Offline validation covers workflow and component tests, conversation and pricing evals, strict typechecking and production builds using injected responses and synthetic fixtures. Browser walkthroughs check interactions and layout separately. Neither establishes live AI extraction accuracy.

The latest committed [workflow verification report](docs/DEMO_APPROVAL_RELEASE_20261020.md#verification-on-20-october-2026), dated 20 October 2026, records its scoped checks, browser observations and mobile visual-verification limits.

## Run locally

Requires Node.js 20.18+ and npm 9+. On Windows use `npm.cmd` if PowerShell blocks `npm.ps1`.

```sh
npm install
npm run build
npm run demo:quote --workspace server
```

Open **http://127.0.0.1:3101** and start in the customer conversation. No API key or provider request is needed. The fixture supports the [documented synthetic messages](docs/ENGINEERING_GUIDE.md#offline-demo-walkthrough), not arbitrary free-form extraction. Internal synthetic lead fixtures remain available for automated tests and guarded verification; they are not visitor-facing entry points.

For development with real extraction, follow the [configuration guide](docs/ENGINEERING_GUIDE.md#running-and-configuration). Keys remain server-side. Customer messages reaching the provider boundary can incur charges.

Start the backend in one terminal:

```sh
npm run dev:server
```

Start the frontend in another terminal:

```sh
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

- **Frontend:** React 19, Vite 6 and TypeScript.
- **Backend:** Node.js, Express 5 and npm workspaces.
- **AI and validation:** OpenAI Responses, Structured Outputs and Zod 4.
- **Testing:** Node's test runner, tsx, React DOM, JSDOM and offline evals.
- **Packaging and hosting:** Docker, Docker Compose, Caddy HTTPS, AWS Lightsail and Amazon ECR.

The current demo has no authenticated owner access, durable lead database, photo uploads, WhatsApp, maps, availability checks, booking or scheduling. Browser tabs in one profile share the same temporary session. Supported pricing is provisional, and unsupported work requires owner review. Persistent business records and external integrations are future work.

- [Architecture, workflow and setup](docs/ENGINEERING_GUIDE.md)
- [Local container packaging and security controls](docs/DEPLOYMENT.md)
- [Conversation and pricing evals](data/evals/README.md)
- [Earlier local screenshots](docs/screenshots/README.md), historical synthetic captures rather than current production evidence
