import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractMessage } from '../src/domain/extraction/extractMessage.js';
import { DEMO_CITIES } from '../src/domain/extraction/patterns.js';
import type { ExtractionResult, RefrigeratorSize, SupportedItemType } from '../src/domain/extraction/types.js';

test('initial refrigerator request extracts only identified items and route cities', () => {
  assert.deepEqual(extractMessage('צריך להעביר מקרר מרמת גן לתל אביב'), {
    moveDetails: { items: [{ type: 'refrigerator' }], pickup: { city: 'רמת גן' }, dropoff: { city: 'תל אביב' } },
  });
});

for (const [text, type] of [
  ['מקרר', 'refrigerator'], ['ארגז', 'box'], ['ארגזים', 'box'],
  ['מכונת כביסה', 'washing_machine'], ['ארון', 'wardrobe'], ['מיטה', 'bed'],
] as const satisfies readonly (readonly [string, SupportedItemType])[]) {
  test(`recognizes supported item: ${type} (${text})`, () => {
    assert.deepEqual(extractMessage(text), { moveDetails: { items: [{ type }] } });
  });
}

test('all demo city pairs have deterministic pickup/dropoff direction', () => {
  for (const pickup of DEMO_CITIES) {
    for (const dropoff of DEMO_CITIES) {
      assert.deepEqual(extractMessage(`מ${pickup} ל${dropoff}`), {
        moveDetails: { pickup: { city: pickup }, dropoff: { city: dropoff } },
      });
    }
  }
});

for (const [text, expected] of [
  ['איסוף מרמת גן', { pickup: { city: 'רמת גן' } }],
  ['איסוף בתל אביב', { pickup: { city: 'תל אביב' } }],
  ['פריקה בתל אביב', { dropoff: { city: 'תל אביב' } }],
  ['לרמת גן', { dropoff: { city: 'רמת גן' } }],
  ['מתל אביב לבת ים', { pickup: { city: 'תל אביב' }, dropoff: { city: 'בת ים' } }],
  ['איסוף: גבעתיים ופריקה: חולון', { pickup: { city: 'גבעתיים' }, dropoff: { city: 'חולון' } }],
  ['מרמת גן לתל אביב, איסוף בחולון', { pickup: { city: 'חולון' }, dropoff: { city: 'תל אביב' } }],
] satisfies [string, NonNullable<ExtractionResult['moveDetails']>][]) {
  test(`city phrase: ${text}`, () => {
    assert.deepEqual(extractMessage(text), { moveDetails: expected });
  });
}

for (const [text, expected] of [
  ['איסוף קומה 2 בלי מעלית', { pickup: { floor: 2, elevator: false } }],
  ['פריקה קומה 3 עם מעלית', { dropoff: { floor: 3, elevator: true } }],
  ['איסוף קומת קרקע אין מעלית', { pickup: { floor: 0, elevator: false } }],
  ['פריקה קומה 0 יש מעלית', { dropoff: { floor: 0, elevator: true } }],
  ['איסוף קומה ראשונה', { pickup: { floor: 1 } }],
  ['פריקה קומה שנייה', { dropoff: { floor: 2 } }],
  ['איסוף קומה שניה', { pickup: { floor: 2 } }],
  ['פריקה קומה שלישית', { dropoff: { floor: 3 } }],
  ['איסוף קומה 2 בלי מעלית ופריקה קומה 3 עם מעלית', { pickup: { floor: 2, elevator: false }, dropoff: { floor: 3, elevator: true } }],
] satisfies [string, NonNullable<ExtractionResult['moveDetails']>][]) {
  test(`side-specific access details: ${text}`, () => {
    assert.deepEqual(extractMessage(text), { moveDetails: expected });
  });
}

for (const [text, sizeCategory] of [
  ['מקרר קטן', 'SMALL'], ['מקרר רגיל', 'REGULAR'], ['המקרר גדול', 'LARGE'],
  ['מקרר 4 דלתות', 'FOUR_DOOR'], ['מקרר ארבע דלתות', 'FOUR_DOOR'],
] satisfies [string, RefrigeratorSize][]) {
  test(`explicit refrigerator size: ${sizeCategory} (${text})`, () => {
    assert.deepEqual(extractMessage(text), { moveDetails: { items: [{ type: 'refrigerator', sizeCategory }] } });
  });
}

