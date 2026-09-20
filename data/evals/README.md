# Moving Services Sales Agent evaluation datasets

These public fixtures evaluate conversation behavior and, later, deterministic pricing.
They are evaluation data, not model-training data. No eval runner, pricing engine, or model
call is included. Passing validation proves the fixtures are structurally valid; it does not
prove the agent passes the behavioral cases or that a pricing model is accurate.

## Files and privacy boundary

- conversation-cases.json: 25 synthetic Hebrew conversation cases.
- pricing-cases.json: six job-level examples: three closed jobs and three historical estimates; no confirmed quoted-only cases.
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

conv-011 and conv-025 (old-fridge removal) are explicitly future capability targets. The current domain does
not model an additional-service workflow. Its intent expectations preserve the desired behavior
without inventing production fields or claiming the service can already be fulfilled.

The expansion conv-016 through conv-025 adds ten intent/state cases: extra facts in an address
reply, an early date with complete dropoff details, an address-only grouped answer, pickup
correction during photo collection, a photo decline with offered dimensions, a photo decline
with actual dimensions, simultaneous measurements and a floor correction, stair carry despite
an existing elevator, unknown floor information pending a customer check, and a removal request.
The access case retains elevator=true while recording that the refrigerator cannot fit.
The unknown-floor case requires acknowledgement without inventing a value or satisfying the
missing requirement. Existing conv-001 through conv-015 remain unchanged.

## Pricing format and evidence quality

The file is a JSON array with unique stable IDs. Required fields are id, sourceQuality, items,
currency and outcome. Optional business fields may be omitted or null when unknown.

| sourceQuality | Evidence | Validation |
| --- | --- | --- |
| closed_job | Strongest evidence: an actual closed price is known. | closedPrice must be present. |
| quoted_only | A quote was sent; the final close price is unknown. | quotedPrice required; closedPrice absent/null. |
| historical_estimate | Internal or assistant estimate only; never ground truth. | estimatedPrice or priceRange required; quotedPrice and closedPrice absent/null. |

Do not mix categories when selecting reference data or reporting future evaluation results.
Historical estimates belong in their own cases. estimatedPrice is an optional extension for
that category so estimates are never mislabeled as quotes or actual closed prices.
Keep quotedPrice and closedPrice separate even when equal; negotiated jobs may have different
values. These fixtures are user-provided evidence, not independently audited financial records.
These examples do not establish a general pricing formula.

Other fields:

- items: generic type strings with positive integer quantities, or null for unknown counts; independent of the narrower
  supported item types in today's conversation workflow. Optional sizeCategory retains known size information.
- boxCount: a separate total; do not repeat boxes in items or count them twice.
- pickup and dropoff: optional floor, elevator, city and address fields. Prefer omitting
  addresses from pricing evals. Floor 0 means ground floor; false elevator is a known fact.
- requestedDate: YYYY-MM-DD or unknown.
- workers and vehicles: positive integer counts or unknown.
- specialDifficulty: an array of descriptions, or unknown. Null means not supplied, not
  "no difficulty"; an empty array means explicitly no extra difficulty.
- disassemblyAssembly: unknown, or an object with nullable disassembly/assembly booleans and
  optional notes. Do not infer these services merely from an item type.
- prices: strictly positive numeric currency units, never formatted strings. Unknown prices stay omitted/null.
- currency: v1 explicitly supports ILS only. Extend the allowlist deliberately before adding
  a dataset in another currency; future comparisons must not silently mix currencies.
- outcome: WON, LOST, OPEN or UNKNOWN.
- notes: anonymized provenance, missing information or qualifications only. Approximate box/item
  counts are explicitly qualified here; do not treat them as exact inventory measurements.
- evidenceNote: optional sanitized explanation of the source and what it does or does not establish.
- priceRange: optional historical-estimate range with positive min/max and min <= max. It can
  stand alone without an invented midpoint. If estimatedPrice is also supplied, it must lie
  within the range. Reference ranges cannot be attached to closed_job or quoted_only records.
