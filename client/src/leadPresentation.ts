import type { DemoSnapshot } from './api';
import type { MoveItem } from '../../server/src/domain/lead';
import { pricingRules } from '../../server/src/domain/pricing/pricingRules';

export const itemNames: Record<string, string> = {
  refrigerator: 'מקרר', box: 'ארגזים', washing_machine: 'מכונת כביסה', wardrobe: 'ארון', bed: 'מיטה', dresser: 'שידה',
};
const namedItems: Record<string, string> = {
  refrigerator: 'המקרר', box: 'הארגזים', washing_machine: 'מכונת הכביסה', wardrobe: 'הארון', bed: 'המיטה', dresser: 'השידה',
};
export const requirementLabels: Record<string, string> = {
  items: 'פריטים להובלה', 'pickup.city': 'עיר האיסוף', 'pickup.address': 'כתובת האיסוף',
  'pickup.floor': 'קומת האיסוף', 'pickup.elevator': 'מעלית באיסוף',
  'dropoff.city': 'עיר הפריקה', 'dropoff.address': 'כתובת הפריקה',
  'dropoff.floor': 'קומת הפריקה', 'dropoff.elevator': 'מעלית בפריקה',
  requestedDate: 'תאריך ההובלה', specialAccessNotes: 'פרטי גישה מיוחדים',
  'item.type': 'סוג הפריט', 'item.support': 'בדיקת תמחור', 'item.quantity': 'כמות',
  'item.size': 'גודל הפריט', 'item.width': 'רוחב', 'item.height': 'גובה', 'item.depth': 'עומק',
  'item.disassembly': 'צורך בפירוק', 'item.assembly': 'צורך בהרכבה', 'item.photo': 'תמונה',
};

export function itemLabel(items: MoveItem[], index: number, definite = false): string {
  const type = items[index]?.type;
  const label = (definite ? namedItems : itemNames)[type ?? ''];
  if (!label) return `פריט ${index + 1}`;
  return items.filter(item => item.type === type).length > 1 ? `${label} (פריט ${index + 1})` : label;
}

export function itemPricingReviewLabel(items: MoveItem[], index: number): string {
  const type = items[index]?.type;
  const verb = type === 'box' ? 'דורשים' : ['dresser', 'bed', 'washing_machine'].includes(type ?? '') ? 'דורשת' : 'דורש';
  return `${itemLabel(items, index)} — ${verb} בדיקת תמחור`;
}

export function highBoxVolumeLabel(items: MoveItem[]): string | undefined {
  const boxes = items.filter(item => item.type === 'box');
  if (boxes.some(item => item.quantity === null)) return undefined;
  const quantity = boxes.reduce((sum, item) => sum + item.quantity!, 0);
  // Reuse the existing review threshold; this is only a label, never a price calculation.
  return quantity > pricingRules.review.maxBoxes ? `נפח גבוה — ${quantity} ארגזים — דורש בדיקה` : undefined;
}

/** Display grouping only. Backend requirements, readiness and pricing remain unchanged. */
export function presentRequirements(state: DemoSnapshot): { customerMissing: string[]; ownerReview: string[] } {
  const items = state.lead.moveDetails.items;
  const customerMissing: string[] = [];
  const ownerReview: string[] = [];
  const dimensions = new Set<number>();
  const dimensionIds = ['item.size', 'item.width', 'item.height', 'item.depth'];
  const missing = [...state.requirements.missingRequired, ...state.requirements.pendingReview];
  for (const requirement of missing) {
    const index = requirement.itemIndex;
    if (requirement.id === 'item.support') {
      ownerReview.push(index === undefined ? 'פריט — דורש בדיקת תמחור' : itemPricingReviewLabel(items, index));
    } else if (index !== undefined && dimensionIds.includes(requirement.id)) {
      if (dimensions.has(index)) continue;
      dimensions.add(index);
      const group = missing.filter(entry => entry.itemIndex === index && dimensionIds.includes(entry.id));
      const unavailable = group.some(entry => entry.availability === 'TEMPORARILY_UNAVAILABLE');
      const label = unavailable || group.some(entry => entry.id !== 'item.size') ? 'מידות' : 'גודל';
      customerMissing.push(`${label} ${itemLabel(items, index, true)}${unavailable ? ' — לא זמינות כרגע' : ''}`);
    } else if (requirement.id === 'item.photo' && index !== undefined && items[index]?.photoStatus === 'NOT_AVAILABLE') {
      ownerReview.push(`${itemLabel(items, index)} — בדיקה ללא תמונה`);
    } else {
      customerMissing.push(`${requirementLabels[requirement.id] ?? 'פרט להשלמה'}${index === undefined ? '' : ` — ${itemLabel(items, index)}`}`);
    }
  }
  const volume = highBoxVolumeLabel(items);
  if (volume) ownerReview.push(volume);
  if (state.unappliedItems.length) ownerReview.push('פריטים דומים — נדרשת הבהרה לאיזה פריט שייך העדכון');
  return { customerMissing, ownerReview };
}

export function nextStepLabel(state: DemoSnapshot | null): string {
  if (!state) return 'המשך השיחה יופיע לאחר החיבור לשרת.';
  switch (state.lead.status) {
    case 'HUMAN_HANDOFF': return 'המשך טיפול אצל הנציג.';
    case 'QUOTE_SENT': return 'ממתינים לתשובת הלקוח להצעה.';
    case 'WON': return 'ממתין לתיאום';
    case 'LOST': return 'הפנייה נסגרה.';
  }
  if (state.nextQuestion) return 'המשך איסוף הפרטים מהלקוח.';
  const missing = state.requirements.missingRequired;
  const manualReview = missing.length > 0 && missing.every(requirement =>
    requirement.id === 'item.support' || requirement.availability === 'TEMPORARILY_UNAVAILABLE');
  if (state.lead.status === 'AWAITING_REVIEW' || state.lead.status === 'READY_FOR_PRICING' || manualReview) {
    return 'המשך לבדיקת בעל העסק ולתמחור.';
  }
  return 'ממתינים לעדכון על הפרטים החסרים.';
}
