import { demoRouteDistance } from './distanceAdapter.js';
import { randomUUID } from 'node:crypto';
import { createLead } from '../domain/createLead.js';
import { createMoveItem } from '../domain/createMoveItem.js';
import { evaluateRequirements } from '../domain/requirements/evaluateRequirements.js';
import { buildConversationResponse } from '../domain/conversation/buildConversationResponse.js';
import { buildPricingInput, isPricingEvaluationCurrent } from '../domain/pricing/buildPricingInput.js';
import { calculatePrice } from '../domain/pricing/calculatePrice.js';
import { ownerActionSchema, OwnerWorkflowError, type OwnerAction, type ReviewToken } from '../domain/ownerReview/types.js';
import { acceptanceMessage, customerQuoteProjection, isConditionalQuoteReply, isQuoteAcceptance,
  quoteAcceptanceQuestion, quoteMessage, quoteScopeFingerprint } from '../domain/quote/quoteScope.js';
import type { CustomerQuoteRecord, QuoteToken } from '../domain/quote/types.js';
import type { DemoSnapshot } from './types.js';
import type { OwnerDemoState, OwnerSnapshot } from './ownerTypes.js';

export const handoffText = 'תודה, העברתי את הפרטים לנציג שימשיך איתך מכאן ויחזור אליך בהקדם.';
export function freshOwnerState(): OwnerDemoState {
  const lead = createLead();
  const requirements = evaluateRequirements(lead);
  return { customer: { lead, requirements, extraction: {}, unappliedItems: [], nextQuestion: requirements.nextQuestion,
    ...buildConversationResponse(lead, requirements) }, revision: 0, pricingContext: {}, pricingEvaluation: null,
    pricingHistory: [], reviews: [], pricingStale: false, pendingOwnerQuestion: null,
    quotes: [], currentQuoteId: null, activeQuoteQuestionId: null, coordinationSummary: null };
}
const currentQuote = (state: OwnerDemoState) => state.quotes.find(quote => quote.id === state.currentQuoteId) ?? null;
const pendingPhotos = (state: OwnerDemoState) => state.customer.requirements.pendingReview
  .filter(requirement => requirement.id === 'item.photo' && requirement.itemIndex !== undefined)
  .map(requirement => requirement.itemIndex!);
