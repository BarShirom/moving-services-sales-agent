import { OwnerView } from './OwnerView';
import { ConversationMessages } from './ConversationMessages';
import { Icon } from './Icon';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AgentState, statusLabel } from './AgentState';
import { DemoApiError, demoRequest, ownerRequest, ownerSample, type OwnerSnapshot, type DemoSnapshot } from './api';

const example = 'צריך להעביר מקרר גדול מרמת גן לתל אביב.\nהאיסוף מביאליק 20, קומה 2 בלי מעלית.\nיש גם בערך 15 ארגזים.';
const stages = ['שיחה ואיסוף פרטים', 'בדיקת בעל העסק ואישור מחיר', 'אישור הלקוח', 'ממתינים לתיאום ידני'];

function hasProgress(state: DemoSnapshot | null, owner: OwnerSnapshot | null): boolean {
  if (!state) return false;
  const move = state.lead.moveDetails;
  return !!(state.lead.messages.length || state.quote || state.lead.status !== 'COLLECTING_INFORMATION'
    || move.items.length || Object.values(move.pickup).some(value => value !== null)
    || Object.values(move.dropoff).some(value => value !== null) || move.requestedDate || move.requestedTime
    || move.specialAccessNotes || owner?.reviews.length || owner?.pricingEvaluation);
}
function currentStage(state: DemoSnapshot | null): number | null {
  if (!state || ['HUMAN_HANDOFF', 'LOST'].includes(state.lead.status)) return null;
  if (state.lead.status === 'WON') return 3;
  if (state.lead.status === 'QUOTE_SENT') return 2;
  if (['AWAITING_REVIEW', 'READY_FOR_PRICING'].includes(state.lead.status)) return 1;
  return 0;
}

