# Moving Services Sales Agent

## Purpose
Build Moving Services Sales Agent, an AI engineering portfolio project informed by historical moving-business references. The demo supports lead intake, information collection, deterministic pricing recommendations, human approval, customer acceptance and a manual-coordination summary. It does not represent an active business pilot. Durable business operations records remain future work.

## Scope
The current v0.1 uses React/Vite/TypeScript and Node.js/Express/TypeScript. Local development binds to loopback; the public demo is deployed on AWS Lightsail with Docker, Caddy HTTPS and private Amazon ECR images. Each browser cookie jar has a temporary in-memory session, shared by its tabs. The application includes structured Lead state, deterministic and OpenAI extraction boundaries, requirements, provisional deterministic pricing, owner review, versioned quotes, contextual customer acceptance and offline evals.

Every quote requires human approval. Acceptance means commercial agreement awaiting manual coordination, not a booked move. Pricing evidence and engineering assumptions must remain distinguishable. Preserve existing behavior and tests during portfolio/documentation work; do not add major features, change tariffs or call live OpenAI unless explicitly requested.

Authentication, a durable lead/quote database, WhatsApp, maps integration and scheduling remain future work. The deployed AI admission ledger is durable cost-control state, not business persistence. Preserve its cumulative reservations, fixed expiry and existing deployment controls across releases; session reset or container replacement must not replenish the allowance. Local defaults leave the AI gate closed even when a key is present. Use the opt-in offline quote fixture for reproducible demonstrations. See README.md, docs/ENGINEERING_GUIDE.md and docs/EXTENDING.md for commands, architecture and extension boundaries. Dated release/security reports remain historical evidence.

## Architecture Principles
- Keep client and server separate, with a small modular backend rather than microservices.
- Keep Express app creation separate from the listening server.
- Use TypeScript with strict checking.
- Keep lead/conversation state structured.
- Never ask for information already provided. Retain known facts and ask only for relevant missing information; clarify ambiguity when necessary.
- Keep extraction, workflow decisions, and pricing separate.
- The LLM must not determine final prices.
- Pricing must remain deterministic, implemented by a separate pricing engine.
- Human approval is required for all v0.1 quotes.
- Preserve suggested prices, owner decisions, sent quotes and accepted amounts separately in each temporary session; durable outcome/final-price learning remains future work.
- Share item identifiers without conflating recognition, collection, transport, service, appliance, box and stair policies. Known item policies and lifecycle presentation must be exhaustive.
- Keep recovery explicit: clear stale snapshots and quote bindings, retain an unsent draft, and never replay messages, approvals or other mutations automatically.
- Keep changes scoped and explain important technical decisions.

## Commands
Run npm install from the root. Validate with npm test, npm run eval, npm run typecheck, npm run build and git diff --check. Use npm.cmd on Windows if PowerShell blocks npm.ps1. Use npm run dev:server and npm run dev:client in separate terminals for development. For a no-key offline demonstration, build first and run npm run demo:quote --workspace server. Register new test files explicitly in the relevant workspace package.json test command; tests use injected responses and synthetic fixtures, with no live provider calls.
