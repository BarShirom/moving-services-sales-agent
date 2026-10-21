import { useEffect, useRef, useState } from 'react';
import { AgentState, statusLabel } from './AgentState';
import { DemoApiError, ownerAction, ownerPricing, ownerRequest, type OwnerSnapshot, type OwnerAction } from './api';
import { presentRequirements } from './leadPresentation';
import { QuoteOverview } from './QuoteOverview';
import { ownerMoney as money } from './displayFormatting';
import { OwnerPricingCard } from './OwnerPricingCard';
import { OwnerFinalizationForm } from './OwnerFinalizationForm';

const decisions = {
  APPROVED: 'המחיר אושר ונשלח',
  ADJUSTED: 'המחיר עודכן ונשלח',
  REQUEST_MORE_INFO: 'נשלחה בקשת מידע',
  HUMAN_HANDOFF: 'האוטומציה נעצרה לטיפול ידני',
};

function nextOwnerAction(owner: OwnerSnapshot): string {
  if (owner.customer.lead.status === 'HUMAN_HANDOFF') return 'המשך הטיפול ידני, מחוץ להדגמה.';
  if (owner.customer.lead.status === 'LOST') return 'הפנייה נסגרה. אפשר להתחיל הדגמה חדשה.';
  if (owner.currentQuote?.status === 'ACCEPTED') return 'המחיר אושר על ידי הלקוח. נותר לתאם מועד וצוות ידנית.';
  if (owner.currentQuote?.status === 'SENT') return 'עברו לתצוגת הלקוח כדי להשיב להצעת המחיר.';
  if (owner.pendingOwnerQuestion) return 'ממתינים לתשובת הלקוח לשאלה שנשלחה.';
  if (owner.pricingStale) return 'הפרטים השתנו. חשבו המלצה מחדש לפני אישור מחיר.';
  if (owner.actions.approve || owner.actions.adjust) return 'בדקו את פרטי ההובלה והתנאים, ואשרו מחיר סופי ללקוח.';
  if (owner.actions.recalculate) return 'חשבו המלצה לפי הפרטים שנאספו.';
  return 'השלימו את הפרטים החסרים בתצוגת הלקוח לפני אישור מחיר.';
}

function ownerPriceLabel(owner: OwnerSnapshot): string {
  if (owner.currentQuote?.status === 'ACCEPTED') return 'המחיר שהלקוח אישר';
  if (owner.currentQuote?.status === 'SENT') return 'המחיר הסופי שאישר בעל העסק';
  if (!owner.pricingEvaluation) return 'מחיר ההובלה';
  if (owner.pricingEvaluation.completeness === 'COMPLETE_RECOMMENDATION') return 'המלצת המנוע, לפני אישור';
  if (owner.pricingEvaluation.suggestedAmount === null) return 'נדרש תמחור ידני';
  return 'סכום חלקי, לפני מחיר סופי';
}

