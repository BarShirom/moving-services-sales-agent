import type { OwnerSnapshot } from '../../server/src/demo/ownerTypes';
import type { OwnerAction, ReviewToken } from '../../server/src/domain/ownerReview/types';
export type { OwnerSnapshot, OwnerAction };
import type { DemoSnapshot } from '../../server/src/demo/types';
export type { DemoSnapshot };

/** Safe API identity for explicit UI recovery; never retries a mutation. */
export class DemoApiError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'DemoApiError'; }
}

async function request<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/demo${path}`, {
      method,
      credentials: 'include',
      headers: { 'X-Demo-Request': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : {
        body: JSON.stringify(body),
      }),
    });
  } catch {
    throw new DemoApiError('NETWORK_ERROR', 'לא ניתן להתחבר לשרת. נסו להתחבר שוב.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (['AI_BUDGET_EXHAUSTED', 'AI_WINDOW_CLOSED'].includes(body?.error?.code)) {
      throw new DemoApiError(body.error.code, 'עיבוד ה-AI בהדגמה זו סגור. תקציב הבטא משותף ומצטבר ואינו מתחדש אוטומטית. המידע הקיים נשמר ואפשר להמשיך בבדיקה ידנית.');
    }
    if (body?.error?.code === 'AI_NOT_CONFIGURED') throw new DemoApiError('AI_NOT_CONFIGURED', 'עיבוד הודעות בעזרת AI אינו זמין כרגע. אפשר לנסות את הפנייה המוכנה ללא AI.');
    // Render only the demo API's curated errors, never proxy/provider error bodies.
    const knownCodes = ['BUSY', 'INVALID_MESSAGE', 'AI_NOT_CONFIGURED', 'EXTRACTION_FAILED', 'INVALID_REQUEST', 'INVALID_OWNER_ACTION', 'STALE_REVIEW', 'ACTION_UNAVAILABLE', 'SESSION_EXPIRED', 'SESSION_CAPACITY', 'SESSION_FULL', 'REQUEST_FORBIDDEN', 'RATE_LIMITED', 'SESSION_RATE_LIMITED', 'AI_RATE_LIMITED', 'AI_BUSY', 'AI_BUDGET_EXHAUSTED', 'AI_WINDOW_CLOSED', 'AI_INPUT_LIMIT', 'PROTECTION_CAPACITY'];
    const retrySeconds = Number(response.headers.get('Retry-After'));
    const retryHint = [429, 503].includes(response.status) && Number.isSafeInteger(retrySeconds) && retrySeconds > 0 && retrySeconds <= 86400
      ? ` אפשר לנסות שוב בעוד ${retrySeconds} שניות.` : '';
    const known = knownCodes.includes(body?.error?.code);
    throw new DemoApiError(known ? body.error.code : 'UNKNOWN', known && typeof body.error.message === 'string'
      ? body.error.message + retryHint : 'השרת אינו זמין כרגע. נסו שוב בעוד רגע.');
  }
  try { return await response.json(); }
  catch { throw new Error('התקבלה תשובה לא תקינה מהשרת. נסו שוב בעוד רגע.'); }
}

let pendingRead: Promise<DemoSnapshot> | undefined;
export function demoRequest(path = '', message?: string, quote?: { id: string; version: number }): Promise<DemoSnapshot> {
  // Coalesce the initial React StrictMode reads so one tab does not create two cookies.
  if (!path) {
    pendingRead ??= request<DemoSnapshot>('', 'GET').finally(() => { pendingRead = undefined; });
    return pendingRead;
  }
  return request(path, path ? 'POST' : 'GET', message === undefined ? undefined : {
    message, ...(quote ? { quoteId: quote.id, quoteVersion: quote.version } : {}),
  });
}
export function ownerRequest(): Promise<OwnerSnapshot> { return request('/owner', 'GET'); }
export function ownerAction(action: OwnerAction): Promise<OwnerSnapshot> { return request('/owner/action', 'POST', action); }
export function ownerPricing(token: ReviewToken): Promise<OwnerSnapshot> { return request('/owner/pricing', 'POST', token); }
export function ownerSample(token: ReviewToken): Promise<OwnerSnapshot> { return request('/owner/sample', 'POST', token); }
