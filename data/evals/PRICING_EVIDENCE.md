# Pricing evidence and tariff readiness

This is an evidence register, not a new price list. It records the available anonymized Rick & GO
references before further item-level pricing is designed. The current engine remains
`MOVING_PRICING_V0_1_3`; this evidence work changes no tariff, formula or approval rule and makes no
OpenAI call. Every current tariff remains provisional, including tariffs with historical support.

The machine-readable records are [pricing-evidence.json](pricing-evidence.json), and category
decisions are [pricing-tariff-readiness.json](pricing-tariff-readiness.json). Existing job evidence
in [pricing-cases.json](pricing-cases.json) is preserved and linked rather than overwritten.

The register contains **29 records**: 3 CLOSED_JOB, 6 HISTORICAL_ESTIMATE, 9 ITEM_REFERENCE,
3 SERVICE_REFERENCE, 7 BUSINESS_RULE and 1 JOB_LEVEL_CASE; there are no confirmed QUOTED_JOB
records. Evidence strength is **3 STRONG, 10 MEDIUM and 16 WEAK**. The **23 categories** comprise
**10 PROVISIONAL, 5 INSUFFICIENT_EVIDENCE, 8 MANUAL_REVIEW_ONLY and 0 READY** decisions. The six
original job fixtures remain the inputs to the existing pricing eval; these 29 evidence records
are a separate register, not 29 newly executable pricing cases.

## Provenance and interpretation

