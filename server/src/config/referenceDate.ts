// Application boundary: callers supply the instant; domain extraction receives only the local date.
export function israelReferenceDate(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const part = (type: string) => parts.find(entry => entry.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
