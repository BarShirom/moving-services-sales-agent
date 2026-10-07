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

Recommendation-only deterministic pricing is available through the domain API below. MongoDB, WhatsApp, authentication, and production channel integration are intentionally not implemented. OpenAI extraction is available through the developer-only workflow described below.

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

Item names: מקרר, ארגז/ארגזים, מכונת כביסה, ארון, מיטה, שידה. Recognition does not expand pricing support: wardrobe, bed, and dresser transport remain unsupported.

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
collected item/location/date details, separate customer-information and owner-review lists, and
a concise operational next step derived from the existing status/question. It does not repeat the chat reply. False elevator/service answers and floor zero are displayed
as known facts. Pending review and ambiguous unapplied item updates are also surfaced. A collapsed
JSON section provides the full response for development; it contains lead data, never credentials.

`client/src/leadPresentation.ts` maps existing requirements to business wording without changing
readiness or missing facts. Pending size/axis entries are grouped by item (for example,
"מידות הארון — לא זמינות כרגע"). Item pricing checks, unavailable photos and ambiguous item updates
appear under "נושאים לבדיקה אצל בעל העסק"; empty sections are hidden. Known aggregate box counts
above the existing `pricingRules.review.maxBoxes` threshold show "נפח גבוה — 40 ארגזים — דורש בדיקה".
Unknown totals are not guessed. Owner View retains the full pricing breakdown and all review reasons.

### Demo API and state

- `GET /api/demo`: current Lead, extraction, requirements, unapplied items, next question, optional acknowledgement, and final responseText.
- `POST /api/demo/message` with `{ "message": "..." }`: processes one customer message.
- `POST /api/demo/reset`: creates a new empty Lead and evaluates initial requirements.

`server/src/demo/router.ts` holds one Lead in memory per Express app instance. All local browser
tabs share this session. Reloading fetches current server state; resetting or restarting clears it.
This is a single-session local demo, not a multi-user production service. The server binds to loopback.
No database, authentication, or WhatsApp integration is added. The later Owner Review Demo section describes the in-memory pricing and approval extension.

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

When the active question is only `requestedDate`, the date is still unknown, and the whole
reply is a numeric date token, `conversation/dateReply.ts` normalizes it before calling an
external extractor. This removes the unnecessary provider dependency for answers such as
`10/10`. The regular merge, requirements and owner workflow still apply. Compound messages,
corrections and answers to other questions continue through extraction; invalid calendar dates
still throw and the demo retains its previous state. The demo clock is injectable at app creation
for HTTP tests, never from a customer request. With reference `2026-10-07`, `10/10` becomes
`2026-10-10`, `07/10` stays `2026-10-07`, and `06/10` becomes `2027-10-06`.

The October regression tests exercise the elevator question, `לא`, the displayed date question,
the numeric reply and the next photo requirement through `/api/demo/message`. They also verify
state retention on invalid dates and provider failures, and automatic pricing with owner approval
still required. A simulated provider failure reproduced HTTP 502 before the date shortcut; the
reported live `10/10` retry succeeded before the fix, so its original unlogged exception could
not be established retrospectively.

### Contextual photo replies and final response

Previously no state represented an unavailable photo: the item stayed REQUIRED and its question
was selected again. The asynchronous workflow now recognizes `אין`, `אין לי`, `אין תמונה`,
`אין לי תמונה`, `לא`, and `לא כרגע` only when the actually presented question contains one
targeted item.photo requirement and that item is still REQUIRED. It updates only that item to
NOT_AVAILABLE. The shortcut accepts only an entire, unambiguous short reply (including `אין לי כרגע`).
Compound replies always go through full extraction, including their photo and measurement facts.
Existing RECEIVED and NOT_APPLICABLE meanings are preserved.

`buildConversationResponse.ts` combines acknowledgements with the next engine question,
or a human-review/pricing next step when collection is complete. It also returns a reply for
unsupported items needing review. It does not claim an external handoff has occurred.
`conversationEvents.ts` derives applied corrections, extra supplied facts, access notes, and
customer follow-up intent from the latest merged state and the question actually presented.
Acknowledgements compose across simultaneous events. A narrow Hebrew will-check/unknown cue
defers only still-missing requirements from that question for this response; their status and
Lead readiness remain unchanged. Other askable requirements may continue, and an acknowledgement
alone is returned when waiting is the only next step. Deferral is transient, not a Lead field.
This is deterministic and needs no second model call. The demo persists the complete response
as an AGENT message. React renders that text in chat and a separate brief status/action in the
next-step card, without changing requirements or readiness. Photos remain pending review; no upload, quote approval,
or pricing calculation is introduced.

