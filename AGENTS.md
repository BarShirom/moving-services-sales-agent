# Rick & GO Sales Agent

## Purpose
Build a real-world AI engineering portfolio project for Rick & GO, a moving business. Eventually support lead intake, information collection, deterministic quote pricing, human approval, and conversion of won leads into operations records.

## Scope
The current milestone is only a React/Vite/TypeScript client and Node.js/Express/TypeScript server with GET /api/health. Do not implement lead models, extraction, pricing, or authentication in this milestone. WhatsApp, MongoDB, and OpenAI are not part of the current milestone.

The planned v0.1 is a local conversation simulator supporting refrigerator workflows and demo pricing only. Future core move/item models must remain generic enough for additional item types; no models are needed in this scaffold.

## Architecture Principles
- Keep client and server separate, with a small modular backend rather than microservices.
- Keep Express app creation separate from the listening server.
- Use TypeScript with strict checking.
- Future lead/conversation state must be structured.
- Never ask for information already provided. Retain known facts and ask only for relevant missing information; clarify ambiguity when necessary.
- Keep extraction, workflow decisions, and pricing separate.
- The LLM must not determine final prices.
- Pricing must remain deterministic, implemented by a separate pricing engine.
- Human approval is required for all v0.1 quotes.
- Eventually retain suggested prices, human corrections, sent quotes, lead outcomes, and final prices.
- Keep changes scoped and explain important technical decisions.

## Commands
Run npm install from the root. Use npm run typecheck and npm run build to validate changes. Use npm run dev:server and npm run dev:client in separate terminals for development.
