# Moving Services Sales Agent

## Purpose
Build Moving Services Sales Agent, a real-world AI engineering portfolio project with Rick & GO, a moving business, as the current pilot. The demo supports lead intake, information collection, deterministic pricing recommendations, human approval, customer acceptance and a manual-coordination summary. Durable operations records remain future work.

## Scope
The current v0.1 is a local, single-session React/Vite/TypeScript and Node.js/Express/TypeScript demo. It includes structured Lead state, deterministic and OpenAI extraction boundaries, requirements, provisional deterministic pricing, owner review, versioned quotes, contextual customer acceptance and offline evals. Core move/item models remain generic enough for additional item types.

Every quote requires human approval. Acceptance means commercial agreement awaiting manual coordination, not a booked move. Pricing evidence and engineering assumptions must remain distinguishable. Preserve existing behavior and tests during portfolio/documentation work; do not add major features, change tariffs or call live OpenAI unless explicitly requested.

Authentication, persistent storage, WhatsApp, maps integration, cloud deployment and scheduling are future milestones, not current capabilities. Use the opt-in offline quote fixture for reproducible demonstrations. See README.md and docs/ENGINEERING_GUIDE.md for current commands and boundaries.

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
- Preserve suggested prices, owner decisions, sent quotes and accepted amounts separately in the demo; durable outcome/final-price learning remains future work.
- Keep changes scoped and explain important technical decisions.

## Commands
Run npm install from the root. Validate with npm test, npm run eval, npm run typecheck, npm run build and git diff --check. Use npm run dev:server and npm run dev:client in separate terminals for development. For a no-key offline demonstration, build first and run npm run demo:quote --workspace server.
