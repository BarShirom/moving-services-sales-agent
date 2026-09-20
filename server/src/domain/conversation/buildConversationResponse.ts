import type { Lead } from '../lead.js';
import type { RequirementEvaluation } from '../requirements/types.js';

export interface ConversationResponse {
  acknowledgement?: string;
  responseText: string;
}

export function buildConversationResponse(
  lead: Lead, requirements: RequirementEvaluation, acknowledgement?: string, previousLead?: Lead,
): ConversationResponse {
  for (const [index, item] of lead.moveDetails.items.entries()) {
    const previous = previousLead?.moveDetails.items[index];
    const newlyUnavailable = item.photoStatus === 'NOT_AVAILABLE' && previous?.photoStatus !== 'NOT_AVAILABLE';
    const offeredNow = item.dimensionsAvailable === true && previous?.dimensionsAvailable !== true;
    const measurementsChanged = Object.entries(item.dimensions).some(([axis, value]) =>
      value !== null && value !== previous?.dimensions[axis as keyof typeof item.dimensions]);
    const complete = Object.values(item.dimensions).every(value => value !== null && Number.isFinite(value) && value > 0);
    if (item.photoStatus === 'NOT_AVAILABLE' && complete && (newlyUnavailable || measurementsChanged)) {
      acknowledgement = 'אין בעיה, המידות התקבלו.';
    } else if (offeredNow && !complete) {
      acknowledgement = 'אין בעיה, המידות יעזרו.';
    } else if (newlyUnavailable) {
      acknowledgement = 'אין בעיה, נמשיך בלי תמונה. אם יהיה צורך, נבקש השלמה בהמשך.';
    }
  }
  let continuation = requirements.nextQuestion?.text;
  if (!continuation) {
    if (!['COLLECTING_INFORMATION', 'READY_FOR_PRICING'].includes(lead.status)) {
      continuation = 'תודה, העדכון נשמר. הצוות ימשיך לטפל בפנייה.';
    } else if (requirements.readyForPricing) {
      // Describe the next step; no external handoff or quote approval has actually happened.
      continuation = 'יש לי את הפרטים הדרושים. השלב הבא הוא בדיקה ותמחור על ידי הצוות.';
    } else {
      continuation = 'תודה, הפרטים נשמרו. נדרשת בדיקה של הצוות כדי להמשיך.';
    }
  }
  return {
    ...(acknowledgement ? { acknowledgement } : {}),
    responseText: [acknowledgement, continuation].filter(Boolean).join(' '),
  };
}
