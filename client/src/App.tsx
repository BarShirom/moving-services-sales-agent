import { OwnerView } from './OwnerView';
import { ConversationMessages } from './ConversationMessages';
import { Icon } from './Icon';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AgentState, statusLabel } from './AgentState';
import { demoRequest, ownerRequest, type OwnerSnapshot, type DemoSnapshot } from './api';

const example = 'צריך להעביר מקרר גדול מרמת גן לתל אביב.\nהאיסוף מביאליק 20, קומה 2 בלי מעלית.\nיש גם בערך 15 ארגזים.';

export default function App() {
  const [state, setState] = useState<DemoSnapshot | null>(null);
  const [view, setView] = useState<'customer' | 'owner'>('customer');
  const [owner, setOwner] = useState<OwnerSnapshot | null>(null);
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<'send' | 'reset' | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const busy = loading || pending !== null || ownerBusy;

  useEffect(() => {
    let active = true;
    demoRequest().then(result => { if (active) setState(result); })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : 'לא ניתן להתחבר לשרת.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    bottom.current?.scrollIntoView({ block: 'nearest', behavior });
  }, [state?.lead.messages.length, pending]);

  useLayoutEffect(() => {
    const textarea = input.current;
    if (!textarea) return;
    const resize = () => {
      textarea.style.height = 'auto';
      // Include borders; CSS caps the height and allows scrolling for longer drafts.
      textarea.style.height = `${textarea.scrollHeight + textarea.offsetHeight - textarea.clientHeight}px`;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [text]);

  async function send() {
    if (busy || !text.trim() || !state) return;
    setError(''); setPending('send');
    try {
      const displayedQuote = state.quote && ['SENT', 'ACCEPTED'].includes(state.quote.status) ? state.quote : undefined;
      setState(await demoRequest('/message', text, displayedQuote)); setText('');
    }
    catch (error) { setError(error instanceof Error ? error.message : 'לא הצלחנו לעבד את ההודעה.'); }
    finally { setPending(null); }
  }
  async function reset() {
    if (busy || !state) return;
    setError(''); setPending('reset');
    try { setState(await demoRequest('/reset')); setOwner(null); setView('customer'); setText(''); }
    catch (error) { setError(error instanceof Error ? error.message : 'לא ניתן לאפס כרגע.'); }
    finally { setPending(null); }
  }
  async function reconnect() {
    if (busy) return;
    setLoading(true); setError('');
    try { setState(await demoRequest()); }
    catch (error) { setError(error instanceof Error ? error.message : 'לא ניתן להתחבר לשרת.'); }
    finally { setLoading(false); }
  }

  async function switchView(next: 'customer' | 'owner') {
    if (busy || view === next) return;
    setLoading(true); setError('');
    try {
      if (next === 'owner') { const result = await ownerRequest(); setOwner(result); setState(result.customer); }
      else setState(await demoRequest());
      setView(next);
    } catch (error) { setError(error instanceof Error ? error.message : 'לא ניתן להחליף תצוגה.'); }
    finally { setLoading(false); }
  }
  return <div className="app-shell" dir="rtl">
    <header className="page-header">
      <h1 dir="ltr">Moving Services Sales Agent</h1>
      <p>סוכן מכירות חכם לשירותי הובלה</p>
    </header>
    <nav className="view-switch" aria-label="תצוגת ההדגמה">
      <button type="button" aria-pressed={view === 'customer'} disabled={busy} onClick={() => void switchView('customer')}>לקוח</button>
      <button type="button" aria-pressed={view === 'owner'} disabled={busy} onClick={() => void switchView('owner')}>בעל העסק</button>
    </nav>
    <main id="main-content">
      {view === 'owner' && owner ? <>
        {error && <p className="error-banner" role="alert">{error}</p>}
        <OwnerView disabled={busy} owner={owner} onChange={value => { setOwner(value); setState(value.customer); }} onBusy={setOwnerBusy} onReset={reset} />
      </> : <>
      <section className="conversation-card" aria-labelledby="conversation-heading">
        <div className="conversation-header">
          <div><h2 id="conversation-heading">השיחה שלכם</h2><span className="status-label" role="status">{loading ? 'מתחברים לשיחה…' : state ? statusLabel(state) : 'אין חיבור לשרת'}</span></div>
          <button type="button" className="reset-button" onClick={reset} disabled={busy || !state}><Icon name="reset" />{pending === 'reset' ? 'מאפסים…' : 'איפוס הדגמה'}</button>
        </div>
        <div className="message-area" role="log" aria-label="הודעות השיחה" aria-live="polite" aria-busy={busy}>
          {loading ? <div className="conversation-empty"><Icon name="chat" /><p>טוענים את השיחה…</p></div> :
            !state ? <div className="conversation-empty"><Icon name="chat" /><p>השיחה תופיע כאן לאחר החיבור לשרת.</p></div> :
            !state.lead.messages.length && pending !== 'send' && <div className="conversation-empty">
              <span className="welcome-symbol"><Icon name="chat" /></span>
              <h3>מה צריך להעביר?</h3><p>ספרו לנו על ההובלה.<br />הסוכן יאסוף את הפרטים ויעזור להתקדם.</p>
              <button type="button" className="example-button" disabled={busy} onClick={() => { setText(example); input.current?.focus(); }}>טעינת הודעה לדוגמה</button>
            </div>}
          <ConversationMessages messages={state?.lead.messages ?? []} />
          {pending === 'send' && <><div className="message customer"><span className="message-label">הלקוח · בעיבוד</span><div className="bubble pending-bubble">{text}</div></div><div className="processing" role="status"><span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>{state?.lead.status === 'HUMAN_HANDOFF' ? 'שומרים את ההודעה לנציג…' : 'הסוכן מעבד את ההודעה…'}</div></>}
          <div ref={bottom} />
        </div>
        <form className="composer" onSubmit={event => { event.preventDefault(); void send(); }}>
          {error && <div className="error-banner" role="alert"><strong>לא הצלחנו להשלים את הפעולה</strong><p>{error}</p>{!state && <button type="button" onClick={reconnect} disabled={busy}>ניסיון חיבור נוסף</button>}</div>}
          <label className="visually-hidden" htmlFor="customer-message">הודעת הלקוח</label>
          <div className="composer-row">
            <textarea ref={input} id="customer-message" value={text} onChange={event => setText(event.target.value)} maxLength={4000} disabled={busy || !state} rows={1} placeholder="כתבו הודעה…" onKeyDown={event => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void send(); }
            }} />
            <button type="submit" className="send-button" disabled={busy || !text.trim() || !state}>{pending === 'send' ? 'מעבד…' : 'שלח'}<Icon name="send" /></button>
          </div>
        </form>
      </section>
      <AgentState state={state} />
      {state && <details className="debug-panel"><summary>נתונים למפתחים · JSON</summary><pre dir="ltr">{JSON.stringify(state, null, 2)}</pre></details>}
      </>}
    </main>
    <footer dir="ltr">© 2026 Bar Shirom. All rights reserved.</footer>
  </div>;
}
