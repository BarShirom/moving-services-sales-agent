import type { Lead } from '../lead.js';
import type { RequirementEvaluation } from '../requirements/types.js';

export interface ConversationResponse {
  acknowledgement?: string;
  responseText: string;
}

export function buildConversationResponse(
  lead: Lead, requirements: RequirementEvaluation, acknowledgement?: string,
): ConversationResponse {
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
