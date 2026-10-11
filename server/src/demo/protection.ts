import type { Response } from 'express';
import type { ResponseParseParams } from 'openai/resources/responses/responses';
import { getDemoLimits, type DemoLimits } from '../config/demoLimits.js';
import type { DemoSession } from './sessions.js';

const minute = 60_000, hour = 60 * minute, day = 24 * hour;
type Window = { count: number; until: number };
const empty = (): Window => ({ count: 0, until: 0 });
type Client = { requests: Window; sessions: Window; ai: Window };
type Session = { requests: Window; ai: number };
type Code = 'RATE_LIMITED' | 'SESSION_RATE_LIMITED' | 'AI_RATE_LIMITED' | 'AI_BUSY' | 'AI_BUDGET_EXHAUSTED' | 'AI_INPUT_LIMIT' | 'PROTECTION_CAPACITY';
export class ProtectionError extends Error {
  constructor(readonly code: Code, readonly status: 429 | 503, readonly retryAfter: number) {
    super(code === 'AI_BUDGET_EXHAUSTED' ? 'מכסת ה-AI היומית של ההדגמה מוצתה. אפשר להמשיך בבדיקת הצעה קיימת או לנסות מחר.'
      : code === 'AI_INPUT_LIMIT' ? 'ההדגמה הגיעה למגבלת עיבוד ה-AI. אפשר להמשיך בבדיקה ידנית או לאפס את ההדגמה.'
      : status === 503 ? 'ההדגמה עמוסה כרגע. נסו שוב בעוד רגע.'
      : 'הגעתם למגבלת הבקשות של ההדגמה. המתינו לפני ניסיון נוסף.');
  }
}
export function protectionResponse(error: ProtectionError, response: Response) {
  response.set('Retry-After', String(error.retryAfter)).set('Cache-Control', 'no-store')
    .status(error.status).json({ error: { code: error.code, message: error.message } });
}

/** One instance per app/process: identities come only from validated HTTP admission. */
export class DemoProtection {
  readonly limits: DemoLimits;
  private readonly clients = new Map<string, Client>();
  private readonly sessions = new WeakMap<DemoSession, Session>();
  private requests = empty();
  private creations = empty();
  private aiWindow = empty();
  private active = 0;
  private daily = { date: -1, requests: 0, reservedTokens: 0 };
  private lastTime = 0;
  private readonly rejected: Record<Code, number> = {
    RATE_LIMITED: 0, SESSION_RATE_LIMITED: 0, AI_RATE_LIMITED: 0, AI_BUSY: 0,
    AI_BUDGET_EXHAUSTED: 0, AI_INPUT_LIMIT: 0, PROTECTION_CAPACITY: 0,
  };
  constructor(limits: DemoLimits = getDemoLimits(), private readonly clock: () => number = Date.now) {
    this.limits = Object.freeze({ ...limits });
  }
  private now() { return this.lastTime = Math.max(this.lastTime, this.clock()); }
  private reject(code: Code, status: 429 | 503, until: number): never {
    this.rejected[code] = Math.min(Number.MAX_SAFE_INTEGER, this.rejected[code] + 1);
    throw new ProtectionError(code, status, Math.max(1, Math.ceil((until - this.now()) / 1000)));
  }
  private check(window: Window, limit: number, duration: number, code: Code) {
    const now = this.now();
    if (now >= window.until) { window.count = 0; window.until = now + duration; }
    if (window.count >= limit) this.reject(code, 429, window.until);
  }
  cleanup() {
    const now = this.now();
    for (const [key, value] of this.clients) {
      if (now >= Math.max(value.requests.until, value.sessions.until, value.ai.until)) this.clients.delete(key);
    }
  }
  private client(peer: string): Client {
    this.cleanup();
    // Admission supplies the socket peer or the validated, exact Caddy peer's client IP.
    const key = peer.startsWith('::ffff:') ? peer.slice(7) : peer;
    let client = this.clients.get(key);
    if (!client) {
      if (this.clients.size >= this.limits.maxClients) this.reject('PROTECTION_CAPACITY', 503, this.now() + minute);
      client = { requests: empty(), sessions: empty(), ai: empty() };
      this.clients.set(key, client);
    }
    return client;
  }
  private session(session: DemoSession): Session {
    let counts = this.sessions.get(session);
    if (!counts) { counts = { requests: empty(), ai: 0 }; this.sessions.set(session, counts); }
    return counts;
  }
  request(peer: string) {
    this.check(this.requests, this.limits.globalRequests, minute, 'RATE_LIMITED');
    this.requests.count++; // Even rejected clients consume global admission capacity.
    const client = this.client(peer);
    this.check(client.requests, this.limits.clientRequests, minute, 'RATE_LIMITED');
    client.requests.count++;
  }
  sessionRequest(session: DemoSession) {
    const counts = this.session(session);
    this.check(counts.requests, this.limits.sessionRequests, minute, 'RATE_LIMITED');
    counts.requests.count++;
  }
  createSession(peer: string) {
    const client = this.client(peer);
    this.check(this.creations, this.limits.globalSessions, hour, 'SESSION_RATE_LIMITED');
    this.check(client.sessions, this.limits.clientSessions, hour, 'SESSION_RATE_LIMITED');
    this.creations.count++; client.sessions.count++;
  }
  async extract<T>(session: DemoSession, peer: string, request: ResponseParseParams, run: () => Promise<T> | T): Promise<T> {
    const now = this.now();
    const date = Math.floor(now / day);
    if (date !== this.daily.date) this.daily = { date, requests: 0, reservedTokens: 0 };
    const bytes = Buffer.byteLength(JSON.stringify(request), 'utf8');
    // Conservative text-only reservation, not a tokenizer or a dollar-cost quote.
    const output = request.max_output_tokens;
    if (!Number.isSafeInteger(output) || !output || output < 1 || bytes > this.limits.requestBytes) {
      this.reject('AI_INPUT_LIMIT', 429, session.expiresAt);
    }
    const reservation = bytes + output! + 4096;
    const counts = this.session(session), client = this.client(peer);
    if (counts.ai >= this.limits.sessionAI) this.reject('AI_RATE_LIMITED', 429, session.expiresAt);
    this.check(client.ai, this.limits.clientAI, hour, 'AI_RATE_LIMITED');
    this.check(this.aiWindow, this.limits.globalAI, minute, 'AI_RATE_LIMITED');
    if (this.daily.requests >= this.limits.dailyAI || this.daily.reservedTokens + reservation > this.limits.dailyTokens) {
      this.reject('AI_BUDGET_EXHAUSTED', 429, (date + 1) * day);
    }
    if (this.active >= this.limits.aiConcurrency) this.reject('AI_BUSY', 503, now + 5_000);
    // All checks and reservations happen synchronously before the first await.
    counts.ai++; client.ai.count++; this.aiWindow.count++;
    this.daily.requests++; this.daily.reservedTokens += reservation; this.active++;
    // Never refund: provider failures/timeouts/invalid output may still incur cost.
    try { return await run(); } finally { this.active--; }
  }
  snapshot() {
    this.cleanup();
    const date = Math.floor(this.now() / day);
    const today = this.daily.date === date ? this.daily : { requests: 0, reservedTokens: 0 };
    return { utcDay: new Date(date * day).toISOString().slice(0, 10), activeAI: this.active,
      dailyAIRequests: today.requests, dailyReservedTokens: today.reservedTokens,
      trackedClients: this.clients.size, rejected: { ...this.rejected } };
  }
}