Sources are the six existing pricing cases, the [historical heuristic notes](README.md#historical-pricing-heuristics),
the [root pricing documentation](../../README.md#pricing-engine-v01-complete-and-partial-recommendations),
the current [rule configuration](../../server/src/domain/pricing/pricingRules.ts) and
[calculator](../../server/src/domain/pricing/calculatePrice.ts), and the historical pricing sections
supplied for this evidence-table task. Source references identify those sanitized records/sections;
they do not retain private attachment paths, customer identities or street addresses.

A reference repeated in this document, another README and the task is still the same source family.
Repeated documentation is not independent corroboration. An implemented rule proves what the
software currently calculates; it does not prove that the business charged that amount.

Evidence strength and tariff readiness answer different questions:

- **STRONG** is the strongest available source grade here: the three user-supplied closed-job
  records qualify at JOB_LEVEL only. This does not claim an independent financial audit, and
  their components do not inherit isolated prices. Future repeated isolated evidence would need
  distinct sources, not copies of the same reference.
- **MEDIUM** describes the more specific historical item/service ranges and business-rule reports.
  These are usable provisional references, not audited transactions or calibrated production tariffs.
- **WEAK** describes estimates, broad or open-ended references, unverified reported outcomes and
  engineering assumptions. A plausible amount does not increase its strength.
- **READY** would mean sufficient isolated evidence and an approved production rule. No category
  is READY in this register.
- **PROVISIONAL** means an existing narrow demo rule can remain under owner review; it is not
  evidence of production readiness. Boxes and distance have this status only as explicit engineering assumptions.
- **INSUFFICIENT_EVIDENCE** means available references cannot define a defensible scoped tariff.
- **MANUAL_REVIEW_ONLY** means the current system must leave the category to an owner; bundle-only
  appearances or a different service tariff do not establish its transport price.

The legacy `sourceQuality` values `closed_job`, `quoted_only` and `historical_estimate` classify
transaction provenance. The new STRONG/MEDIUM/WEAK values classify evidence strength. They must
not be interchanged. ITEM_LEVEL can support an item tariff; SERVICE_LEVEL can support only the
named service; JOB_LEVEL supports whole-job comparisons; RULE_LEVEL describes a heuristic.

The record fields keep different monetary claims separate:

- `referencePrice` is a contextual item, service or rule reference; `estimatedPrice` is an internal
  proposal/estimate. Neither proves a quote was sent or a transaction closed.
- `expectedClosePrice` and `expectedCloseRange` preserve anticipated outcomes, including 900 and
  600–650 for the bed examples. They are not `closedPrice` or `quotedPrice`.
- `priceRange` records the stated range and its limits. An open upper bound uses `max: null` with
  `upperBoundOpen: true`; the bed's 550+ note and kitchen island's 400 lower bound supply no maximum.
- `originalSourceQuality` retains the legacy job provenance; `sourceQuality` is the new evidence
  strength. `sourceBasis` and `sourceReference` identify lineage; `limitations` constrain its use.
- `humanApprovalRequired: true` applies the current product policy. It does not assert that an
  owner approved the historical job, proposal or quote.
- Readiness `evidenceIds` include related context; `tariffEvidenceIds` identify the narrower
  sources relevant to a scoped tariff. A JOB_LEVEL total cannot serve as an isolated tariff source.

## Evidence and readiness matrix

All amounts below are ILS. Reference amounts are approximate unless explicitly described as a
closed price. Evidence IDs resolve to the machine-readable register; they are not additional sources.

| Item/service | Evidence | Quality | Tariff readiness | Current decision |
| --- | --- | --- | --- | --- |
| Refrigerator transport | `ref-fridge-small`, `ref-fridge-regular`, `ref-fridge-large`: about 300, 350, and 400–450; `historical-fridge-route` supports context only | MEDIUM item references; WEAK route example | PROVISIONAL | Retain existing size bands and owner approval; no removal charge is established. |
| Washing machine transport | `ref-washing-machine`: about 280–320; linked bundles and disputed stair case are job context | MEDIUM isolated reference; other job evidence does not isolate the rate | PROVISIONAL | Retain the existing reference band; do not infer a universal stair-inclusive price. |
| Dresser transport | No identified isolated dresser price in the supplied business sources; generic furniture is not a confirmed dresser record | No qualifying isolated evidence | MANUAL_REVIEW_ONLY | Leave transport/access unpriced. Synthetic demo wardrobes/dressers are not business transactions. |
| Wardrobe transport | Wardrobe service reference and complex-job estimates do not price transport; `evidence-pricing-003` contains a cabinet, with wardrobe as related context only | WEAK estimates; STRONG related bundle without confirmed wardrobe classification | MANUAL_REVIEW_ONLY | Do not use the 350–600 service band as a transport tariff or relabel the cabinet. |
| Wardrobe disassembly/assembly | `ref-wardrobe-service`: about 350–600 depending on size/complexity | MEDIUM service reference | PROVISIONAL | Retain one eligible service bundle; unknown/complex work remains manual. |
| Bed transport | `ref-bed-transport`: about 180–550+ with mixed size/access/service conditions; two bed/mattress estimates | WEAK broad reference and job estimates | INSUFFICIENT_EVIDENCE | No isolated bed transport tariff; 550+ is not a finite upper cap. |
| Bed disassembly/assembly | `ref-bed-service`: about 180–350 | MEDIUM service reference | PROVISIONAL | Retain one eligible service bundle, separate from unsupported bed transport. |
| Sofa transport | `ref-sofa`: about 320–600; also appears in `evidence-pricing-002` | WEAK broad reference; STRONG bundle only | INSUFFICIENT_EVIDENCE | Size/access scope and isolated transactions are missing; no precise tariff. |
| Table/desk transport | `ref-table-desk`: about 250–450; a coffee table appears in a closed bundle | WEAK broad reference; STRONG bundle only | INSUFFICIENT_EVIDENCE | Do not treat desks, tables and coffee tables as one validated tariff. |
| TV transport | Televisions in `evidence-pricing-002` and `evidence-pricing-003` | STRONG job evidence only | MANUAL_REVIEW_ONLY | Bundle totals cannot isolate television handling or unit prices. |
| Dishwasher transport | `evidence-pricing-001`; additional complex-job context | STRONG job evidence only | MANUAL_REVIEW_ONLY | The 450 closed total includes both dishwasher and oven, not a dishwasher tariff. |
| Oven transport | `evidence-pricing-001` | STRONG job evidence only | MANUAL_REVIEW_ONLY | The same 450 bundle cannot also become an oven price. |
| Dryer transport | `evidence-pricing-003` | STRONG job evidence only | MANUAL_REVIEW_ONLY | No separate dryer amount or access allocation. |
| Armchair transport | `evidence-pricing-003` | STRONG job evidence only | MANUAL_REVIEW_ONLY | No separate armchair amount. |
| Electric piano transport | `evidence-pricing-003` and complex-job estimates | STRONG job evidence / WEAK estimate, both job-level | MANUAL_REVIEW_ONLY | Weight, handling/access scope and an isolated price remain unestablished. |
| Boxes | `engineering-boxes-1-10`, `engineering-boxes-11-20`, `engineering-boxes-21-30`; boxes also appear in mixed jobs | WEAK engineering assumptions; bundles do not isolate box cost | PROVISIONAL | Retain demo aggregate bands only; over 30 or unknown count requires review. |
| Stairs | `ref-stairs`: about 100–150 per relevant floor | MEDIUM rule reference | PROVISIONAL | Historical floor band; supported-load/endpoint composition is an explicit engineering assumption. |
| Distance | `engineering-distance`; no isolated historical kilometer rate | WEAK engineering assumption | PROVISIONAL | Retain the numeric demo tariff; synthetic 20 km adapters are not geographic evidence. |
| Additional stop | `ref-extra-stop`: about 200–300 | MEDIUM rule/service reference | PROVISIONAL | Retain extra-point fee; additional floor/access work stays manual. |
| Waiting | `ref-waiting`: about 150 per started half-hour in the supplied historical task | MEDIUM rule reference | PROVISIONAL | Retain explicit waiting blocks; estimated job duration is not waiting. |
| Student discount | `ref-student-discount`: 10% | MEDIUM business-rule reference | PROVISIONAL | Explicit eligibility, once; do not use the disputed 600→500 story to redefine the percentage. |
| General appliance context | `ref-general-appliance`: about 220–450 depending on item/access | WEAK broad reference | INSUFFICIENT_EVIDENCE | Context only; not a generic appliance tariff or support for every appliance type. |
| Kitchen island transport | `ref-kitchen-island`: from about 400 | WEAK lower-bound reference | INSUFFICIENT_EVIDENCE | Preserve only the lower bound; no invented upper bound, midpoint or enabled tariff. |

## Preserved job evidence and unresolved claims

The three existing closed records remain STRONG JOB_LEVEL evidence. Their reported quote and
closed amounts are already present in the repository as user-supplied evidence, not independently
audited receipts; this task does not invent sent quotes:

| Original case / linked evidence | Retained facts | Use and limitation |
| --- | --- | --- |
| `pricing-001` / `evidence-pricing-001` | Dishwasher + oven; pickup floor 3 with elevator; dropoff floor 1 without; 2 workers; quoted/closed 450 | Compare the whole bundle only. Vehicle/box counts and other unspecified facts remain unknown. |
| `pricing-002` / `evidence-pricing-002` | Sofa, 8 boxes, bed base, mattress, refrigerator, 2 TVs, coffee table; pickup floor 2 without elevator; ground-floor dropoff with elevator; 3 workers, 2 vehicles; quoted/closed 1,200 | No per-item division of the total. Preserve the recorded ground-floor elevator fact. |
| `pricing-003` / `evidence-pricing-003` | Bed, TV, washing machine, dryer, cabinet, armchair, electric piano, 25 boxes; floor 3 to floor 2 without elevators; 3 workers, 2 vehicles; quoted/closed 2,990 | Preserve cabinet as recorded; do not silently relabel it as a priced wardrobe or dresser. |

The original estimate cases remain WEAK historical estimates with unknown outcomes and no
confirmed quoted/closed price: `pricing-004` about 750, `pricing-005` about 2,200 with a 1,900–2,400
range, and `pricing-006` about 4,500. Additional task details are attributed separately in their
linked records and do not rewrite the original fixtures or constitute independent corroboration.

| Historical report | Retained evidence | Intentionally not asserted |
| --- | --- | --- |
| Bed 160×190 + mattress, floor 4 to floor 2, no elevators, no assembly | `historical-bed-stairs`: proposed about 1,000; expected close about 900 | Neither a sent quote nor a confirmed 900 close; disassembly and unspecified quantities stay unknown. |
| Bed 160×190 + mattress, pickup elevator, destination ground floor, disassembly + assembly | `historical-bed-service-route`: proposed about 700; expected close 600–650 | No confirmed close, finite per-bed tariff, inferred pickup floor or destination elevator. |
| Larger move, approximately 30 boxes and mixed inventory/access effort | Linked `evidence-pricing-005`: estimate/range retained; a reported 2,000 close is unverified | No upgrade to CLOSED_JOB or QUOTED_JOB without evidence of the relevant event. |
| Washing machine, pickup floor 3 without elevator | `historical-washer-stairs-disputed-close`: about 600 proposed and 500 reportedly closed with student discount | The close is unverified. If 600 were exact and the sole adjustment were 10%, the result would be 540. Approximate reporting leaves this ambiguous; do not infer a new discount, hidden fee or original base amount. |
| Complex multi-item move | Linked `evidence-pricing-006`: about 4,500 proposal, task range 4,200–4,600, human approval required; supplied approximate plants/boxes/suitcases, additional washer point and service context retained | No actual approval, sent quote, close, exact unspecified wardrobe/bed counts, or decomposed item prices. |
| Regular-fridge urban route and old-fridge removal inquiry | `historical-fridge-route`: reference about 350; access affects the job | Supporting context only; no measured distance, confirmed transaction or removal-service tariff. |

Expected close, proposed amount, reported close and confirmed close remain distinct claims. New
records leave quotedPrice/closedPrice unknown unless the source establishes that specific event.
Approximate supplied counts keep their qualification; absent counts stay null/omitted. Existing
seed quantities are preserved as repository facts, not extended into new inferred counts.

The bed 180–550+ reference keeps its open upper end and mixed transport/service scope. A record
may preserve the discussed 550 figure with an explicit open-bound qualifier, but it cannot treat
550 as a maximum. The kitchen-island reference establishes only a lower bound near 400. Neither
reference supplies an engine-ready closed interval or a defensible midpoint.

## Current Pricing Engine audit

This is a read-only audit of the current ten rule families. “Historically supported” means a
specific source reference exists; it does not mean a production tariff is READY. All current
rules retain owner approval and their existing component applicability checks.

| Current rule | Exact current rule in ILS | Evidence supporting it | Evidence strength | Current readiness | Action |
| --- | --- | --- | --- | --- | --- |
| Refrigerator | SMALL 300; REGULAR 350; LARGE/FOUR_DOOR 400–450, midpoint 425, per eligible unit | `ref-fridge-small/regular/large`; historical A | MEDIUM reference | PROVISIONAL | Retain unchanged; validate isolated jobs and access scope. |
| Washing machine | 280–320, midpoint 300, per known unit | `ref-washing-machine`; historical B | MEDIUM reference | PROVISIONAL | Retain unchanged; disputed stair job does not replace this band. |
| Boxes | Aggregate 1–10: 50–100 (75); 11–20: 100–200 (150); 21–30: 200–300 (250); no box item adds no charge | Three `engineering-boxes-*` records; root provisional assumptions | WEAK; no isolated historical box rate | PROVISIONAL | Engineering assumption only; retain unchanged and collect load/volume evidence. |
| Distance | First 10 km included; excess km 5–10/km (midpoint 7.5), including fractional km | `engineering-distance`; root provisional assumptions | WEAK; no historical kilometer tariff | PROVISIONAL | Engineering assumption only; require external numeric distance, never infer real geography. |
| Stairs | 100–150 (125 midpoint) per positive floor at each eligible endpoint, once for the supported load | `ref-stairs`; historical G | MEDIUM band; WEAK composition assumption | PROVISIONAL | Retain band and composition unchanged; validate load/access effects. |
| Bed service | 180–350 (265 midpoint), one bundle if either/both services are explicitly required | `ref-bed-service`; historical H | MEDIUM service reference | PROVISIONAL | Retain eligibility: quantity 1, STANDARD complexity, no explicitly pending dimensions; transport remains separate. |
| Wardrobe service | 350–600 (475 midpoint), same one-bundle eligibility | `ref-wardrobe-service`; historical H | MEDIUM service reference | PROVISIONAL | Retain unchanged; this never establishes a wardrobe transport rate. |
| Extra stop | 200–300 (250 midpoint) for each pickup/dropoff point beyond the initial two | `ref-extra-stop`; historical F | MEDIUM rule reference | PROVISIONAL | Retain unchanged; additional access remains omitted. |
| Waiting | 150 × ceiling(explicit waitingMinutes / 30) | `ref-waiting`; historical I and task's explicit started-half-hour wording | MEDIUM rule reference | PROVISIONAL | Retain unchanged; no waiting inferred from duration. |
| Student discount | 10% once, last, on all priced components when explicitly eligible | `ref-student-discount`; historical J | MEDIUM percentage; scope/composition remains provisional | PROVISIONAL | Retain unchanged; review eligibility and discount scope with the owner. |

Composition is part of the audit, not new historical fact. Appliance references include normal
handling/base transport labor; the engine adds eligible item, box, stair, distance, service, stop
and waiting components without an extra BASE charge. The simple supported load is up to two
refrigerators/washing machines and up to 30 boxes. Known appliance quantities multiply references;
the existing narrow singular-refrigerator/wardrobe convention affects detached pricing input only.
These assumptions do not change quantities stored in evidence or the Lead.

Stairs cover the eligible supported load once per endpoint, not each item. Unsupported furniture
transport/access stays manual even when a supported stair subtotal is calculated. Ground floor
has no stair charge; known no-elevator access or explicit non-fit can trigger ordinary stairs.
Unknown fit is a review issue only when explicitly required for an item. Complex load/access
limits remain unchanged. Historical floor references do not prove this exact stacking policy.

The engine uses range midpoints, adds component endpoints, rounds money to agorot and rejects
unsafe arithmetic. An eligible student discount scales both subtotal endpoints together by 0.9;
it is not an independent negative interval. Service bundles are not charged twice when both
assembly and disassembly are requested. The historical scope of which adjustments stack still
requires owner validation. None of the evidence records is loaded as a runtime pricing coefficient.

## Owner learning loop

Future business evidence should retain these distinct fields:

- Engine suggested amount and pricing rule version, with the priced scope and omitted components.
- Owner approved amount and owner adjustment amount relative to that recommendation.
- Internal adjustment reason, kept private to the owner.
- Quote sent, including its actual amount and scope/version.
- Customer accepted/rejected outcome, recorded separately from fulfilment.
- Closed/final amount only when that event and amount are established.
- Actual duration/workers/vehicles, recorded separately from estimates.

Link these events by Lead/job/quote identifiers and scope versions; anonymize public evaluation
exports and retain source limitations. Owner corrections must not automatically change tariffs.

The review sequence is:

production evidence
→ review / aggregate
→ compare engine vs owner decisions
→ identify systematic bias
→ propose rule update
→ version pricing rules
→ run evals
→ human approval of new rule version

Repeated owner corrections can identify patterns to investigate; they do not automatically become
tariffs or proof of item-level costs. Review comparable item/access/service groups, preserve
whole-job bundles as bundles, and separate discounts, scope changes and omitted-cost finalization
from model error. Price differences against weak estimates are informational, not calibrated accuracy.

In the current demo, WON means the customer accepted the commercial quote; it does not establish
fulfilment, payment, a confirmed final charge or an actually closed job. Future records must
distinguish accepted, fulfilled, paid and final-amount events. A provisional owner adjustment is
also not automatically a settled transaction. The original three closed-job records retain their
existing reported transaction evidence independently of this newer demo lifecycle meaning.

This milestone implements no automatic tariff learning, model training, production data collection
or new persistence. Future evidence must pass review and evaluation before a human approves a new
rule version. The existing human quote-finalization requirement remains in force.
