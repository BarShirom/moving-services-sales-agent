# Moving Services Sales Agent evaluation datasets

These public fixtures evaluate conversation behavior and, later, deterministic pricing.
They are evaluation data, not model-training data. No eval runner, pricing engine, or model
call is included. Passing validation proves the fixtures are structurally valid; it does not
prove the agent passes the behavioral cases or that a pricing model is accurate.

## Files and privacy boundary

- conversation-cases.json: 15 synthetic Hebrew conversation cases.
- pricing-cases.json: three user-supplied, anonymized closed-job examples.
- ../private/: local source material only; the entire data/private/ directory is Git-ignored.
  Git does not retain empty directories. Create it locally if needed after a fresh clone.

Production/customer data must be anonymized BEFORE it enters committed evals. Public committed
evals must never contain raw private customer data: no real customer names, phone numbers,
email addresses, personally identifying notes, raw WhatsApp exports, or unnecessary exact
customer addresses. Never copy an export into this directory for later cleanup.

The conversation streets explicitly use synthetic "רחוב דוגמה" labels. Cities are contextual
municipalities, not customer identities. Conversation dates are fixed synthetic references.
Pricing examples omit customer identities, contact details, cities, street addresses and dates.
Their supplied item counts, access conditions, staffing, prices and outcomes are preserved.

Before adding a fixture, manually inspect every field, including descriptions, notes and
expected responses. Preserve the business behavior while replacing identifying facts with
synthetic equivalents. The privacy checks catch obvious phones, emails and chat-export metadata;
they cannot prove anonymity or reliably identify real names or addresses. Git ignore is an
accident-prevention measure, not access control, and cannot remove previously tracked files.

## Conversation format

The file is a JSON array. IDs are stable and unique within this dataset. Required fields:

- id: lowercase letters, digits and hyphens, beginning with a letter.
- scenario: a descriptive scenario tag.
- customerMessage: the complete message, including all clauses.
- expectedAgentIntent: a nonempty list of semantic behavior targets.

Optional fields:

- description: context and the behavior being tested.
- status: regression or future. Omitted status is treated as a regression target by convention.
  A label is not an assertion that the current implementation passes the case.
- previousAgentQuestion: an object containing text and optional requirements. Each requirement
  has an id and, for an item-specific question, an itemIndex. This is the actual question asked,
  not a question inferred from the missing fields.
- currentLeadState: a partial structured Lead snapshot. The seeds contain moveDetails only.
  A future adapter should create a fresh Lead and overlay this state, retaining normal defaults
  for omitted fields. Omitted snapshots mean a fresh Lead; null means explicitly unknown.
  No fixture needs live IDs, timestamps or a real customer message history.
- referenceDate: explicit YYYY-MM-DD for date interpretation; never substitute today's date
  or infer a year from model memory.
- expectedExtraction: a partial semantic projection of the normalized domain update after
  conversion, NOT the model's keep/set/correct wire format. Only supplied paths are expectations.
  Item entries match by type when unique, not by incidental extraction-array order.
  The pure short-photo shortcut may update state without an extraction patch, so its case
  deliberately specifies expectedStateChanges instead.
- expectedStateChanges: a map of dot-separated Lead paths to expected post-turn values.
  Numeric components select item indices in the seeded/appended item order. Values may assert
  a change OR preservation of a known/unknown fact. Omitted paths do not mean deletion.
- mustNot: forbidden behaviors, interpreted semantically.

Free-text notes such as specialAccessNotes are meaning-based expectations; equivalent Hebrew
wording is valid. Neither the schema nor this milestone implements a semantic comparator.
Do not require exact conversation prose unless a future case explicitly explains why exact
wording matters. Every real bug found during manual testing should become a permanent,
anonymized regression case. Keep IDs stable as the suite grows.

