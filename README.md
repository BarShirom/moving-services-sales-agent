# Moving Services Sales Agent

Moving Services Sales Agent is the system/product being developed. Rick & GO, a moving business, is the current pilot customer and real-world implementation. The project contains the frontend/backend scaffold, a health endpoint, structured lead state, requirements evaluation, and deterministic and OpenAI message extraction with validated lead updates.

## Requirements

Node.js 20.18+ and npm 9+. The scaffold uses Vite 6 for compatibility with Node.js 20.18.

## Setup and Development

From the project root:

```sh
npm install
npm run dev:server
```

In a second terminal:

```sh
npm run dev:client
```

Client: http://localhost:5173 (Vite selects another port if occupied).
Backend: http://localhost:3001. Set PORT to change the backend port.

```sh
curl http://localhost:3001/api/health
```

Expected response (the existing health API service identifier is preserved for compatibility):

```json
{"status":"ok","service":"Rick & GO Sales Agent","version":"0.1"}
```

On Windows PowerShell, use npm.cmd if script execution policy blocks npm.ps1.

## Validation and Production Build

```sh
npm run typecheck
npm test
npm run build
npm start
```

The client builds to client/dist and the server to server/dist. npm start runs the compiled backend only; it does not serve the client. For a local client build preview, run npm run preview --workspace client.

## Structure and Decisions

- client/: Hebrew RTL React/Vite demo, structured state cards, and backend conversation responses.
- server/src/app.ts: Express app and health route, without opening a port.
- server/src/server.ts: process entry point and HTTP listener.
- server/src/domain/lead.ts: plain TypeScript domain types with explicit nulls for unknown collected values.
- server/src/domain/createLead.ts: creates independent empty leads with UUIDs and matching UTC timestamps.
- server/tests/lead.test.ts: domain default and serialization tests using Node's built-in runner via tsx. Tests are typechecked separately and excluded from production output.
- Root npm workspaces: one install and lockfile for both packages.
- Separate TypeScript configurations: browser code uses bundler resolution; backend code uses Node ESM resolution.

## Planned v0.1

A local conversation simulator for refrigerator moves and deterministic demo pricing. Future move/item models should support additional item types. The workflow must preserve provided information, ask only relevant missing questions, and require human approval for every v0.1 quote. An LLM must never determine final prices.

Pricing, MongoDB, WhatsApp, authentication, and production channel integration are intentionally not implemented. OpenAI extraction is available through the developer-only workflow described below.

## Domain Conventions

Collected fields are required properties whose unknown values are null, not undefined. For elevator and assembly/disassembly needs, null means unknown, false means confirmed no, and true means confirmed yes. Floor 0 is a known ground floor. Empty items/messages arrays mean no entries recorded yet; they do not establish that a move has no items.

Item types remain strings to support future moving items without refrigerator-specific fields. Dimensions are individually nullable numbers in centimeters. Requested date/time use local YYYY-MM-DD and HH:mm strings; record timestamps use ISO 8601 UTC strings. These formats and units are domain conventions. The AI extraction boundary validates them before producing a patch; direct domain construction remains caller-controlled.

Lead statuses and message senders are string unions. Ordinary field edits do not automatically update updatedAt. The readiness helper updates it when collection readiness changes. Missing information is derived from current state, never stored as a missingFields array.

## Requirements Engine (Milestone 3)

- server/src/domain/createMoveItem.ts creates items with explicit unknown defaults and independent dimensions.
- server/src/domain/requirements/types.ts defines requirement IDs, per-item context, results, and question references.
- server/src/domain/requirements/evaluateRequirements.ts derives requirements and offers updateLeadReadiness.
- server/src/domain/requirements/nextQuestion.ts selects at most two unanswered questions from one location or item in natural Hebrew.
- server/tests/requirements.test.ts covers collection, conditional rules, photos, quantities, readiness, and question selection. npm test runs all test files.

evaluateRequirements(lead, context?) returns all requirements, missingRequired, pendingReview, readyForPricing, and nextQuestion without changing the lead. Each result has a typed ID, optional item index, PRICING/REVIEW stage, MISSING/SATISFIED/NOT_APPLICABLE status, and a conditional flag. Item indices refer to the current evaluation only; reevaluate after reordering items. Derived results should not be persisted on Lead.

