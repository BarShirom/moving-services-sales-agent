import { createHash } from 'node:crypto';
import type { MoveDetails } from '../lead.js';
import type { CustomerQuoteRecord, CustomerQuoteSafe } from './types.js';

/** Commercial facts only; photo availability itself does not change the agreed work. */
export function quoteScopeFingerprint(scope: MoveDetails): string {
  const facts = {
    items: scope.items.map(item => ({
      type: item.type, quantity: item.quantity, description: item.description, sizeCategory: item.sizeCategory,
      dimensions: { width: item.dimensions.width, height: item.dimensions.height, depth: item.dimensions.depth },
      requiresDisassembly: item.requiresDisassembly, requiresAssembly: item.requiresAssembly,
    })),
    pickup: { city: scope.pickup.city, address: scope.pickup.address, floor: scope.pickup.floor, elevator: scope.pickup.elevator },
    dropoff: { city: scope.dropoff.city, address: scope.dropoff.address, floor: scope.dropoff.floor, elevator: scope.dropoff.elevator },
    requestedDate: scope.requestedDate, requestedTime: scope.requestedTime, specialAccessNotes: scope.specialAccessNotes,
  };
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex');
}

export function customerQuoteProjection(quote: CustomerQuoteRecord): CustomerQuoteSafe {
  return structuredClone({
    id: quote.id, version: quote.version, leadId: quote.leadId, approvedAmount: quote.approvedAmount,
    currency: quote.currency, scope: quote.scope, sentAt: quote.sentAt, status: quote.status, acceptance: quote.acceptance,
  });
}

export const quoteAcceptanceQuestion = 'האם לאשר את הצעת המחיר להובלה המתוארת?';
export const isQuoteAcceptance = (text: string): boolean => /^(?:כן|מאשר|מאשרת|סגור)[\s.!！]*$/u.test(text.trim());
/** A compound affirmative must never approve an unexamined condition. */
export function isConditionalQuoteReply(text: string): boolean {
  if (/(?:^|[\s,.;:!?？！])(?:אבל|בתנאי)(?:\s|[,:]|$)|(?:^|\s)רק\s+(?:אחרי|לפני|אם)(?:\s|$)/u.test(text.trim())) return true;
  const match = /^(?:כן|מאשרת|מאשר|סגור)([\s,.;:!?？！…—-][\s\S]*)$/u.exec(text.trim());
  // Bare punctuation (especially "כן?") is not a condition; further content is.
  return match !== null && match[1].replace(/^[\s,.;:!?？！…—-]+/u, '').length > 0;
}

export function quoteMessage(amount: number): string {
  return `הצעת המחיר להובלה המתוארת היא ${amount.toLocaleString('he-IL')} ₪. התיאום הסופי ייעשה מול נציג; המועד המבוקש עדיין לא שוריין. ${quoteAcceptanceQuestion}`;
}

export function acceptanceMessage(amount: number): string {
  return `תודה, קיבלנו את אישורך להצעת המחיר בסך ${amount.toLocaleString('he-IL')} ₪. התיאום הסופי יתבצע מול נציג; מועד ההובלה עדיין לא שוריין.`;
}
