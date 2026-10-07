import { useState } from 'react';
import { AgentState, statusLabel } from './AgentState';
import { ownerAction, ownerPricing, ownerRequest, ownerSample, type OwnerSnapshot, type OwnerAction } from './api';
import type { ReviewReason, PricingComponent, OmittedComponent } from '../../server/src/domain/pricing/types';
import { highBoxVolumeLabel, itemLabel, itemPricingReviewLabel } from './leadPresentation';
import { QuoteOverview } from './QuoteOverview';
import type { MoveItem } from '../../server/src/domain/lead';

const money = (value: number) => new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
const sizes: Record<string, string> = { SMALL: 'קטן', REGULAR: 'רגיל', LARGE: 'גדול', FOUR_DOOR: 'ארבע דלתות' };
const omittedLabels: Record<string, string> = { BOXES: 'ארגזים: כמות לא ידועה או נפח חריג', DISTANCE: 'מרחק: טרם נמסר מרחק מספרי', SPECIAL_DIFFICULTY: 'קושי גישה: נדרשת בדיקה', EXTRA_STOP_ACCESS: 'גישה בנקודות נוספות',
  REFRIGERATOR: 'מקרר: נדרש בירור לתמחור', WASHING_MACHINE: 'מכונת כביסה: נדרש בירור לתמחור',
  FLOORS: 'קומות: נדרשת בדיקה', ASSEMBLY_DISASSEMBLY: 'פירוק והרכבה: דורשים תמחור ידני', UNSUPPORTED_ITEM: 'הובלת פריט ללא תעריף',
  ITEM_DIMENSIONS: 'מידות הפריט: נדרשת השלמה או בדיקה', UNSUPPORTED_ITEM_ACCESS: 'נשיאה וגישה: דורשות בדיקה ותמחור ידני',
  SERVICE_REQUIREMENTS: 'צורך בפירוק / הרכבה: נדרש בירור',
  WORKERS: 'צוות', TIME: 'משך העבודה' };
