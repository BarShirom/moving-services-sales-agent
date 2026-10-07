import type { OwnerSnapshot } from './api';
import { itemLabel } from './leadPresentation';

const money = (amount: number) => `${amount.toLocaleString('he-IL')} ₪`;
const yesNo = (value: boolean | null) => value === null ? 'טרם צוין' : value ? 'כן' : 'לא';
const sizes: Record<string, string> = { LARGE: 'גדול', REGULAR: 'רגיל', SMALL: 'קטן', FOUR_DOOR: 'ארבע דלתות' };

export function QuoteOverview({ owner }: { owner: OwnerSnapshot }) {
  const quote = owner.currentQuote;
  const summary = owner.coordinationSummary;
  if ((!quote || !['SENT', 'ACCEPTED'].includes(quote.status)) && !summary) return null;
  return <>
    {quote && ['SENT', 'ACCEPTED'].includes(quote.status) && <section className="card final-quote-card" aria-labelledby="final-quote-heading">
      <div className="card-heading"><h2 id="final-quote-heading">{quote.status === 'ACCEPTED' ? 'הלקוח אישר את המחיר' : 'הצעת המחיר נשלחה'}</h2></div>
      <p>מחיר סופי שאושר להובלה המתוארת: <strong className="final-quote-amount">{money(quote.approvedAmount)}</strong></p>
      <p>{owner.customer.lead.status === 'HUMAN_HANDOFF' ? 'המשך טיפול אצל הנציג.' : quote.status === 'ACCEPTED' ? 'ממתין לתיאום' : 'ממתינים לתשובת הלקוח'}</p>
      <p className="muted">הצעה {quote.version} · המועד המבוקש אינו מועד משוריין.</p>
      {quote.omittedCostsAcknowledged && <p>בעל העסק אישר שהמחיר הסופי מכסה גם את הרכיבים שלא תומחרו במנוע.</p>}
      {!!quote.reviewedPhotoItemIndices.length && <ul className="photo-decisions">{quote.reviewedPhotoItemIndices.map(index => <li key={index}>
        {itemLabel(quote.scope.items, index)}: בעל העסק אישר להמשיך ללא תמונה. התמונה לא התקבלה.
      </li>)}</ul>}
    </section>}
    {summary && <section className="card coordination-summary" aria-labelledby="coordination-heading">
      <div className="card-heading"><h2 id="coordination-heading">סיכום לתיאום ידני</h2><span className="status-label">{summary.status === 'REVIEW_REQUIRED' ? 'נדרשת בדיקה לפני תיאום' : 'ממתין לתיאום'}</span></div>
      <p>מחיר שהלקוח אישר: <strong>{money(summary.acceptedAmount)}</strong></p>
      <p className="muted">טרם שוריינו מועד או צוות להובלה.</p>
      <h3>הפריטים שאושרו בהצעה</h3>
      <ul>{summary.scope.items.map((item, index) => <li key={index}>{itemLabel(summary.scope.items, index)} · כמות: {item.quantity ?? 'טרם צוינה'}
        {item.sizeCategory ? ` · גודל: ${sizes[item.sizeCategory] ?? item.sizeCategory}` : ''}
      </li>)}</ul>
      <h3>מסלול וגישה</h3>
      <ul>{(['pickup', 'dropoff'] as const).map(side => <li key={side}>
        {side === 'pickup' ? 'איסוף' : 'פריקה'}: {[summary.scope[side].address, summary.scope[side].city].filter(Boolean).join(', ') || 'כתובת טרם נמסרה'}
        {` · קומה: ${summary.scope[side].floor ?? 'טרם צוינה'} · מעלית: ${yesNo(summary.scope[side].elevator)}`}
      </li>)}</ul>
      <p>מועד מבוקש: {[summary.scope.requestedDate, summary.scope.requestedTime].filter(Boolean).join(' · ') || 'טרם נמסר'}. נדרש תיאום סופי.</p>
      {summary.scope.specialAccessNotes && <p>פרטי גישה: {summary.scope.specialAccessNotes}</p>}
      <h3>שירותים שנכללו במפורש</h3>
      {summary.scope.items.some(item => item.requiresDisassembly || item.requiresAssembly) ? <ul>{summary.scope.items.flatMap((item, index) => [
        item.requiresDisassembly === true && <li key={`${index}-disassembly`}>פירוק {itemLabel(summary.scope.items, index, true)}</li>,
        item.requiresAssembly === true && <li key={`${index}-assembly`}>הרכבת {itemLabel(summary.scope.items, index, true)}</li>,
      ])}</ul> : <p>לא נמסרו שירותי פירוק או הרכבה שנדרשים במפורש.</p>}
      {!!summary.unresolvedDetails.length && <><h3>פרטים שעדיין דורשים בירור</h3><ul>{summary.unresolvedDetails.map((detail, index) => <li key={index}>{detail}</li>)}</ul></>}
      <h3>אישורי בעל העסק</h3>
      <ul><li>{summary.omittedCostsAcknowledged ? 'אושר שהמחיר הסופי מכסה את הרכיבים שלא תומחרו במנוע.' : 'אושרה הצעת המחיר על בסיס החישוב המלא.'}</li>
        {summary.reviewedPhotoItemIndices.map(index => <li key={index}>{itemLabel(summary.scope.items, index)}: אושר להמשיך ללא תמונה; התמונה עדיין חסרה.</li>)}
      </ul>
    </section>}
  </>;
}
