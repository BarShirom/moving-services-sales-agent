import { randomBytes } from 'node:crypto';
import { freshOwnerState } from './ownerWorkflow.js';
import type { OwnerDemoState } from './ownerTypes.js';

export class DemoSessionError extends Error {
  constructor(public readonly code: 'SESSION_EXPIRED' | 'SESSION_CAPACITY' | 'SESSION_FULL',
    public readonly status: number, message: string) { super(message); }
}
export const expiredSession = () => new DemoSessionError('SESSION_EXPIRED', 409,
  'תוקף ההדגמה פג או שהעוגייה אינה זמינה. רעננו את העמוד כדי להתחיל הדגמה חדשה.');

export interface SessionOptions {
  ttlMs?: number;
  maxSessions?: number;
  maxStateBytes?: number;
  /** Independent of the business clock used for offline quote fixtures. */
  clock?: () => number;
}

export class DemoSession {
  busy = false;
  private value = freshOwnerState();
  constructor(readonly expiresAt: number, private readonly clock: () => number,
    private readonly maxStateBytes: number) {}
  get state(): OwnerDemoState { return this.value; }
  set state(value: OwnerDemoState) {
    // Never commit a provider result after expiry, or partially truncate quote history.
    if (this.clock() >= this.expiresAt) throw expiredSession();
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > this.maxStateBytes) {
      throw new DemoSessionError('SESSION_FULL', 413,
        'ההדגמה הגיעה למגבלת הגודל. אפסו את ההדגמה כדי להתחיל מחדש.');
    }
    this.value = value;
  }
}

export class DemoSessionStore {
  readonly ttlMs: number;
  private readonly maxSessions: number;
  private readonly maxStateBytes: number;
  private readonly clock: () => number;
  private readonly entries = new Map<string, { session: DemoSession; timer: NodeJS.Timeout }>();

  constructor(options: SessionOptions = {}) {
    this.ttlMs = options.ttlMs ?? 30 * 60_000;
    this.maxSessions = options.maxSessions ?? 100;
    this.maxStateBytes = options.maxStateBytes ?? 256 * 1024;
    this.clock = options.clock ?? Date.now;
    for (const limit of [this.ttlMs, this.maxSessions, this.maxStateBytes]) {
      if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Session limits must be positive safe integers');
    }
    if (this.ttlMs > 2_147_483_647 || this.maxStateBytes < Buffer.byteLength(JSON.stringify(freshOwnerState()))) {
      throw new Error('Invalid session lifetime or initial state size limit');
    }
  }
  private remove(id: string) {
    const entry = this.entries.get(id);
    if (entry) { clearTimeout(entry.timer); this.entries.delete(id); }
  }
  cleanup() {
    const now = this.clock();
    for (const [id, { session }] of this.entries) {
      // Keep in-flight work counted against capacity until its finally block runs.
      if (now >= session.expiresAt && !session.busy) this.remove(id);
    }
  }
  get(id: string | undefined): DemoSession | undefined {
    this.cleanup();
    if (!id || !/^[A-Za-z0-9_-]{43}$/.test(id)) return undefined;
    const session = this.entries.get(id)?.session;
    return session && this.clock() < session.expiresAt ? session : undefined;
  }
  create(): { id: string; session: DemoSession } {
    this.cleanup();
    if (this.entries.size >= this.maxSessions) {
      throw new DemoSessionError('SESSION_CAPACITY', 503,
        'ההדגמה עמוסה כרגע. נסו שוב בעוד מספר דקות.');
    }
    let id: string;
    do { id = randomBytes(32).toString('base64url'); } while (this.entries.has(id));
    const session = new DemoSession(this.clock() + this.ttlMs, this.clock, this.maxStateBytes);
    const timer = setTimeout(() => this.cleanup(), this.ttlMs);
    timer.unref();
    this.entries.set(id, { session, timer });
    return { id, session };
  }
  release(session: DemoSession) { session.busy = false; this.cleanup(); }
}

/** Reject ambiguous/encoded identifiers; clients can only return a server-issued token. */
export function sessionCookie(header: string | undefined, name: string): string | undefined {
  const values = (header ?? '').split(';').map(part => part.trim())
    .filter(part => part.startsWith(`${name}=`)).map(part => part.slice(name.length + 1));
  return values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0]) ? values[0] : undefined;
}