for (const [text, quantity] of [['20 ארגזים', 20], ['בערך 15 ארגזים', 15], ['יש 10 ארגזים', 10]] as const) {
  test(`box count: ${text}`, () => {
    assert.deepEqual(extractMessage(text), { moveDetails: { items: [{ type: 'box', quantity }] } });
  });
}

test('boxes without a count omit quantity rather than returning null or zero', () => {
  assert.deepEqual(extractMessage('יש גם ארגזים'), { moveDetails: { items: [{ type: 'box' }] } });
});

test('invalid and conflicting quantities are not invented', () => {
  for (const text of ['0 ארגזים', '-5 ארגזים', '1.5 ארגזים', '10-20 ארגזים', '999999999999999999 ארגזים', '20 ארגזים ועוד 15 ארגזים']) {
    assert.deepEqual(extractMessage(text), { moveDetails: { items: [{ type: 'box' }] } }, text);
  }
});

test('numeric separators, additive quantities, and quantity bounds do not become exact totals', () => {
  for (const text of ['1,500 ארגזים', 'עוד 5 ארגזים', '5 ארגזים נוספים', 'עד 20 ארגזים', 'לפחות 20 ארגזים']) {
    assert.deepEqual(extractMessage(text), { moveDetails: { items: [{ type: 'box' }] } }, text);
  }
});

test('opposite-direction cities in a labeled segment are not assigned to the wrong side', () => {
  assert.deepEqual(extractMessage('איסוף מחיפה לתל אביב'), {});
  assert.deepEqual(extractMessage('פריקה מרמת גן לחיפה'), {});
});

test('conflicting size or location facts omit only those updates', () => {
  assert.deepEqual(extractMessage('מקרר קטן מקרר גדול'), { moveDetails: { items: [{ type: 'refrigerator' }] } });
  assert.deepEqual(extractMessage('איסוף קומה 2 קומה 3 עם מעלית בלי מעלית'), {});
  assert.deepEqual(extractMessage('איסוף ברמת גן איסוף בחולון'), {});
  assert.deepEqual(extractMessage('מרמת גן לתל אביב, איסוף בחולון איסוף בבת ים'), { moveDetails: { dropoff: { city: 'תל אביב' } } });
});

test('only valid unambiguous ISO calendar dates are extracted', () => {
  for (const date of ['2026-09-20', '2028-02-29']) {
    assert.deepEqual(extractMessage(`בתאריך ${date}`), { moveDetails: { requestedDate: date } });
  }
  for (const text of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '20/09', '20.09', 'מחר', '2026-09-20 2026-09-21']) {
    assert.deepEqual(extractMessage(text), {}, text);
  }
});

test('unsupported or ambiguous language produces no structured guesses', () => {
  for (const text of [
    '', 'שלום תודה', 'קומה 2 בלי מעלית', 'תל אביב רמת גן', 'הכתובת היא ביאליק 20',
    'לא צריך מקרר', 'אין מקרר', 'בלי ארגזים', 'אולי מקרר גדול', 'מקרר קטן או גדול',
    'איסוף ברמת גן או בחולון', 'יש מעלית?', 'איסוף קומה רביעית', 'איסוף קומה 2.5', 'איסוף קומה 2,3',
    'מקררים', 'ארגזייה', 'איסוף קומה 2? פריקה קומה 3',
  ]) {
    assert.deepEqual(extractMessage(text), {}, text);
  }
});

test('punctuation ends side context and vague size does not become a category', () => {
  assert.deepEqual(extractMessage('איסוף מרמת גן, קומה 2 בלי מעלית'), { moveDetails: { pickup: { city: 'רמת גן' } } });
  assert.deepEqual(extractMessage('מקרר די גדול'), { moveDetails: { items: [{ type: 'refrigerator' }] } });
});

test('several item types are extracted once each', () => {
  assert.deepEqual(extractMessage('מקרר גדול וארון, יש 20 ארגזים וגם מקרר גדול').moveDetails?.items, [
    { type: 'refrigerator', sizeCategory: 'LARGE' }, { type: 'wardrobe' }, { type: 'box', quantity: 20 },
  ]);
});
