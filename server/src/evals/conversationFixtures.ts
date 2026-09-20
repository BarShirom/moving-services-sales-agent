import type { ExtractionResult } from '../domain/extraction/types.js';

export interface OfflineFixture {
  message: string;
  // Hand-authored extractor test double, independent of dataset expected assertions.
  // This exercises downstream workflow, NOT the accuracy of AI text extraction.
  extraction?: ExtractionResult;
  mode: 'DOMAIN' | 'FIXTURE';
  accessNoteMeaning?: RegExp[];
}

const fixture = (message: string, extraction: ExtractionResult): OfflineFixture => ({ message, extraction, mode: 'FIXTURE' });
const dimensions = { width: 70, height: 180, depth: 68 };
const photoOffer: ExtractionResult = { moveDetails: { items: [
  { type: 'refrigerator', photoStatus: 'NOT_AVAILABLE', dimensionsAvailable: true },
] } };
const photoDimensions: ExtractionResult = { moveDetails: { items: [
  { type: 'refrigerator', photoStatus: 'NOT_AVAILABLE', dimensions },
] } };
const photoCorrection: ExtractionResult = { moveDetails: {
  ...photoDimensions.moveDetails, dropoff: { floor: 4 },
} };
const correction: ExtractionResult = { moveDetails: { pickup: { floor: 3 } } };

export const offlineFixtures: Readonly<Record<string, OfflineFixture>> = {
  'conv-001': fixture('צריך להעביר מקרר גדול מרמת גן לתל אביב. האיסוף מרחוב דוגמה א 20, קומה 2 בלי מעלית. יש גם בערך 15 ארגזים.', { moveDetails: {
    items: [{ type: 'refrigerator', sizeCategory: 'LARGE' }, { type: 'box', quantity: 15 }],
    pickup: { city: 'רמת גן', address: 'רחוב דוגמה א 20', floor: 2, elevator: false }, dropoff: { city: 'תל אביב' },
  } }),
  'conv-002': fixture('רחוב דוגמה ב 12, קומה 5', { moveDetails: { dropoff: { address: 'רחוב דוגמה ב 12', floor: 5 } } }),
  'conv-003': fixture('לא', { moveDetails: { dropoff: { elevator: false } } }),
  'conv-004': fixture('25/09', { moveDetails: { requestedDate: '2026-09-25' } }),
  'conv-005': { message: 'אין לי', mode: 'DOMAIN' },
  'conv-006': fixture('אין לי כרגע, אבל יש לי את המידות', photoOffer),
  'conv-007': fixture('גובה 180 ס"מ, רוחב 70 ועומק 68', { moveDetails: { items: [{ type: 'refrigerator', dimensions }] } }),
  'conv-008': fixture('אין לי תמונה, הוא 180 גובה, 70 רוחב ו-68 עומק. אגב טעיתי, הפריקה קומה 4 ולא 5.', photoCorrection),
  'conv-009': fixture('מקרר רגיל ו-8 ארגזים. איסוף מרמת גן ברחוב דוגמה א 20, קומה 2 בלי מעלית. פריקה בתל אביב ברחוב דוגמה ב 12, קומת קרקע עם מעלית. ההובלה ב-25/09/2026.', { moveDetails: {
    items: [{ type: 'refrigerator', sizeCategory: 'REGULAR' }, { type: 'box', quantity: 8 }],
    pickup: { city: 'רמת גן', address: 'רחוב דוגמה א 20', floor: 2, elevator: false },
    dropoff: { city: 'תל אביב', address: 'רחוב דוגמה ב 12', floor: 0, elevator: true }, requestedDate: '2026-09-25',
  } }),
  'conv-010': {
    ...fixture('באיסוף חדר המדרגות צר ויש פנייה חדה בין הקומות.', { moveDetails: { specialAccessNotes: 'באיסוף מדרגות צרות עם פנייה חדה' } }),
    accessNoteMeaning: [/איסוף/u, /מדרגות/u, /צר/u, /פני/u, /חד/u],
  },
  'conv-012': fixture('רחוב דוגמה ב 12, קומה 5 ויש מעלית. למקרר רוחב 70, גובה 180 ועומק 68.', { moveDetails: {
    dropoff: { address: 'רחוב דוגמה ב 12', floor: 5, elevator: true }, items: [{ type: 'refrigerator', dimensions }],
  } }),
  'conv-013': fixture('רחוב דוגמה ב 12, וזה ל-25/09.', { moveDetails: { dropoff: { address: 'רחוב דוגמה ב 12' }, requestedDate: '2026-09-25' } }),
  'conv-014': fixture('רחוב דוגמה ב 12', { moveDetails: { dropoff: { address: 'רחוב דוגמה ב 12' } } }),
  'conv-015': fixture('טעיתי, האיסוף הוא מקומה 3', correction),
  'conv-016': fixture('רחוב דוגמה ג 50, קומה 4 ויש מעלית', { moveDetails: { dropoff: { address: 'רחוב דוגמה ג 50', floor: 4, elevator: true } } }),
  'conv-017': fixture('רחוב דוגמה ג 50, קומה 4 עם מעלית, וזה ל-25/09', { moveDetails: {
    dropoff: { address: 'רחוב דוגמה ג 50', floor: 4, elevator: true }, requestedDate: '2026-09-25',
  } }),
  'conv-018': fixture('רחוב דוגמה ג 50', { moveDetails: { dropoff: { address: 'רחוב דוגמה ג 50' } } }),
  'conv-019': fixture('טעיתי, האיסוף הוא מקומה 3', correction),
  'conv-020': fixture('אין לי כרגע, אבל יש לי את המידות', photoOffer),
  'conv-021': fixture('אין לי תמונה, גובה 180, רוחב 70, עומק 68', photoDimensions),
  'conv-022': fixture('אין לי תמונה, הוא 180 גובה, 70 רוחב ו-68 עומק. אגב טעיתי, הפריקה קומה 4 ולא 5.', photoCorrection),
  'conv-023': {
    ...fixture('יש מעלית אבל המקרר לא נכנס בה, צריך להעלות אותו במדרגות', { moveDetails: {
      specialAccessNotes: 'בפריקה יש מעלית אך המקרר לא נכנס בה ונדרשת נשיאה במדרגות',
    } }),
    accessNoteMeaning: [/פריקה/u, /מעלית/u, /מקרר/u, /(?:לא|אינו).*נכנס/u, /מדרגות/u],
  },
  'conv-024': fixture('אני לא יודע כרגע, אבדוק ואעדכן', {}),
};