export default function App() {
  const [state, setState] = useState<DemoSnapshot | null>(null);
  const [view, setView] = useState<'customer' | 'owner'>('customer');
  const [owner, setOwner] = useState<OwnerSnapshot | null>(null);
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [notice, setNotice] = useState('');
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<'send' | 'reset' | 'sample' | null>(null);
  const [confirmation, setConfirmation] = useState<'reset' | 'sample' | null>(null);
  const messageArea = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const confirmPanel = useRef<HTMLElement>(null);
  const recoveryButton = useRef<HTMLButtonElement>(null);
  const focusRecoveredDraft = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const busy = loading || pending !== null || ownerBusy;
  const blocked = busy || expired || confirmation !== null;
  const stage = currentStage(state);
  const aiUnavailable = ['AI_BUDGET_EXHAUSTED', 'AI_WINDOW_CLOSED', 'AI_NOT_CONFIGURED', 'AI_BUSY', 'AI_RATE_LIMITED', 'EXTRACTION_FAILED', 'AI_INPUT_LIMIT'].includes(errorCode);
  const photoRequested = state?.nextQuestion?.requirements.some(requirement => requirement.id === 'item.photo');

  function clearError() { setError(''); setErrorCode(''); }
  function handleError(error: unknown) {
    const code = error instanceof DemoApiError ? error.code : '';
    setErrorCode(code);
    setError(error instanceof Error ? error.message : 'לא ניתן להשלים את הפעולה כרגע.');
    if (code === 'SESSION_EXPIRED') {
      // Clear every stale quote/review binding, retaining only the unsent draft.
      setState(null); setOwner(null); setView('customer'); setConfirmation(null); setExpired(true); setNotice('');
    }
  }
  useEffect(() => {
    let active = true;
    demoRequest().then(result => { if (active) setState(result); })
      .catch(error => { if (active) handleError(error); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!state?.lead.messages.length && pending !== 'send') return;
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    // Scroll only the transcript, keeping the introduction and controls in place.
    const area = messageArea.current;
    area?.scrollTo?.({ top: area.scrollHeight, behavior });
  }, [state?.lead.messages.length, pending]);
  useEffect(() => { if (confirmation) confirmPanel.current?.focus(); else trigger.current?.focus(); }, [confirmation]);
  useEffect(() => { if (expired && !busy) recoveryButton.current?.focus(); }, [expired, busy]);
  useEffect(() => {
    if (focusRecoveredDraft.current && !loading && !expired && state) {
      input.current?.focus(); focusRecoveredDraft.current = false;
    }
  }, [loading, expired, state?.lead.id]);
  useLayoutEffect(() => {
    const textarea = input.current;
    if (!textarea) return;
    const resize = () => {
      textarea.style.height = 'auto';
      textarea.style.height = (textarea.scrollHeight + textarea.offsetHeight - textarea.clientHeight) + 'px';
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [text, view]);

  async function send() {
    if (blocked || !text.trim() || !state) return;
    clearError(); setNotice(''); setPending('send');
    try {
      const displayedQuote = state.quote && ['SENT', 'ACCEPTED'].includes(state.quote.status) ? state.quote : undefined;
      setState(await demoRequest('/message', text, displayedQuote)); setText('');
    } catch (error) { handleError(error); }
    finally { setPending(null); }
  }
  async function reset() {
    if (busy || expired || !state) return;
    setConfirmation(null); clearError(); setPending('reset');
    try {
      setState(await demoRequest('/reset')); setOwner(null); setView('customer'); setText('');
      setNotice('התחלנו הדגמה חדשה. השיחה וההצעה הקודמות הוסרו.');
    } catch (error) { handleError(error); }
    finally { setPending(null); }
  }
  async function reconnect() {
    if (busy) return;
    // GET only. Never replay a customer message, quote acceptance or owner action.
    setLoading(true); clearError(); setState(null); setOwner(null); setView('customer'); setConfirmation(null);
    try {
      setState(await demoRequest()); setExpired(false); focusRecoveredDraft.current = true;
      setNotice('ההדגמה פתוחה. אם נשמרה טיוטה, בדקו אותה ולחצו על שלח כשתרצו. שום הודעה לא נשלחה שוב.');
    } catch (error) { handleError(error); }
    finally { setLoading(false); }
  }
  function requestReplacement(kind: 'reset' | 'sample') {
    if (blocked || !state) return;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (hasProgress(state, owner) || text.trim()) setConfirmation(kind);
    else if (kind === 'sample') void loadSample();
    else void reset();
  }
  function cancelReplacement() { setConfirmation(null); }
  async function loadSample() {
    if (busy || expired || !state) return;
    setConfirmation(null); clearError(); setPending('sample');
    try {
      const latest = await ownerRequest();
      // Review a changed server/tab snapshot before replacing its progress.
      if ((latest.customer.lead.id !== state.lead.id || latest.customer.lead.updatedAt !== state.lead.updatedAt)
        && hasProgress(latest.customer, latest)) {
        setState(latest.customer); setOwner(latest); setConfirmation('sample');
        setNotice('הפנייה השתנתה מאז שהוצגה. בדקו אותה לפני אישור ההחלפה.');
        return;
      }
      const result = await ownerSample({ leadId: latest.customer.lead.id, revision: latest.revision });
      setOwner(result); setState(result.customer); setText(''); setView('owner');
      setNotice('נטענה פנייה מוכנה לבדיקה. זו דוגמה סינתטית, לא שיחה שנוצרה עכשיו בעזרת AI.');
    } catch (error) { handleError(error); }
    finally { setPending(null); }
  }
  async function switchView(next: 'customer' | 'owner') {
    if (blocked || view === next) return;
    setLoading(true); clearError();
    try {
      const result = next === 'owner' ? await ownerRequest() : null;
      const customer = result?.customer ?? await demoRequest();
      // Cookie-issuing GETs can replace an expired session without a 401 response.
      if (state && customer.lead.id !== state.lead.id) {
        handleError(new DemoApiError('SESSION_EXPIRED', 'ההדגמה הקודמת הסתיימה או הוחלפה. התחילו הדגמה חדשה.'));
        return;
      }
      setState(customer); setOwner(result);
      setView(next);
    } catch (error) { handleError(error); }
    finally { setLoading(false); }
  }

  const errorPanel = error && !expired && <div className="error-banner" role="alert">
    <strong>לא הצלחנו להשלים את הפעולה</strong><p>{error}</p>
    {!state && <button type="button" onClick={() => void reconnect()} disabled={busy}>ניסיון חיבור נוסף</button>}
    {state && aiUnavailable && <div className="error-actions">
      <button type="button" disabled={blocked} onClick={() => requestReplacement('sample')}>לטעינת פנייה מוכנה ללא AI</button>
      {view === 'customer' && <button type="button" disabled={blocked} onClick={() => void switchView('owner')}>לבדיקת הפנייה הקיימת</button>}
    </div>}
  </div>;

  return <div className="app-shell" dir="rtl">
    <a className="skip-link" href="#main-content">דילוג להדגמה</a>
    <header className="page-header">
      <p className="hero-kicker">סוכן מכירות לשירותי הובלה</p>
      <h1>מפניית לקוח להצעת מחיר באישור בעל העסק</h1>
      <p className="hero-copy">אוספים את פרטי ההובלה בשיחה, בודקים המלצת מחיר ומאשרים הצעה. אפשר לנסות את שני צדי התהליך: לקוח ובעל עסק.</p>
    </header>
    <section className="demo-start" aria-labelledby="demo-start-heading">
      <div><h2 id="demo-start-heading">רוצים להכיר את התהליך בלי לכתוב הודעות?</h2>
        <p>טענו פנייה מוכנה, עברו על הפרטים ואשרו מחיר בתפקיד בעל העסק. אחר כך חזרו לתצוגת הלקוח כדי לאשר את ההצעה.</p></div>
      <button type="button" className="primary-button sample-button" disabled={blocked || !state} onClick={() => requestReplacement('sample')}>{pending === 'sample' ? 'טוענים פנייה…' : 'טעינת פנייה מוכנה ללא AI'}</button>
    </section>
    <aside className="demo-notes" aria-label="גבולות ההדגמה">
      <p>השתמשו בפרטים לדוגמה בלבד. עיבוד הודעות בעזרת AI כפוף לתקציב משותף ומצטבר שאינו מתחדש אוטומטית; הפנייה המוכנה זמינה גם ללא AI.</p>
      <p>תצוגת בעל העסק היא חלק מההדגמה. כל הצעה דורשת אישור שלו. אישור הלקוח משאיר את ההובלה לתיאום ידני, ללא שמירת מועד או צוות.</p>
    </aside>
    <main id="main-content" tabIndex={-1}>
      <div className="workflow-guide" aria-label="שלבי ההדגמה">
        <ol>{stages.map((label, index) => <li key={label} className={'workflow-step' + (stage === index ? ' current' : stage !== null && index < stage ? ' complete' : '')} aria-current={stage === index ? 'step' : undefined}>
          <span className="step-index" aria-hidden="true">{index + 1}</span><span className="step-label">{label}</span>
        </li>)}</ol>
        {state?.lead.status === 'HUMAN_HANDOFF' && <p role="status">האוטומציה נעצרה. המשך הטיפול ידני ומתרחש מחוץ להדגמה.</p>}
        {state?.lead.status === 'LOST' && <p role="status">הפנייה נסגרה. אפשר להתחיל הדגמה חדשה.</p>}
      </div>
      <nav className="view-switch" aria-label="תצוגת ההדגמה">
        <button type="button" aria-pressed={view === 'customer'} disabled={blocked} onClick={() => void switchView('customer')}>לקוח</button>
        <button type="button" aria-pressed={view === 'owner'} disabled={blocked} onClick={() => void switchView('owner')}>בעל העסק</button>
      </nav>
      {notice && <p className="owner-notice" role="status">{notice}</p>}
      {expired && <section className="session-recovery" role="alert" aria-labelledby="session-heading">
        <h2 id="session-heading">תוקף ההדגמה הסתיים</h2>
        <p>השיחה וההצעה הקודמות אינן פעילות. התחילו הדגמה חדשה כדי להמשיך. הטיוטה שלא נשלחה נשמרה; שום הודעה או אישור לא יישלחו שוב אוטומטית.</p>
        <button type="button" ref={recoveryButton} disabled={busy} onClick={() => void reconnect()}>התחלת הדגמה חדשה</button>
        {errorCode !== 'SESSION_EXPIRED' && error && <p>{error}</p>}
      </section>}
      {confirmation && <section className="confirmation-panel" role="alertdialog" aria-labelledby="replace-heading" aria-describedby="replace-description" tabIndex={-1} ref={confirmPanel} onKeyDown={event => { if (event.key === 'Escape') cancelReplacement(); }}>
        <h2 id="replace-heading">{confirmation === 'sample' ? 'להחליף את השיחה בפנייה המוכנה?' : 'להתחיל מחדש ולמחוק את השיחה הנוכחית?'}</h2>
        <p id="replace-description">הפרטים, ההחלטות וההצעה הנוכחיים יוחלפו, וגם הטיוטה תימחק. {confirmation === 'sample' ? 'תיטען פנייה סינתטית מוכנה לבדיקה, ללא שימוש ב-AI.' : 'תיפתח שיחה ריקה.'}</p>
        <button type="button" className="confirm-replace" disabled={busy} onClick={() => void (confirmation === 'sample' ? loadSample() : reset())}>{confirmation === 'sample' ? 'אישור החלפה וטעינת הפנייה' : 'אישור איפוס ההדגמה'}</button>
        <button type="button" disabled={busy} onClick={cancelReplacement}>ביטול והמשך השיחה</button>
      </section>}
      {view === 'owner' && owner ? <>
        {errorPanel}
        <OwnerView disabled={blocked} owner={owner} onChange={value => { setOwner(value); setState(value.customer); }} onBusy={setOwnerBusy}
          onError={handleError} onSample={() => requestReplacement('sample')} onReset={async () => requestReplacement('reset')} />
      </> : <>
        <div className="customer-layout">
          <section className="conversation-card" aria-labelledby="conversation-heading">
            <div className="conversation-header">
              <div><h2 id="conversation-heading">השיחה שלכם</h2><span className="status-label" role="status">{loading ? 'מתחברים לשיחה…' : expired ? 'נדרשת הדגמה חדשה' : state ? statusLabel(state) : 'אין חיבור לשרת'}</span></div>
              <button type="button" className="reset-button" onClick={() => requestReplacement('reset')} disabled={blocked || !state}><Icon name="reset" />{pending === 'reset' ? 'מאפסים…' : 'איפוס הדגמה'}</button>
            </div>
            <div ref={messageArea} className="message-area" role="log" aria-label="הודעות השיחה" aria-live="polite" aria-busy={busy}>
              {loading ? <div className="conversation-empty"><Icon name="chat" /><p>טוענים את השיחה…</p></div> :
                !state ? <div className="conversation-empty"><Icon name="chat" /><p>{expired ? 'השיחה הקודמת הסתיימה. התחילו הדגמה חדשה כדי להמשיך.' : 'השיחה תופיע כאן לאחר החיבור לשרת.'}</p></div> :
                !state.lead.messages.length && pending !== 'send' && <div className="conversation-empty">
                  <span className="welcome-symbol"><Icon name="chat" /></span>
                  <h3>מה צריך להעביר?</h3><p>כתבו הודעה עם פרטי ההובלה.<br />הסוכן יאסוף את המידע החסר לפני בדיקת בעל העסק.</p>
                  <button type="button" className="example-button" disabled={blocked} onClick={() => { setText(example); input.current?.focus(); }}>טעינת הודעה לדוגמה</button>
                  <small>ההודעה תיכנס לטיוטה. עיבוד AI יתחיל רק לאחר לחיצה על שלח.</small>
                </div>}
              <ConversationMessages messages={state?.lead.messages ?? []} />
              {pending === 'send' && <><div className="message customer"><span className="message-label">הלקוח · בעיבוד</span><div className="bubble pending-bubble">{text}</div></div><div className="processing" role="status"><span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>{state?.lead.status === 'HUMAN_HANDOFF' ? 'שומרים את ההודעה להמשך טיפול מחוץ להדגמה…' : 'הסוכן מעבד את ההודעה…'}</div></>}
            </div>
            <form className="composer" onSubmit={event => { event.preventDefault(); void send(); }}>
              {errorPanel}
              {photoRequested && <div className="photo-help"><p>בהדגמה אין אפשרות להעלות תמונות. אם אין תמונה זמינה, אפשר לציין זאת; בעל העסק יצטרך לאשר המשך בלעדיה.</p>
                <button type="button" disabled={blocked} onClick={() => { setText('אין לי כרגע'); input.current?.focus(); }}>הכנסת תשובה: אין לי תמונה כרגע</button>
                <small>התשובה תיכנס לטיוטה ותישלח רק בלחיצה על שלח.</small>
              </div>}
              <label className="visually-hidden" htmlFor="customer-message">הודעת הלקוח</label>
              <div className="composer-row">
                <textarea ref={input} id="customer-message" value={text} onChange={event => setText(event.target.value)} maxLength={4000} disabled={blocked || !state} rows={1} placeholder="כתבו הודעה…" onKeyDown={event => {
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void send(); }
                }} />
                <button type="submit" className="send-button" disabled={blocked || !text.trim() || !state}>{pending === 'send' ? 'מעבד…' : 'שלח'}<Icon name="send" /></button>
              </div>
            </form>
          </section>
          <AgentState state={state} />
        </div>
        {state && ['AWAITING_REVIEW', 'READY_FOR_PRICING'].includes(state.lead.status) && <button className="primary-button continue-review" type="button" disabled={blocked} onClick={() => void switchView('owner')}>המשך לבדיקת בעל העסק</button>}
        {state && <details className="debug-panel"><summary>נתונים למפתחים · JSON</summary><pre dir="ltr">{JSON.stringify(state, null, 2)}</pre></details>}
      </>}
      <details className="engineering-note"><summary>איך זה עובד?</summary>
        <p>ה-AI מחלץ עובדות מובנות מהודעות הלקוח. קוד עם כללים קבועים מחשב המלצת מחיר. בעל העסק בודק את הפרטים ומאשר את ההצעה הסופית.</p>
      </details>
    </main>
    <footer className="app-footer"><nav aria-label="מידע על הפרויקט"><a href="https://github.com/BarShirom/moving-services-sales-agent" target="_blank" rel="noopener noreferrer">קוד הפרויקט</a><a href="https://barshirom.com/" target="_blank" rel="noopener noreferrer">האתר של בר שירום</a></nav><p>© 2026 בר שירום · הדגמת מוצר לשירותי הובלה</p></footer>
  </div>;
}
