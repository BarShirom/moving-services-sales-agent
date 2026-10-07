import { acknowledgeEvent, type ConversationEvent } from './conversationEvents.js';
import type { Lead } from '../lead.js';
import type { RequirementEvaluation } from '../requirements/types.js';

export interface ConversationResponse {
  acknowledgement?: string;
  responseText: string;
}

function itemLabel(lead: Lead, index: number): string {
  const labels: Record<string, string> = {
    refrigerator: 'המקרר', wardrobe: 'הארון', dresser: 'השידה', bed: 'המיטה', washing_machine: 'מכונת הכביסה',
  };
  const type = lead.moveDetails.items[index]?.type;
  return type && Object.hasOwn(labels, type) ? labels[type] : `פריט ${index + 1}`;
}

export function buildConversationResponse(
  lead: Lead, requirements: RequirementEvaluation, acknowledgement?: string, previousLead?: Lead, events: ConversationEvent[] = [],
): ConversationResponse {
  const waitingForCustomer = events.some(event => event.type === 'CUSTOMER_WILL_CONFIRM_LATER');
  const pendingDimensions = requirements.requirements.filter(result => result.availability === 'TEMPORARILY_UNAVAILABLE');
  const finalPendingSummary = !requirements.nextQuestion && !waitingForCustomer && !requirements.readyForPricing
    && ['COLLECTING_INFORMATION', 'READY_FOR_PRICING'].includes(lead.status) && pendingDimensions.length > 0;
  const acknowledgements = new Set<string>();
  if (acknowledgement) acknowledgements.add(acknowledgement);
  for (const [index, item] of lead.moveDetails.items.entries()) {
    acknowledgement = undefined;
    const previous = previousLead?.moveDetails.items[index];
    const newlyUnavailable = item.photoStatus === 'NOT_AVAILABLE' && previous?.photoStatus !== 'NOT_AVAILABLE';
    const offeredNow = item.dimensionsAvailable === true && previous?.dimensionsAvailable !== true;
    const measurementsChanged = Object.entries(item.dimensions).some(([axis, value]) =>
      value !== null && value !== previous?.dimensions[axis as keyof typeof item.dimensions]);
    const complete = Object.values(item.dimensions).every(value => value !== null && Number.isFinite(value) && value > 0);
    if (item.dimensionsAvailable === false && previous?.dimensionsAvailable !== false && !complete) {
      const services = [item.requiresDisassembly === true && 'פירוק', item.requiresAssembly === true && 'הרכבה'].filter(Boolean);
      const dimensionsText = finalPendingSummary ? '' : `המידות של ${itemLabel(lead, index)} לא זמינות כרגע ונשארו להשלמה.`;
      const servicesText = services.length ? `נרשם הצורך ב${services.join(' ו')}.` : '';
      const message = [dimensionsText, servicesText].filter(Boolean).join(' ');
      if (message) acknowledgements.add(message);
    }
    if (item.photoStatus === 'NOT_AVAILABLE' && complete && (newlyUnavailable || measurementsChanged)) {
      acknowledgement = 'אין בעיה, המידות התקבלו.';
    } else if (offeredNow && !complete) {
      acknowledgement = 'אין בעיה, המידות יעזרו.';
    } else if (newlyUnavailable) {
      acknowledgement = 'אין בעיה, נמשיך בלי תמונה.';
    }
    if (acknowledgement) acknowledgements.add(acknowledgement);
  }
  for (const event of events.filter(event => event.type !== 'EXTRA_INFORMATION_RECEIVED')) {
    const message = acknowledgeEvent(event);
    if (message) acknowledgements.add(message);
  }
  if (!acknowledgements.size && events.some(event => event.type === 'EXTRA_INFORMATION_RECEIVED')) {
    acknowledgements.add('מעולה, קיבלתי.');
  }
  acknowledgement = [...acknowledgements].join(' ') || undefined;
  let continuation = requirements.nextQuestion?.text;
  if (!continuation && !waitingForCustomer) {
    if (!['COLLECTING_INFORMATION', 'READY_FOR_PRICING'].includes(lead.status)) {
      continuation = 'תודה, העדכון נשמר. הצוות ימשיך לטפל בפנייה.';
    } else if (requirements.readyForPricing) {
      // Describe the next step; no external handoff or quote approval has actually happened.
      continuation = 'יש לי את הפרטים הדרושים. השלב הבא הוא בדיקה ותמחור על ידי הצוות.';
    } else {
      const pendingItemLabels = [...new Set(pendingDimensions.flatMap(result =>
        result.itemIndex === undefined ? [] : [itemLabel(lead, result.itemIndex)]))];
      const pendingLabel = pendingItemLabels.length ? ` של ${pendingItemLabels.join(' ו')}` : '';
      continuation = pendingDimensions.length
        ? `המידות${pendingLabel} נשארו להשלמה, והפרטים יעברו עכשיו לבדיקה ותמחור אצל בעל העסק.`
        : 'הפרטים יעברו עכשיו לבדיקה ותמחור אצל בעל העסק.';
    }
  }
  return {
    ...(acknowledgement ? { acknowledgement } : {}),
    responseText: [acknowledgement, continuation].filter(Boolean).join(' '),
  };
}
