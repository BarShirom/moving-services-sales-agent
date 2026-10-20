# Explicit customer approval and demo clarity

This scoped change follows deployed checkpoint `5aa84bf1262dd03cc5c9498367024b0c73095384`. It keeps the same pricing, extraction boundary, quote protections and cumulative public-beta accounting.

The visible “איך זה עובד?” section separates AI extraction, deterministic recommendations and owner approval. Contextual guidance keeps synthetic-data, session, budget and manual-coordination boundaries near the relevant controls. Authored interface strings and page metadata use natural Hebrew without em dashes; technical punctuation recognition and historical evidence are preserved.

A customer quote summary displays the owner-approved amount, approved move scope and status. Its deliberate “אישור ההצעה” action sends the existing deterministic acceptance phrase with the current quote ID/version. It does not call extraction, submit a separate draft or run on render. Exact natural-language approval variants are recognized narrowly; conditional or changed-scope replies retain their existing protections. Session recovery removes stale quote/review bindings, preserves the unsent draft and requires explicit GET recovery without replay.

Handoff wording describes stopped automation, temporary-session storage and manual handling outside the demo. No representative inbox, forwarding service, human chat or resume mechanism was added. Replacement confirmation and cancellation preserve meaningful progress. The owner can switch directly to the customer view after sending a quote.

Verification uses this isolated release worktree and its exact source, with injected provider responses or the guarded no-key fixture. Unrelated pending readiness tests in the primary worktree are excluded. Check results and browser observations are recorded before the source commit; deployment must separately verify the resulting committed artifacts. No provider request is part of these checks.

## Verification on 20 October 2026

- `npm test`: 603 server and 74 frontend tests passed, with zero failures. The added cases cover exact approval phrases, current/stale quote identity/version, conditional replies, idempotency, required acknowledgements, no extraction for prepared-scenario acceptance, truthful handoff, Retry-After, zero/false values and explicit recovery without replay.
- `npm run eval`: 24 conversation cases passed, zero failed, two unsupported future-service cases were not run; six pricing cases evaluated with zero invalid. These results cover implemented checks rather than live extraction accuracy or complete whole-job pricing accuracy.
- `npm run typecheck`, `npm run build` and `git diff --check` passed.
- A new guarded local Chrome walkthrough verified the prepared ILS900 lead, missing-photo acknowledgement, owner approval, direct customer navigation, explicit customer approval with a separately preserved draft, replacement cancellation and accurate negotiation handoff. Provider networking was blocked and the extractor was injected.
- Real-browser interactions at a measured 390 by 844 CSS-pixel viewport verified replacement confirmation and narrow owner forms with long synthetic input and no horizontal document overflow. The mobile screenshot was partially rendered and is not accepted as visual proof. New desktop captures were inspected; a complete mobile visual review remains unavailable.
- Restarting only the verified guarded local fixture reproduced a cookie-issuing owner GET with a replacement lead. Recovery cleared quote/review history, kept the 880-character draft, required explicit GET recovery and restored draft focus with zero messages or quotes. No acceptance or mutation was replayed.

The release must preserve the same durable cumulative beta ledger, consumed reservations, fixed expiry, provider configuration, Caddy/TLS and rollback evidence. A successful deterministic demo does not establish always-on AI readiness.
