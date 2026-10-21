import { useCallback, useEffect, useState } from 'react';
import { DemoApiError, demoRequest, ownerRequest, type OwnerSnapshot, type DemoSnapshot } from './api';

function hasProgress(state: DemoSnapshot | null, owner: OwnerSnapshot | null): boolean {
  if (!state) return false;
  const move = state.lead.moveDetails;
  return !!(state.lead.messages.length || state.quote || state.lead.status !== 'COLLECTING_INFORMATION'
    || move.items.length || Object.values(move.pickup).some(value => value !== null)
    || Object.values(move.dropoff).some(value => value !== null) || move.requestedDate || move.requestedTime
    || move.specialAccessNotes || owner?.reviews.length || owner?.pricingEvaluation);
}
/** Session data and request orchestration. UI focus and owner form drafts stay in their views.
 * Reads may establish a session; only explicit event handlers dispatch mutations.
 */
export function useDemoSession() {
  const [state, setState] = useState<DemoSnapshot | null>(null);
  const [view, setView] = useState<'customer' | 'owner'>('customer');
  const [owner, setOwner] = useState<OwnerSnapshot | null>(null);
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [knownAiUnavailable, setKnownAiUnavailable] = useState(false);
  const [notice, setNotice] = useState('');
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<'send' | 'accept' | 'reset' | null>(null);
  const [retryUntil, setRetryUntil] = useState(0);
  const [aiRetryUntil, setAiRetryUntil] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [confirmation, setConfirmation] = useState(false);
  const [recoveryVersion, setRecoveryVersion] = useState(0);
  const busy = loading || pending !== null || ownerBusy;
  const retrySeconds = Math.max(0, Math.ceil((retryUntil - now) / 1000));
  const aiRetrySeconds = Math.max(0, Math.ceil((aiRetryUntil - now) / 1000));
  const messageCooldown = aiRetrySeconds > 0 && state?.lead.status !== 'HUMAN_HANDOFF';
  const blocked = busy || expired || confirmation || retrySeconds > 0;
  const aiUnavailableError = ['AI_BUDGET_EXHAUSTED', 'AI_WINDOW_CLOSED', 'AI_NOT_CONFIGURED', 'AI_BUSY', 'AI_RATE_LIMITED', 'EXTRACTION_FAILED', 'AI_INPUT_LIMIT'].includes(errorCode);
  const aiUnavailable = knownAiUnavailable || aiUnavailableError;

  function clearError() {
    setError('');
    setErrorCode('');
  }

  const handleError = useCallback((error: unknown) => {
    const code = error instanceof DemoApiError ? error.code : '';
    setErrorCode(code);
    if (['AI_BUDGET_EXHAUSTED', 'AI_WINDOW_CLOSED', 'AI_NOT_CONFIGURED'].includes(code)) setKnownAiUnavailable(true);
    setError(error instanceof Error ? error.message : 'לא ניתן להשלים את הפעולה כרגע.');
    if (error instanceof DemoApiError && error.retryAfterSeconds && ['SESSION_RATE_LIMITED', 'SESSION_CAPACITY', 'RATE_LIMITED', 'PROTECTION_CAPACITY'].includes(code)) {
      const receivedAt = Date.now();
      setNow(receivedAt);
      setRetryUntil(receivedAt + error.retryAfterSeconds * 1000);
    }
    if (error instanceof DemoApiError && error.retryAfterSeconds && ['AI_RATE_LIMITED', 'AI_BUSY'].includes(code)) {
      const receivedAt = Date.now();
      setNow(receivedAt);
      setAiRetryUntil(receivedAt + error.retryAfterSeconds * 1000);
    }
    if (code === 'SESSION_EXPIRED') {
      // Clear every stale quote/review binding, retaining only the unsent draft.
      setState(null);
      setOwner(null);
      setView('customer');
      setConfirmation(false);
      setExpired(true);
      setNotice('');
    }
  }, []);

  const coolingDown = now < Math.max(retryUntil, aiRetryUntil);
  useEffect(() => {
    if (!coolingDown) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [retryUntil, aiRetryUntil, coolingDown]);

  useEffect(() => {
    let active = true;
    demoRequest().then(result => { if (active) setState(result); })
      .catch(error => { if (active) handleError(error); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [handleError]);

  async function send() {
    if (blocked || messageCooldown || !text.trim() || !state) return;
    clearError();
    setNotice('');
    setPending('send');
    try {
      const displayedQuote = state.quote && ['SENT', 'ACCEPTED'].includes(state.quote.status) ? state.quote : undefined;
      setState(await demoRequest('/message', text, displayedQuote));
      setText('');
      // Quote replies and handoff messages can succeed without any AI processing.
      if (!displayedQuote && state.lead.status !== 'HUMAN_HANDOFF') setKnownAiUnavailable(false);
    } catch (error) { handleError(error); }
    finally { setPending(null); }
  }

  async function acceptQuote() {
    const quote = state?.quote;
    if (blocked || !state || !quote || quote.status !== 'SENT' || state.lead.status !== 'QUOTE_SENT' || quote.leadId !== state.lead.id) return;
    clearError();
    setNotice('');
    setPending('accept');
    try {
      // The same deterministic endpoint and current displayed quote binding as a typed acceptance.
      // Never send or clear the customer's separate unsent draft.
      setState(await demoRequest('/message', 'מאשר', quote));
      if (text.trim()) setNotice('אישור ההצעה נשלח. טיוטת ההודעה נשמרה ולא נשלחה.');
    } catch (error) { handleError(error); }
    finally { setPending(null); }
  }

  async function reset() {
    if (busy || expired || !state || retrySeconds > 0) return;
    setConfirmation(false);
    clearError();
    setPending('reset');
    try {
      setState(await demoRequest('/reset'));
      setOwner(null);
      setView('customer');
      setText('');
      setNotice('התחלנו הדגמה חדשה. השיחה וההצעה הקודמות הוסרו.');
    } catch (error) { handleError(error); }
    finally { setPending(null); }
  }

  async function reconnect() {
    if (busy || retrySeconds > 0) return;
    // GET only. Never replay a customer message, quote acceptance or owner action.
    setLoading(true);
    clearError();
    setState(null);
    setOwner(null);
    setView('customer');
    setConfirmation(false);
    try {
      setState(await demoRequest());
      setExpired(false);
      setRecoveryVersion(current => current + 1);
      setNotice('ההדגמה פתוחה. אם נשמרה טיוטה, בדקו אותה ולחצו על שלח כשתרצו. שום הודעה לא נשלחה שוב.');
    } catch (error) { handleError(error); }
    finally { setLoading(false); }
  }

  function requestReset() {
    if (blocked || !state) return;
    if (hasProgress(state, owner) || text.trim()) setConfirmation(true);
    else void reset();
  }

  function cancelReset() {
    setConfirmation(false);
  }

  async function switchView(next: 'customer' | 'owner') {
    if (blocked || view === next) return;
    setLoading(true);
    clearError();
    try {
      const result = next === 'owner' ? await ownerRequest() : null;
      const customer = result?.customer ?? await demoRequest();
      // Cookie-issuing GETs can replace an expired session without a 401 response.
      if (state && customer.lead.id !== state.lead.id) {
        handleError(new DemoApiError('SESSION_EXPIRED', 'ההדגמה הקודמת הסתיימה או הוחלפה. התחילו הדגמה חדשה.'));
        return;
      }
      setState(customer);
      setOwner(result);
      setView(next);
    } catch (error) { handleError(error); }
    finally { setLoading(false); }
  }

  function updateOwner(value: OwnerSnapshot) {
    setOwner(value);
    setState(value.customer);
  }

  return {
    state, owner, view, text, setText, error, errorCode, notice, expired, loading,
    pending, confirmation, busy, blocked, retrySeconds, aiRetrySeconds,
    messageCooldown, knownAiUnavailable, aiUnavailableError, aiUnavailable,
    recoveryVersion, hasProgress: hasProgress(state, owner), send, acceptQuote,
    reset, reconnect, requestReset, cancelReset, switchView, updateOwner,
    setOwnerBusy, handleError,
  };
}
