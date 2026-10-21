import type { OwnerSnapshot } from './api';
import { ownerMoney as money } from './displayFormatting';
import { componentLabel, omittedLabel, reviewNotes } from './ownerPricingPresentation';

export function OwnerPricingCard({ owner, pending, onRecalculate }: {
  owner: OwnerSnapshot;
  pending: boolean;
  onRecalculate: () => void;
}) {
  const evaluation = owner.pricingEvaluation;
  const complete = evaluation?.completeness === 'COMPLETE_RECOMMENDATION';
  const quoteSent = owner.currentQuote?.status === 'SENT';
  const quoteAccepted = owner.currentQuote?.status === 'ACCEPTED';
  const finalized = quoteSent || quoteAccepted;
  const notes = reviewNotes(owner);
  const badge = quoteAccepted ? 'הלקוח אישר את המחיר' : quoteSent ? 'הצעת המחיר נשלחה' : 'נדרש אישור בעל העסק';
  const completenessLabels = {
    COMPLETE_RECOMMENDATION: 'המלצה מלאה להובלה לפי הכללים הזמניים',
    CANNOT_PRICE: 'אין המלצה מספרית',
    PARTIAL_RECOMMENDATION: 'המלצה חלקית: רכיבים חסרים בתמחור',
  };
  const omittedAccess = evaluation?.omittedComponents.some(part => part.code === 'UNSUPPORTED_ITEM_ACCESS');

  return <section className="card pricing-card" aria-labelledby="pricing-heading">
    <div className="card-heading">
      <h2 id="pricing-heading">{finalized ? 'חישוב המנוע ששימש לבדיקה' : 'מחיר מומלץ'}</h2>
      <span className="review-badge">{badge}</span>
    </div>
    {!evaluation ? <p className="muted">ההמלצה תופיע לאחר השלמת הפרטים הדרושים לתמחור.</p> : <>
      {owner.pricingStale && <p className="stale-banner" role="status">ההמלצה אינה עדכנית. יש להשלים את המידע ולחשב מחדש לפני אישור.</p>}
      <div className="price-hero">
        <strong className="suggested-price">{evaluation.suggestedAmount === null ? 'נדרש תמחור ידני' : money(evaluation.suggestedAmount)}</strong>
        <span>{completenessLabels[evaluation.completeness]}</span>
      </div>
      <div className="price-metrics">
        <div>
          <span>{complete ? 'טווח מומלץ להובלה' : 'טווח לרכיבים שתומחרו'}</span>
          <strong dir="ltr">{evaluation.priceRange ? `${money(evaluation.priceRange.min)}–${money(evaluation.priceRange.max)}` : 'לא זמין'}</strong>
        </div>
        <div>
          <span>ציון שלמות ומידע</span>
          <strong>{evaluation.confidence}%</strong>
          <small>אינו מדד לדיוק סטטיסטי</small>
        </div>
      </div>
      <p className="pricing-explanation">
        {finalized ? 'זהו החישוב המקורי של המנוע. המחיר הסופי שאושר מוצג בנפרד.' : 'המלצה דטרמיניסטית לפי כללים זמניים.'}{' '}
        {complete ? 'רכיבי המחיר חושבו; תנאים תפעוליים שטרם הושלמו עדיין דורשים בדיקה.' : <>
          רכיבים שלא תומחרו אינם כלולים בסכום או בטווח.{' '}
          {finalized ? 'המחיר הסופי נקבע ואושר בנפרד.' : 'בעל העסק נדרש לקבוע ולאשר מחיר סופי להובלה המתוארת.'}
        </>}
      </p>
      {owner.demoDistanceKm !== null && <p className="pricing-explanation">
        מרחק הדגמה סינתטי: {owner.demoDistanceKm} ק״מ (נתון זמני, לא מדידת מפה).
      </p>}
      <h3>תומחר</h3>
      <ul className="price-breakdown">
        {evaluation.breakdown.map((part, index) => <li key={index}>
          <div>
            <strong>{componentLabel(part, owner)}</strong>
            <b>{money(part.amount)}</b>
          </div>
          <p>טווח ייחוס לרכיב: {money(part.range.min)}–{money(part.range.max)}</p>
          {part.code === 'FLOORS' && omittedAccess && <p className="pricing-scope">
            תמחור המדרגות כולל את הפריטים שתומחרו בלבד. נשיאת הפריטים ללא תעריף ותנאי הגישה שלהם דורשים תמחור ידני נפרד.
          </p>}
          <details>
            <summary>בסיס החישוב</summary>
            <p dir="auto">{part.basis}</p>
          </details>
        </li>)}
      </ul>
      {!evaluation.breakdown.length && <p className="muted">אין רכיבים שניתן לחשב לפי הכללים הנוכחיים.</p>}
      <h3>דורש תמחור ידני</h3>
      {!evaluation.omittedComponents.length && <p className="complete-note">אין רכיבים שהוחרגו מהחישוב.</p>}
      <ul className="omitted-list">
        {evaluation.omittedComponents.map((part, index) => <li key={index}>
          <strong>{omittedLabel(part, owner)}</strong>
          {part.quantity !== null && <span>{part.code === 'DISTANCE' ? 'מרחק ידוע בק״מ' : 'כמות'}: {part.quantity}</span>}
          <details>
            <summary>פרטי ההחרגה</summary>
            <p dir="auto">{part.reason}</p>
          </details>
        </li>)}
      </ul>
      <div className="review-reasons">
        <h3>מה דורש בדיקה</h3>
        <ul>{notes.map(note => <li key={note.key}>{note.label}</li>)}</ul>
      </div>
      {!!evaluation.reviewReasons.length && <details className="confidence-details">
        <summary>פירוט ציון השלמות והמידע</summary>
        <p>זהו ציון לפי כללי ההדגמה, ואינו מדד לדיוק סטטיסטי.</p>
        <ul>{notes.map(note => <li key={note.key}>
          {note.label}<small>הפחתה בציון: {note.confidenceDeduction}</small>
        </li>)}</ul>
      </details>}
    </>}
    <button type="button" className="recalculate-button" disabled={pending || !owner.actions.recalculate} onClick={onRecalculate}>
      חשב המלצה מחדש
    </button>
  </section>;
}