The next question prioritizes items, pickup, dropoff, date, then item details. Within the selected group it includes only missing fields. Pending photos are requested after pricing questions are complete. A requirement needing internal human policy (item.support) has no customer question, so nextQuestion can be null while readiness is false.

### Item and Context Assumptions

Supported requirement profiles are refrigerator and box, including box-only moves. Refrigerator readiness requires an item type, sufficient size information, both cities/addresses/floors/elevator answers, and a requested date. A single refrigerator's unknown quantity does not block readiness or get silently changed to 1. Boxes always require a positive integer quantity; null is unknown and 0 is invalid, not an unknown default. Ordinary boxes do not require dimensions.

sizeCategory is an explicit, accepted size/type classification entered by a caller or human. A nonblank classification or three positive dimensions supplies sufficient refrigerator size information. Free-text description is preserved but not interpreted. Actual business size categories still need agreement before pricing is implemented. Partial dimensions without a size category trigger questions for only the missing measurements; with neither, the engine asks for size/type information first.

RequirementContext can mark quantity, exact dimensions, disassembly, or assembly as relevant for a specific item, and can require special access notes. These flags are caller-provided context, not inferred from text or from elevator=false. Use the same context for evaluation and readiness updates. Exact-dimension context overrides sufficient size categories when an access issue needs measurements. No distance, worker count, or time-estimate questions are generated; distance will be derived from addresses later. Requested time is optional at this stage.

Wardrobe and bed profiles demonstrate size and assembly conditions, and washing_machine demonstrates optional dimensions. These and unknown item types have a blocking item.support requirement until their policies are approved and implemented; they cannot silently pass as supported moves. No prices are calculated.

### Photos and Readiness

MoveItem.photoStatus is REQUIRED, RECEIVED, NOT_AVAILABLE, or NOT_APPLICABLE. NOT_AVAILABLE records that the customer cannot provide a requested photo now; it remains pending human review but has no repeat customer question. The item factory defaults refrigerators to REQUIRED and other/unknown types to NOT_APPLICABLE; callers changing an item's type should also reassess its photo policy. REQUIRED means the photo is still pending. RECEIVED is a caller assertion of receipt, not an uploaded file or an assessment of image quality. No uploads, storage references, or image analysis are implemented.

Photos are review requirements and do not block initial pricing readiness. READY_FOR_PRICING requires every applicable PRICING requirement to be satisfied. It is not quote approval: all v0.1 quotes still require human approval. updateLeadReadiness returns a lead with a changed status/timestamp only when moving between COLLECTING_INFORMATION and READY_FOR_PRICING; it can revert readiness after information is removed, and preserves all later lifecycle statuses. It does not send messages or quotes.

## Deterministic Extraction (Milestone 4)

This is deliberately limited pattern matching, not general Hebrew NLP. It proves extraction, safe state updates, history, requirements, and question selection independently of the AI understanding layer. This deterministic extractor uses no external service and remains available for offline use and regression tests.

- extraction/types.ts defines partial patches. Missing properties mean no update; extracted values never use null. The patch contains no Lead status, history, or timestamps.
- extraction/patterns.ts centralizes demo cities, item names, refrigerator sizes, and floor words.
- extraction/extractMessage.ts extracts supported facts without accessing or changing a Lead.
- extraction/mergeExtraction.ts applies only explicit fields, merges nested locations, and retains unrelated values including false and 0. It returns a new Lead and unappliedItems for ambiguous item matches. It does not update history or timestamps.
- conversation/processCustomerMessage.ts orchestrates extraction, merge, appending one CUSTOMER message with its original text/UUID/UTC timestamp, readiness updates, and requirements evaluation. It returns lead, extraction, unappliedItems, requirements, nextQuestion, and responseText. Optional RequirementContext is passed through consistently. Generated questions are not appended to history.

These modules live under server/src/domain/. Tests live in server/tests/extraction.test.ts, mergeExtraction.test.ts, and conversation.test.ts. The explicit test-file list in server/package.json is compatible with Node 20 on Windows; add future test files there.