const decisions = { APPROVED: 'המחיר אושר ונשלח', ADJUSTED: 'המחיר עודכן ונשלח', REQUEST_MORE_INFO: 'נשלחה בקשת מידע', HUMAN_HANDOFF: 'השיחה הועברה לנציג' };
function requestedServices(item?: MoveItem): string | null {
  const services = [item?.requiresDisassembly === true && 'פירוק', item?.requiresAssembly === true && 'הרכבה'].filter(Boolean);
  return services.length ? services.join(' ו') : null;
}
function omittedLabel(component: OmittedComponent, owner: OwnerSnapshot): string {
  if (component.itemIndex !== undefined) {
    const items = owner.pricingEvaluation?.inputSnapshot.moveDetails.items ?? owner.customer.lead.moveDetails.items;
    const label = itemLabel(items, component.itemIndex);
    const definite = itemLabel(items, component.itemIndex, true);
    if (component.code === 'UNSUPPORTED_ITEM') return `${label}: הובלה דורשת תמחור ידני`;
    if (component.code === 'ASSEMBLY_DISASSEMBLY') return `${requestedServices(items[component.itemIndex]) ?? 'שירותים'} של ${definite}: נדרש תמחור ידני`;
    if (component.code === 'SERVICE_REQUIREMENTS') return `צורך בפירוק / הרכבה של ${definite}: נדרש בירור`;
    if (component.code === 'ITEM_DIMENSIONS') return `מידות ${definite}: נדרשת השלמה או בדיקה`;
    if (component.code === 'UNSUPPORTED_ITEM_ACCESS') return `נשיאה וגישה עבור ${definite}: דורשות בדיקה ותמחור ידני`;
    if (component.code === 'REFRIGERATOR' || component.code === 'WASHING_MACHINE') return `${label}: נדרש בירור לתמחור`;
  }
  return omittedLabels[component.code] ?? 'רכיב נוסף: דורש תמחור ידני';
}
function reasonLabel(reason: ReviewReason, owner: OwnerSnapshot): string {
  const items = owner.pricingEvaluation?.inputSnapshot.moveDetails.items ?? owner.customer.lead.moveDetails.items;
  const unsupported = /^ITEM_(\d+)_UNSUPPORTED$/.exec(reason.code);
  if (unsupported) return itemPricingReviewLabel(items, Number(unsupported[1]));
  if (reason.code === 'HIGH_VOLUME') return highBoxVolumeLabel(items) ?? 'נפח ההובלה דורש בדיקה';
  if (reason.code === 'SINGULAR_ITEM_QUANTITY') {
    const assumptions = owner.pricingEvaluation!.inputSnapshot.assumptions;
    const labels = [...assumptions.singularRefrigeratorQuantity, ...assumptions.singularWardrobeQuantity]
      .sort((a, b) => a - b).map(index => `${itemLabel(items, index)} אחד`);
    return `התמחור מניח ${labels.join(' ו')} לפי רשימת הפריטים. יש לאשר את ${labels.length > 1 ? 'הכמויות' : 'הכמות'}`;
  }
  const labels: Record<string, string> = {
    PROVISIONAL_BOX_RATE: 'תעריף נפח הארגזים הוא הנחת עבודה זמנית', PROVISIONAL_DISTANCE_RATE: 'תעריף המרחק הוא הנחת עבודה זמנית',
    ITEM_COMPOSITION: 'מחירי הפריטים מחוברים ללא חיוב בסיס נוסף', SERVICE_COMPOSITION: 'פירוק והרכבה מחויבים כחבילת שירות אחת',
    WAITING_ROUNDING: 'המתנה מחושבת לפי חצאי שעה שהחלו', DISCOUNT_SCOPE: 'הנחת סטודנט חלה על הרכיבים שתומחרו',
    WORKERS_COMPLEXITY: 'גודל הצוות דורש בדיקת מורכבות', DURATION_COMPLEXITY: 'משך העבודה דורש בדיקת מורכבות',
    PROVISIONAL_RULES: 'התעריפים מבוססים על נתונים היסטוריים ודורשים אישור בעל העסק', MISSING_DISTANCE: 'מרחק המסלול אינו ידוע',
    DISTANCE_RATE_UNAVAILABLE: 'חסר תעריף למרחק ההובלה, גם כשהמרחק ידוע', MISSING_DATE: 'תאריך ההובלה חסר',
    INCOMPLETE_INVENTORY: 'רשימת הפריטים אינה מלאה או שהכמויות משוערות', MANY_ITEM_TYPES: 'מגוון פריטים דורש בדיקה פרטנית',
    HIGH_VOLUME: 'נפח ההובלה דורש בדיקה', MULTIPLE_POINTS: 'מספר נקודות איסוף או פריקה דורש בדיקה',
    SPECIAL_ACCESS: 'קושי גישה דורש בדיקה', ACCESS_UNKNOWN: 'תנאי הגישה טרם אושרו', NO_ITEMS: 'טרם נמסרו פריטים',
    REFRIGERATOR_QUANTITY: 'כמות המקררים חסרה או מעבר לתחום התמחור', FLOOR_COMPOSITION: 'שילוב תעריף המקרר והקומות דורש בדיקה',
    SINGULAR_REFRIGERATOR_QUANTITY: 'התמחור מניח מקרר אחד לפי רשימת הפריטים. יש לאשר את הכמות',
    SINGULAR_WARDROBE_QUANTITY: 'הבדיקה מתייחסת לארון אחד לפי רשימת הפריטים. יש לאשר את הכמות',
    WORKERS_RATE_UNAVAILABLE: 'אין תעריף מוגדר לצוות', TIME_RATE_UNAVAILABLE: 'אין תעריף מוגדר למשך העבודה',
  };
  if (labels[reason.code]) return labels[reason.code];
  const suffixes: Record<string, string> = { BOX_RATE: 'אין עדיין תעריף לארגזים', QUANTITY: 'כמות הפריט חסרה',
    DIMENSIONS_UNAVAILABLE: 'הלקוח אינו יכול למסור את כל המידות כרגע. נדרשת השלמה או בדיקה',
    SERVICE_COMPLEXITY: 'מורכבות הפירוק או ההרכבה דורשת בדיקה', SERVICES_UNKNOWN: 'צורך בפירוק או בהרכבה טרם הובהר', SERVICES: 'פירוק או הרכבה דורשים תמחור ידני', SERVICES_MANUAL: 'פירוק / הרכבה דורשים בירור ותמחור ידני',
    UNSUPPORTED: 'פריט שאינו נתמך בתמחור הנוכחי', VISUAL_EVIDENCE: 'חסרים צילום או מידות מלאות', SIZE: 'גודל המקרר חסר או אינו נתמך',
    LOCATION: 'כתובת או עיר חסרה', FLOOR: 'הקומה אינה ידועה', ELEVATOR: 'זמינות המעלית אינה ידועה',
    ELEVATOR_FIT_UNKNOWN: 'לא ידוע אם הפריט נכנס במעלית', ELEVATOR_DOES_NOT_FIT: 'הפריט לא נכנס במעלית. נדרשת בדיקת נשיאה',
    BASEMENT: 'גישה לקומת מרתף דורשת בדיקה', FLOOR_RULE_NOT_APPLIED: 'תמחור המדרגות לא נכלל בשל מורכבות ההובלה' };
  const suffix = reason.code.replace(/^(ITEM_\d+|pickup|dropoff)_/, '');
  const side = reason.code.startsWith('pickup_') ? 'באיסוף: ' : reason.code.startsWith('dropoff_') ? 'בפריקה: ' : '';
  const item = /^ITEM_(\d+)_/.exec(reason.code);
  if (item && suffix === 'SERVICES_MANUAL') return `${itemLabel(items, Number(item[1]))}: נדרש תמחור ידני עבור ${requestedServices(items[Number(item[1])]) ?? 'שירותים'}`;
  return (item ? `${itemLabel(items, Number(item[1]))}: ` : side) + (suffixes[suffix] ?? reason.message);
}
function reviewNotes(owner: OwnerSnapshot) {
  const notes = new Map<string, { label: string; confidenceDeduction: number }>();
  for (const reason of owner.pricingEvaluation?.reviewReasons ?? []) {
    const label = reasonLabel(reason, owner);
    // Merge identical business wording, retaining separate items/endpoints and all score deductions.
    const scope = /^(ITEM_\d+|pickup|dropoff)_/.exec(reason.code)?.[1] ?? 'move';
    const key = `${scope}:${label}`;
    const previous = notes.get(key);
    notes.set(key, { label, confidenceDeduction: (previous?.confidenceDeduction ?? 0) + reason.confidenceDeduction });
  }
  return [...notes].map(([key, note]) => ({ key, ...note }));
}
function componentLabel(component: PricingComponent, owner: OwnerSnapshot): string {
  if (component.code === 'REFRIGERATOR') return 'מקרר ' + (sizes[owner.pricingEvaluation?.inputSnapshot.moveDetails.items.find(item => item.type === 'refrigerator')?.sizeCategory ?? ''] ?? '');
  if (component.code === 'BOXES') {
    const boxes = owner.pricingEvaluation?.inputSnapshot.moveDetails.items.filter(item => item.type === 'box') ?? [];
    if (boxes.length && boxes.every(item => item.quantity !== null)) return `${boxes.reduce((sum, item) => sum + item.quantity!, 0)} ארגזים`;
  }
  if (component.code !== 'FLOORS') return ({ WASHING_MACHINE: 'מכונת כביסה', BOXES: 'נפח ארגזים', DISTANCE: 'מרחק המסלול', ASSEMBLY_DISASSEMBLY: 'פירוק / הרכבה', EXTRA_STOP: 'נקודות נוספות', WAITING: 'המתנה', DISCOUNT: 'הנחת סטודנט' } as Record<string, string>)[component.code] ?? component.label;
  return 'קומות ללא מעלית ' + (component.label.startsWith('pickup') ? 'באיסוף' : 'בפריקה');
}
export function OwnerView({ owner, onChange, onBusy, onReset, disabled = false }: {
  disabled?: boolean; owner: OwnerSnapshot; onChange: (value: OwnerSnapshot) => void; onBusy: (value: boolean) => void; onReset: () => Promise<void>;
}) {
  const [working, setPending] = useState(false);
  const pending = working || disabled;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState<'approve' | 'adjust' | 'question' | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [question, setQuestion] = useState('');
  const [scopeConfirmed, setScopeConfirmed] = useState(false);
  const [reviewedPhotos, setReviewedPhotos] = useState<number[]>([]);
  const [showSampleConfirmation, setShowSampleConfirmation] = useState(false);
  const evaluation = owner.pricingEvaluation;
  const complete = evaluation?.completeness === 'COMPLETE_RECOMMENDATION';
  const quoteSent = owner.currentQuote?.status === 'SENT';
  const quoteAccepted = owner.currentQuote?.status === 'ACCEPTED';
  const finalized = quoteSent || quoteAccepted;
  const photosConfirmed = owner.pendingPhotoItemIndices.every(index => reviewedPhotos.includes(index));
  const validAmount = amount.trim() !== '' && Number.isFinite(Number(amount)) && Number(amount) > 0
    && Number.isSafeInteger(Math.round(Number(amount) * 100)) && Number(amount) === Math.round(Number(amount) * 100) / 100;
  const token = { leadId: owner.customer.lead.id, revision: owner.revision };
  async function run(operation: () => Promise<OwnerSnapshot>, success: string) {
    if (pending) return;
    setPending(true); onBusy(true); setError(''); setNotice('');
    try { onChange(await operation()); setForm(null); setAmount(''); setReason(''); setQuestion(''); setNotice(success); }
    catch (error) { setError(error instanceof Error ? error.message : 'לא ניתן להשלים את הפעולה.'); }
    finally { setPending(false); onBusy(false); }
  }
  function act(action: OwnerAction) { return run(() => ownerAction(action), 'הפעולה נשמרה. אפשר לעבור לתצוגת הלקוח.'); }
  function openFinalization(mode: 'approve' | 'adjust') {
    setForm(mode); setScopeConfirmed(false); setReviewedPhotos([]); setReason(''); setError('');
    setAmount(evaluation?.suggestedAmount === null || !evaluation ? '' : String(evaluation.suggestedAmount));
  }
  function approve() {
    if (!evaluation) return;
    if (!complete) openFinalization('adjust');
    else if (owner.pendingPhotoItemIndices.length) openFinalization('approve');
    else void act({ ...token, action: 'APPROVE', pricingEvaluationId: evaluation.id, scopeConfirmed: true });
  }
  function submitFinalization() {
    if (!evaluation) return;
    if (form === 'adjust' && !validAmount) { setError('יש להזין מחיר סופי חיובי, עם שתי ספרות עשרוניות לכל היותר.'); return; }
    if ((form === 'adjust' && !scopeConfirmed) || !photosConfirmed) { setError('יש לאשר במפורש את היקף ההצעה ואת התנאים שטרם הושלמו.'); return; }
    const acknowledgement = { scopeConfirmed: true, omittedCostsAcknowledged: !complete && scopeConfirmed, reviewedPhotoItemIndices: reviewedPhotos };
    if (form === 'approve') void act({ ...token, ...acknowledgement, action: 'APPROVE', pricingEvaluationId: evaluation.id });
    else void act({ ...token, ...acknowledgement, action: 'ADJUST_PRICE', pricingEvaluationId: evaluation.id, amount: Number(amount), internalReason: reason });
  }
  return <div className="owner-view" aria-busy={pending}>
    <section className="card owner-overview">
      <div className="owner-title"><div><span className="eyebrow">סביבת הדגמה · בעל העסק</span><h2>בדיקת ההובלה</h2><span className="status-label">{statusLabel(owner.customer)}</span></div><span className="owner-emblem" aria-hidden="true">✓</span></div>
      <p className="card-description">כל הפרטים, המלצה שקופה והחלטה שלך לפני שהמחיר מגיע ללקוח.</p>
      <div className="owner-toolbar">
        <button type="button" disabled={pending} onClick={() => void run(ownerRequest, 'המידע מעודכן.')}>רענון הפנייה</button>
        <button type="button" disabled={pending} onClick={() => setShowSampleConfirmation(!showSampleConfirmation)}>תרחיש לדוגמה</button>
        <button type="button" disabled={pending} onClick={() => void onReset()}>איפוס הדגמה</button>
      </div>
      {showSampleConfirmation && <div className="sample-confirmation"><p>טעינת הובלת מקרר סינתטית תחליף את השיחה הנוכחית. אינה משתמשת ב-AI.</p><button type="button" disabled={pending} onClick={() => { setShowSampleConfirmation(false); void run(() => ownerSample(token), 'תרחיש ההדגמה נטען.'); }}>טען תרחיש והחלף שיחה</button></div>}
      {error && <p className="error-banner" role="alert">{error}</p>}
      {notice && <p className="owner-notice" role="status">{notice}</p>}
    </section>
    <AgentState state={owner.customer} />
    <QuoteOverview owner={owner} />
    <section className="card pricing-card" aria-labelledby="pricing-heading">
      <div className="card-heading"><h2 id="pricing-heading">{finalized ? 'חישוב המנוע ששימש לבדיקה' : 'מחיר מומלץ'}</h2><span className="review-badge">{quoteAccepted ? 'הלקוח אישר את המחיר' : quoteSent ? 'הצעת המחיר נשלחה' : 'נדרש אישור בעל העסק'}</span></div>
      {!evaluation ? <p className="muted">ההמלצה תופיע לאחר השלמת הפרטים הדרושים לתמחור.</p> : <>
        {owner.pricingStale && <p className="stale-banner" role="status">ההמלצה אינה עדכנית. יש להשלים את המידע ולחשב מחדש לפני אישור.</p>}
        <div className="price-hero"><strong className="suggested-price">{evaluation.suggestedAmount === null ? 'נדרש תמחור ידני' : money(evaluation.suggestedAmount)}</strong><span>{evaluation.completeness === 'COMPLETE_RECOMMENDATION' ? 'המלצה מלאה להובלה לפי הכללים הזמניים' : evaluation.completeness === 'CANNOT_PRICE' ? 'אין המלצה מספרית' : 'המלצה חלקית: רכיבים חסרים בתמחור'}</span></div>
        <div className="price-metrics"><div><span>{evaluation.completeness === 'COMPLETE_RECOMMENDATION' ? 'טווח מומלץ להובלה' : 'טווח לרכיבים שתומחרו'}</span><strong dir="ltr">{evaluation.priceRange ? `${money(evaluation.priceRange.min)}–${money(evaluation.priceRange.max)}` : 'לא זמין'}</strong></div><div><span>ציון שלמות ומידע</span><strong>{evaluation.confidence}%</strong><small>אינו מדד לדיוק סטטיסטי</small></div></div>
        <p className="pricing-explanation">{finalized ? 'זהו החישוב המקורי של המנוע. המחיר הסופי שאושר מוצג בנפרד.' : 'המלצה דטרמיניסטית לפי כללים זמניים.'} {complete ? 'רכיבי המחיר חושבו; תנאים תפעוליים שטרם הושלמו עדיין דורשים בדיקה.' : <>רכיבים שלא תומחרו אינם כלולים בסכום או בטווח. {finalized ? 'המחיר הסופי נקבע ואושר בנפרד.' : 'בעל העסק נדרש לקבוע ולאשר מחיר סופי להובלה המתוארת.'}</>}</p>
        {owner.demoDistanceKm !== null && <p className="pricing-explanation">מרחק הדגמה סינתטי: {owner.demoDistanceKm} ק״מ (נתון זמני, לא מדידת מפה).</p>}
        <h3>תומחר</h3>
        <ul className="price-breakdown">{evaluation.breakdown.map((part, index) => <li key={index}><div><strong>{componentLabel(part, owner)}</strong><b>{money(part.amount)}</b></div><p>טווח ייחוס לרכיב: {money(part.range.min)}–{money(part.range.max)}</p>{part.code === 'FLOORS' && evaluation.omittedComponents.some(omitted => omitted.code === 'UNSUPPORTED_ITEM_ACCESS') && <p className="pricing-scope">תמחור המדרגות כולל את הפריטים שתומחרו בלבד. נשיאת הפריטים ללא תעריף ותנאי הגישה שלהם דורשים תמחור ידני נפרד.</p>}<details><summary>בסיס החישוב</summary><p dir="auto">{part.basis}</p></details></li>)}</ul>
        {!evaluation.breakdown.length && <p className="muted">אין רכיבים שניתן לחשב לפי הכללים הנוכחיים.</p>}
        <h3>דורש תמחור ידני</h3>{!evaluation.omittedComponents.length && <p className="complete-note">אין רכיבים שהוחרגו מהחישוב.</p>}
        <ul className="omitted-list">{evaluation.omittedComponents.map((part, index) => <li key={index}><strong>{omittedLabel(part, owner)}</strong>{part.quantity !== null && <span>{part.code === 'DISTANCE' ? 'מרחק ידוע בק״מ' : 'כמות'}: {part.quantity}</span>}<details><summary>פרטי ההחרגה</summary><p dir="auto">{part.reason}</p></details></li>)}</ul>
        <div className="review-reasons"><h3>מה דורש בדיקה</h3><ul>{reviewNotes(owner).map(item => <li key={item.key}>{item.label}<small>הפחתה בציון: {item.confidenceDeduction}</small></li>)}</ul></div>
      </>}
      <button type="button" className="recalculate-button" disabled={pending || !owner.actions.recalculate} onClick={() => void run(() => ownerPricing(token), 'ההמלצה חושבה מחדש.')}>חשב המלצה מחדש</button>
    </section>
    <section className="card owner-actions" aria-labelledby="actions-heading"><h2 id="actions-heading">החלטת בעל העסק</h2>
      {owner.pendingOwnerQuestion && <p className="muted">ממתינים לתשובת הלקוח: {owner.pendingOwnerQuestion}</p>}
      {owner.customer.lead.status === 'HUMAN_HANDOFF' && <p className="owner-notice">השיחה בטיפול אנושי. הסוכן האוטומטי נעצר; הודעות הלקוח נשמרות.</p>}
      <div className="action-grid">
        <button type="button" className="approve-button" disabled={pending || (complete ? !owner.actions.approve : !owner.actions.adjust)} onClick={approve}>{complete ? 'אשר ושלח הצעת מחיר' : evaluation?.suggestedAmount === null ? 'הזן ואשר מחיר סופי' : 'השלם ואשר מחיר סופי'}</button>
        {complete && <button type="button" disabled={pending || !owner.actions.adjust} onClick={() => openFinalization('adjust')}>שנה מחיר</button>}
        <button type="button" disabled={pending || !owner.actions.requestMoreInfo} onClick={() => setForm('question')}>בקש מידע נוסף</button>
        <button type="button" disabled={pending || !owner.actions.takeOver} onClick={() => void act({ ...token, action: 'TAKE_OVER_CONVERSATION' })}>קח את השיחה</button>
      </div>
      {(form === 'adjust' || form === 'approve') && evaluation && <form className="owner-form finalization-form" onSubmit={event => { event.preventDefault(); submitFinalization(); }}>
        <h3>{form === 'approve' ? 'בדיקת התנאים לפני שליחת ההצעה' : 'אישור מחיר סופי להובלה המתוארת'}</h3>
        <div className="calculated-subtotal"><strong>{complete ? 'הסכום שחושב במנוע' : 'סכום הרכיבים שתומחרו'}</strong><p>{evaluation.suggestedAmount === null ? 'אין סכום מחושב. המחיר ייקבע על ידי בעל העסק.' : money(evaluation.suggestedAmount)}</p>
          {evaluation.priceRange && <p>טווח הרכיבים: {money(evaluation.priceRange.min)}–{money(evaluation.priceRange.max)}</p>}</div>
        {!!evaluation.omittedComponents.length && <><h4>רכיבים שלא תומחרו</h4><ul className="finalization-omissions">{evaluation.omittedComponents.map((part, index) => <li key={index}>{omittedLabel(part, owner)}</li>)}</ul></>}
        {!!evaluation.reviewReasons.length && <details className="finalization-conditions" open><summary>פרטים ותנאים לבדיקה</summary><ul>{reviewNotes(owner).map(note => <li key={note.key}>{note.label}</li>)}</ul></details>}
        {form === 'adjust' && <>
          <label htmlFor="approved-amount">מחיר סופי לכל ההובלה (₪)</label><input id="approved-amount" type="number" min="0.01" step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} disabled={pending} />
          <label className="confirmation-field" htmlFor="scope-confirmation"><input id="scope-confirmation" type="checkbox" checked={scopeConfirmed} required onChange={event => setScopeConfirmed(event.target.checked)} disabled={pending} />בדקתי את {complete ? 'פרטי ההובלה והתנאים' : 'הרכיבים שלא תומחרו'}, והמחיר הסופי שהזנתי מכסה את ההובלה המתוארת.</label>
          <label htmlFor="internal-reason">סיבה פנימית לשינוי (לא תוצג ללקוח)</label><input id="internal-reason" maxLength={300} value={reason} onChange={event => setReason(event.target.value)} disabled={pending} />
        </>}
        {owner.pendingPhotoItemIndices.map(index => <label className="confirmation-field" htmlFor={`photo-confirmation-${index}`} key={index}><input id={`photo-confirmation-${index}`} type="checkbox" checked={reviewedPhotos.includes(index)} required disabled={pending} onChange={event => setReviewedPhotos(current => event.target.checked ? [...current, index] : current.filter(value => value !== index))} />בדקתי את הצורך בתמונה של {itemLabel(owner.customer.lead.moveDetails.items, index, true)} ואני מאשר להמשיך בלעדיה. התמונה עדיין חסרה.</label>)}
        <button type="submit" disabled={pending || !photosConfirmed || (form === 'adjust' ? !owner.actions.adjust || !scopeConfirmed || !validAmount : !owner.actions.approve)}>{form === 'approve' ? 'אשר תנאים ושלח הצעת מחיר' : 'אשר ושלח את המחיר הסופי'}</button>
      </form>}
      {form === 'question' && <form className="owner-form" onSubmit={event => { event.preventDefault(); void act({ ...token, action: 'REQUEST_MORE_INFO', question }); }}>
        <label htmlFor="owner-question">השאלה שתישלח ללקוח</label><textarea id="owner-question" required maxLength={500} value={question} onChange={event => setQuestion(event.target.value)} disabled={pending} />
        <button type="submit" disabled={pending || !question.trim() || !owner.actions.requestMoreInfo}>שלח שאלה ללקוח</button>
      </form>}
      {form && <button type="button" className="cancel-action" disabled={pending} onClick={() => setForm(null)}>ביטול</button>}
    </section>
    {owner.reviews.length > 0 && <section className="card owner-history"><h2>היסטוריית החלטות</h2><ul>{[...owner.reviews].reverse().map(review => <li key={review.id}><strong>{decisions[review.decision]}</strong><time dateTime={review.createdAt}>{new Date(review.createdAt).toLocaleString('he-IL')}</time>
      <p>המלצה: {review.suggestedAmount === null ? 'לא זמינה' : money(review.suggestedAmount)} · אושר: {review.approvedAmount === null ? 'טרם אושר' : money(review.approvedAmount)}</p>
      {review.internalReason && <p>סיבה פנימית: {review.internalReason}</p>}{review.customerQuestion && <p>{review.customerQuestion}</p>}
    </li>)}</ul></section>}
  </div>;
}