function syncCustomerQuote(state: OwnerDemoState): void {
  const quote = currentQuote(state);
  if (quote) state.customer.quote = customerQuoteProjection(quote);
  else delete state.customer.quote;
}
function invalidateSentQuote(state: OwnerDemoState): void {
  const quote = currentQuote(state);
  if (quote?.status === 'SENT') quote.status = 'INVALIDATED';
  state.activeQuoteQuestionId = null;
  syncCustomerQuote(state);
}
function unresolvedDetails(state: OwnerDemoState): string[] {
  const names: Record<string, string> = { refrigerator: 'מקרר', box: 'ארגזים', wardrobe: 'ארון', dresser: 'שידה', bed: 'מיטה', washing_machine: 'מכונת כביסה' };
  const itemName = (index?: number) => index === undefined ? 'ההובלה' : names[state.customer.lead.moveDetails.items[index]?.type ?? ''] ?? `פריט ${index + 1}`;
  const titles: Record<string, string> = {
    'item.support': 'תמחור ההובלה דורש החלטת בעל העסק', 'item.photo': 'תמונה לא התקבלה',
    'item.size': 'מידות או גודל נשארו להשלמה', 'item.width': 'מידות נשארו להשלמה', 'item.height': 'מידות נשארו להשלמה', 'item.depth': 'מידות נשארו להשלמה',
    'item.quantity': 'כמות נשארה להשלמה', 'item.assembly': 'צורך בהרכבה טרם הובהר', 'item.disassembly': 'צורך בפירוק טרם הובהר',
  };
  const omitted: Record<string, string> = { UNSUPPORTED_ITEM: 'הובלה בתמחור ידני', ASSEMBLY_DISASSEMBLY: 'שירותי פירוק או הרכבה דורשים החלטת בעל העסק',
    ITEM_DIMENSIONS: 'מידות נשארו להשלמה', UNSUPPORTED_ITEM_ACCESS: 'עבודת גישה ומדרגות בתמחור ידני', DISTANCE: 'מרחק הנסיעה לא חושב',
    FLOORS: 'עבודת המדרגות לא חושבה', BOXES: 'נפח הארגזים דורש תמחור ידני', SPECIAL_DIFFICULTY: 'קשיי גישה דורשים בדיקה', EXTRA_STOP_ACCESS: 'גישה בנקודות נוספות דורשת בדיקה' };
  return [...new Set([
    ...[...state.customer.requirements.missingRequired, ...state.customer.requirements.pendingReview]
      .map(requirement => `${itemName(requirement.itemIndex)}: ${titles[requirement.id] ?? 'פרטים דורשים בדיקת בעל העסק'}`),
    ...(state.pricingEvaluation?.omittedComponents ?? []).map(part => `${itemName(part.itemIndex)}: ${omitted[part.code] ?? 'רכיב דורש תמחור ידני'}`),
  ])];
}
function isStale(state: OwnerDemoState): boolean {
  return state.pricingStale || (state.pricingEvaluation !== null &&
    !isPricingEvaluationCurrent(state.pricingEvaluation, state.customer.lead, state.pricingContext));
}
export function ownerSnapshot(state: OwnerDemoState): OwnerSnapshot {
  const status = state.customer.lead.status;
  const active = !['HUMAN_HANDOFF', 'WON', 'LOST'].includes(status);
  const stale = isStale(state);
  const reviewable = active && status === 'AWAITING_REVIEW' && !!state.pricingEvaluation && !stale && !state.pendingOwnerQuestion;
  const missing = state.customer.requirements.missingRequired;
  const manualOnly = missing.length > 0 && missing.every(requirement =>
    requirement.id === 'item.support' || requirement.availability === 'TEMPORARILY_UNAVAILABLE'
    // An owner may price the supported subtotal while unsupported furniture service
    // details remain missing. Keep the customer's requirements and questions intact.
    || (['item.assembly', 'item.disassembly'].includes(requirement.id) && requirement.itemIndex !== undefined
      && missing.some(other => other.id === 'item.support' && other.itemIndex === requirement.itemIndex)));
  const input = state.pricingEvaluation?.inputSnapshot;
  const registeredDistance = input ? demoRouteDistance(input.moveDetails) : null;
  const demoDistanceKm = registeredDistance !== null && registeredDistance === input?.context.distanceKm ? registeredDistance : null;
  return structuredClone({ customer: state.customer, revision: state.revision, pricingEvaluation: state.pricingEvaluation,
    demoDistanceKm,
    pricingHistory: state.pricingHistory, reviews: state.reviews, pricingStale: stale, pendingOwnerQuestion: state.pendingOwnerQuestion,
    quotes: state.quotes, currentQuote: currentQuote(state), coordinationSummary: state.coordinationSummary,
    pendingPhotoItemIndices: pendingPhotos(state),
    actions: { approve: reviewable && state.pricingEvaluation!.completeness === 'COMPLETE_RECOMMENDATION'
      && state.pricingEvaluation!.suggestedAmount !== null && state.pricingEvaluation!.suggestedAmount > 0, adjust: reviewable,
      requestMoreInfo: active, takeOver: active,
      recalculate: active && status !== 'QUOTE_SENT' && !state.pendingOwnerQuestion && (state.customer.requirements.readyForPricing || manualOnly) },
  });
}
export function assertReviewToken(state: OwnerDemoState, token: ReviewToken): void {
  if (state.customer.lead.id !== token.leadId || state.revision !== token.revision) {
    throw new OwnerWorkflowError('STALE_REVIEW', 'הפנייה השתנתה מאז פתיחת המסך. רעננו את הבדיקה לפני הפעולה.');
  }
}
function append(state: OwnerDemoState, text: string, sender: 'HUMAN' | 'AGENT', timestamp: string) {
  const id = randomUUID();
  state.customer.lead.messages.push({ id, sender, text, timestamp });
  state.customer.responseText = text;
  state.customer.lead.updatedAt = timestamp;
  return id;
}
export function generatePricing(state: OwnerDemoState, now: Date = new Date()): OwnerDemoState {
  if (!ownerSnapshot(state).actions.recalculate) throw new OwnerWorkflowError('ACTION_UNAVAILABLE', 'לא ניתן לחשב המלצה כרגע. יש להשלים את המידע הדרוש.');
  const next = structuredClone(state);
  next.pricingContext.distanceKm = demoRouteDistance(next.customer.lead.moveDetails);
  const evaluation = calculatePrice(buildPricingInput(next.customer.lead, next.pricingContext), { id: randomUUID(), createdAt: now.toISOString() });
  next.pricingEvaluation = evaluation;
  next.pricingHistory.push(evaluation);
  next.pricingStale = false;
  next.customer.lead.status = 'AWAITING_REVIEW';
  next.customer.lead.updatedAt = evaluation.createdAt;
  next.revision++;
  return next;
}

