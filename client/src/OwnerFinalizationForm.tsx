import { useState } from 'react';
import type { OwnerAction, OwnerSnapshot } from './api';
import { ownerMoney as money } from './displayFormatting';
import { itemLabel } from './leadPresentation';
import { omittedLabel, reviewNotes } from './ownerPricingPresentation';

type FinalizationOwner = OwnerSnapshot & {
  pricingEvaluation: NonNullable<OwnerSnapshot['pricingEvaluation']>;
};

/** Local draft only. The parent dispatches the explicit, version-bound owner action. */
export function OwnerFinalizationForm({ owner, mode, pending, onSubmit, onError }: {
  owner: FinalizationOwner;
  mode: 'approve' | 'adjust';
  pending: boolean;
  onSubmit: (action: OwnerAction) => void;
  onError: (message: string) => void;
}) {
  const evaluation = owner.pricingEvaluation;
  const complete = evaluation.completeness === 'COMPLETE_RECOMMENDATION';
  const [amount, setAmount] = useState(evaluation.suggestedAmount === null ? '' : String(evaluation.suggestedAmount));
  const [reason, setReason] = useState('');
  const [scopeConfirmed, setScopeConfirmed] = useState(false);
  const [reviewedPhotos, setReviewedPhotos] = useState<number[]>([]);
  const photosConfirmed = owner.pendingPhotoItemIndices.every(index => reviewedPhotos.includes(index));
  const validAmount = amount.trim() !== '' && Number.isFinite(Number(amount)) && Number(amount) > 0
    && Number.isSafeInteger(Math.round(Number(amount) * 100)) && Number(amount) === Math.round(Number(amount) * 100) / 100;
  const actionAvailable = mode === 'adjust'
    ? owner.actions.adjust && scopeConfirmed && validAmount
    : owner.actions.approve;

  function submit() {
    if (mode === 'adjust' && !validAmount) {
      onError('יש להזין מחיר סופי חיובי, עם שתי ספרות עשרוניות לכל היותר.');
      return;
    }
    if ((mode === 'adjust' && !scopeConfirmed) || !photosConfirmed) {
      onError('יש לאשר במפורש את היקף ההצעה ואת התנאים שטרם הושלמו.');
      return;
    }
    const acknowledgement = {
      leadId: owner.customer.lead.id,
      revision: owner.revision,
      pricingEvaluationId: evaluation.id,
      scopeConfirmed: true,
      omittedCostsAcknowledged: !complete && scopeConfirmed,
      reviewedPhotoItemIndices: reviewedPhotos,
    };
    onSubmit(mode === 'approve'
      ? { ...acknowledgement, action: 'APPROVE' }
      : { ...acknowledgement, action: 'ADJUST_PRICE', amount: Number(amount), internalReason: reason });
  }

  function confirmPhoto(index: number, checked: boolean) {
    setReviewedPhotos(current => checked ? [...current, index] : current.filter(value => value !== index));
  }

  return <form className="owner-form finalization-form" onSubmit={event => {
    event.preventDefault();
    submit();
  }}>
    <h3>{mode === 'approve' ? 'בדיקת התנאים לפני שליחת ההצעה' : 'אישור מחיר סופי להובלה המתוארת'}</h3>
    <div className="calculated-subtotal">
      <strong>{complete ? 'הסכום שחושב במנוע' : 'סכום הרכיבים שתומחרו'}</strong>
      <p>{evaluation.suggestedAmount === null ? 'אין סכום מחושב. המחיר ייקבע על ידי בעל העסק.' : money(evaluation.suggestedAmount)}</p>
      {evaluation.priceRange && <p>טווח הרכיבים: {money(evaluation.priceRange.min)}–{money(evaluation.priceRange.max)}</p>}
    </div>
    {!!evaluation.omittedComponents.length && <>
      <h4>רכיבים שלא תומחרו</h4>
      <ul className="finalization-omissions">
        {evaluation.omittedComponents.map((part, index) => <li key={index}>{omittedLabel(part, owner)}</li>)}
      </ul>
    </>}
    {!!evaluation.reviewReasons.length && <details className="finalization-conditions" open>
      <summary>פרטים ותנאים לבדיקה</summary>
      <ul>{reviewNotes(owner).map(note => <li key={note.key}>{note.label}</li>)}</ul>
    </details>}
    {mode === 'adjust' && <>
      <label htmlFor="approved-amount">מחיר סופי לכל ההובלה (₪)</label>
      <input id="approved-amount" type="number" min="0.01" step="0.01" required value={amount}
        onChange={event => setAmount(event.target.value)} disabled={pending} />
      <label className="confirmation-field" htmlFor="scope-confirmation">
        <input id="scope-confirmation" type="checkbox" checked={scopeConfirmed} required
          onChange={event => setScopeConfirmed(event.target.checked)} disabled={pending} />
        בדקתי את {complete ? 'פרטי ההובלה והתנאים' : 'הרכיבים שלא תומחרו'}, והמחיר הסופי שהזנתי מכסה את ההובלה המתוארת.
      </label>
      <label htmlFor="internal-reason">סיבה פנימית לשינוי (לא תוצג ללקוח)</label>
      <input id="internal-reason" maxLength={300} value={reason}
        onChange={event => setReason(event.target.value)} disabled={pending} />
    </>}
    {owner.pendingPhotoItemIndices.map(index => <label className="confirmation-field" htmlFor={`photo-confirmation-${index}`} key={index}>
      <input id={`photo-confirmation-${index}`} type="checkbox" checked={reviewedPhotos.includes(index)}
        required disabled={pending} onChange={event => confirmPhoto(index, event.target.checked)} />
      בדקתי את הצורך בתמונה של {itemLabel(owner.customer.lead.moveDetails.items, index, true)} ואני מאשר להמשיך בלעדיה. התמונה עדיין חסרה.
    </label>)}
    <button type="submit" disabled={pending || !photosConfirmed || !actionAvailable}>
      {mode === 'approve' ? 'אשר תנאים ושלח הצעת מחיר' : 'אשר ושלח את המחיר הסופי'}
    </button>
  </form>;
}