### Supported Patterns

| Input | Extracted update |
| --- | --- |
| צריך להעביר מקרר מרמת גן לתל אביב | refrigerator; pickup Ramat Gan; dropoff Tel Aviv |
| איסוף קומה 2 בלי מעלית | pickup floor 2, elevator false |
| פריקה קומה 3 עם מעלית | dropoff floor 3, elevator true |
| המקרר גדול | existing refrigerator sizeCategory LARGE |
| יש גם ארגזים | box item, no quantity update |
| יש 20 ארגזים | box quantity 20 |
| בתאריך 2026-10-01 | requestedDate 2026-10-01 |

Item names: מקרר, ארגז/ארגזים, מכונת כביסה, ארון, מיטה. Recognition does not expand pricing support: wardrobe, bed, and washing_machine still have the existing unsupported-policy requirement.

Cities: תל אביב, רמת גן, גבעתיים, בת ים, חולון. Unlabelled מ-city / ל-city phrases indicate pickup/dropoff. Explicit איסוף / פריקה labels take precedence for their side and accept city names with or without a prefix. Floors and elevators require these explicit labels within the same punctuation-delimited clause. Bare floor/elevator answers are not assigned using previous questions. Separate labels can appear in the same clause; punctuation ends their context.

Floors: integer digits, קומה ראשונה, קומה שנייה/שניה, קומה שלישית, קומת קרקע, and קומה 0. Elevator phrases: עם/יש מעלית and בלי/אין מעלית. Box quantities: positive integer digits immediately before the item, including יש 10 ארגזים and בערך 15 ארגזים. Invalid, fractional, or conflicting counts do not update a known quantity.

Refrigerator size must immediately follow the item name: קטן -> SMALL, רגיל -> REGULAR, גדול -> LARGE, 4 דלתות / ארבע דלתות -> FOUR_DOOR. These are demo classifications, not pricing rules. Dates support only validated YYYY-MM-DD calendar dates. No missing year is inferred; DD/MM, DD.MM, relative dates, and date ranges are unsupported.

### Merge and Limits

The extractor emits at most one update per supported item type per message. Merging updates the sole existing matching type or appends a new item using createMoveItem defaults. Repeated mentions do not create duplicates or reset unknown/known fields. A new explicit quantity or size replaces the old value; the merge never adds counts together. Additive counts (such as עוד 5 ארגזים), bounds, and numbers with separators do not supply a quantity update. If multiple existing items share that type, the update appears in unappliedItems and none is chosen. Unknown-type placeholders are preserved rather than identified by guessing.

Conflicting candidates for one field in a message omit that field. Common uncertainty, alternative, negation, and question markers cause a clause to be skipped. This is a conservative guard, not comprehensive negation or intent understanding. Unsupported wording can be missed, and recognition of a substring is not proof of general comprehension. Use explicit short statements in this simulator.

Addresses, dimensions, service needs, photos, requested times, item removal, additive quantities, pronouns, arbitrary Hebrew number words, and conversation-context answers are not extracted. Keep unlabelled routes separate from labeled location clauses; mixed routes within a single label are not fully supported, and opposite-direction prefixes cannot assign a city to the wrong side. LocationPatch supports address updates supplied by a caller, but no address parser exists. A full readiness demo must start with addresses supplied structurally. Unsupported messages still enter history with no invented field updates. The React demo uses the separate AI workflow described below.

## OpenAI Structured Extraction (Milestone 5)

Both extractors return the same `ExtractionResult`. `extractMessage(text)` remains synchronous,
local pattern matching; `extractMessageWithAI({ lead, text, lastQuestion? })` handles natural
language and contextual replies through the official OpenAI Node SDK. Keeping both provides an
offline baseline, reproducible business-logic tests, and an independently replaceable AI boundary.
There is no automatic fallback from AI to deterministic extraction.

### Setup and model