### Regression coverage

`server/tests/conversationReplies.test.ts` covers date formats, year boundaries, calendar validation,
explicit corrections, date-to-photo progression, all negative photo phrases, context isolation,
per-item targeting, acknowledgement composition, review responses, and retained state.
`server/tests/demo.test.ts` covers the full reported five-message flow over HTTP with a mocked
structured extractor. `client/tests/response.test.tsx` verifies full chat response rendering,
separate customer/owner lists, box-volume boundaries, hidden empty sections and concise next-step
wording across collection, manual review, quotes, handoff and closed states.

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
true records an explicit offer, false records inability to supply measurements now (including an explicit promise to check later), and null is unknown.
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

Unavailable dimensions use this same persisted availability field, not fabricated measurements or
a new Lead lifecycle status. Requirement evaluation marks unresolved size/axis results as
`MISSING` with `availability: TEMPORARILY_UNAVAILABLE` and no automatic question. Supplied values
remain `SATISFIED`; null axes stay null. Later messages retain the unavailable state for owner
review. An explicit new offer reopens missing axes, and supplied measurements satisfy only the
corresponding facts. Compound replies still go through full structured extraction, so
"אין לי כרגע את המידות ודרוש פירוק ואחר כך גם הרכבה." records availability plus BOTH service flags
for the wardrobe identified by the active question. Unrelated uncertainty never globally defers facts.

The agent acknowledges pending dimensions and services, then asks another collectable question.
When no pricing question remains askable because dimensions are unavailable, optional review
questions can continue. Once collection is exhausted, owner/manual pricing can proceed even while
`readyForPricing` remains false, provided the only missing pricing requirements are unsupported
item policies or explicitly unavailable dimensions. This does not satisfy or remove those requirements.
An owner can also explicitly calculate a partial recommendation while assembly/disassembly is still
unanswered for an item that already has a missing unsupported-item policy. This exception is limited
to that same unsupported item; other missing customer requirements still block calculation.
Its service question remains active and `readyForPricing` remains false. Automatic generation for
this manual-only path still waits until no next question remains, so requesting an owner subtotal
does not skip collection or imply that the unanswered service was accepted.
Owner Review shows the missing availability status and the pricing risk reason. Unknown quantities,
unsupported wardrobe/dresser transport, over-30-box volume and service complexity remain flagged;
only defensible components form a subtotal, and every quote still requires owner approval.
The anonymized `conv-026` fixture and HTTP/owner/UI tests cover this loop and retained information.

Response composition compares the previous and merged item state. A photo decline plus a
measurement offer acknowledges the alternative; a decline plus complete dimensions acknowledges
receipt and continues to the next relevant question or human review/pricing step. No second model
call, pricing change, automatic approval, upload support, or React business logic is introduced.

server/tests/offScript.test.ts covers the reported combined reply, available-versus-supplied
measurements, partial measurement follow-ups, dimension units/orientation fixtures, early dates,
extra address details, partial answers, isolated corrections, compound corrections, unavailable
photos outside the active question, ambiguity, atomic validation, and preservation of known state.
These are offline structured-model fixtures and workflow tests, not a live-model language benchmark.

## Offline evaluation runner

Eval Runner v0.1 checks the conversation workflow against the public evaluation datasets
and executes provisional pricing evaluations. It uses explicit offline extraction fixtures and
existing domain logic; it never calls live OpenAI or treats partial subtotals as whole-job pricing accuracy.

From the repository root:

    npm run eval
    npm run --silent eval:json

The JSON command is suitable for CI consumption. Reports are printed, not persisted.
Failed executable assertions or invalid evidence exit with code 1; unsupported/future cases
are reported as NOT_RUN. PASS is limited to the supported checks, with remaining natural-language
mustNot statements explicitly listed for manual review.

The current baseline is 24 conversation cases passing, 0 failing, and 2 future removal-service
cases not run. The 6 pricing records produce 5 PARTIAL_INPUT and 1 NOT_SUPPORTED results; none is a complete job-price score.
The eval command exits 0 for this baseline. Dataset expectations and execution fixtures remain
unchanged; the workflow now acknowledges applied updates and defers will-check questions.

See [the evaluation dataset and runner guide](data/evals/README.md) for fixtures, limitations,
source-quality reporting and how to turn an anonymized manual bug into a permanent regression case.

## Pricing Engine v0.1: complete and partial recommendations

