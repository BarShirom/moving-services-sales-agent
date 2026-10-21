# Moving Services Sales Agent

[Public demo](https://sales.barshirom.com/) · [Portfolio](https://barshirom.com/) · [Engineering guide](docs/ENGINEERING_GUIDE.md) · [Extension guide](docs/EXTENDING.md)

A Hebrew RTL sales-workflow demo built by Bar Shirom. Customer messages become structured move details, deterministic pricing recommendations and owner-approved quotes. Acceptance means **pending manual coordination**, with no reserved date or crew. Historical moving-business references inform the provisional rules; there is no active business pilot.

## Try the workflow

1. Start in the customer conversation with synthetic move details. Loading the example only fills an editable draft; submit it deliberately to begin collection.
2. Answer the relevant missing questions, then switch to the owner view to review pricing, complete required acknowledgements and approve a final quote.
3. Switch back to the customer view and explicitly accept the current quote. Coordination remains manual outside the demo.

Sending messages can invoke AI extraction when the operator-controlled allowance is available. Loading an example, switching views and accepting an unchanged quote do not call the provider. Reset requires confirmation when meaningful progress exists. Recovery preserves an unsent draft and never replays messages or approvals.

## Run offline

Requires Node.js 20.18+ and npm 9+. On Windows use `npm.cmd` if PowerShell blocks `npm.ps1`.

```sh
npm install
npm run build
npm run demo:quote --workspace server
```

Open **http://127.0.0.1:3101**. The fixture supports the [documented synthetic messages](docs/ENGINEERING_GUIDE.md#offline-demo-walkthrough), with no API key or provider requests. Internal prepared-lead fixtures support automated verification; the public interface starts with a conversation.

For development, run `npm run dev:server` and `npm run dev:client` in separate terminals. Local defaults leave the AI gate closed. A provider key alone does not enable extraction; see [configuration and admission controls](docs/ENGINEERING_GUIDE.md#running-and-configuration).

## Boundaries

- **AI extracts facts.** Structured Outputs, Zod and domain conversion restrict proposed updates. Schema validation does not prove factual accuracy.
- **Code prices the work.** Versioned rules expose calculated components and omissions. All tariffs remain provisional; [pricing evidence and engineering assumptions](data/evals/PRICING_EVIDENCE.md#current-pricing-engine-audit) are recorded separately.
- **Owners approve every quote.** Recommendations, owner decisions, quote versions and accepted amounts stay separate. Scope, freshness and missing-photo safeguards run on the server.
- **Acceptance is deterministic.** The explicit action carries the current quote ID/version. Changed or conditional replies retain review protections. Handoff stops automation; follow-up occurs outside the app.

The public demo runs on AWS Lightsail with Docker, Caddy HTTPS and private Amazon ECR images. Browser sessions remain in memory: expiry or backend replacement removes leads, conversations and quotes. The separate durable AI ledger preserves cumulative reservations and fixed expiry across deployments. Resetting a session does not restore the allowance. See [local versus deployed controls](docs/ENGINEERING_GUIDE.md#local-and-deployed-runtime).

There is no authenticated owner access, durable lead database, photo upload, WhatsApp, maps, availability check, booking or scheduling. Tabs in one browser profile share a session. Multiple items of the same type have [identity limitations](docs/EXTENDING.md#item-identity-limitation).

## Verify

```sh
npm test
npm run eval
npm run typecheck
npm run build
git diff --check
```

Tests and evals use synthetic fixtures and injected responses with no live provider calls. Browser interaction checks and screenshot inspection are separate evidence; offline checks do not establish live extraction or whole-job pricing accuracy. Dated [release reports](docs/DEMO_APPROVAL_RELEASE_20261020.md) retain their original scope and results.

The stack is React 19, Vite 6, strict TypeScript, Express 5, OpenAI Responses, Zod 4, Node's test runner, React DOM and JSDOM. See the [engineering guide](docs/ENGINEERING_GUIDE.md) for architecture, API and setup, the [extension guide](docs/EXTENDING.md) for safe changes, [deployment notes](docs/DEPLOYMENT.md) for runtime controls, and the [eval guide](data/evals/README.md) for evidence limits.
