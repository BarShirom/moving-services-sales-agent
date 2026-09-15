import type { DemoSnapshot } from '../../server/src/demo/types';
export type { DemoSnapshot };

export async function demoRequest(path = '', message?: string): Promise<DemoSnapshot> {
  let response: Response;
  try {
    response = await fetch(`/api/demo${path}`, {
      method: path ? 'POST' : 'GET',
      ...(message === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
      }),
    });
  } catch {
    throw new Error('לא ניתן להתחבר לשרת. ודאו שהוא פועל ונסו שוב.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    // Render only the demo API's curated errors, never proxy/provider error bodies.
    const knownCodes = ['BUSY', 'INVALID_MESSAGE', 'AI_NOT_CONFIGURED', 'EXTRACTION_FAILED', 'INVALID_REQUEST'];
    throw new Error(knownCodes.includes(body?.error?.code) && typeof body.error.message === 'string'
      ? body.error.message : 'השרת אינו זמין כרגע. נסו שוב בעוד רגע.');
  }
  try { return await response.json(); }
  catch { throw new Error('התקבלה תשובה לא תקינה מהשרת. נסו שוב בעוד רגע.'); }
}