The deterministic engine uses `MOVING_PRICING_V0_1_3`. This revision preserves defensible supported
components in mixed inventories, narrows service/fit eligibility, and groups overlapping review
deductions; the monetary rates and formulas below are unchanged. Structured Lead facts and explicit numeric
pricing context are the only inputs; the LLM never calculates prices, ranges or confidence.
All results remain provisional and require owner approval. No automatic customer quote, maps
request, WhatsApp, database or scheduling integration is introduced.

The [pricing evidence and tariff-readiness audit](data/evals/PRICING_EVIDENCE.md) separates
29 historical/reference/engineering records from 23 category decisions. It preserves the six
original job fixtures, marks all ten current rule families PROVISIONAL, and documents the future
owner learning loop. No category is production-ready, and the evidence register changes no runtime
pricing rule. Boxes and distance remain engineering assumptions; closed bundles do not establish
isolated item tariffs.

### Provisional pricing assumptions

The historical references in [the eval guide](data/evals/README.md#historical-pricing-heuristics)
support appliance, floor, service, waiting, extra-stop and student-discount heuristics. The six
job totals do NOT isolate box or distance costs. The box/distance rules below are newly chosen,
explicit engineering assumptions for owner-reviewed demonstrations, not calibrated business rates.
They must be validated with the pilot owner before business reliance. No historical total is used
as a coefficient or memorized result; current estimates are not ground truth.

| Component | Exact rule in ILS | Provenance / assumption |
| --- | --- | --- |
| Refrigerator | SMALL 300; REGULAR 350; LARGE/FOUR_DOOR band 400-450, midpoint 425 | Historical A; handling/base labor included, no extra BASE charge |
| Washing machine | Band 280-320, midpoint 300 per known unit | Historical B |
| Boxes | No boxes adds 0; 1-10 adds 50-100 (75); 11-20 adds 100-200 (150); 21-30 adds 200-300 (250) | New provisional volume bands; aggregate all box rows into one band |
| Distance | First 10 km included in item handling; each additional km adds 5-10 (7.5 midpoint) | New provisional numeric-distance tariff; fractional km supported |
| Stairs | 100-150 (125 midpoint) per positive floor at pickup and dropoff | Historical G; once per endpoint for the supported load, not per item |
| Bed service | 180-350 (265 midpoint) | Historical H; one bundle for an explicitly requested service, quantity 1, confirmed STANDARD complexity, and no explicitly pending dimensions |
| Wardrobe service | 350-600 (475 midpoint) | Historical H; same eligibility and bundle policy |
| Extra stop | 200-300 (250 midpoint) per pickup/dropoff beyond the initial two points | Historical F; additional access remains unpriced |
| Waiting | 150 per started half-hour; zero minutes adds 0 | Historical I; rounding upward is provisional |
| Student discount | 10% of all priced components, once, applied last | Historical J; explicit eligibility required; scope is provisional |

The simple complete-job scope is at most two known refrigerators/washing machines combined,
with up to 30 boxes and one pickup/dropoff. Known appliance quantities multiply their reference
bands; those bands include normal handling and base transport labor. Adding their bands and the
box/floor/distance additions is a provisional composition policy, not a fitted labor model.
Boxes-only jobs can use the volume band and route/stair components. A zero box count is represented
by no box item (the domain retains positive quantities for recorded items); no box fee is then added.
More than 30 boxes or two appliances requires manual review and omits the unsupported component.
No arbitrary furniture transport tariff or special-difficulty surcharge is created.

Floor 0 is known ground floor with no stair charge, even if elevator availability is unknown.
At positive floors, elevator=false means stairs. Elevator=true does not by itself require a fit
answer, add stairs, or create a missing-fit penalty. An unknown fit matters only when explicit
pricing context identifies a specific item requiring that check at that endpoint. If fit=false,
the elevator stays true: ordinary stair work is priced and a separate unpriced special-carry issue
makes the result partial. Explicit narrow-access or other difficulty also retains ordinary stairs
but flags the unpriced additional work. Unknown floors/elevators, explicitly required fit checks,
basements and loads outside the supported limits cannot silently become free access.
The stair heuristic applies once per endpoint to the supported load of priced appliances and up
to 30 boxes, not once per appliance or box. Unsupported wardrobe/furniture transport does not remove
that subtotal; its stair/access work remains unpriced and flagged for owner review. Extending
historical G to the supported load is explicitly provisional.

Bed/wardrobe services do not establish a transport rate for that furniture, so such jobs remain
partial. Services are never inferred from item type. A single item with either service=true is
eligible for the historical band only when serviceComplexity is explicitly STANDARD and dimensions
are not explicitly pending. Either or both requested services use one bundle, never two charges.
Unknown/COMPLEX service complexity, explicitly unavailable incomplete dimensions, and multiple or
unresolved service quantities leave the service unpriced for manual assessment. A unique wardrobe
can use the documented pricing-only quantity convention below, but that assumption does not establish
service complexity or measurements. Unsupported appliance service requirements also remain unpriced.
Unknown assembly/disassembly flags on refrigerators, washing machines and boxes do not create
missing-service warnings: ordinary transport does not require those answers. Explicitly requested
services still require assessment. Unknown bed/wardrobe service needs are clarification issues,
not a claim that assembly or disassembly is required. A dresser's unknown service flags are not
applicable by default and do not manufacture a pricing warning; an explicitly requested dresser
service still requires manual assessment. Disassembly never establishes assembly or vice versa.

Workers and estimatedDurationHours are complexity signals only. More than two workers or two hours
adds review and a confidence deduction, but no fabricated labor charge or automatic partial flag.
These thresholds are engineering review limits. Estimated duration never implies waiting minutes.

### Calculation, ranges and completeness

Suggested amount = item references + box-volume band + applicable stair work + excess-distance
charge + explicit supported services/stops/waiting, followed by an eligible student discount.
Each component records its amount, range, source and calculation basis. Monetary values settle
to integer agorot at component boundaries; unsafe arithmetic rejects. Component amounts sum to
the suggestion to the nearest agora. Without a discount, total ranges sum component endpoints.
A discount is correlated with the subtotal: multiply both subtotal endpoints by 0.9, rather than
adding independent negative interval bounds. Its negative breakdown amount remains traceable.

`completeness` is separate from workflow `status`:

- COMPLETE_RECOMMENDATION / amountScope FULL_JOB: a positive amount with all meaningful supported
  cost components known. Provisional assumptions still lower confidence and require owner approval.
- PARTIAL_RECOMMENDATION / SUPPORTED_COMPONENTS_ONLY: a positive subtotal with an unsupported or
  missing meaningful component. Its range does not bound the whole job. Unresolved quantity/size,
  relevant assembly needs, route distance, access details or incomplete inventory produce partial results.
- CANNOT_PRICE: no defensible numeric component. Amount and range are null, never a zero-price quote.
  Distance/stair/waiting/stop supplements alone cannot price unknown inventory.

Complete inputs normally return RECOMMENDATION_READY. Operational uncertainty (missing date/address,
missing photo/dimensions, unknown extra access difficulty, staffing/duration risk) can return MANUAL_REVIEW_REQUIRED
while the cost completeness remains complete. Partial recommendations always require manual review.
The absence of special-access notes remains an owner caution, not an invented missing surcharge.
Explicit difficulty still identifies unpriced extra work; known ordinary stair work remains priced.
Dates/addresses carry no seasonal or geography-based tariff in the engine. In all cases
humanApprovalRequired is true; only explicit owner approval/adjustment can send the demo quote.

### Inputs, distance adapter and audit

buildPricingInput validates/copies the Lead's moveDetails and external PricingContext. Unknowns,
floor zero and false are preserved except for the narrow pricing-only quantity convention below.
Raw messages are excluded. Size categories are explicit;
dimensions never imply a refrigerator category. Invalid dates/numbers/counts reject before pricing.

For a complete v0.1 inventory, a unique refrigerator or wardrobe row with `quantity=null` can use
quantity 1 in pricing. Each type is assessed independently: `inventoryComplete=true`, all inventory
rows have a known type, exactly one row of the relevant type, and `description=null` are required.
Other item types, an unsupported wardrobe,
or unknown/high box volume do not invalidate an otherwise unambiguous singular refrigerator.
Duplicate rows of the same type, descriptive ambiguity or incomplete inventory disable that type's
convention. Explicit quantities are never replaced, and no such convention applies to other types.
The adapter changes only the detached pricing input and records affected indices in
`assumptions.singularRefrigeratorQuantity` and `assumptions.singularWardrobeQuantity`; Lead
quantities remain unchanged. `SINGULAR_ITEM_QUANTITY` exposes the
convention and deducts five points once even when both refrigerator and wardrobe use it.
This convention uses structured inventory only and does not parse messages to establish quantities.

Context supports numeric distanceKm, legacy distanceBand (not used to price), workers, estimated
job duration, pickup/dropoff point counts, per-endpoint elevator-fit booleans and item-specific
fit-check requirements (`pickupElevatorFitRequiredItems` / `dropoffElevatorFitRequiredItems`, arrays
of zero-based item indices, default empty), explicit specialDifficulty descriptions, inventoryComplete,
waitingMinutes, studentDiscountEligible and
serviceComplexity keyed by zero-based item index (STANDARD or COMPLEX). Defaults are one pickup
and dropoff, inventoryComplete=true, no requested waiting/discount, and otherwise unknown facts.
The historical adapter defaults inventoryComplete=false; original fixtures remain unchanged.

`server/src/demo/distanceAdapter.ts` supplies a fixed **20 synthetic km** for two registered demo routes:

- רמת גן, רחוב דוגמה 1 → תל אביב, רחוב דוגמה 2 (the owner sample).
- רמת גן, ביאליק 20 → תל אביב, סלמה 37 (the reported refrigerator-and-boxes regression).

These values are demonstration fixtures, not measured or estimated travel distances. Owner Review
labels the registered distance as synthetic/provisional. Unregistered routes return null; there is
no city-wide fallback. The demo refreshes this context on customer changes and before recalculation,
so changing a route to an unregistered address removes its old distance. A future Maps adapter can
supply actual numeric kilometers through the same boundary; pricing itself neither parses addresses
nor calls a service.

Each evaluation stores its rule version, detached inputSnapshot and SHA-256 inputFingerprint.
Identical validated input and supplied audit metadata produce identical evaluations. The fingerprint
canonicalizes `REQUIRED`, `NOT_AVAILABLE` and `NOT_APPLICABLE` photos as the same lack of received
evidence, because calculation treats them identically. A photo refusal after automatic pricing
therefore leaves the recommendation current; the audit snapshot still retains the original photo
status. `RECEIVED` remains distinct. Actual quantity/size/dimension/access/route changes, quantity
assumption provenance and rule-version changes invalidate previous evaluations. Messages, lifecycle
status and timestamps are excluded. Explicit owner requests for more information still hold the
recommendation stale until recalculated, even when the reply does not change a priced fact.
The owner workflow retains prior evaluations and decisions in memory and blocks stale approvals;
no persistence or complex versioning is added.

### Confidence and review

Confidence is deterministic completeness/risk, not statistical accuracy. Start at 100, subtract
the deductions exposed in review reasons after grouping overlapping risks, and clamp to 0-100;
CANNOT_PRICE scores 0.
Deduct 10 for provisional rules, 5 for each active provisional composition/new-rate assumption,
15 for missing distance, 5 for missing facts or missing photo/complete dimensions, 20 for unsupported
items or complexity, and 10 when a contextual rate cannot be applied. The singular-item quantity
assumption deducts 5 once globally. For each unsupported item, transport, manual service,
unavailable dimensions and unresolved quantity are one overlapping risk group: apply the largest
deduction in that group once (normally 20), while retaining every distinct review note. Other items
and independent route/access risks still deduct separately. This prevents one wardrobe from losing
points repeatedly for the same unresolved manual assessment. A complete recommendation may still
have a low score and require manual review.

### Calculated sample and historical evaluation

The synthetic owner sample is a LARGE fridge plus 15 boxes, pickup floor 2 without elevator,
dropoff floor 5 with a fitting elevator, confirmed no assembly/disassembly, known dimensions,
no special difficulty and a supplied synthetic 20 km route. It calculates:

- Refrigerator 425, boxes 150, pickup stairs 250, excess distance 75 = **900 ILS**.
- Range **750-1,050 ILS**, completeness COMPLETE_RECOMMENDATION, confidence **75**, approval required.
- The owner may approve 900 or adjust it; no recommendation is customer-visible before approval.

The reported browser case uses the second registered route: one LARGE refrigerator with unknown
quantity, 15 boxes, floor 2 without an elevator at both ends, date 2026-11-08 and no available photo
or dimensions. With the pricing-only singular assumption, the calculation is:

- Refrigerator 425 + boxes 150 + pickup stairs 250 + dropoff stairs 250 + excess distance 75 = **1,150 ILS**.
- Range **950-1,350 ILS**, COMPLETE_RECOMMENDATION, MANUAL_REVIEW_REQUIRED, confidence **60**.
- Reasons: provisional rules (10); singular quantity, missing visual evidence, unconfirmed extra access
  difficulty, provisional box rate, provisional distance rate and stair composition (5 each).
- No quantity-missing or irrelevant assembly warning; no supported component is omitted. Photo refusal
  does not stale the recommendation, and only an owner approval/adjustment sends a customer quote.

The mixed-inventory regression adds an unsupported wardrobe to a LARGE refrigerator and 15 boxes.
The refrigerator and wardrobe each have a unique, unambiguous row with unknown quantity; the pricing
adapter treats each as one without changing the Lead. Pickup is floor 2 without an elevator;
dropoff is floor 3 with an elevator and no explicitly required fit check. The date is 2026-11-08.
The refrigerator has no photo, wardrobe dimensions are unavailable, and disassembly is requested
without confirmed STANDARD service complexity. The wardrobe remains a manual item even when its
size description or assembly flag is known.

| Supported component | Midpoint | Range in ILS |
| --- | --- | --- |
| LARGE refrigerator | 425 | 400-450 |
| 15 boxes | 150 | 100-200 |
| Supported-load pickup stairs, floor 2 | 250 | 200-300 |
| Registered synthetic 20 km route | 75 | 50-100 |
| Supported subtotal with registered route | **900** | **750-1,050** |

This is **PARTIAL_RECOMMENDATION**, **MANUAL_REVIEW_REQUIRED**, confidence **40**, and always
requires owner approval. Wardrobe transport, its disassembly/assembly, pending dimensions and
wardrobe stair/access work remain omitted/manual; the supported-load stair subtotal does not
include that furniture work. There is no dropoff stair charge or default elevator-fit warning,
and no generic quantity warning for the two safe singular assumptions. Owner Review separates
the priced subtotal from components requiring manual pricing using item-specific Hebrew labels.

The score follows the rules, not a case-specific target: provisional rules 10; overlapping wardrobe
risk 20 once; singular quantities, missing refrigerator visual evidence, box tariff, distance tariff,
stair composition and unconfirmed additional access difficulty 5 each. All distinct wardrobe review
notes remain visible even when their overlapping deductions are zero. If addresses do not match a
registered demo route, no distance is invented: the subtotal is **825 ILS**, range **700-950 ILS**,
confidence **30**, with missing distance requiring review. Known cities alone do not select 20 km.
These examples are deterministic regression cases, not historical job-price evidence.

The runner reports quoted/closed/reference amounts, absolute/percentage differences, completeness,
and review reasons. A complete result is SCORED even if manual review is needed. Price differences
never fail the build; malformed evidence and structural invariants do. Historical estimates are
informational. Partial subtotal-to-whole-job differences are reported with an explicit limitation.

| Historical case | Calculated subtotal | Why not a complete job recommendation |
| --- | --- | --- |
| 001 | None | Dishwasher/oven transport unsupported |
| 002 | 75 | Boxes only; fridge size missing, other furniture unsupported |
| 003 | 1,175 | Washing machine, boxes and supported-load stairs at both ends; other furniture/electric piano and their access work unsupported |
| 004 | 975 | Small fridge, washer and pickup stairs; incomplete dropoff access and inventory |
| 005 | 550 | Washer plus boxes; mixed unsupported inventory and difficult access |
| 006 | 250 | Boxes only; unsupported complex inventory and unclear quantities/access |

All six lack numeric distance; none is a full historical score. Current baseline: 5 PARTIAL_INPUT,
1 NOT_SUPPORTED, 0 INVALID. Three closed-job totals remain 450, 1,200 and 2,990; the historical
estimate cases remain estimates. The conversation baseline remains 24 passing, 2 future cases not run.


## Quote Finalization & Customer Acceptance v0.1

The **לקוח** and **בעל העסק** views share one local session. The engine's calculation, the owner's
commercial decision, and the quote actually sent to the customer are separate records. A useful
partial subtotal is never automatically promoted to a price for the whole move. The mobile-first
Hebrew interface retains conversation history, drafts and errors when switching views; it refreshes
backend state after actions and view switches.

### Calculation, owner decision and customer quote

`PricingEvaluation` retains the original amount/range, completeness, omissions, assumptions and
review reasons. `OwnerReview` records the suggested and final approved amounts separately, its
decision/evaluation reference, scope snapshot/version/fingerprint, finalization acknowledgements,
timestamp and optional private internal reason. A decision does not rewrite an evaluation or make
partial pricing complete.

`CustomerQuoteRecord` in `server/src/domain/quote/types.ts` stores a quote ID and increasing version,
Lead/evaluation/decision references, final amount and currency, the known move scope, sent time,
status and any acceptance. Scope includes item facts, pickup/dropoff access, requested date/time
and explicitly supplied services. Unknown facts remain unknown, including quantities that only
the pricing adapter assumed for calculation. The record also retains owner-reviewed missing photos
and unresolved details; owner approval does not turn them into factual answers.

| Current calculation | Explicit owner action |
| --- | --- |
| COMPLETE_RECOMMENDATION | **אשר ושלח הצעת מחיר** / APPROVE uses the current suggested amount. Existing unresolved review conditions still require their acknowledgements. |
| PARTIAL_RECOMMENDATION | **השלם ואשר מחיר סופי** opens a form separating the calculated subtotal/range from omitted work. ADJUST_PRICE must supply a final total, scopeConfirmed=true and omittedCostsAcknowledged=true. |
| CANNOT_PRICE | Owner-entered final total through ADJUST_PRICE with the same scope/omitted-cost confirmations; it is not labeled an engine recommendation. |

The partial finalization confirmation is unchecked initially: the owner must explicitly confirm
that the final amount covers the described move, including the components the engine did not price.
The owner may deliberately choose the same amount as the subtotal or a different positive total;
no arbitrary surcharge is required. APPROVE cannot send a partial/null recommendation, including
through a direct API call. ADJUST_PRICE cannot bypass the incomplete-cost confirmations.

Finalization validates the current Lead revision and pricing evaluation. Null, zero, negative,
non-finite, unsafe or more-than-two-decimal amounts are rejected. The customer receives only the
final owner-approved amount, never a stale recommendation or an unapproved subtotal. The owner view
keeps the original engine calculation as context after sending and acceptance, separately from the
final quote; the current quote no longer appears to be awaiting owner approval.

### Collection and pending review information

Unsupported item tariffs are owner issues, not a reason to skip customer questions. The requirements
selector asks collectable PRICING questions first, then collectable REVIEW questions when only
unsupported-item policies or explicitly unavailable dimensions remain. The dresser regression
therefore reaches the refrigerator photo question. Requirement statuses and readyForPricing are
unchanged; a deferred ordinary pricing question still preserves its one-turn wait behavior.

Pickup and dropoff floor/elevator facts are independent. Known floor 0 and elevator=false stay valid,
early facts are retained, and updating one endpoint does not erase the other. A contextual photo
decline records NOT_AVAILABLE, is acknowledged briefly and is not asked again. The photo requirement
remains unresolved for owner review. No image upload exists.

Before either approval path, the backend supplies pendingPhotoItemIndices and requires the owner
to include each in reviewedPhotoItemIndices. This applies to REQUIRED and NOT_AVAILABLE photos.
The acknowledgement records a decision to proceed without received evidence; it neither writes
RECEIVED nor marks the original photo requirement SATISFIED. Preparing an evaluation alone leaves
collection questions intact and never sends a quote.

Unknown dresser service flags remain not applicable under the default requirements. Explicit
disassembly is displayed as disassembly; it does not imply assembly. Unknown relevant bed/wardrobe
services are clarification issues (SERVICES_UNKNOWN / SERVICE_REQUIREMENTS), while explicitly
requested unpriced services retain their manual-pricing issue. Tariffs and amount formulas are unchanged.

### Acceptance and manual coordination

The backend sends an acceptance question tied to the current quote. A clear contextual `כן`, `מאשר`,
`מאשרת` or `סגור` accepts that quote only after verifying its identity/version, explicit owner
approval, active question, current status and unchanged commercial scope. The accepted amount
comes from the quote record. A `כן` answering an elevator question is an ordinary collection reply,
not approval of some quote found in history.

Compound replies such as `כן, אבל יש גם עוד ארון`, `כן, אבל רק אחרי 18:00` and
`סגור, רק שהפריקה עכשיו בקומה 4` are not shortcut acceptances. Relevant facts go through the existing
extraction/merge workflow; material changes invalidate the old quote or return it to review.
An unextracted condition, coverage question or price objection goes to a representative for
clarification rather than accepting the existing offer. Negations do not automatically mark a Lead
LOST. No negotiation engine is introduced.

Acceptance records the quote ID/version, amount and timestamp, sets quote status ACCEPTED, and
uses Lead status WON to mean **the customer accepted the commercial quote**. WON does not mean
a scheduled move, allocated crew or completed job. Coordination remains PENDING and the customer
is told that final arrangements will be handled by a representative and the requested date is not reserved.

The owner coordination summary uses the accepted scope and amount, including items, both locations
and access, requested date/time, explicit services, unresolved details and the owner's acknowledgements.
It does not invent contact information. Later material changes require review/handoff and do not
rewrite the accepted quote or restart ordinary automatic collection. Human takeover still retains
messages without extraction or automatic replies.

### Freshness, duplicate protection and API boundaries

Pricing fingerprints protect the calculation; a separate commercial-scope fingerprint protects the
quote. Item quantities/descriptions/sizes/measurements/services, route/access, requested date/time
and special access notes are material scope facts. Photo availability alone does not change the
described commercial work. Quotes retain their original scope even if later Lead facts change.

Every owner mutation includes leadId and revision; finalization also references pricingEvaluationId.
Stale owner screens and repeated finalization cannot create duplicate quotes. Only the current
valid sent quote can be accepted; invalidated/superseded quotes cannot be accepted. Repeated
acceptance does not duplicate acceptance records or coordination summaries. In-flight extraction
blocks competing mutations/reset, and failed processing leaves the prior session intact.
Customer message requests may include quoteId and quoteVersion together; a stale supplied token
cannot accept a different quote. Even without that optional token, the backend requires its actual
current quote and active acceptance question, so a historical QUOTE_SENT status alone is insufficient.

| Endpoint | Behavior |
| --- | --- |
| GET /api/demo | Customer Lead/conversation and an explicit customer-safe quote projection; no engine evaluations, internal reasons or private owner notes. |
| POST /api/demo/message | Contextual quote replies or the existing collection workflow; preserves takeover behavior. |
| POST /api/demo/reset | Clears Lead, pricing/review history, quotes, acceptance, coordination, pending questions and handoff state. |
| GET /api/demo/owner | Current calculation, decisions/quotes, pending review information, coordination and backend-calculated actions. |
| POST /api/demo/owner/action | Validated APPROVE, ADJUST_PRICE, REQUEST_MORE_INFO or TAKE_OVER_CONVERSATION. |
| POST /api/demo/owner/pricing | Prepares/recalculates a recommendation; does not approve or send it. |
| POST /api/demo/owner/sample | Replaces the session with the synthetic fridge/15-box owner sample. |

REQUEST_MORE_INFO retains the actual owner question, makes old approval unavailable and requires
recalculation after the reply. TAKE_OVER_CONVERSATION preserves the existing human-handoff behavior.
Customer responses expose only safe quote fields (identity/version, final amount, scope, sent time,
status and acceptance); evaluation references, owner reasons, confidence and internal pricing notes
stay owner-only, including in debug data.

### Reproducible offline browser demonstration

From the repository root, build both applications and launch the opt-in fixture server:

    npm run build
    npm run demo:quote --workspace server

Open `http://127.0.0.1:3101`. The server injects a fixed reference date, 2026-10-07, and the exact
synthetic messages in `server/src/demo/quoteFixture.ts`; it makes no OpenAI calls and needs no API key.
Send these four messages in the customer view, responding to the successive questions:

1. `צריך להעביר מקרר גדול, שידה קטנה וכ-15 ארגזים מרמת גן לתל אביב. האיסוף ברחוב הדגמה 11, קומה 2 בלי מעלית.`
2. `הפריקה ברחוב הדגמה 22, קומה 1 בלי מעלית.`
3. `8/11` (stored as 2026-11-08).
4. `אין לי כרגע` when asked for the refrigerator photo.

Switch to **בעל העסק**. The real deterministic engine calculates a **950 ILS partial subtotal**:
refrigerator 425 + 15 boxes 150 + pickup stairs 250 + dropoff stairs 125. Dresser transport/access and
route distance remain unpriced; the synthetic addresses intentionally do not select a registered distance.
Open **השלם ואשר מחיר סופי**, enter **1,200**, confirm the final whole-job scope/omitted costs and
the decision to proceed without the photo, then explicitly send the quote. These confirmations
are never preselected. The 950 engine subtotal remains distinct from the 1,200 approved total.

Switch to **לקוח** and reply `כן` to the current quote's acceptance question. Both views should show
the accepted **1,200 ILS** and pending manual coordination. The owner sees the coordination summary;
neither view claims that the requested move date has been booked. Reset clears the entire flow.

The fixture additionally understands only the documented synthetic changes in quoteFixture.ts,
plus the existing narrow date/photo/acceptance paths. Other free-form messages can fail without
changing stored state. This is reproducible workflow verification, not a language model or proof
of live Hebrew extraction accuracy. The ordinary development server still uses its configured extractor.
The owner sample loader remains available for a complete 900 ILS calculation, with explicit owner
approval and any pending-photo acknowledgement still required.

Everything remains in memory in a local, single-session demo. Browser tabs share state and a
restart clears it. Switching views is not authentication; anyone with server access can use owner
endpoints. There is no database, WhatsApp/external delivery, payments, maps, availability check,
calendar, crew assignment or scheduling. View switches/actions refresh state; there is no live
cross-tab subscription. No public deployment is part of this milestone.
