import type { Lead } from '../lead.js';
import type { NextQuestion, RequirementEvaluation } from '../requirements/types.js';

type RequirementRef = NextQuestion['requirements'][number];
type Fact = { id: string; itemIndex?: number; label: string; value: string | number | boolean | null };

// Latest-turn observations only: never persisted on the Lead or used as pricing facts.
export type ConversationEvent =
  | { type: 'CORRECTION_APPLIED'; label: string; value: string | number | boolean }
  | { type: 'EXTRA_INFORMATION_RECEIVED' }
  | { type: 'ACCESS_DIFFICULTY_RECORDED'; notes: string }
  | { type: 'CUSTOMER_WILL_CONFIRM_LATER'; requirements: RequirementRef[] };

function facts(lead: Lead): Fact[] {
  const move = lead.moveDetails;
  const result: Fact[] = [];
  for (const side of ['pickup', 'dropoff'] as const) {
    const location = side === 'pickup' ? 'האיסוף' : 'הפריקה';
    for (const [field, label] of [
      ['city', 'עיר'], ['address', 'כתובת'], ['floor', 'קומת'], ['elevator', 'זמינות המעלית בכתובת'],
    ] as const) {
      result.push({ id: `${side}.${field}`, label: `${label} ${location}`, value: move[side][field] });
    }
  }
  result.push({ id: 'requestedDate', label: 'תאריך ההובלה', value: move.requestedDate });
  result.push({ id: 'requestedTime', label: 'שעת ההובלה', value: move.requestedTime });
  move.items.forEach((item, itemIndex) => {
    for (const [field, id, label] of [
      ['type', 'type', 'סוג'], ['quantity', 'quantity', 'כמות'], ['sizeCategory', 'size', 'גודל'],
      ['requiresDisassembly', 'disassembly', 'הצורך בפירוק'], ['requiresAssembly', 'assembly', 'הצורך בהרכבה'],
    ] as const) {
      result.push({ id: `item.${id}`, itemIndex, label: `${label} פריט ${itemIndex + 1}`, value: item[field] });
    }
    for (const [axis, label] of [['width', 'רוחב'], ['height', 'גובה'], ['depth', 'עומק']] as const) {
      result.push({ id: `item.${axis}`, itemIndex, label: `${label} פריט ${itemIndex + 1}`, value: item.dimensions[axis] });
    }
  });
  return result;
}

export function sameRequirement(a: { id: string; itemIndex?: number }, b: { id: string; itemIndex?: number }): boolean {
  return a.id === b.id && a.itemIndex === b.itemIndex;
}

export function identifyConversationEvents(
  previous: Lead, current: Lead, text: string, requirements: RequirementEvaluation, lastQuestion?: NextQuestion,
): ConversationEvent[] {
  const events: ConversationEvent[] = [];
  const before = facts(previous);
  let extraInformation = false;
  for (const fact of facts(current)) {
    const prior = before.find(entry => sameRequirement(entry, fact));
    if (fact.value === null || fact.value === prior?.value) continue;
    if (prior?.value !== null && prior?.value !== undefined) {
      // Infer from the applied state delta, never from a claimed or unapplied correction.
      events.push({ type: 'CORRECTION_APPLIED', label: fact.label, value: fact.value });
    } else if (lastQuestion && !lastQuestion.requirements.some(ref =>
      sameRequirement(ref, fact) || (ref.id === 'items' && fact.itemIndex !== undefined))) {
      extraInformation = true;
    }
  }
  if (extraInformation) events.push({ type: 'EXTRA_INFORMATION_RECEIVED' });
  const notes = current.moveDetails.specialAccessNotes;
  if (notes && notes !== previous.moveDetails.specialAccessNotes) {
    events.push({ type: 'ACCESS_DIFFICULTY_RECORDED', notes });
  }

  // Deliberately narrow Hebrew cues; extraction still runs first and retains all supplied facts.
  const willCheck = /(?:אבדוק|אברר)\s+ו?(?:אעדכן|אודיע)|(?:לא יודע|לא יודעת|לא בטוח|לא בטוחה)\s+כרגע/u.test(text);
  if (willCheck && lastQuestion) {
    const pending = lastQuestion.requirements.filter(ref => requirements.requirements.some(result =>
      sameRequirement(ref, result) && result.status === 'MISSING' && result.question !== null));
    if (pending.length) events.push({ type: 'CUSTOMER_WILL_CONFIRM_LATER', requirements: pending });
  }
  return events;
}

export function acknowledgeEvent(event: ConversationEvent): string | undefined {
  switch (event.type) {
    case 'CORRECTION_APPLIED': {
      const value = typeof event.value === 'boolean' ? (event.value ? 'כן' : 'לא') : event.value;
      return `הבנתי, עדכנתי את ${event.label} ל-${value}.`;
    }
    case 'ACCESS_DIFFICULTY_RECORDED':
      // Repeat the recorded meaning without inferring direction, location, or elevator availability.
      return `הבנתי, רשמתי את פרטי הגישה: ${event.notes.replace(/[.!?\s]+$/u, '')}.`;
    case 'CUSTOMER_WILL_CONFIRM_LATER':
      return 'אין בעיה, כשתדע אפשר לעדכן אותי.';
    case 'EXTRA_INFORMATION_RECEIVED':
      return 'מעולה, קיבלתי.';
  }
}
