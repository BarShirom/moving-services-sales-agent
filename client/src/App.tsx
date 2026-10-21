import { OwnerView } from './OwnerView';
import { ConversationMessages } from './ConversationMessages';
import { Icon } from './Icon';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { AgentState } from './AgentState';
import { currentStage, statusLabel } from './leadPresentation';
import { useDemoSession } from './useDemoSession';
import { CustomerQuoteOverview } from './QuoteOverview';
import type { DemoSnapshot } from './api';

const example = 'צריך להעביר מקרר גדול מרמת גן לתל אביב.\nהאיסוף מביאליק 20, קומה 2 בלי מעלית.\nיש גם בערך 15 ארגזים.';
const stages = ['שיחה ואיסוף פרטים', 'בדיקת בעל העסק ואישור מחיר', 'אישור הלקוח', 'ממתינים לתיאום ידני'];

function conversationStatus(state: DemoSnapshot | null, loading: boolean, expired: boolean): string {
  if (loading) return 'מתחברים לשיחה…';
  if (expired) return 'נדרשת הדגמה חדשה';
  return state ? statusLabel(state) : 'אין חיבור לשרת';
}

function ConversationPlaceholder({ state, loading, expired, sending, aiUnavailable, blocked, onExample }: {
  state: DemoSnapshot | null;
  loading: boolean;
  expired: boolean;
  sending: boolean;
  aiUnavailable: boolean;
  blocked: boolean;
  onExample: () => void;
}) {
  if (loading) return <div className="conversation-empty">
    <Icon name="chat" />
    <p>טוענים את השיחה…</p>
  </div>;
  if (!state) return <div className="conversation-empty">
    <Icon name="chat" />
    <p>{expired ? 'השיחה הקודמת הסתיימה. התחילו הדגמה חדשה כדי להמשיך.' : 'השיחה תופיע כאן לאחר החיבור לשרת.'}</p>
  </div>;
  if (state.lead.messages.length || sending) return null;
  return <div className="conversation-empty">
    <span className="welcome-symbol"><Icon name="chat" /></span>
    <h3>מה צריך להעביר?</h3>
    <p>{aiUnavailable ? 'אפשר לערוך טיוטה. איסוף פרטים חדשים דורש עיבוד AI זמין.' : <>
      כתבו הודעה עם פרטי ההובלה.<br />הסוכן יאסוף את המידע החסר לפני בדיקת בעל העסק.
    </>}</p>
    <button type="button" className="example-button" disabled={blocked} onClick={onExample}>טעינת הודעה לדוגמה</button>
    <small>ההודעה תיכנס לטיוטה. עיבוד AI יתחיל רק לאחר לחיצה על שלח.</small>
  </div>;
}

