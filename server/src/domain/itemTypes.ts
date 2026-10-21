// Identifiers recognized by extraction. Collection and pricing policies stay separate.
export const ITEM_TYPES = [
  'refrigerator', 'box', 'washing_machine', 'wardrobe', 'bed', 'dresser',
] as const;

export type ItemType = typeof ITEM_TYPES[number];

export function isItemType(value: string | null): value is ItemType {
  return value !== null && ITEM_TYPES.some(type => type === value);
}
