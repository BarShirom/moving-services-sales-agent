import type { RefrigeratorSize, SupportedItemType } from './types.js';

export const DEMO_CITIES = ['תל אביב', 'רמת גן', 'גבעתיים', 'בת ים', 'חולון'] as const;

export const ITEM_PATTERNS: Record<SupportedItemType, string> = {
  refrigerator: 'מקרר',
  box: 'ארגז(?:ים)?',
  washing_machine: 'מכונת\\s+כביסה',
  wardrobe: 'ארון',
  bed: 'מיטה',
};

export const REFRIGERATOR_SIZES: Record<string, RefrigeratorSize> = {
  קטן: 'SMALL', רגיל: 'REGULAR', גדול: 'LARGE',
  '4 דלתות': 'FOUR_DOOR', 'ארבע דלתות': 'FOUR_DOOR',
};

export const FLOOR_WORDS: Record<string, number> = {
  ראשונה: 1, שנייה: 2, שניה: 2, שלישית: 3,
};
