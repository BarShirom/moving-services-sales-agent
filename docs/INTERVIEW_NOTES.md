# Interview notes

Use these as talking points grounded in the current implementation. Present planned production work as future design, and avoid describing the offline suite as a live-model benchmark.

## What problem does the system solve?

Moving leads arrive as incomplete, conversational descriptions. The application collects structured inventory/access facts, identifies missing information and helps an owner turn an explainable recommendation into a reviewed quote. It aims to reduce repeated questions and unpriced scope; commercial benefits are not yet measured.

## Why use an LLM only for extraction?

Language is variable; business decisions need explicit rules. The model proposes structured facts from Hebrew and context. TypeScript code validates and merges them, selects questions, computes prices and controls transitions. The owner owns the commercial decision. An extraction error can still matter, so validation and review are not optional.

## What is Structured Output?

In this implementation, a Zod-defined wire schema becomes the strict response format passed to the OpenAI Responses API. The parsed result is checked and converted into an `ExtractionResult` patch. A schema-valid answer can still be factually wrong; refusal, incomplete output, invalid values and ambiguous item matching require separate handling.

## Why not let GPT calculate the price?

The same facts and rule version should produce the same components, amount and omissions. Code makes the calculation inspectable and testable. Historical evidence is incomplete, so even deterministic results remain provisional and need owner approval. The LLM has no pricing or approval fields in its extraction contract.

## How does state management work?

The Express demo router holds one in-memory session containing the Lead, evaluation/review history and quotes. Known fields use explicit `null` for unknown values; `false` and floor `0` remain meaningful. Extraction runs against detached snapshots, and the router assigns the new state after successful processing. React renders server snapshots and refreshes when switching views; it does not decide prices or acceptance.

## What happens when a customer replies off-script?

Validated facts can update fields other than the question currently asked. Conversation logic acknowledges corrections and newly supplied details, then recomputes requirements. Temporary unavailability remains missing and can defer a question. Narrow date/photo handlers handle specific contextual replies. Ambiguous facts are not guessed; new conditions on a quote trigger review rather than blind acceptance.

## How does the Requirements Engine work?

It derives requirements from current facts and item/context policies instead of storing a stale missing-fields list. Requirements distinguish pricing collection from review information and carry statuses such as missing or satisfied. The selector asks relevant missing questions; unsupported item tariffs with no customer question must not hide an askable photo request. An unavailable photo is not a received photo.

## How is pricing explainable?

The versioned engine returns each priced component, its range, source and calculation basis, plus assumptions, omitted components and review reasons. Midpoints form recommendations; confidence is a deduction-based heuristic, not a probability. Refrigerator/washer bands have historical references, while box and numeric-distance tariffs are explicit engineering assumptions. Bundle-level closed prices do not imply per-item tariffs.

## How does owner approval work?

Complete, current recommendations still require an explicit action. Partial/cannot-price cases require a positive final owner total and scope/omitted-cost confirmation; missing photos need acknowledgement. These guards run on the server, including direct API requests. The final customer quote is a separate versioned scope/amount record; the engine evaluation is not rewritten.

## How are stale recommendations prevented?

Owner mutations include the Lead ID and current revision; finalization also references the pricing evaluation. Pricing-input fingerprints detect changed calculation facts. Quote acceptance checks current quote identity/version, the actual active question, owner approval and a commercial-scope fingerprint. Material changes invalidate an unaccepted quote or send accepted work to review while retaining the accepted snapshot. Duplicate acceptance does not create another acceptance record or summary.

## How is acceptance different from scheduling?

Only a clear answer to the current quote question can accept that quote. “כן” to an elevator question is ordinary collection. `WON` means the customer accepted the commercial offer, and coordination remains pending. No availability, reserved date, crew, payment or completed-job claim follows from that transition.

## Why use evals?

They make regressions visible beyond a plausible chat response. The suite checks preserved facts, missing questions, failure atomicity, pricing omissions and quote identity. The 2026-10-07 baseline is 419 passing tests and 24 passing conversation cases, with two future-service cases not run. The six pricing cases are incomplete whole-job comparisons; none yields a full accuracy score. Injected extraction does not measure live Hebrew understanding, and some natural-language constraints still need manual review.

## What would you change for production?

Add authenticated roles and tenant isolation, durable state/audit storage, transactional version checks, retries with idempotency, observability and data-retention controls. Validate pricing with the owner and real outcomes. Add separately authorized live extraction evaluations and adversarial cases. Integrations should use explicit interfaces; no model or feedback event should automatically update tariffs.

## Why no database yet?

The current objective is a reproducible local workflow, so one in-memory session keeps setup and inspection simple. It loses data on restart, shares state across tabs and cannot serve as a multi-user production store. A database milestone should preserve the existing domain boundaries and add durable concurrency/audit guarantees rather than make database documents the workflow engine.

## Where would Python fit later?

Potentially in offline evidence analysis, experiment notebooks, error analysis or evaluation reporting. It is not currently a dependency and is not needed to orchestrate this TypeScript workflow. Add it only when a concrete analysis task benefits from its tools; keep any proposed tariff update versioned and human-approved.

## How would WhatsApp integration work?

A future channel adapter would validate provider webhooks, map a conversation to the correct Lead, deduplicate events and pass messages into the existing application boundary. An outbound queue would send only approved responses/quotes and track delivery independently of acceptance. That requires secure credentials, authenticated owner actions, durable state and provider-specific policy review; none is implemented here.

## How would production deployment differ from demo deployment?

The demo binds to loopback and has no authentication; the offline fixture serves a built client with exact synthetic messages. Production would require HTTPS, controlled ingress, authenticated/authorized endpoints, secret management, persistent storage, health/observability checks and a release/rollback process. Multiple instances need shared concurrency control instead of the current process-local busy flag. No cloud deployment, Docker or scheduling is part of this milestone.

## Useful code to show

- [Extraction boundary](../server/src/integrations/openai/extractMessageWithAI.ts) and [conversion](../server/src/integrations/openai/convertExtraction.ts)
- [Conversation orchestration](../server/src/domain/conversation/processCustomerMessage.ts) and [requirements](../server/src/domain/requirements/evaluateRequirements.ts)
- [Deterministic calculator](../server/src/domain/pricing/calculatePrice.ts) and [evidence audit](../data/evals/PRICING_EVIDENCE.md)
- [Owner/quote workflow](../server/src/demo/ownerWorkflow.ts) and [HTTP full-flow regression](../server/tests/quoteDemo.test.ts)
- [Offline eval runner](../server/src/evals/runEvals.ts)
