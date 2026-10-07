import type { OwnerSnapshot } from '../../server/src/demo/ownerTypes';
import type { OwnerAction, ReviewToken } from '../../server/src/domain/ownerReview/types';
export type { OwnerSnapshot, OwnerAction };
import type { DemoSnapshot } from '../../server/src/demo/types';
export type { DemoSnapshot };

async function request<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/demo${path}`, {
      method,
      ...(body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
    });
  } catch {
    throw new Error('לא ניתן להתחבר לשרת. ודאו שהוא פועל ונסו שוב.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    // Render only the demo API's curated errors, never proxy/provider error bodies.
    const knownCodes = ['BUSY', 'INVALID_MESSAGE', 'AI_NOT_CONFIGURED', 'EXTRACTION_FAILED', 'INVALID_REQUEST', 'INVALID_OWNER_ACTION', 'STALE_REVIEW', 'ACTION_UNAVAILABLE'];
    throw new Error(knownCodes.includes(body?.error?.code) && typeof body.error.message === 'string'
      ? body.error.message : 'השרת אינו זמין כרגע. נסו שוב בעוד רגע.');
  }
  try { return await response.json(); }
  catch { throw new Error('התקבלה תשובה לא תקינה מהשרת. נסו שוב בעוד רגע.'); }
}

export function demoRequest(path = '', message?: string, quote?: { id: string; version: number }): Promise<DemoSnapshot> {
  return request(path, path ? 'POST' : 'GET', message === undefined ? undefined : {
    message, ...(quote ? { quoteId: quote.id, quoteVersion: quote.version } : {}),
  });
}
export function ownerRequest(): Promise<OwnerSnapshot> { return request('/owner', 'GET'); }
export function ownerAction(action: OwnerAction): Promise<OwnerSnapshot> { return request('/owner/action', 'POST', action); }
export function ownerPricing(token: ReviewToken): Promise<OwnerSnapshot> { return request('/owner/pricing', 'POST', token); }
export function ownerSample(token: ReviewToken): Promise<OwnerSnapshot> { return request('/owner/sample', 'POST', token); }
