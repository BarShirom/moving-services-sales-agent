import { Icon } from './Icon';
import type { DemoSnapshot } from './api';
import { itemNames, requirementLabels as labels, presentRequirements, nextStepLabel } from './leadPresentation';

const sizes: Record<string, string> = { SMALL: 'קטן', REGULAR: 'רגיל', LARGE: 'גדול', FOUR_DOOR: 'ארבע דלתות' };
const answer = (value: boolean | null) => value === null ? 'טרם צוין' : value ? 'כן' : 'לא';

// Display labels only; the backend remains the source of status and readiness.
export function statusLabel(state: DemoSnapshot): string {
  const labels: Record<DemoSnapshot['lead']['status'], string> = {
    COLLECTING_INFORMATION: state.nextQuestion ? 'איסוף מידע' : 'ממתין למידע נוסף',
    READY_FOR_PRICING: 'מוכן לבדיקה ותמחור',
    AWAITING_REVIEW: 'ממתין לבדיקה',
    QUOTE_SENT: 'הצעת המחיר נשלחה',
    WON: 'הלקוח אישר את המחיר',
    LOST: 'הפנייה נסגרה',
    HUMAN_HANDOFF: 'בטיפול נציג אנושי',
  };
  return labels[state.lead.status];
}

export function AgentState({ state }: { state: DemoSnapshot | null }) {
  const details = state?.lead.moveDetails;
  const { customerMissing, ownerReview } = state ? presentRequirements(state) : { customerMissing: [], ownerReview: [] };
  return <div className="state-sections" aria-label="מצב הסוכן" dir="rtl">
    <section className="card understood" aria-labelledby="understood-heading">
      <div className="card-heading"><span className="section-icon">✦</span><h2 id="understood-heading">מה הבנתי</h2><span className="small-label">פרטי ההובלה</span></div>
      {!details?.items.length ? <div className="empty-facts"><span className="empty-box"><Icon name="box" /></span><p>כל הובלה מתחילה בכמה פרטים</p><span>המידע שנאסף יופיע כאן אחרי ההודעה הראשונה.</span></div> :
        <div className="items-list">{details.items.map((item, index) => <div className="item-row" key={index}>
          <span className="item-symbol"><Icon name="box" /></span><div><strong>{itemNames[item.type ?? ''] ?? item.type ?? 'פריט לא מזוהה'}</strong>
            <div className="item-details">{[
              item.sizeCategory && (sizes[item.sizeCategory] ?? item.sizeCategory),
              item.quantity !== null && `כמות: ${item.quantity}`,
              ...(['width', 'height', 'depth'] as const).map(axis => item.dimensions[axis] !== null && `${labels[`item.${axis}`]}: ${item.dimensions[axis]} ס״מ`),
              item.requiresDisassembly !== null && `פירוק: ${answer(item.requiresDisassembly)}`,
              item.requiresAssembly !== null && `הרכבה: ${answer(item.requiresAssembly)}`,
              item.dimensionsAvailable === false && Object.values(item.dimensions).some(value => value === null) && 'מידות לא זמינות כרגע — ממתינות להשלמה',
              item.photoStatus === 'REQUIRED' && 'ממתינים לתמונה',
              item.photoStatus === 'NOT_APPLICABLE' && 'תמונה אינה נדרשת',
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
          <span className="location-access">קומה: {location?.floor ?? 'טרם צוין'}<span>מעלית: {location ? answer(location.elevator) : 'טרם צוין'}</span></span>
        </div></div>;
      })}</div>
      {(details?.requestedDate || details?.requestedTime) && <div className="schedule"><span>מועד מבוקש</span><strong dir="ltr">{[details.requestedDate, details.requestedTime].filter(Boolean).join(' · ')}</strong></div>}
      {details?.specialAccessNotes && <div className="access-notes"><span className="field-label">גישה מיוחדת</span><p>{details.specialAccessNotes}</p></div>}
    </section>
    {!!customerMissing.length && <section className="card missing-card" aria-labelledby="missing-heading">
      <div className="card-heading"><span className="section-icon amber">≡</span><h2 id="missing-heading">מה עדיין חסר מהלקוח</h2><span className="count">{customerMissing.length}</span></div>
      <ul className="missing-list">{customerMissing.map((label, index) => <li key={index}><span className="missing-dot" /><span>{label}</span></li>)}</ul>
    </section>}
    {!!ownerReview.length && <section className="card owner-review-card" aria-labelledby="owner-review-heading">
      <div className="card-heading"><span className="section-icon amber">≡</span><h2 id="owner-review-heading">נושאים לבדיקה אצל בעל העסק</h2><span className="count">{ownerReview.length}</span></div>
      <ul className="review-list">{ownerReview.map((label, index) => <li key={index}><span className="missing-dot" /><span>{label}</span></li>)}</ul>
    </section>}
    <section className="card next-card" aria-labelledby="next-heading" aria-live="polite" aria-atomic="true">
      <div className="next-heading"><span>✦</span><h2 id="next-heading">השלב הבא</h2><span className="next-line" /></div>
      <p>{nextStepLabel(state)}</p>
      <span className="next-footnote">{state?.lead.status === 'WON' ? 'אישור המחיר אינו שריון מועד ההובלה.' : state?.lead.status === 'QUOTE_SENT' ? 'המועד המבוקש עדיין לא שוריין.' : 'כל הצעת מחיר מחייבת אישור של בעל העסק.'}</span>
    </section>
  </div>;
}