/** The only path that can append a price quote. Recommendation and decision stay separate. */
export function applyOwnerAction(state: OwnerDemoState, input: OwnerAction, now: Date = new Date()): OwnerDemoState {
  const action = ownerActionSchema.parse(input);
  assertReviewToken(state, action);
  const available = ownerSnapshot(state).actions;
  const allowed = { APPROVE: available.approve, ADJUST_PRICE: available.adjust,
    REQUEST_MORE_INFO: available.requestMoreInfo, TAKE_OVER_CONVERSATION: available.takeOver }[action.action];
  if (!allowed) throw new OwnerWorkflowError('ACTION_UNAVAILABLE', 'הפעולה אינה זמינה במצב הנוכחי. יש לבדוק את פרטי הפנייה וההמלצה.');
  if ('pricingEvaluationId' in action && action.pricingEvaluationId !== state.pricingEvaluation?.id) {
    throw new OwnerWorkflowError('STALE_REVIEW', 'ההמלצה השתנתה. יש לבדוק את ההמלצה העדכנית לפני אישור.');
  }
  const next = structuredClone(state);
  const createdAt = now.toISOString();
  const approvedAmount = action.action === 'APPROVE' ? next.pricingEvaluation!.suggestedAmount
    : action.action === 'ADJUST_PRICE' ? action.amount : null;
  const finalizing = action.action === 'APPROVE' || action.action === 'ADJUST_PRICE';
  const reviewedPhotoItemIndices = finalizing ? [...new Set(action.reviewedPhotoItemIndices ?? [])] : [];
  if (finalizing) {
    if (approvedAmount === null || !Number.isFinite(approvedAmount) || approvedAmount <= 0) throw new OwnerWorkflowError('ACTION_UNAVAILABLE', 'יש להזין מחיר סופי חיובי ותקין.');
    if (state.pricingEvaluation!.completeness !== 'COMPLETE_RECOMMENDATION'
      && (action.action !== 'ADJUST_PRICE' || action.scopeConfirmed !== true || action.omittedCostsAcknowledged !== true)) {
      throw new OwnerWorkflowError('ACTION_UNAVAILABLE', 'יש להשלים מחיר סופי ולאשר שהוא מכסה גם את הרכיבים שלא תומחרו.');
    }
    if (pendingPhotos(state).some(index => !reviewedPhotoItemIndices.includes(index))
      || reviewedPhotoItemIndices.some(index => index >= state.customer.lead.moveDetails.items.length)) {
      throw new OwnerWorkflowError('ACTION_UNAVAILABLE', 'יש לאשר במפורש את ההחלטה להתקדם ללא התמונה החסרה.');
    }
  }
  const decision = { APPROVE: 'APPROVED', ADJUST_PRICE: 'ADJUSTED', REQUEST_MORE_INFO: 'REQUEST_MORE_INFO', TAKE_OVER_CONVERSATION: 'HUMAN_HANDOFF' } as const;
  const review = { id: randomUUID(), leadId: next.customer.lead.id, pricingEvaluationId: next.pricingEvaluation?.id ?? null,
    suggestedAmount: next.pricingEvaluation?.suggestedAmount ?? null, approvedAmount,
    decision: decision[action.action], internalReason: action.action === 'ADJUST_PRICE' ? action.internalReason || null : null,
    customerQuestion: action.action === 'REQUEST_MORE_INFO' ? action.question : null, createdAt,
    scopeSnapshot: finalizing ? structuredClone(next.customer.lead.moveDetails) : null,
    scopeVersion: finalizing ? next.quotes.length + 1 : null,
    scopeFingerprint: finalizing ? quoteScopeFingerprint(next.customer.lead.moveDetails) : null,
    scopeConfirmed: finalizing, omittedCostsAcknowledged: finalizing && action.omittedCostsAcknowledged === true,
    reviewedPhotoItemIndices,
  };
  next.reviews.push(review);
  delete next.customer.acknowledgement;
  next.customer.nextQuestion = null;
  if (approvedAmount !== null) {
    const previous = currentQuote(next);
    if (previous && previous.status !== 'ACCEPTED') previous.status = 'SUPERSEDED';
    const quote: CustomerQuoteRecord = {
      id: randomUUID(), version: next.quotes.length + 1, leadId: next.customer.lead.id,
      pricingEvaluationId: next.pricingEvaluation!.id, ownerReviewId: review.id,
      approvedAmount, currency: 'ILS', scope: structuredClone(next.customer.lead.moveDetails),
      scopeFingerprint: review.scopeFingerprint!, sentAt: createdAt, status: 'SENT', acceptance: null,
      scopeConfirmed: true, omittedCostsAcknowledged: review.omittedCostsAcknowledged,
      reviewedPhotoItemIndices, unresolvedDetails: unresolvedDetails(next), acceptanceQuestionMessageId: '',
    };
    next.quotes.push(quote);
    next.currentQuoteId = quote.id;
    next.activeQuoteQuestionId = quote.id;
    next.pendingOwnerQuestion = null;
    next.customer.lead.status = 'QUOTE_SENT';
    next.customer.nextQuestion = { text: quoteAcceptanceQuestion, requirements: [] };
    quote.acceptanceQuestionMessageId = append(next, quoteMessage(approvedAmount), 'HUMAN', createdAt);
  } else if (action.action === 'REQUEST_MORE_INFO') {
    invalidateSentQuote(next);
    next.customer.lead.status = 'COLLECTING_INFORMATION';
    next.pendingOwnerQuestion = action.question;
    next.pricingStale = next.pricingEvaluation !== null;
    next.customer.nextQuestion = { text: action.question, requirements: [] };
    append(next, action.question, 'HUMAN', createdAt);
  } else {
    invalidateSentQuote(next);
    next.customer.lead.status = 'HUMAN_HANDOFF';
    next.pendingOwnerQuestion = null;
    append(next, handoffText, 'HUMAN', createdAt);
  }
  syncCustomerQuote(next);
  next.revision++;
  return next;
}

