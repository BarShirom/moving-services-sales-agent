import { z } from 'zod';
import { fingerprintPricingInput, pricingInputSchema } from './buildPricingInput.js';
import { midpoint, money, pricingRules as rules, sumRanges } from './pricingRules.js';
import type { EvaluationMetadata, PriceRange, PricingComponent, PricingEvaluation, PricingInput, ReviewReason, OmittedComponent } from './types.js';

/** Facts only, no I/O, clock, random IDs, geocoding or LLM calls. */
export function calculatePrice(input: PricingInput, metadata: EvaluationMetadata): PricingEvaluation {
  const snapshot = pricingInputSchema.parse(input);
  const audit = z.object({ id: z.string().trim().min(1), createdAt: z.iso.datetime() }).strict().parse(metadata);
  const move = snapshot.moveDetails;
  const context = snapshot.context;
  const breakdown: PricingComponent[] = [];
  const omittedComponents: OmittedComponent[] = [];
  const reviewReasons: ReviewReason[] = [];
  const score = rules.confidence;
  let incomplete = false;
  let manual = false;
  const review = (code: string, message: string, deduction: number, missingComponent = false, needsManual = true) => {
    if (!reviewReasons.some(reason => reason.code === code)) reviewReasons.push({ code, message, confidenceDeduction: deduction });
    incomplete ||= missingComponent;
    manual ||= needsManual;
  };
  const omit = (code: string, quantity: number | null, reason: string, itemIndex?: number) => {
    incomplete = true;
    omittedComponents.push({ code, quantity, reason, ...(itemIndex === undefined ? {} : { itemIndex }) });
  };
  const component = (code: PricingComponent['code'], label: string, range: PriceRange, basis: string, reference: string, amount = midpoint(range)) => {
    breakdown.push({ code, label, range: { min: money(range.min), max: money(range.max) }, amount: money(amount), basis, source: reference });
  };
  const historical = (reference: string) => `${rules.source} (reference ${reference})`;
  const assumption = (code: string, message: string) => review(code, message, score.assumption, false, false);
  review('PROVISIONAL_RULES', 'Historical bands and new engineering assumptions are provisional; owner approval is always required.', score.provisional, false, false);
  if (snapshot.assumptions.singularRefrigeratorQuantity.length || snapshot.assumptions.singularWardrobeQuantity.length) {
    assumption('SINGULAR_ITEM_QUANTITY', 'Unique refrigerator/wardrobe rows use one unit for pricing; unknown Lead quantities remain unchanged.');
  }
  if (!context.inventoryComplete) review('INCOMPLETE_INVENTORY', 'Inventory totals are incomplete or approximate.', score.complexity, true);
  if (move.items.length === 0) review('NO_ITEMS', 'No inventory is available.', score.unsupported, true);
  if (move.requestedDate === null) review('MISSING_DATE', 'Requested date is unknown; no seasonal surcharge is assumed.', score.missing);
  if (new Set(move.items.map(item => item.type)).size > rules.review.maxItemTypes) review('MANY_ITEM_TYPES', 'Inventory exceeds the simple three-type scope.', score.complexity, true);
  const appliances = move.items.filter(item => item.type === 'refrigerator' || item.type === 'washing_machine');
  const applianceCount = appliances.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
  const complexInventory = applianceCount > rules.review.maxAppliances;
  if (complexInventory) review('HIGH_VOLUME', 'More than two appliances needs manual load planning.', score.complexity, true);
  if (applianceCount > 1 && !complexInventory) assumption('ITEM_COMPOSITION', 'Appliance references add once per known unit; no extra base handling charge.');
  const specialAccess = move.specialAccessNotes !== null || (context.specialDifficulty?.length ?? 0) > 0;
  if (specialAccess) {
    review('SPECIAL_ACCESS', 'Explicit access notes require human assessment; no arbitrary difficulty fee.', score.complexity, true);
    omit('SPECIAL_DIFFICULTY', null, 'Access difficulty beyond ordinary stair work is not priced.');
  } else if (context.specialDifficulty === null) review('ACCESS_UNKNOWN', 'Absence of notes does not confirm easy access; owner should validate the ordinary-access recommendation.', score.missing);

  const pricedTransportItems = new Set<number>();
  const unsupportedItemIndices: number[] = [];
  move.items.forEach((item, index) => {
    const prefix = `ITEM_${index}`;
    const quantity = item.quantity;
    const supportedTransport = ['refrigerator', 'washing_machine', 'box'].includes(item.type ?? '');
    const dimensionsPending = item.dimensionsAvailable === false && Object.values(item.dimensions).some(value => value === null);
    if (dimensionsPending) {
      review(prefix + '_DIMENSIONS_UNAVAILABLE', 'Customer cannot supply all dimensions yet; measurements remain pending for owner review.', score.missing);
      if (!supportedTransport) omit('ITEM_DIMENSIONS', quantity, `Item ${index}: dimensions remain unavailable for manual assessment.`, index);
    }
    if (quantity === null) review(prefix + '_QUANTITY', 'Item quantity is unknown and cannot use the singular-item pricing assumption.', score.missing, true);
    const service = Object.hasOwn(rules.services, item.type ?? '') ? rules.services[item.type as keyof typeof rules.services] : null;
    if (item.requiresAssembly === true || item.requiresDisassembly === true) {
      if (service && quantity === 1 && context.serviceComplexity[String(index)] === 'STANDARD' && !dimensionsPending) {
        component('ASSEMBLY_DISASSEMBLY', `${item.type}: requested service bundle`, service,
          `Item ${index}: explicitly standard service, one combined charge if either or both services are required; full historical band midpoint.`, historical('H'));
        assumption('SERVICE_COMPOSITION', 'One historical service bundle per item, not separate duplicated assembly/disassembly charges.');
      } else {
        review(prefix + '_SERVICES_MANUAL', 'Requested assembly/disassembly needs manual pricing: standard complexity, dimensions, type or quantity are unresolved.', score.manualService, true);
        omit('ASSEMBLY_DISASSEMBLY', quantity, `Item ${index}: requested services require manual pricing.`, index);
      }
    } else if (service && (item.requiresAssembly === null || item.requiresDisassembly === null)) {
      // Existing bed/wardrobe policies make these questions relevant. An unsupported
      // transport tariff alone does not establish service needs for a dresser or other item.
      review(prefix + '_SERVICES_UNKNOWN', 'Whether assembly/disassembly is needed remains unknown; clarify before pricing any applicable service.', score.manualService, true);
      omit('SERVICE_REQUIREMENTS', quantity, `Item ${index}: clarify whether assembly/disassembly is needed; no required service is assumed.`, index);
    }
    if (item.type === 'box') return; // Aggregate all box rows before selecting one volume band.
    if (item.type !== 'refrigerator' && item.type !== 'washing_machine') {
      unsupportedItemIndices.push(index);
      review(prefix + '_UNSUPPORTED', `Unsupported transport item: ${item.type ?? 'unknown'}. Services do not price its transport.`, score.unsupported, true);
      omit('UNSUPPORTED_ITEM', quantity, `Item ${index}: no transport tariff for ${item.type ?? 'unknown'}.`, index);
      return;
    }
    if (item.photoStatus !== 'RECEIVED' && !Object.values(item.dimensions).every(value => value !== null)) review(prefix + '_VISUAL_EVIDENCE', 'Neither a received photo nor complete dimensions are available.', score.noVisualEvidence);
    const band = item.type === 'washing_machine' ? rules.washingMachine
      : item.sizeCategory !== null && Object.hasOwn(rules.refrigerator, item.sizeCategory)
        ? rules.refrigerator[item.sizeCategory as keyof typeof rules.refrigerator] : null;
    if (!band) review(prefix + '_SIZE', 'A supported fridge category is needed; dimensions do not imply a size category.', score.missing, true);
    if (band && quantity !== null && !complexInventory) {
      pricedTransportItems.add(index);
      component(item.type === 'refrigerator' ? 'REFRIGERATOR' : 'WASHING_MACHINE', `${item.type === 'refrigerator' ? item.sizeCategory : 'Washing machine'} x ${quantity}`,
        { min: band.min * quantity, max: band.max * quantity }, `${quantity} x historical item band; base handling included, no separate BASE charge.`, historical(item.type === 'refrigerator' ? 'A' : 'B'));
    } else omit(item.type === 'refrigerator' ? 'REFRIGERATOR' : 'WASHING_MACHINE', quantity, 'Missing category/quantity or inventory exceeds simple appliance limit.', index);
  });

  const boxes = move.items.filter(item => item.type === 'box');
  const boxQuantity = boxes.some(item => item.quantity === null) ? null : boxes.reduce((sum, item) => sum + item.quantity!, 0);
  if (boxes.length && boxQuantity !== null && boxQuantity <= rules.review.maxBoxes) {
    move.items.forEach((item, index) => { if (item.type === 'box') pricedTransportItems.add(index); });
    const band = rules.boxes.find(rule => boxQuantity <= rule.upTo)!;
    component('BOXES', `${boxQuantity} boxes`, band, `${boxQuantity} total boxes: one job-level volume band, not a large-item fee per box.`, rules.assumptionSource);
    assumption('PROVISIONAL_BOX_RATE', 'Box bands are explicit engineering assumptions; historical mixed jobs do not isolate a box tariff.');
  } else if (boxes.length) {
    review('HIGH_VOLUME', 'Unknown box count or more than 30 boxes requires volume assessment.', score.complexity, true);
    omit('BOXES', boxQuantity, 'Unknown quantity or outside the supported volume bands.');
  }

  const hasTransport = breakdown.some(part => ['REFRIGERATOR', 'WASHING_MACHINE', 'BOXES'].includes(part.code));
  // These heuristics are supplements, never a standalone quote for unknown inventory.
  if (context.distanceKm === null) {
    review('MISSING_DISTANCE', 'Numeric route distance is missing; addresses and distance bands cannot substitute for kilometers.', score.missingDistance, true);
    omit('DISTANCE', null, 'A route adapter must supply numeric distance.');
  } else if (hasTransport) {
    const extraKm = Math.max(0, context.distanceKm - rules.distance.includedKm);
    component('DISTANCE', 'Route distance', { min: extraKm * rules.distance.perKm.min, max: extraKm * rules.distance.perKm.max },
      `${context.distanceKm} km; first ${rules.distance.includedKm} km included in handling, ${extraKm} additional km at ${rules.distance.perKm.min}-${rules.distance.perKm.max} ILS/km.`, rules.assumptionSource);
    assumption('PROVISIONAL_DISTANCE_RATE', 'Included distance and per-km bands are engineering assumptions, not inferred historical route costs.');
  }
  const stairScope = hasTransport && !complexInventory && boxQuantity !== null && boxQuantity <= rules.review.maxBoxes
    && move.items.every((item, index) => !['refrigerator', 'washing_machine', 'box'].includes(item.type ?? '')
      || (item.quantity !== null && pricedTransportItems.has(index)));
  let supportedStairsPriced = false;
  for (const side of ['pickup', 'dropoff'] as const) {
    const location = move[side];
    const fits = context[`${side}ElevatorFits`];
    if (location.city === null || location.address === null) review(side + '_LOCATION', `${side} location is incomplete.`, score.missing);
    if (location.floor === null) { review(side + '_FLOOR', `${side} floor is unknown.`, score.missing, true); omit('FLOORS', null, `${side}: floor unknown.`); }
    if (location.elevator === null && location.floor !== 0) review(side + '_ELEVATOR', `${side} elevator availability unknown.`, score.missing, true);
    if (location.elevator === true && fits === null && location.floor !== 0
      && context[`${side}ElevatorFitRequiredItems`].length) {
      review(side + '_ELEVATOR_FIT_UNKNOWN', `${side} item fit is explicitly required for item indices ${context[`${side}ElevatorFitRequiredItems`].join(', ')} and remains unknown.`, score.missing, true);
    }
    if (location.floor !== null && location.floor < 0) { review(side + '_BASEMENT', 'Basement access requires manual assessment.', score.complexity, true); omit('FLOORS', location.floor, `${side}: basement policy unavailable.`); }
    if (fits === false && location.floor !== 0) {
      review(side + '_ELEVATOR_DOES_NOT_FIT', `${side}: elevator existence preserved; price ordinary stairs but additional carrying difficulty remains unpriced.`, score.complexity, true);
      omit('SPECIAL_DIFFICULTY', null, `${side}: non-fitting elevator requires access assessment beyond ordinary stairs.`);
    }
    if (location.floor !== null && location.floor > 0 && (location.elevator === false || fits === false)) {
      if (stairScope) {
        supportedStairsPriced = true;
        component('FLOORS', `${side} stair carry`, { min: location.floor * rules.stairsPerFloor.min, max: location.floor * rules.stairsPerFloor.max },
          `${location.floor} floors x ${rules.stairsPerFloor.min}-${rules.stairsPerFloor.max} ILS, once per endpoint for the priced supported load only; unsupported item access excluded.`, historical('G'));
        assumption('FLOOR_COMPOSITION', 'Pickup and dropoff stair floors add once per endpoint for up to two appliances and 30 boxes.');
      } else { review(side + '_FLOOR_RULE_NOT_APPLIED', 'Complex inventory prevents applying the simple-load stair band.', score.noRate, true); omit('FLOORS', location.floor, `${side}: complex load.`); }
    }
  }
  if (supportedStairsPriced) {
    for (const index of unsupportedItemIndices) {
      omit('UNSUPPORTED_ITEM_ACCESS', move.items[index].quantity, `Item ${index}: its stair/access work is excluded from the supported-load subtotal and requires manual pricing.`, index);
    }
  }
  const stops = context.pickupPoints + context.dropoffPoints - 2;
  if (stops > 0) {
    if (hasTransport) component('EXTRA_STOP', `${stops} additional stops`, { min: stops * rules.extraStop.min, max: stops * rules.extraStop.max }, `${stops} extra points x 200-300 ILS; access costs at additional points excluded.`, historical('F'));
    review('MULTIPLE_POINTS', 'Additional point fees are known, but additional access details are not modeled.', score.complexity, true);
    omit('EXTRA_STOP_ACCESS', stops, 'Additional floors/access require manual review; supplied distance must cover the whole route.');
  }
  if (context.waitingMinutes > 0 && hasTransport) {
    const blocks = Math.ceil(context.waitingMinutes / rules.waiting.minutesPerBlock);
    const amount = money(blocks * rules.waiting.amountPerBlock);
    component('WAITING', 'Explicit waiting time', { min: amount, max: amount }, `${context.waitingMinutes} minutes rounded up to ${blocks} half-hour blocks x 150 ILS.`, historical('I'));
    assumption('WAITING_ROUNDING', 'Started half-hours round upward; waiting is distinct from estimated job duration.');
  }
  if (context.workers !== null && context.workers > rules.review.maxWorkers) review('WORKERS_COMPLEXITY', 'Staffing suggests a complex job; no worker tariff is invented.', score.complexity);
  if (context.estimatedDurationHours !== null && context.estimatedDurationHours > rules.review.maxDurationHours) review('DURATION_COMPLEXITY', 'Duration suggests a complex job; no labor/time tariff is invented.', score.complexity);

  let priceRange = breakdown.length ? sumRanges(breakdown.map(part => part.range)) : null;
  let suggestedAmount = breakdown.length ? money(breakdown.reduce((sum, part) => sum + part.amount, 0)) : null;
  if (context.studentDiscountEligible && suggestedAmount !== null && priceRange) {
    // Correlated reduction: derive total bounds first, not independent interval addition.
    const discounted = { min: money(priceRange.min * (1 - rules.studentDiscount)), max: money(priceRange.max * (1 - rules.studentDiscount)) };
    const approvedBase = money(suggestedAmount * (1 - rules.studentDiscount));
    component('DISCOUNT', 'Student discount', { min: money(discounted.max - priceRange.max), max: money(discounted.min - priceRange.min) },
      'Explicit eligibility: 10% off the priced subtotal, including services/route; excluded costs remain excluded.', historical('J'), money(approvedBase - suggestedAmount));
    suggestedAmount = approvedBase;
    priceRange = discounted;
    assumption('DISCOUNT_SCOPE', '10% applies once after all priced components; eligibility must be explicitly supplied.');
  }
  // Quantity, dimensions and service details for the same unpriced furniture item
  // explain one unresolved item-cost risk. Retain every note, charging only its
  // strongest deduction once. Distinct items and supported-load risks stay separate.
  for (const index of unsupportedItemIndices) {
    const reasons = reviewReasons.filter(reason => reason.code.startsWith(`ITEM_${index}_`));
    const strongest = reasons.reduce<ReviewReason | undefined>((selected, reason) =>
      !selected || reason.confidenceDeduction > selected.confidenceDeduction ? reason : selected, undefined);
    for (const reason of reasons) if (reason !== strongest) reason.confidenceDeduction = 0;
  }
  const completeness = suggestedAmount === null ? 'CANNOT_PRICE' : incomplete ? 'PARTIAL_RECOMMENDATION' : 'COMPLETE_RECOMMENDATION';
  return { ...audit, leadId: snapshot.leadId, ruleVersion: rules.version, provisional: true, currency: 'ILS',
    status: suggestedAmount === null ? 'CANNOT_PRICE' : incomplete || manual ? 'MANUAL_REVIEW_REQUIRED' : 'RECOMMENDATION_READY',
    completeness, amountScope: completeness === 'COMPLETE_RECOMMENDATION' ? 'FULL_JOB' : 'SUPPORTED_COMPONENTS_ONLY', suggestedAmount, priceRange,
    confidence: suggestedAmount === null ? 0 : Math.max(0, 100 - reviewReasons.reduce((sum, reason) => sum + reason.confidenceDeduction, 0)),
    humanApprovalRequired: true, breakdown, omittedComponents, reviewReasons, inputSnapshot: snapshot, inputFingerprint: fingerprintPricingInput(snapshot) };
}
