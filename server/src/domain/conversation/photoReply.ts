import type { Lead } from '../lead.js';
import type { NextQuestion } from '../requirements/types.js';

export interface PhotoReply {
  lead: Lead;
  acknowledgement: string;
}

export function applyUnavailablePhotoReply(lead: Lead, text: string, lastQuestion?: NextQuestion): PhotoReply | undefined {
  // Short negative replies are meaningful only for one explicitly targeted active photo request.
  if (lastQuestion?.requirements.length !== 1) return undefined;
  const requirement = lastQuestion.requirements[0];
  const index = requirement.itemIndex;
  if (requirement.id !== 'item.photo' || index === undefined || !Number.isInteger(index) || index < 0) return undefined;
  const item = lead.moveDetails.items[index];
  if (!item || item.photoStatus !== 'REQUIRED') return undefined;
  const reply = text.trim().replace(/[.!]+$/u, '').trim().replace(/\s+/gu, ' ');
  if (!/^(?:אין(?: לי)?(?: תמונה)?(?: כרגע)?|לא(?: כרגע)?)$/u.test(reply)) return undefined;
  const updated = structuredClone(lead);
  updated.moveDetails.items[index].photoStatus = 'NOT_AVAILABLE';
  return { lead: updated, acknowledgement: 'אין בעיה, נמשיך בלי תמונה. אם יהיה צורך, נבקש השלמה בהמשך.' };
}