export default function App() {
  const {
    state, owner, view, text, setText, error, errorCode, notice, expired, loading,
    pending, confirmation, busy, blocked, retrySeconds, aiRetrySeconds,
    messageCooldown, knownAiUnavailable, aiUnavailableError, aiUnavailable,
    recoveryVersion, hasProgress, send, acceptQuote, reset, reconnect,
    requestReset: requestSessionReset, cancelReset, switchView, updateOwner,
    setOwnerBusy, handleError,
  } = useDemoSession();
  const messageArea = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const confirmPanel = useRef<HTMLElement>(null);
  const recoveryButton = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const focusedRecovery = useRef(0);
  const stage = currentStage(state);
  const conversationStatusText = conversationStatus(state, loading, expired);
  const photoRequested = state?.nextQuestion?.requirements.some(requirement => requirement.id === 'item.photo');

  useEffect(() => {
    if (!state?.lead.messages.length && pending !== 'send') return;
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    // Scroll only the transcript, keeping the introduction and controls in place.
    const area = messageArea.current;
    area?.scrollTo?.({ top: area.scrollHeight, behavior });
  }, [state?.lead.messages.length, pending]);
  useEffect(() => {
    if (confirmation) confirmPanel.current?.focus();
    else trigger.current?.focus();
  }, [confirmation]);
  useEffect(() => {
    if (expired && !busy) recoveryButton.current?.focus();
  }, [expired, busy]);
  useEffect(() => {
    if (recoveryVersion > focusedRecovery.current && !loading && !expired && state) {
      input.current?.focus();
      focusedRecovery.current = recoveryVersion;
    }
  }, [loading, expired, state?.lead.id, recoveryVersion]);
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

  function requestReset() {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    requestSessionReset();
  }

  function loadDraft(value: string) {
    setText(value);
    input.current?.focus();
  }

  const errorPanel = error && !expired && <div className="error-banner" role="alert">
    <strong>לא הצלחנו להשלים את הפעולה</strong>
    <p>{error}</p>
    {!state && <button type="button" onClick={() => void reconnect()} disabled={busy || retrySeconds > 0}>
      ניסיון חיבור נוסף
    </button>}
    {retrySeconds > 0 && <p className="retry-wait">יש להמתין עוד {retrySeconds} שניות לפני ניסיון נוסף. לא ננסה שוב אוטומטית.</p>}
    {state && aiUnavailableError && <>
      <p>השיחה והטיוטה נשמרו. איסוף פרטים מהודעות חדשות דורש עיבוד AI זמין. אפשר לבדוק מידע קיים ולאשר הצעה רק כשמצב הפנייה מאפשר זאת. איפוס ההדגמה אינו מחדש את התקציב המשותף.</p>
      {view === 'customer' && hasProgress && <div className="error-actions">
        <button type="button" disabled={blocked} onClick={() => void switchView('owner')}>לבדיקת הפנייה הקיימת</button>
      </div>}
    </>}
  </div>;

  return <div className="app-shell" dir="rtl">
    <a className="skip-link" href="#main-content">דילוג להדגמה</a>
    <header className="page-header">
      <p className="hero-kicker">סוכן מכירות לשירותי הובלה</p>
      <h1>מפניית לקוח להצעת מחיר באישור בעל העסק</h1>
      <p className="hero-copy">מתחילים בשיחת הלקוח, ממשיכים לבדיקת בעל העסק ומאשרים הצעת מחיר.</p>
    </header>
    <section className="how-it-works" aria-labelledby="how-heading">
      <h2 id="how-heading">איך זה עובד?</h2>
      <ul>
        <li>ה-AI מחלץ את פרטי ההובלה מהשיחה.</li>
        <li>מנוע התמחור מחשב המלצת מחיר לפי כללים מוגדרים.</li>
        <li>בעל העסק בודק ומאשר את המחיר לפני שליחת ההצעה.</li>
      </ul>
    </section>
    <main id="main-content" tabIndex={-1}>
      <div className="workflow-guide" aria-label="שלבי ההדגמה">
        <ol>{stages.map((label, index) => {
          const current = stage === index;
          const complete = stage !== null && index < stage;
          const className = 'workflow-step' + (current ? ' current' : complete ? ' complete' : '');
          return <li key={label} className={className} aria-current={current ? 'step' : undefined}>
            <span className="step-index" aria-hidden="true">{index + 1}</span>
            <span className="step-label">{label}</span>
          </li>;
        })}</ol>
        {state?.lead.status === 'HUMAN_HANDOFF' && <p role="status">האוטומציה נעצרה. המשך הטיפול ידני ומתרחש מחוץ להדגמה.</p>}
        {state?.lead.status === 'LOST' && <p role="status">הפנייה נסגרה. אפשר להתחיל הדגמה חדשה.</p>}
      </div>
      <nav className="view-switch" aria-label="תצוגת ההדגמה">
        <button type="button" aria-pressed={view === 'customer'} disabled={blocked} onClick={() => void switchView('customer')}>לקוח</button>
        <button type="button" aria-pressed={view === 'owner'} disabled={blocked} onClick={() => void switchView('owner')}>בעל העסק</button>
      </nav>
      {notice && <p className="owner-notice" role="status">{notice}</p>}
      {state && knownAiUnavailable && !aiUnavailableError && <p className="error-banner" role="status">עיבוד הודעות בעזרת AI אינו זמין כרגע. אפשר לערוך טיוטה ולבדוק מידע קיים. אישור הצעה אפשרי רק כשמצב הפנייה מאפשר זאת. איפוס ההדגמה אינו מחדש את התקציב המשותף.</p>}
      {expired && <section className="session-recovery" role="alert" aria-labelledby="session-heading">
        <h2 id="session-heading">תוקף ההדגמה הסתיים</h2>
        <p>השיחה וההצעה הקודמות אינן פעילות. התחילו הדגמה חדשה כדי להמשיך. הטיוטה שלא נשלחה נשמרה; שום הודעה או אישור לא יישלחו שוב אוטומטית.</p>
        <button type="button" ref={recoveryButton} disabled={busy || retrySeconds > 0} onClick={() => void reconnect()}>התחלת הדגמה חדשה</button>
        {retrySeconds > 0 && <p>יש להמתין עוד {retrySeconds} שניות לפני ניסיון נוסף. לא ננסה שוב אוטומטית.</p>}
        {errorCode !== 'SESSION_EXPIRED' && error && <p>{error}</p>}
      </section>}
      {confirmation && <section className="confirmation-panel" role="alertdialog" aria-labelledby="replace-heading" aria-describedby="replace-description" tabIndex={-1} ref={confirmPanel} onKeyDown={event => {
        if (event.key === 'Escape') cancelReset();
      }}>
        <h2 id="replace-heading">להתחיל מחדש ולמחוק את השיחה הנוכחית?</h2>
        <p id="replace-description">הפרטים, ההחלטות וההצעה הנוכחיים יוסרו, וגם הטיוטה תימחק. תיפתח שיחה ריקה. איפוס ההדגמה אינו מחדש את תקציב ה-AI המשותף.</p>
        <button type="button" className="confirm-replace" disabled={busy || retrySeconds > 0} onClick={() => void reset()}>אישור איפוס ההדגמה</button>
        <button type="button" disabled={busy} onClick={cancelReset}>ביטול והמשך השיחה</button>
      </section>}
      {view === 'owner' && owner ? <>
        {errorPanel}
        <OwnerView
          disabled={blocked}
          owner={owner}
          onChange={updateOwner}
          onBusy={setOwnerBusy}
          onError={handleError}
          onReset={async () => requestReset()}
          onCustomer={() => void switchView('customer')}
        />
      </> : <>
        <div className="customer-layout">
          <section className="conversation-card" aria-labelledby="conversation-heading">
            <div className="conversation-header">
              <div>
                <h2 id="conversation-heading">השיחה שלכם</h2>
                <span className="status-label" role="status">{conversationStatusText}</span>
              </div>
              <button type="button" className="reset-button" onClick={requestReset} disabled={blocked || !state}>
                <Icon name="reset" />{pending === 'reset' ? 'מאפסים…' : 'איפוס הדגמה'}
              </button>
            </div>
            {state && <CustomerQuoteOverview state={state} disabled={blocked} accepting={pending === 'accept'} onAccept={() => void acceptQuote()} />}
            {state?.lead.status === 'HUMAN_HANDOFF' && <section className="handoff-help" aria-labelledby="handoff-heading">
              <h3 id="handoff-heading">האוטומציה נעצרה</h3>
              <p>המשך הטיפול מתבצע מחוץ להדגמה. אין כאן תיבת נציג או חזרה אוטומטית לשיחה. הודעות נוספות נשמרות רק בשיחת ההדגמה הזמנית.</p>
              <button type="button" disabled={blocked} onClick={requestReset}>איפוס והתחלת שיחה חדשה</button>
            </section>}
            <div ref={messageArea} className="message-area" role="log" aria-label="הודעות השיחה" aria-live="polite" aria-busy={busy}>
              <ConversationPlaceholder
                state={state}
                loading={loading}
                expired={expired}
                sending={pending === 'send'}
                aiUnavailable={aiUnavailable}
                blocked={blocked}
                onExample={() => loadDraft(example)}
              />
              <ConversationMessages messages={state?.lead.messages ?? []} />
              {pending === 'send' && <>
                <div className="message customer">
                  <span className="message-label">הלקוח · בעיבוד</span>
                  <div className="bubble pending-bubble">{text}</div>
                </div>
                <div className="processing" role="status">
                  <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>
                  {state?.lead.status === 'HUMAN_HANDOFF' ? 'שומרים את ההודעה בשיחת ההדגמה הזמנית…' : 'הסוכן מעבד את ההודעה…'}
                </div>
              </>}
            </div>
            <form className="composer" onSubmit={event => {
              event.preventDefault();
              void send();
            }}>
              {errorPanel}
              {photoRequested && <div className="photo-help">
                <p>בהדגמה אין אפשרות להעלות תמונות. אם אין תמונה זמינה, אפשר לציין זאת; בעל העסק יצטרך לאשר המשך בלעדיה.</p>
                <button type="button" disabled={blocked} onClick={() => loadDraft('אין לי כרגע')}>הכנסת תשובה: אין לי תמונה כרגע</button>
                <small>התשובה תיכנס לטיוטה ותישלח רק בלחיצה על שלח.</small>
              </div>}
              <label className="visually-hidden" htmlFor="customer-message">הודעת הלקוח</label>
              <p className="composer-guidance">פרטים סינתטיים בלבד. עיבוד AI כפוף לתקציב משותף ומצטבר שאינו מתחדש אוטומטית.</p>
              {messageCooldown && <p className="composer-guidance" role="status">אפשר לנסות לשלוח שוב בעוד {aiRetrySeconds} שניות. לא ננסה שוב אוטומטית. אפשר לבדוק מידע קיים ולאשר הצעה כשמצב הפנייה מאפשר זאת.</p>}
              <div className="composer-row">
                <textarea ref={input} id="customer-message" value={text} onChange={event => setText(event.target.value)} maxLength={4000} disabled={blocked || !state} rows={1} placeholder="כתבו הודעה…" onKeyDown={event => {
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                    event.preventDefault();
                    void send();
                  }
                }} />
                <button type="submit" className="send-button" disabled={blocked || messageCooldown || !text.trim() || !state}>{pending === 'send' ? 'מעבד…' : 'שלח'}<Icon name="send" /></button>
              </div>
            </form>
          </section>
          <AgentState state={state} />
        </div>
        {state && ['AWAITING_REVIEW', 'READY_FOR_PRICING'].includes(state.lead.status) && <button className="primary-button continue-review" type="button" disabled={blocked} onClick={() => void switchView('owner')}>המשך לבדיקת בעל העסק</button>}
        {state && <details className="debug-panel">
          <summary>נתונים למפתחים · JSON</summary>
          <pre dir="ltr">{JSON.stringify(state, null, 2)}</pre>
        </details>}
      </>}
    </main>
    <footer className="app-footer">
      <nav aria-label="מידע על הפרויקט">
        <a href="https://github.com/BarShirom/moving-services-sales-agent" target="_blank" rel="noopener noreferrer">קוד הפרויקט</a>
        <a href="https://barshirom.com/" target="_blank" rel="noopener noreferrer">האתר של בר שירום</a>
      </nav>
      <p>© 2026 בר שירום · הדגמת מוצר לשירותי הובלה</p>
    </footer>
  </div>;
}