From the root, run `npm install`. Copy `.env.example` to `.env` and set `OPENAI_API_KEY` there,
or supply it as an environment variable. `.env` and `.env.*` are already Git-ignored, with
`.env.example` explicitly allowed. Never put the key in the client or a `VITE_` variable.

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Required only when invoking the real AI extractor. |
| `OPENAI_MODEL` | Optional model override; blank uses the centralized default. |

The default is `gpt-5.4-nano`, configured only in `server/src/config/openai.ts`. It supports
Responses and Structured Outputs and is designed for fast, cost-sensitive extraction tasks.
See the [official model documentation](https://developers.openai.com/api/docs/models/gpt-5.4-nano).
This is an initial model choice, not a measured Hebrew-accuracy or latency benchmark. An override
must support Responses with strict Structured Outputs. SDK 6.x preserves this project's Node.js
20.18 compatibility; SDK 7 requires Node.js 22. Zod supplies schema generation and runtime validation.

Configuration is lazy: importing the integration or running the health server never requires a
key. Real requests have a 30-second timeout, zero SDK retries, and no model fallback. The demo
loads the root `.env` using Node's `loadEnvFile`; existing environment variables take precedence.
Other application callers should supply environment variables themselves.

### Manual AI demo

With a real key configured, run from the project root:

```sh
npm run demo:ai
npm run demo:ai -- "צריך להעביר מקרר גדול מרמת גן לתל אביב. האיסוף מביאליק 20, קומה 2 בלי מעלית. יש גם בערך 15 ארגזים."
```

The default message is that same refrigerator/boxes example. The command prints the validated
extraction, updated Lead, missing requirements, and next question. It makes one real API request;
it is separate from `npm test`. It does not persist data or send a quote. On failure it prints a
short error code/message and exits unsuccessfully. The extraction integration also powers the local React demo described below.

### Schema and validation

The pipeline is:

```text
latest message + bounded context
  -> Responses API / strict JSON Schema
  -> SDK Zod parsing -> domain validation/conversion
  -> ExtractionResult -> mergeExtraction()
  -> deterministic readiness/requirements -> next question
```

`server/src/integrations/openai/schema.ts` defines the Zod wire schema and uses the SDK's
`zodTextFormat` with `responses.parse()`. Every object forbids additional properties. All schema
properties are required, while nested unions express a safe partial update:

```json
{"action":"keep"}
{"action":"set","value":false}
{"action":"correct","value":0}
```

`keep` has no value and becomes an omitted patch property. `set` fills an unknown field or
repeats an explicitly provided known value. `correct` represents an explicit customer change.
The converter rejects a `set` that would change a known value. Neither null nor placeholder
values represent missing updates; `false` and floor `0` survive conversion and merge.
The model still has to recognize the customer's intent correctly: schema validation cannot prove
that a fact or correction was actually communicated.

`convertExtraction.ts` validates the complete response before any merge: supported item types,
refrigerator-only size enums, positive safe-integer quantities, finite positive dimensions,
safe-integer floors, nonblank text, real calendar dates (`YYYY-MM-DD`, including leap-year checks),
and local 24-hour times (`HH:mm`). Invalid data rejects the entire extraction. Duplicate item-type
patches and unexpected fields are rejected. The output cannot contain prices, status, approval,
photo receipt, history, timestamps, or arbitrary workflow fields.

The existing domain patch and pure `mergeExtraction()` now also support partial dimensions,
assembly/disassembly booleans, requested time, and special access notes. Unrelated fields and
individual known dimensions survive updates. Item matching retains the existing type-based policy:
a sole matching item is updated, a new type is appended, and multiple matching items are returned
as `unappliedItems` without selecting one. The deterministic extractor is unchanged; the requirements engine additionally handles unavailable photos without repeating the request. Recognition of wardrobe, bed, and washing_machine does not approve their pricing policies.

### Context and workflow

`context.ts` sends a detached copy of the current Lead's `moveDetails`, up to six recent messages,
the latest customer message, an explicit optional `referenceDate`, and an optional `lastQuestion` containing question text and requirement
references. Full Lead history, lifecycle status, IDs, and timestamps are excluded. The structured
Lead stays the source of truth; history is only used to resolve references in the latest message.
No provider conversation ID or model memory is used, and requests set `store: false`.

Limits are explicit: latest message 4,000 characters; each history message 2,000; structured state
24,000; question 1,000 with at most two requirements; total serialized context 48,000. Oversized
history messages are omitted whole, with `historyOmitted` flagged. Oversized current state/message/
question is rejected rather than cut in a way that could lose negation or correction evidence.

The caller should pass the question **actually presented** to the customer. The existing workflow
returns questions but does not append them to Lead history. If no question is supplied, the prompt
may use a clearly relevant AGENT/HUMAN question in the bounded history; it must not assume an
unasked missing requirement was requested. Ambiguous short answers stay unresolved.

The existing `processCustomerMessage(lead, text, requirementsContext?)` API remains synchronous
and deterministic. The asynchronous alternate accepts any trusted extractor implementation:

```ts
import { processCustomerMessageWithExtractor } from './domain/conversation/processCustomerMessage.js';
import { extractMessageWithAI } from './integrations/openai/extractMessageWithAI.js';

const result = await processCustomerMessageWithExtractor(lead, customerText, {
  extractor: extractMessageWithAI,
  lastQuestion: questionActuallyPresented, // optional NextQuestion
  referenceDate: '2026-09-15',          // explicit local calendar date for yearless dates
  requirementsContext,                   // optional business policy context
});
```

Both paths share merge, recording one customer message, readiness evaluation, and next-question
selection. The asynchronous path snapshots inputs before awaiting and isolates the extractor from
mutating the caller's Lead. A failed extraction rejects without recording or merging anything;
callers should catch `AIExtractionError`. The AI boundary validates model data; a custom injected
extractor is responsible for honoring the `ExtractionResult` contract.

### Errors and tests

`AIExtractionError.code` identifies `MISSING_API_KEY`, `REQUEST_FAILED`, `NO_STRUCTURED_OUTPUT`
(refusal, absent or incomplete output), `INVALID_EXTRACTION`, or `CONTEXT_TOO_LARGE`. Raw provider
errors and customer text are not included in these messages. No extraction is invented after failure.

Run `npm test`, `npm run typecheck`, and `npm run build`. Tests require neither a key nor network.
`server/tests/aiExtraction.test.ts` covers conversion, contextual question forwarding, Hebrew reply
fixtures, free-text address fixtures, quantities, false/zero, partial dimensions, explicit corrections,
ambiguity, validation, bounded context, typed failures, and injected workflow behavior. An SDK test
uses a fake HTTP transport to exercise actual Responses parsing with the generated schema.
Contextual language tests use mocked model results; they verify the integration contract, not live
model understanding. The original deterministic tests continue to run unchanged.

### Current limitations and assumptions

- Only explicitly communicated facts are requested. The prompt handles Hebrew number words,
  refrigerator categories (including four-door), address components, and contextual replies
  conservatively; live language quality still needs evaluation with real examples.
- Natural relative dates (`היום`, `מחר`, `יום חמישי`) remain unresolved. Numeric Israeli dates
  accept slash/dot separators and optional four-digit years. Yearless dates require an explicit
  reference date from the application; record timestamps never supply a year.
  An explicit time can still be extracted while an unsupported date stays unchanged.
- Dimensions need clear axes and units; explicit meters can be converted to centimeters.
  Unlabelled or ambiguous measurements are left unresolved.
- A singular item mention does not silently set quantity to one. Approximate positive integer
  totals are accepted; additive counts, deletion, clearing fields, and multiple same-type item
  identity are unresolved. No geocoding, images, uploads, or persistence is implemented.
- The AI only extracts data. It never prices or approves a quote; requirements and workflow remain
  deterministic, and every v0.1 quote still requires human approval.

Structured Outputs follows the [official OpenAI guide](https://developers.openai.com/api/docs/guides/structured-outputs).

## React stakeholder demo

A Hebrew, RTL development interface shows the conversation on the left and the Agent State on
 the right at desktop widths, stacking them on mobile. It uses existing React/Vite/CSS only.

### Run locally

1. Run `npm install` from the root.
2. Manually set a real `OPENAI_API_KEY` in the root `.env`; `OPENAI_MODEL` remains optional.
3. Run `npm run dev:server` in one terminal.
4. Run `npm run dev:client` in another, then open http://localhost:5173 (or Vite's reported port).

Both the server entry point and CLI demo load the root `.env`. No API key is sent to Vite or the
browser. The Vite development proxy forwards `/api` to `http://127.0.0.1:3001`; if changing the
backend `PORT`, update that proxy target too. Production builds remain separate artifacts;
`npm start` runs the backend only. Serving the production client with an API proxy is outside this demo.

Click **טעינת הודעה לדוגמה** to fill the composer, then **שלח** to make a real extraction request.
Customer messages and the exact backend `responseText` appear as chat bubbles, including acknowledgements and final next steps. The right side shows
collected item/location/date details, the server's `requirements.missingRequired` with Hebrew display
labels, and the complete `responseText` under the next-question or next-step heading. False elevator/service answers and floor zero are displayed
as known facts. Pending review and ambiguous unapplied item updates are also surfaced. A collapsed
JSON section provides the full response for development; it contains lead data, never credentials.

### Demo API and state

- `GET /api/demo`: current Lead, extraction, requirements, unapplied items, next question, optional acknowledgement, and final responseText.
- `POST /api/demo/message` with `{ "message": "..." }`: processes one customer message.
- `POST /api/demo/reset`: creates a new empty Lead and evaluates initial requirements.

`server/src/demo/router.ts` holds one Lead in memory per Express app instance. All local browser
tabs share this session. Reloading fetches current server state; resetting or restarting clears it.
This is a single-session local demo, not a multi-user production service. The server binds to loopback.
No database, authentication, pricing, or WhatsApp integration is added.

Requests accept only nonblank text up to 4,000 characters. Clients cannot submit Lead/status or
requirement state. Concurrent messages and resets during extraction return a friendly busy response.
An extraction failure preserves the entire prior state. The UI retains the unsent draft for retry,
shows a friendly error, and disables send/reset while waiting.

The route invokes `processCustomerMessageWithExtractor()` with the real `extractMessageWithAI`
by default, passes the last displayed question and current Jerusalem calendar date, then records the final `responseText` in history even when `nextQuestion` is null.
The existing requirements engine, merge, readiness rules, schema, and model selection are reused.
Recognized short negative photo replies are handled explicitly by the workflow without calling AI.
For messages requiring AI, missing/placeholder keys produce a setup message and other
AI failures produce a safe retry message. Raw provider errors are never returned or displayed.

`client/src/api.ts` imports only TypeScript response types from `server/src/demo/types.ts`; these
imports are erased from browser output. No server runtime or business decisions run in the client.
Frontend mappings translate field identifiers into Hebrew labels; missing fields, readiness, and
question selection come solely from the response.

`server/tests/demo.test.ts` exercises real local HTTP routes with injected extractors: initialization,
health, context/history, retained facts, reset, input validation, safe failures, and concurrent-request
protection. `npm test` never makes real OpenAI requests. Browser verification uses temporary injected
sample responses, so it checks the interface rather than claiming live model accuracy.

## Conversation polish: dates, unavailable photos, and replies

The UI palette follows the white header, dark green, and bright green accents of
[the Rick & GO website](https://rick-and-go.vercel.app/). No local logo asset was present,
so the header uses a text wordmark and inline SVG icons, with no remote asset dependency.

### Date normalization

The previous AI prompt required ISO dates and left missing years unresolved; conversion also
accepted only ISO. Israeli date answers could therefore be omitted or rejected.
The strict output shape is unchanged. The prompt now requests the numeric date token verbatim;
conversion delegates normalization to `normalizeRequestedDate.ts`.

- Accepts DD/MM, DD/MM/YYYY, DD.MM, DD.MM.YYYY, and existing ISO YYYY-MM-DD.
- Stores YYYY-MM-DD. Explicit years are preserved, including past years.
- For omitted years, uses the reference year if the day/month is today or upcoming, otherwise
  the following year. Without a reference date, a yearless field stays unresolved.
- The demo route and CLI explicitly provide the current Asia/Jerusalem date. The pure normalizer
  never reads the clock; tests supply fixed dates.
- Invalid calendar dates reject extraction. A yearless leap day must exist in the selected
  current/next year; the policy does not search for a later leap year. Relative words and ranges
  remain unsupported. Known-date changes still require an explicit correction operation.

### Contextual photo replies and final response

Previously no state represented an unavailable photo: the item stayed REQUIRED and its question
was selected again. The asynchronous workflow now recognizes `אין`, `אין לי`, `אין תמונה`,
`אין לי תמונה`, `לא`, and `לא כרגע` only when the actually presented question contains one
targeted item.photo requirement and that item is still REQUIRED. It updates only that item to
NOT_AVAILABLE. The shortcut accepts only an entire, unambiguous short reply (including `אין לי כרגע`).
Compound replies always go through full extraction, including their photo and measurement facts.
Existing RECEIVED and NOT_APPLICABLE meanings are preserved.

`buildConversationResponse.ts` combines the photo acknowledgement with the next engine question,
or a human-review/pricing next step when collection is complete. It also returns a reply for
unsupported items needing review. It does not claim an external handoff has occurred.
This is deterministic and needs no second model call. The demo persists the complete response
as an AGENT message. React renders that text in both chat and the response card without deciding
requirements, readiness, or wording. Photos remain pending review; no upload, quote approval,
or pricing calculation is introduced.

### Regression coverage

`server/tests/conversationReplies.test.ts` covers date formats, year boundaries, calendar validation,
explicit corrections, date-to-photo progression, all negative photo phrases, context isolation,
per-item targeting, acknowledgement composition, review responses, and retained state.
`server/tests/demo.test.ts` covers the full reported five-message flow over HTTP with a mocked
structured extractor. `client/tests/response.test.tsx` verifies backend response rendering in
chat and state cards, including when there is no next question.

Automated tests are offline. Separate manual live checks passed the reported conversation and
each of the four numeric date formats; these sample model behavior, not every possible phrasing.
Browser checks use an isolated injected extractor and cover desktop/mobile, loading, retained
drafts on safe errors, response rendering, and reset.

### Off-script facts, photo declines, and offered dimensions

Every compound customer message is extracted in full before validated updates are merged and
the full Lead is re-evaluated. The actual last question resolves references; it does not restrict
extraction to the requested fields. Address replies can include floors, elevators, dates or
corrections. Only explicitly updated fields change; unknown facts and unrelated known data remain intact.

The strict per-item AI schema now includes photoStatus (only NOT_AVAILABLE can be extracted)
and dimensionsAvailable. The latter is stored on MoveItem as true, false, or null:
true records an explicit offer, false records inability to supply measurements, and null is unknown.
None of these values supplies width, height or depth. Measurements remain separately validated,
positive centimeter values. The prompt covers Hebrew labels before/after values, approximate
measurements, meter/millimeter conversion, and explicitly ordered triples. Unlabelled triples do
not establish axes; promises never generate numbers. Received/non-applicable photos cannot be
overwritten by model output. Ambiguous same-type item patches remain unapplied.

An offered measurement set produces questions only for missing axes, grouped into one question.
When a size category already meets pricing requirements, these measurements are optional REVIEW
information; the offer adds no pricing requirement. If size itself is unknown, explicit dimensions
can satisfy the existing size requirement. Withdrawing an optional offer preserves measurements
already collected. Unavailable photos remain pending human review without a repeated photo request.

Response composition compares the previous and merged item state. A photo decline plus a
measurement offer acknowledges the alternative; a decline plus complete dimensions acknowledges
receipt and continues to the next relevant question or human review/pricing step. No second model
call, pricing change, automatic approval, upload support, or React business logic is introduced.

server/tests/offScript.test.ts covers the reported combined reply, available-versus-supplied
measurements, partial measurement follow-ups, dimension units/orientation fixtures, early dates,
extra address details, partial answers, isolated corrections, compound corrections, unavailable
photos outside the active question, ambiguity, atomic validation, and preservation of known state.
These are offline structured-model fixtures and workflow tests, not a live-model language benchmark.
