import type { Lead } from '../lead.js';
import type { RequirementContext, RequirementEvaluation, RequirementResult } from './types.js';
import { selectNextQuestion } from './nextQuestion.js';

const profiles: Record<string, { label: string; size: boolean; assembly: boolean; supported: boolean }> = {
  refrigerator: { label: 'המקרר', size: true, assembly: false, supported: true },
  box: { label: 'הארגזים', size: false, assembly: false, supported: true },
  wardrobe: { label: 'הארון', size: true, assembly: true, supported: false },
  bed: { label: 'המיטה', size: true, assembly: true, supported: false },
  washing_machine: { label: 'מכונת הכביסה', size: false, assembly: false, supported: false },
};

const hasText = (value: string | null): boolean => value !== null && value.trim().length > 0;
const positive = (value: number | null): boolean => value !== null && Number.isFinite(value) && value > 0;

export function evaluateRequirements(lead: Lead, context: RequirementContext = {}): RequirementEvaluation {
  const requirements: RequirementResult[] = [];
  function add(
    id: RequirementResult['id'], known: boolean, question: string | null,
    options: { applicable?: boolean; conditional?: boolean; stage?: RequirementResult['stage']; itemIndex?: number } = {},
  ): void {
    const status = options.applicable === false ? 'NOT_APPLICABLE' : known ? 'SATISFIED' : 'MISSING';
    requirements.push({
      id, ...(options.itemIndex === undefined ? {} : { itemIndex: options.itemIndex }),
      stage: options.stage ?? 'PRICING', status,
      conditional: options.conditional ?? false,
      question: status === 'MISSING' ? question : null,
    });
  }

  const move = lead.moveDetails;
  add('items', move.items.length > 0, 'מה צריך להעביר?');

  // Location groups come first so a known item and cities lead to address questions.
  for (const side of ['pickup', 'dropoff'] as const) {
    const location = move[side];
    const label = side === 'pickup' ? 'האיסוף' : 'הפריקה';
    add(`${side}.city`, hasText(location.city), `באיזו עיר ${label}?`);
    add(`${side}.address`, hasText(location.address), `מה הכתובת המדויקת של ${label}${hasText(location.city) ? ` בעיר ${location.city}` : ''}?`);
    add(`${side}.floor`, location.floor !== null && Number.isInteger(location.floor), `באיזו קומה ${label}?`);
    add(`${side}.elevator`, location.elevator !== null, `האם יש מעלית בכתובת ${label}?`);
  }
  add('requestedDate', hasText(move.requestedDate), 'באיזה תאריך תרצו לבצע את ההובלה?');

  move.items.forEach((item, itemIndex) => {
    const profile = item.type !== null && Object.hasOwn(profiles, item.type) ? profiles[item.type] : undefined;
    const hints = context.items?.[itemIndex] ?? {};
    const label = `${profile?.label ?? 'הפריט'}${move.items.length > 1 ? ` (פריט ${itemIndex + 1})` : ''}`;
    const options = { itemIndex, conditional: true };
    const typed = hasText(item.type);
    add('item.type', typed, `מה סוג ${label}?`, { itemIndex });
    // Unsupported types need a human-defined policy, not another customer type question.
    add('item.support', profile?.supported === true, null, { ...options, applicable: typed });
    add('item.quantity', positive(item.quantity) && Number.isInteger(item.quantity),
      `מה הכמות של ${label}?`, { ...options, applicable: item.type === 'box' || hints.quantityRequired === true });

    const completeDimensions = Object.values(item.dimensions).every(positive);
    const partialDimensions = Object.values(item.dimensions).some(value => value !== null);
    const sizeKnown = hasText(item.sizeCategory) || completeDimensions;
    const dimensionsNeeded = hints.dimensionsRequired === true || (profile?.size === true && !sizeKnown && (partialDimensions || item.dimensionsAvailable === true));
    // Accept offered measurements without turning optional review information into
    // a new pricing policy. Availability alone never satisfies a measurement.
    const dimensionsOffered = item.dimensionsAvailable === true
      || (item.photoStatus === 'NOT_AVAILABLE' && partialDimensions && item.dimensionsAvailable !== false);
    add('item.size', sizeKnown, dimensionsNeeded ? null : `מה הגודל או סוג הדגם של ${label}?`,
      { ...options, applicable: profile?.size === true });
    for (const [axis, title] of [['width', 'הרוחב'], ['height', 'הגובה'], ['depth', 'העומק']] as const) {
      add(`item.${axis}`, positive(item.dimensions[axis]), `מה ${title} של ${label} בסנטימטרים?`,
        { ...options, applicable: dimensionsNeeded || dimensionsOffered, stage: dimensionsNeeded ? 'PRICING' : 'REVIEW' });
    }
    add('item.disassembly', item.requiresDisassembly !== null, `האם נדרש פירוק של ${label}?`,
      { ...options, applicable: hints.disassemblyRelevant ?? profile?.assembly ?? false });
    add('item.assembly', item.requiresAssembly !== null, `האם נדרשת הרכבה של ${label} ביעד?`,
      { ...options, applicable: hints.assemblyRelevant ?? profile?.assembly ?? false });
    // Unavailable photos still need human review, but must not be requested again automatically.
    add('item.photo', item.photoStatus === 'RECEIVED', item.photoStatus === 'NOT_AVAILABLE' ? null : `אפשר לצרף תמונה של ${label} לבדיקה?`,
      { ...options, stage: 'REVIEW', applicable: item.photoStatus !== 'NOT_APPLICABLE' });
  });
  add('specialAccessNotes', hasText(move.specialAccessNotes), 'מה חשוב לדעת על קשיי הגישה במקום?',
    { conditional: true, applicable: context.specialAccessDetailsRequired === true });

  const missingRequired = requirements.filter(result => result.stage === 'PRICING' && result.status === 'MISSING');
  const pendingReview = requirements.filter(result => result.stage === 'REVIEW' && result.status === 'MISSING');
  return {
    requirements, missingRequired, pendingReview,
    readyForPricing: missingRequired.length === 0,
    nextQuestion: selectNextQuestion(requirements),
  };
}

// Only collection readiness is managed here; review, sent, and closed states stay intact.
export function updateLeadReadiness(lead: Lead, context: RequirementContext = {}): Lead {
  if (lead.status !== 'COLLECTING_INFORMATION' && lead.status !== 'READY_FOR_PRICING') return lead;
  const status = evaluateRequirements(lead, context).readyForPricing ? 'READY_FOR_PRICING' : 'COLLECTING_INFORMATION';
  if (status === lead.status) return lead;
  return { ...lead, status, updatedAt: new Date().toISOString() };
}