/** Deterministic replies to the actual current quote question; no extraction call needed. */
export function handleQuoteReply(
  state: OwnerDemoState, text: string, now: Date = new Date(), expected?: QuoteToken,
): OwnerDemoState | null {
  const quote = currentQuote(state);
  if (!quote || state.customer.lead.status === 'HUMAN_HANDOFF') return null;
  const acceptance = isQuoteAcceptance(text);
  if (state.pendingOwnerQuestion || (state.customer.nextQuestion && state.customer.nextQuestion.text !== quoteAcceptanceQuestion)) {
    return null; // An affirmative to an actual collection/owner question is not a quote reply.
  }
  if (acceptance && expected && (expected.quoteId !== quote.id || expected.quoteVersion !== quote.version)) {
    throw new OwnerWorkflowError('STALE_REVIEW', 'הצעת המחיר השתנתה. יש לבדוק את ההצעה העדכנית לפני האישור.');
  }
  if (acceptance && expected && !['SENT', 'ACCEPTED'].includes(quote.status)) {
    throw new OwnerWorkflowError('STALE_REVIEW', 'ההצעה הקודמת אינה זמינה לאישור. נדרשת הצעה עדכנית.');
  }
  const sameScope = quote.scopeFingerprint === quoteScopeFingerprint(state.customer.lead.moveDetails);
  const approval = state.reviews.find(review => review.id === quote.ownerReviewId);
  const ownerApproved = approval !== undefined && ['APPROVED', 'ADJUSTED'].includes(approval.decision)
    && approval.approvedAmount === quote.approvedAmount && quote.approvedAmount > 0 && Number.isFinite(quote.approvedAmount)
    && approval.pricingEvaluationId === quote.pricingEvaluationId && approval.scopeFingerprint === quote.scopeFingerprint
    && approval.scopeVersion === quote.version && approval.scopeConfirmed && quote.scopeConfirmed;
  if (acceptance && quote.status === 'ACCEPTED' && quote.acceptance && state.customer.lead.status === 'WON' && sameScope) {
    return state; // Retry/repeated affirmative: one acceptance and one coordination summary.
  }
  const active = quote.status === 'SENT' && state.customer.lead.status === 'QUOTE_SENT'
    && state.activeQuoteQuestionId === quote.id && !state.pendingOwnerQuestion
    && state.customer.nextQuestion?.text === quoteAcceptanceQuestion;
  if (acceptance && !active) return null;
  if (!active && quote.status !== 'ACCEPTED') return null;
  if (isConditionalQuoteReply(text)) return null; // Let structured extraction process the new facts.
  const materialLanguage = /(?:עוד\s|נוספ|קומה|כתובת|פריקה|איסוף|אחרי\s|לפני\s|\d{1,2}:\d{2})/u.test(text);
  const clarification = !materialLanguage && /[?？]|כולל|יקר|לא\b|^לא(?:\s|$)|שאלה|להוזיל/u.test(text.trim());
  if (!acceptance && !clarification) return null;
  const next = structuredClone(state);
  const timestamp = now.toISOString();
  next.customer.lead.messages.push({ id: randomUUID(), sender: 'CUSTOMER', text, timestamp });
  delete next.customer.acknowledgement;
  next.customer.nextQuestion = null;
  next.activeQuoteQuestionId = null;
  if (acceptance && sameScope && ownerApproved) {
    const accepted = currentQuote(next)!;
    accepted.status = 'ACCEPTED';
    accepted.acceptance = { quoteId: accepted.id, quoteVersion: accepted.version,
      amount: accepted.approvedAmount, acceptedAt: timestamp, coordinationStatus: 'PENDING' };
    next.customer.lead.status = 'WON'; // Commercial acceptance only; no scheduling is performed.
    next.coordinationSummary = {
      quoteId: accepted.id, quoteVersion: accepted.version, acceptedAmount: accepted.approvedAmount,
      currency: accepted.currency, acceptedAt: timestamp, status: 'PENDING', scope: structuredClone(accepted.scope),
      unresolvedDetails: [...accepted.unresolvedDetails], reviewedPhotoItemIndices: [...accepted.reviewedPhotoItemIndices],
      omittedCostsAcknowledged: accepted.omittedCostsAcknowledged,
    };
    append(next, acceptanceMessage(accepted.approvedAmount), 'AGENT', timestamp);
  } else {
    if (!sameScope || !ownerApproved) { invalidateSentQuote(next); next.pricingStale = next.pricingEvaluation !== null; }
    next.customer.lead.status = 'HUMAN_HANDOFF';
    append(next, sameScope && ownerApproved ? 'קיבלתי. נציג יבדוק את השאלה או הבקשה שלך וימשיך איתך מכאן; ההצעה לא אושרה מחדש.'
      : 'הפרטים השתנו ולכן ההצעה הקודמת אינה זמינה לאישור. נציג יבדוק את הפרטים ויחזור אליך.', 'AGENT', timestamp);
  }
  syncCustomerQuote(next);
  next.revision++;
  return next;
}

