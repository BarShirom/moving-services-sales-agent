import { Icon } from './Icon';
import type { DemoSnapshot } from './api';

const itemNames: Record<string, string> = {
  refrigerator: 'מקרר', box: 'ארגזים', washing_machine: 'מכונת כביסה', wardrobe: 'ארון', bed: 'מיטה',
};
const sizes: Record<string, string> = { SMALL: 'קטן', REGULAR: 'רגיל', LARGE: 'גדול', FOUR_DOOR: 'ארבע דלתות' };
const labels: Record<string, string> = {
  items: 'פריטים להובלה', 'pickup.city': 'עיר האיסוף', 'pickup.address': 'כתובת האיסוף',
  'pickup.floor': 'קומת האיסוף', 'pickup.elevator': 'מעלית באיסוף',
  'dropoff.city': 'עיר הפריקה', 'dropoff.address': 'כתובת הפריקה',
  'dropoff.floor': 'קומת הפריקה', 'dropoff.elevator': 'מעלית בפריקה',
  requestedDate: 'תאריך ההובלה', specialAccessNotes: 'פרטי גישה מיוחדים',
  'item.type': 'סוג הפריט', 'item.support': 'בדיקת תמיכה בסוג הפריט', 'item.quantity': 'כמות',
  'item.size': 'גודל הפריט', 'item.width': 'רוחב', 'item.height': 'גובה', 'item.depth': 'עומק',
  'item.disassembly': 'צורך בפירוק', 'item.assembly': 'צורך בהרכבה', 'item.photo': 'תמונת הפריט',
};
const answer = (value: boolean | null) => value === null ? 'טרם צוין' : value ? 'כן' : 'לא';

export function AgentState({ state }: { state: DemoSnapshot | null }) {
  const details = state?.lead.moveDetails;
  return <aside className="state-column" aria-label="מצב הסוכן" dir="rtl">
    <div className="column-heading"><span className="eyebrow">תמונת מצב</span><span className="live-label"><i /> מתעדכן עם השיחה</span></div>
    <section className="card understood">
      <div className="card-heading"><span className="section-icon">✦</span><h2>מה הבנתי</h2><span className="small-label">פרטי ההובלה</span></div>
      {!details?.items.length ? <div className="empty-facts"><span className="empty-box"><Icon name="box" /></span><p>כל הובלה מתחילה בכמה פרטים</p><span>המידע שנאסף יופיע כאן אחרי ההודעה הראשונה.</span></div> :
        <div className="items-list">{details.items.map((item, index) => <div className="item-row" key={index}>
          <span className="item-symbol"><Icon name="box" /></span><div><strong>{itemNames[item.type ?? ''] ?? item.type ?? 'פריט לא מזוהה'}</strong>
            <div className="item-details">{[
              item.sizeCategory && (sizes[item.sizeCategory] ?? item.sizeCategory),
              item.quantity !== null && `כמות: ${item.quantity}`,
              ...(['width', 'height', 'depth'] as const).map(axis => item.dimensions[axis] !== null && `${labels[`item.${axis}`]}: ${item.dimensions[axis]} ס״מ`),
              item.requiresDisassembly !== null && `פירוק: ${answer(item.requiresDisassembly)}`,
              item.requiresAssembly !== null && `הרכבה: ${answer(item.requiresAssembly)}`,
              item.photoStatus === 'NOT_AVAILABLE' && 'תמונה לא זמינה כרגע',
              item.photoStatus === 'RECEIVED' && 'תמונה התקבלה',
            ].filter(Boolean).join(' · ') || 'ממתינים לפרטים נוספים'}</div>
          </div><span className="fact-check">✓</span>
        </div>)}</div>}
      <div className="locations">{(['pickup', 'dropoff'] as const).map((side, index) => {
        const location = details?.[side];
        return <div className="location" key={side}><span className={`route-dot dot-${index}`} /><div>
          <span className="field-label">{side === 'pickup' ? 'איסוף' : 'פריקה'}</span>
          <strong>{[location?.address, location?.city].filter(Boolean).join(', ') || 'הכתובת עדיין לא צוינה'}</strong>
          <span className="location-access">קומה: {location?.floor ?? '—'}<span>מעלית: {location ? answer(location.elevator) : '—'}</span></span>
        </div></div>;
      })}</div>
      {(details?.requestedDate || details?.requestedTime) && <div className="schedule"><span>מועד מבוקש</span><strong dir="ltr">{[details.requestedDate, details.requestedTime].filter(Boolean).join(' · ')}</strong></div>}
      {details?.specialAccessNotes && <div className="access-notes"><span className="field-label">גישה מיוחדת</span><p>{details.specialAccessNotes}</p></div>}
    </section>
    <section className="card missing-card">
      <div className="card-heading"><span className="section-icon amber">≡</span><h2>מה עדיין חסר</h2><span className="count">{state?.requirements.missingRequired.length ?? '—'}</span></div>
      <p className="card-description">הפרטים הדרושים כדי להתקדם לתמחור</p>
      {!state ? <p className="muted">ממתינים לחיבור לשרת…</p> : state.requirements.missingRequired.length ?
        <ul className="missing-list">{state.requirements.missingRequired.map((requirement, index) => <li key={`${requirement.id}-${requirement.itemIndex ?? index}`}>
          <span className="missing-dot" /><span>{labels[requirement.id] ?? requirement.id}{requirement.itemIndex !== undefined &&
            <small> · {itemNames[details?.items[requirement.itemIndex]?.type ?? ''] ?? `פריט ${requirement.itemIndex + 1}`}</small>}</span>
        </li>)}</ul> : <p className="complete-note">✓ נאספו כל הפרטים הדרושים לתמחור</p>}
      {!!state?.requirements.pendingReview.length && <p className="review-note">נושאים לבדיקה לפני שליחת הצעה: {state.requirements.pendingReview.length}.</p>}
      {!!state?.unappliedItems.length && <p className="review-note">יש כמה פריטים מאותו סוג. העדכון לא שויך לפריט מסוים ונדרשת הבהרה.</p>}
    </section>
    <section className="next-card" aria-live="polite" aria-atomic="true">
      <div className="next-heading"><span>✦</span><h2>{state?.nextQuestion ? 'השאלה הבאה' : 'השלב הבא'}</h2><span className="next-line" /></div>
      <p>{state?.responseText ?? 'טוענים את תמונת המצב…'}</p>
      <span className="next-footnote">{state?.requirements.readyForPricing ? 'המידע מוכן לתמחור · כל הצעה מחייבת אישור אנושי' : 'מתקדמים רק לפי המידע שעדיין חסר'}</span>
    </section>
  </aside>;
}