- humanApprovalRequired: optional evidence that approval was required, not proof it was granted.

Original seed assumptions: each singular listed non-box item has quantity 1; the second job has two
televisions. Bed base and mattress are separate items. Box counts 8 and 25 are recorded
separately. The first job's box count and vehicle count are unknown, not zero or one.
Unspecified dates, extra difficulty and assembly/disassembly details remain null. The reported
ground-floor elevator in the second job is retained without reinterpretation. The original three
examples are closed_job / WON with quoted and closed prices of 450, 1200 and 2990 ILS.

## Job evidence versus historical pricing heuristics

Job-level evidence concerns a specific move, its known inventory/access conditions, and an
actual quote/close or an internal job estimate. A heuristic describes a reusable reference
band or possible adjustment without documenting a specific transaction. They must not be
mixed as equivalent evaluation targets.

closed_job is the strongest evidence because an actual final price is known. quoted_only is
weaker: a sent quote does not establish the final outcome or price. historical_estimate is
not ground truth and must never be promoted based on a recommendation alone. Source-quality
validation separates the categories; it cannot independently verify that a transaction occurred.

The historical expansion was checked against available repository/context evidence:

| Case | Dataset entry | Evidence retained |
| --- | --- | --- |
| C: small refrigerator and washing machine | pricing-004 | Approximately 750 ILS recommended; pickup floor 3 without elevator; dropoff floor 1, elevator unknown. |
| D: larger move, approximately 30 boxes | pricing-005 | Internal range 1,900–2,400 ILS and recommendation around 2,200 ILS; access difficulty at both ends, exact conditions unknown. |
| E: complex multi-item move | pricing-006 | Approximately 4,500 ILS discussed/proposed; human approval required for multiple points/floors/access complexity. |

All three additions are historical_estimate with outcome UNKNOWN and null quotedPrice/closedPrice.
The historical request is the source of these sanitized summaries. No available repository
evidence confirms that the recommendations were sent as quotes. In particular, the conditional
report of a roughly 2,000 ILS close for case D is not corroborated, so no closed price or WON
outcome is recorded for it. Approval of case E is also unknown.

Unspecified item counts are null, not fabricated quantities. The approximate counts for boxes,
plants and suitcases are retained as supplied and qualified in notes. The generic furniture
description in case D may overlap listed items; future evaluation must not double-count it.
Unknown workers, vehicles, dates, floors and elevator conditions remain unknown. Existing
pricing-001 through pricing-003 are unchanged.

### Historical pricing heuristics

These user-supplied Rick & GO references are historical, context-dependent design inputs,
not confirmed closed jobs or automatically enabled current pricing rules. Cases A and B
are documented here because they are item reference bands without a specific route/job;
cases F–J are rule-level references. None is represented by a fabricated job in the dataset.

| Reference | Historical amount/rule in ILS |
| --- | --- |
| A: small refrigerator | Around 300 |
| A: regular refrigerator | Around 350 |
| A: large / four-door refrigerator | Around 400–450 |
| B: washing machine | Approximately 280–320 |
| F: additional pickup/dropoff point | Around 200–300 |
| G: floors without elevator | Approximately 100–150 per floor, depending on job context |
| H: bed disassembly/assembly | Approximately 180–350 |
| H: wardrobe disassembly/assembly | Approximately 350–600, depending on size/complexity |
| I: waiting time | Approximately 150 per half-hour |
| J: student discount | Reported historical rule of 10% |

There are six defensible job-level cases, rather than a forced target of eight to twelve.
The references above remain available for future Pricing Engine design without contaminating
closed-job ground truth. A future Pricing Engine must not simply memorize examples or assume
every adjustment stacks independently. It should use deterministic rules with explicit
conditions and human approval for uncertain or complex jobs. This milestone implements no
pricing calculations, discounts or approval automation.

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