/** Applies a completed extraction atomically; preserves audit history and invalidates old approvals. */
export function acceptCustomerResult(state: OwnerDemoState, result: DemoSnapshot, now: Date = new Date()): OwnerDemoState {
  let next = structuredClone(state);
  next.customer = structuredClone(result);
  next.pricingContext.distanceKm = demoRouteDistance(next.customer.lead.moveDetails);
  next.pendingOwnerQuestion = null;
  const quote = currentQuote(next);
  const latestText = result.lead.messages.filter(message => message.sender === 'CUSTOMER').at(-1)?.text ?? '';
  // Material-looking questions were sent through extraction first. If no new fact
  // could be represented, their unanswered condition still blocks acceptance.
  const unresolvedReply = isConditionalQuoteReply(latestText) || /[?？]/u.test(latestText);
  const changedScope = quote !== null && quote.scopeFingerprint !== quoteScopeFingerprint(next.customer.lead.moveDetails);
  if (quote && (quote.status === 'SENT' || quote.status === 'ACCEPTED')) {
    if (changedScope || unresolvedReply) {
      invalidateSentQuote(next);
      next.pricingStale = next.pricingEvaluation !== null;
      next.customer.nextQuestion = null;
      if (quote.acceptance || (!changedScope && unresolvedReply)) {
        next.customer.lead.status = 'HUMAN_HANDOFF';
        if (next.coordinationSummary) next.coordinationSummary.status = 'REVIEW_REQUIRED';
        next.customer.responseText = quote.acceptance
          ? 'האישור הקודם נשמר עבור הפרטים שאושרו. השינוי החדש דורש בדיקת נציג לפני המשך התיאום.'
          : 'הבקשה החדשה דורשת בדיקת נציג. ההצעה הקודמת לא אושרה; נציג יבדוק את התנאי ויחזור אליך.';
      } else {
        next.customer.lead.status = result.requirements.readyForPricing ? 'READY_FOR_PRICING' : 'COLLECTING_INFORMATION';
        next.customer.nextQuestion = result.nextQuestion;
        next.customer.responseText = 'הפרטים השתנו, הצעת המחיר הקודמת דורשת אישור מחדש. '
          + (result.nextQuestion?.text ?? 'הפרטים יעברו לבדיקה ותמחור אצל בעל העסק.');
      }
    } else if (quote.status === 'ACCEPTED') {
      next.customer.lead.status = 'WON';
      next.customer.nextQuestion = null;
      next.customer.responseText = 'אישורך להצעת המחיר נשמר. נציג ימשיך איתך בתיאום הסופי; המועד עדיין לא שוריין.';
    } else if (state.activeQuoteQuestionId === quote.id && !state.pendingOwnerQuestion) {
      next.customer.lead.status = 'QUOTE_SENT';
      next.customer.nextQuestion = { text: quoteAcceptanceQuestion, requirements: [] };
      next.customer.responseText = `הצעת המחיר בסך ${quote.approvedAmount.toLocaleString('he-IL')} ₪ ממתינה לתשובתך. ${quoteAcceptanceQuestion}`;
    }
    syncCustomerQuote(next);
    next.revision++;
    append(next, next.customer.responseText, 'AGENT', now.toISOString());
    return next;
  }
  if (next.pricingEvaluation && isStale(next)) {
    next.pricingStale = true;
    if (!['WON', 'LOST', 'HUMAN_HANDOFF'].includes(state.customer.lead.status)) {
      next.customer.lead.status = result.requirements.readyForPricing ? 'READY_FOR_PRICING' : 'COLLECTING_INFORMATION';
    }
    if (state.customer.lead.status === 'QUOTE_SENT') next.customer.responseText = 'הפרטים השתנו, הצעת המחיר הקודמת דורשת אישור מחדש. ' + next.customer.responseText;
  }
  if (['AWAITING_REVIEW', 'READY_FOR_PRICING'].includes(next.customer.lead.status) && !next.customer.nextQuestion) {
    const reviewResponse = [next.customer.acknowledgement, 'הפרטים ממתינים לבדיקה ותמחור אצל בעל העסק.'].filter(Boolean).join(' ');
    next.customer.responseText = state.customer.lead.status === 'QUOTE_SENT'
      ? 'הפרטים השתנו, הצעת המחיר הקודמת דורשת אישור מחדש. ' + reviewResponse : reviewResponse;
  }
  next.revision++;
  if (!next.pricingEvaluation && ((result.requirements.readyForPricing && next.customer.lead.status === 'READY_FOR_PRICING')
    || (next.customer.lead.status === 'COLLECTING_INFORMATION' && !next.customer.nextQuestion && ownerSnapshot(next).actions.recalculate))) next = generatePricing(next, now);
  syncCustomerQuote(next);
  append(next, next.customer.responseText, 'AGENT', now.toISOString());
  return next;
}
export function recordHandoffMessage(state: OwnerDemoState, text: string): OwnerDemoState {
  const next = structuredClone(state);
  const timestamp = new Date().toISOString();
  next.customer.lead.messages.push({ id: randomUUID(), sender: 'CUSTOMER', text, timestamp });
  next.customer.lead.updatedAt = timestamp;
  next.revision++;
  return next;
}

