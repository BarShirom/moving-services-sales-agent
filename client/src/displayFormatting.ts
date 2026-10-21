export const sizeLabels: Record<string, string> = {
  SMALL: 'קטן',
  REGULAR: 'רגיל',
  LARGE: 'גדול',
  FOUR_DOOR: 'ארבע דלתות',
};

export function booleanLabel(value: boolean | null): string {
  return value === null ? 'טרם צוין' : value ? 'כן' : 'לא';
}

const ownerCurrency = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function ownerMoney(value: number): string {
  return ownerCurrency.format(value);
}

// Quotes intentionally use the same plain shekel suffix as the conversation.
export function quoteMoney(value: number): string {
  return `${value.toLocaleString('he-IL')} ₪`;
}