export function OwnerView({ owner, onChange, onBusy, onReset, onError, onCustomer, disabled = false }: {
  onError?: (error: unknown) => void;
  onCustomer?: () => void;
  disabled?: boolean;
  owner: OwnerSnapshot;
  onChange: (value: OwnerSnapshot) => void;
  onBusy: (value: boolean) => void;
  onReset: () => Promise<void>;
}) {
  const [working, setPending] = useState(false);
  const pending = working || disabled;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState<'approve' | 'adjust' | 'question' | 'handoff' | null>(null);
  const [finalizationVersion, setFinalizationVersion] = useState(0);
  const [question, setQuestion] = useState('');
  const handoffButton = useRef<HTMLButtonElement>(null);
  const handoffCancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (form === 'handoff') handoffCancel.current?.focus();
  }, [form]);
  const evaluation = owner.pricingEvaluation;
  const complete = evaluation?.completeness === 'COMPLETE_RECOMMENDATION';
  const quoteSent = owner.currentQuote?.status === 'SENT';
  const quoteAccepted = owner.currentQuote?.status === 'ACCEPTED';
  const finalized = quoteSent || quoteAccepted;
  const { customerMissing, ownerReview } = presentRequirements(owner.customer);
  const handoff = owner.customer.lead.status === 'HUMAN_HANDOFF';
  const nextAction = nextOwnerAction(owner);
  const priceLabel = ownerPriceLabel(owner);
  const displayedAmount = finalized && owner.currentQuote ? owner.currentQuote.approvedAmount : evaluation?.suggestedAmount;
  const priceAmount = displayedAmount != null ? money(displayedAmount) : 'טרם נקבע מחיר';
  const approveLabel = complete ? 'אשר ושלח הצעת מחיר'
    : evaluation?.suggestedAmount === null ? 'הזן ואשר מחיר סופי' : 'השלם ואשר מחיר סופי';
  const token = { leadId: owner.customer.lead.id, revision: owner.revision };

  async function run(operation: () => Promise<OwnerSnapshot>, success: string) {
    if (pending) return;
    setPending(true);
    onBusy(true);
    setError('');
    setNotice('');
    try {
      onChange(await operation());
      setForm(null);
      setQuestion('');
      setNotice(success);
    } catch (error) {
      if (onError && error instanceof DemoApiError && ['SESSION_EXPIRED', 'SESSION_RATE_LIMITED', 'SESSION_CAPACITY', 'RATE_LIMITED', 'PROTECTION_CAPACITY'].includes(error.code)) {
        onError(error);
      } else {
        setError(error instanceof Error ? error.message : 'לא ניתן להשלים את הפעולה.');
      }
    } finally {
      setPending(false);
      onBusy(false);
    }
  }

  function refresh() {
    return run(async () => {
      const refreshed = await ownerRequest();
      // A cookie-issuing GET may replace an expired or externally changed session.
      if (refreshed.customer.lead.id !== owner.customer.lead.id) {
        throw new DemoApiError('SESSION_EXPIRED', 'ההדגמה הקודמת הסתיימה או הוחלפה. התחילו הדגמה חדשה.');
      }
      return refreshed;
    }, 'המידע מעודכן.');
  }
  function closeForm() {
    const wasHandoff = form === 'handoff';
    setForm(null);
    if (wasHandoff) handoffButton.current?.focus();
  }

  function act(action: OwnerAction) {
    return run(() => ownerAction(action), 'הפעולה נשמרה. אפשר לעבור לתצוגת הלקוח.');
  }

  function openFinalization(mode: 'approve' | 'adjust') {
    setForm(mode);
    setFinalizationVersion(current => current + 1);
    setError('');
  }

  function approve() {
    if (!evaluation) return;
    if (!complete) openFinalization('adjust');
    else if (owner.pendingPhotoItemIndices.length) openFinalization('approve');
    else void act({ ...token, action: 'APPROVE', pricingEvaluationId: evaluation.id, scopeConfirmed: true });
  }
  return <div className="owner-view" aria-busy={pending}>
    <section className="card owner-overview">
      <div className="owner-title">
        <div>
          <span className="eyebrow">סביבת הדגמה · בעל העסק</span>
          <h2>בדיקת ההובלה</h2>
          <span className="status-label">{statusLabel(owner.customer)}</span>
        </div>
        <span className="owner-emblem" aria-hidden="true">₪</span>
      </div>
      <p className="card-description">כל הפרטים, המלצה שקופה והחלטה שלך לפני שהמחיר מגיע ללקוח.</p>
      <div className="owner-workflow-summary">
        <div className="owner-price-summary">
          <span>{priceLabel}</span>
          <strong>{priceAmount}</strong>
          {!finalized && !complete && evaluation && <small>רכיבים שלא תומחרו אינם כלולים בסכום.</small>}
        </div>
        <div className="owner-next-action">
          <h3>מה עושים עכשיו?</h3>
          <p>{nextAction}</p>
          {quoteSent && !handoff && onCustomer && <button type="button" className="primary-button to-customer-button" disabled={pending} onClick={onCustomer}>
            לתצוגת הלקוח ואישור ההצעה
          </button>}
          {!finalized && !!customerMissing.length && <p>להשלמה מהלקוח: {customerMissing.join(' · ')}</p>}
          {!finalized && !!ownerReview.length && <p>לבדיקת בעל העסק: {ownerReview.join(' · ')}</p>}
          {!finalized && !!evaluation?.omittedComponents.length && <p>יש {evaluation.omittedComponents.length} רכיבים שלא תומחרו. יש לכלול אותם במחיר הסופי.</p>}
        </div>
      </div>
      <div className="owner-toolbar">
        <button type="button" disabled={pending} onClick={() => void refresh()}>רענון הפנייה</button>
        <button type="button" disabled={pending} onClick={() => void onReset()}>איפוס הדגמה</button>
      </div>
      {error && <p className="error-banner" role="alert">{error}</p>}
      {notice && <p className="owner-notice" role="status">{notice}</p>}
    </section>
    <div className="owner-decision-layout">
      <div className="owner-sidebar">
        <section className="card owner-actions" aria-labelledby="actions-heading">
          <h2 id="actions-heading">החלטת בעל העסק</h2>
          {owner.pendingOwnerQuestion && <p className="muted">ממתינים לתשובת הלקוח: {owner.pendingOwnerQuestion}</p>}
          {owner.customer.lead.status === 'HUMAN_HANDOFF' && <p className="owner-notice">האוטומציה נעצרה. המשך הטיפול מתבצע מחוץ להדגמה; אין כאן ממשק מענה אנושי או אפשרות לחדש את האוטומציה בפנייה זו.</p>}
          <div className="action-grid">
            <button type="button" className="approve-button" disabled={pending || (complete ? !owner.actions.approve : !owner.actions.adjust)} onClick={approve}>
              {approveLabel}
            </button>
            {complete && <button type="button" disabled={pending || !owner.actions.adjust} onClick={() => openFinalization('adjust')}>
              שנה מחיר
            </button>}
            <button type="button" disabled={pending || !owner.actions.requestMoreInfo} onClick={() => setForm('question')}>
              בקש מידע נוסף
            </button>
            <button ref={handoffButton} type="button" disabled={pending || !owner.actions.takeOver} onClick={() => setForm('handoff')}>
              עצור אוטומציה לטיפול ידני
            </button>
          </div>
          {form === 'handoff' && <div className="handoff-confirmation" role="group" aria-labelledby="handoff-heading" aria-describedby="handoff-description" onKeyDown={event => {
            if (event.key === 'Escape' && !pending) closeForm();
          }}>
            <h3 id="handoff-heading">לעצור את האוטומציה בפנייה הזו?</h3>
            <p id="handoff-description">לא ניתן לחדש אותה בפנייה זו. ההמשך יהיה בטיפול ידני מחוץ להדגמה; אין כאן צ׳אט עם נציג.</p>
            <button type="button" disabled={pending || !owner.actions.takeOver} onClick={() => void act({ ...token, action: 'TAKE_OVER_CONVERSATION' })}>
              אשר עצירה והמשך ידני
            </button>
            <button ref={handoffCancel} type="button" className="cancel-action" disabled={pending} onClick={closeForm}>
              ביטול
            </button>
          </div>}
          {(form === 'adjust' || form === 'approve') && evaluation && <OwnerFinalizationForm
            key={finalizationVersion}
            owner={{ ...owner, pricingEvaluation: evaluation }}
            mode={form}
            pending={pending}
            onSubmit={action => void act(action)}
            onError={setError}
          />}
          {form === 'question' && <form className="owner-form" onSubmit={event => {
            event.preventDefault();
            void act({ ...token, action: 'REQUEST_MORE_INFO', question });
          }}>
            <label htmlFor="owner-question">השאלה שתישלח ללקוח</label>
            <textarea id="owner-question" required maxLength={500} value={question}
              onChange={event => setQuestion(event.target.value)} disabled={pending} />
            <button type="submit" disabled={pending || !question.trim() || !owner.actions.requestMoreInfo}>
              שלח שאלה ללקוח
            </button>
          </form>}
          {form && form !== 'handoff' && <button type="button" className="cancel-action" disabled={pending} onClick={closeForm}>
            ביטול
          </button>}
        </section>
      </div>
      <div className="owner-content">
        <AgentState state={owner.customer} />
        <QuoteOverview owner={owner} />
        <OwnerPricingCard owner={owner} pending={pending} onRecalculate={() => void run(() => ownerPricing(token), 'ההמלצה חושבה מחדש.')} />
      </div>
    </div>
    {owner.reviews.length > 0 && <section className="card owner-history">
      <h2>היסטוריית החלטות</h2>
      <ul>{[...owner.reviews].reverse().map(review => <li key={review.id}>
        <strong>{decisions[review.decision]}</strong>
        <time dateTime={review.createdAt}>{new Date(review.createdAt).toLocaleString('he-IL')}</time>
        <p>המלצה: {review.suggestedAmount === null ? 'לא זמינה' : money(review.suggestedAmount)} · אושר: {review.approvedAmount === null ? 'טרם אושר' : money(review.approvedAmount)}</p>
        {review.internalReason && <p>סיבה פנימית: {review.internalReason}</p>}
        {review.customerQuestion && <p>{review.customerQuestion}</p>}
      </li>)}</ul>
    </section>}
  </div>;
}
