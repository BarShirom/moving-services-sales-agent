import type { MessageExtractor } from '../domain/conversation/processCustomerMessage.js';

/** Opt-in offline browser fixture. These exact synthetic messages are not a language model. */
export const quoteDemoMessages = {
  inventory: 'צריך להעביר מקרר גדול, שידה קטנה וכ-15 ארגזים מרמת גן לתל אביב. האיסוף ברחוב הדגמה 11, קומה 2 בלי מעלית.',
  dropoff: 'הפריקה ברחוב הדגמה 22, קומה 1 בלי מעלית.',
  date: '8/11',
  photo: 'אין לי כרגע',
} as const;

export const quoteFixtureExtractor: MessageExtractor = ({ text }) => {
  if (text === quoteDemoMessages.inventory) return { moveDetails: {
    items: [{ type: 'refrigerator', sizeCategory: 'LARGE' }, { type: 'dresser', sizeCategory: 'SMALL', quantity: 1 }, { type: 'box', quantity: 15 }],
    pickup: { city: 'רמת גן', address: 'רחוב הדגמה 11', floor: 2, elevator: false },
    dropoff: { city: 'תל אביב' },
  } };
  if (text === quoteDemoMessages.dropoff) return { moveDetails: { dropoff: { address: 'רחוב הדגמה 22', floor: 1, elevator: false } } };
  if (text === 'כן, אבל יש גם עוד ארון') return { moveDetails: { items: [{ type: 'wardrobe', quantity: 1 }] } };
  if (text === 'כן, אבל רק אחרי 18:00') return { moveDetails: { requestedTime: '18:00' } };
  if (text === 'סגור, רק שהפריקה עכשיו בקומה 4') return { moveDetails: { dropoff: { floor: 4 } } };
  if (text === 'נדרש פירוק של השידה') return { moveDetails: { items: [{ type: 'dresser', requiresDisassembly: true }] } };
  if (text === 'תודה' || text === 'כן, בתנאי שנדבר קודם') return {};
  throw new Error('Offline fixture only supports the documented synthetic messages.');
};