The seeds cover first-message item coverage, partial/grouped replies, contextual negatives,
dates, photo refusal, offered versus supplied dimensions, combined corrections, access
difficulty, multiple facts, early information, and non-linear/off-script behavior. They encode
preservation of known facts and asking only for missing facts. A dimensions offer is not a
numeric measurement; actual measurements use centimeters.

conv-011 (old-fridge removal) is explicitly a future capability target. The current domain does
not model an additional-service workflow. Its intent expectations preserve the desired behavior
without inventing production fields or claiming the service can already be fulfilled.

## Pricing format and evidence quality

The file is a JSON array with unique stable IDs. Required fields are id, sourceQuality, items,
currency and outcome. Optional business fields may be omitted or null when unknown.

| sourceQuality | Evidence | Validation |
| --- | --- | --- |
| closed_job | Strongest evidence: an actual closed price is known. | closedPrice must be present. |
| quoted_only | A quote was sent; the final close price is unknown. | quotedPrice required; closedPrice absent/null. |
| historical_estimate | Internal or assistant estimate only; never ground truth. | estimatedPrice required; quotedPrice and closedPrice absent/null. |

Do not mix categories when selecting reference data or reporting future evaluation results.
Historical estimates belong in their own cases. estimatedPrice is an optional extension for
that category so estimates are never mislabeled as quotes or actual closed prices.
Keep quotedPrice and closedPrice separate even when equal; negotiated jobs may have different
values. These fixtures are user-provided evidence, not independently audited financial records.
Three examples do not establish a general pricing formula.

Other fields:

- items: generic type strings with positive integer quantities; independent of the narrower
  supported item types in today's conversation workflow.
- boxCount: a separate total; do not repeat boxes in items or count them twice.
- pickup and dropoff: optional floor, elevator, city and address fields. Prefer omitting
  addresses from pricing evals. Floor 0 means ground floor; false elevator is a known fact.
- requestedDate: YYYY-MM-DD or unknown.
- workers and vehicles: positive integer counts or unknown.
- specialDifficulty: an array of descriptions, or unknown. Null means not supplied, not
  "no difficulty"; an empty array means explicitly no extra difficulty.
- disassemblyAssembly: unknown, or an object with nullable disassembly/assembly booleans and
  optional notes. Do not infer these services merely from an item type.
- prices: nonnegative numeric currency units, never formatted strings.
- currency: v1 explicitly supports ILS only. Extend the allowlist deliberately before adding
  a dataset in another currency; future comparisons must not silently mix currencies.
- outcome: WON, LOST, OPEN or UNKNOWN.
- notes: anonymized provenance, missing information or qualifications only.

Seed assumptions: each singular listed non-box item has quantity 1; the second job has two
televisions. Bed base and mattress are separate items. Box counts 8 and 25 are recorded
separately. The first job's box count and vehicle count are unknown, not zero or one.
Unspecified dates, extra difficulty and assembly/disassembly details remain null. The reported
ground-floor elevator in the second job is retained without reinterpretation. All three
examples are closed_job / WON with quoted and closed prices of 450, 1200 and 2990 ILS.

## Loader and validation

server/src/evals/loadEvalCases.ts exports:

- loadEvalCases(): reads both JSON files and this README, validates public content, and
  returns conversationCases and pricingCases.
- parseConversationCases(value) and parsePricingCases(value): validate in-memory unknown
  JSON data, including decoded strings and unique IDs.
- The individual/dataset Zod schemas and inferred TypeScript case types.
- assertPublicEvalText(text): a conservative privacy tripwire.

The default loader resolves data relative to its module, so it works from server/src/evals
and server/dist/evals independently of the working directory. An optional directory URL
must end in a slash and contain both datasets and README.md. Compiled callers still need
the repository-level data/evals directory; the build does not bundle these JSON files.

The tests check parsing, minimal required fields, duplicate IDs in each dataset, valid source
quality/currency, price evidence separation, counts, dates, privacy patterns, and all public
files under this directory. There are no OpenAI calls in dataset validation.

Run from the repository root:

    npm test
    npm run typecheck
    npm run build
    git diff --check
