import { ConversationMessages } from './ConversationMessages';
import { Icon } from './Icon';
import { useEffect, useRef, useState } from 'react';
import { AgentState } from './AgentState';
import { demoRequest, type DemoSnapshot } from './api';

const example = 'צריך להעביר מקרר גדול מרמת גן לתל אביב.\nהאיסוף מביאליק 20, קומה 2 בלי מעלית.\nיש גם בערך 15 ארגזים.';

export default function App() {
  const [state, setState] = useState<DemoSnapshot | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<'send' | 'reset' | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const busy = loading || pending !== null;

  useEffect(() => {
    let active = true;
    demoRequest().then(result => { if (active) setState(result); })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : 'לא ניתן להתחבר לשרת.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [state?.lead.messages.length, pending]);

  useEffect(() => {
    if (!busy && state) input.current?.focus({ preventScroll: true });
  }, [busy]);

  async function send() {
    if (busy || !text.trim() || !state) return;
    setError(''); setPending('send');
    try { setState(await demoRequest('/message', text)); setText(''); }
    catch (error) { setError(error instanceof Error ? error.message : 'לא הצלחנו לעבד את ההודעה.'); }
    finally { setPending(null); }
  }
  async function reset() {
    if (busy) return;
    setError(''); setPending('reset');
    try { setState(await demoRequest('/reset')); setText(''); }
    catch (error) { setError(error instanceof Error ? error.message : 'לא ניתן לאפס כרגע.'); }
    finally { setPending(null); }
  }
  async function reconnect() {
    setLoading(true); setError('');
    try { setState(await demoRequest()); }
    catch (error) { setError(error instanceof Error ? error.message : 'לא ניתן להתחבר לשרת.'); }
    finally { setLoading(false); }
  }

  return <div className="app-shell" dir="rtl">
    <header className="topbar">
      <div className="brand" aria-label="Rick & GO הובלות">
        <strong className="wordmark" dir="ltr">RICK<span>&amp;</span>GO<Icon name="arrow" /></strong>
        <span className="brand-tagline">הובלות, עם מחשבה קדימה</span>
      </div>
      <div className="header-meta"><span className="demo-pill"><i /> הדגמה אינטראקטיבית</span><span>Sales Agent Demo</span></div>
    </header>
    <main>
      <div className="page-heading"><div><div className="eyebrow">פחות שאלות חוזרות. יותר סדר בכל הובלה.</div><h1 dir="ltr">Moving Services Sales Agent</h1><p dir="ltr">Pilot for Rick &amp; GO</p></div>
        <button className="reset-button" onClick={reset} disabled={busy || !state}><Icon name="reset" />{pending === 'reset' ? 'מאפסים…' : 'איפוס הדגמה'}</button>
      </div>
      <div className="workspace">
        <section className="conversation-column" dir="rtl" aria-labelledby="conversation-heading">
          <div className="column-heading"><span className="eyebrow">מרחב השיחה</span><span className="small-label">לקוח ↔ סוכן</span></div>
          <div className="conversation-card">
            <div className="conversation-header"><span className="chat-icon"><Icon name="chat" /></span><div><h2 id="conversation-heading">שיחת לקוח</h2><p>כל הודעה מוסיפה עוד חלק לתמונה</p></div><span className="channel-tag">סימולטור שיחה</span></div>
            <div className="message-area" role="log" aria-label="הודעות השיחה" aria-live="polite" aria-busy={pending === 'send'}>
              {!state?.lead.messages.length && pending !== 'send' && <div className="conversation-empty">
                <div className="welcome-symbol" aria-hidden="true"><Icon name="truck" /><span className="welcome-spark">✦</span></div>
                <span className="eyebrow">ההובלה הבאה מתחילה כאן</span><h3>מה צריך להעביר?</h3><p>כתבו כמו שלקוח היה כותב ב-WhatsApp.<br />הסוכן יאסוף את הפרטים וישאל מה שצריך.</p>
                <button className="example-button" disabled={busy} onClick={() => { setText(example); input.current?.focus(); }}><span aria-hidden="true">＋</span>טעינת הודעה לדוגמה<span aria-hidden="true">↖</span></button>
              </div>}
              <ConversationMessages messages={state?.lead.messages ?? []} />
              {pending === 'send' && <><div className="message customer"><span className="message-label">הלקוח · בעיבוד</span><div className="bubble pending-bubble">{text}</div></div><div className="processing" role="status"><span className="typing-dots"><i /><i /><i /></span>הסוכן קורא ומסדר את הפרטים…</div></>}
              <div ref={bottom} />
            </div>
            <form className="composer" onSubmit={event => { event.preventDefault(); void send(); }}>
              {error && <div className="error-banner" role="alert"><strong>משהו עצר את השיחה</strong><p>{error}</p>{!state && <button type="button" onClick={reconnect} disabled={busy}>ניסיון חיבור נוסף</button>}</div>}
              <label htmlFor="customer-message">הודעת הלקוח</label>
              <div className={`input-container ${pending === 'send' ? 'is-processing' : ''}`}><textarea ref={input} id="customer-message" value={text} onChange={event => setText(event.target.value)} maxLength={4000} disabled={busy} rows={3} placeholder="למשל: צריך להעביר מקרר מרמת גן לתל אביב…" onKeyDown={event => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void send(); }
              }} />
                <div className="composer-actions"><span className="input-hint">אפשר לכתוב חופשי, גם בכמה שורות</span><button className="send-button" disabled={busy || !text.trim() || !state}>{pending === 'send' ? 'מעבד…' : 'שלח'}<Icon name="send" /></button></div>
              </div>
              <div className="composer-foot"><span>Ctrl / ⌘ + Enter לשליחה</span><span dir="ltr">{text.length.toLocaleString()} / 4,000</span></div>
            </form>
          </div>
        </section>
        <AgentState state={state} />
      </div>
      {state && <details className="debug-panel"><summary>נתונים למפתחים · JSON</summary><pre dir="ltr">{JSON.stringify(state, null, 2)}</pre></details>}
      <footer><span className="footer-dot" />מסך הדגמה בלבד — המערכת מיועדת להתחבר ל-WhatsApp בהמשך.<span className="footer-brand" dir="ltr">Built for better moves.</span></footer>
    </main>
  </div>;
}