/** Explicit synthetic demo scenario, never an extraction or a real customer job. */
export function sampleOwnerState(): OwnerDemoState {
  const state = freshOwnerState();
  const lead = state.customer.lead;
  lead.moveDetails = {
    items: [{ ...createMoveItem('refrigerator'), quantity: 1, sizeCategory: 'LARGE', photoStatus: 'NOT_AVAILABLE',
      dimensions: { width: 70, height: 180, depth: 60 }, requiresDisassembly: false, requiresAssembly: false },
      { ...createMoveItem('box'), quantity: 15, requiresDisassembly: false, requiresAssembly: false }],
    pickup: { city: 'רמת גן', address: 'רחוב דוגמה 1', floor: 2, elevator: false },
    dropoff: { city: 'תל אביב', address: 'רחוב דוגמה 2', floor: 5, elevator: true },
    requestedDate: '2026-10-20', requestedTime: null, specialAccessNotes: null,
  };
  lead.status = 'READY_FOR_PRICING';
  lead.messages.push({ id: randomUUID(), sender: 'CUSTOMER', text: 'תרחיש הדגמה סינתטי: מקרר גדול אחד ו-15 ארגזים, מרמת גן לתל אביב. איסוף קומה 2 ללא מעלית, פריקה קומה 5 עם מעלית שמתאימה לפריטים. ללא פירוק והרכבה; המידות 70×180×60 ס״מ.', timestamp: lead.createdAt });
  state.customer.requirements = evaluateRequirements(lead);
  state.customer.nextQuestion = null;
  state.pricingContext = { distanceKm: demoRouteDistance(lead.moveDetails), dropoffElevatorFits: true, specialDifficulty: [] };
  append(state, 'הפרטים התקבלו וממתינים לבדיקה של בעל העסק.', 'AGENT', lead.createdAt);
  return generatePricing(state);
}
