import { DEMO_CITIES, FLOOR_WORDS, ITEM_PATTERNS, REFRIGERATOR_SIZES } from './patterns.js';
import type { ExtractionResult, ItemPatch, LocationPatch, RefrigeratorSize, SupportedItemType } from './types.js';

type Side = 'pickup' | 'dropoff';
type LocationEvidence = { cities: string[]; floors: number[]; elevators: boolean[] };

function unique<T>(values: T[]): T | undefined {
  const distinct = [...new Set(values)];
  return distinct.length === 1 ? distinct[0] : undefined;
}

function isUncertain(text: string): boolean {
  return /\?|(?<!\p{L})(?:לא|אולי|או|אם|האם|ייתכן|יתכן|כנראה)(?!\p{L})/u.test(text)
    || /(?<!\p{L})(?:אין|בלי)(?!\p{L})(?!\s+מעלית(?!\p{L}))/u.test(text);
}

function segments(clause: string): { text: string; side?: Side }[] {
  const markers = [...clause.matchAll(/(?<!\p{L})ו?(איסוף|פריקה)(?=\s|:|$)/gu)];
  if (markers.length === 0) return [{ text: clause }];
  const result: { text: string; side?: Side }[] = [{ text: clause.slice(0, markers[0].index) }];
  markers.forEach((marker, index) => {
    result.push({
      text: clause.slice(marker.index! + marker[0].length, markers[index + 1]?.index),
      side: marker[1] === 'איסוף' ? 'pickup' : 'dropoff',
    });
  });
  return result;
}

function validISODate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function extractMessage(text: string): ExtractionResult {
  const explicit: Record<Side, LocationEvidence> = {
    pickup: { cities: [], floors: [], elevators: [] },
    dropoff: { cities: [], floors: [], elevators: [] },
  };
  const route: Record<Side, string[]> = { pickup: [], dropoff: [] };
  const itemEvidence = new Map<SupportedItemType, { quantities: number[]; sizes: RefrigeratorSize[] }>();
  const dates: string[] = [];
  const cityPattern = new RegExp(`(?<![\\p{L}\\p{N}])ו?([מלב])?(${DEMO_CITIES.map(city => city.replaceAll(' ', '\\s+')).join('|')})(?![\\p{L}\\p{N}])`, 'gu');

  // Numeric separators stay intact so 1.5 or 1,500 cannot become 5 or 500.
  const clauses = text.normalize('NFKC').split(/[;\n!]+|(?<!\d)[.,]|[.,](?!\d)/u);
  for (const raw of clauses) {
    const clause = raw.replace(/\s+/gu, ' ').trim();
    if (!clause || isUncertain(clause)) continue;

    for (const [type, pattern] of Object.entries(ITEM_PATTERNS) as [SupportedItemType, string][]) {
      const matches = clause.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])ו?ה?${pattern}(?![\\p{L}\\p{N}])`, 'gu'));
      for (const match of matches) {
        const evidence = itemEvidence.get(type) ?? { quantities: [], sizes: [] };
        itemEvidence.set(type, evidence);
        if (type === 'box' && !/(?<!\p{L})(?:עוד|נוספים|נוספות|עד|לפחות|מקסימום)(?!\p{L})/u.test(clause)) {
          const preceding = clause.slice(0, match.index);
          const quantityText = preceding.match(/(?<![\p{L}\p{N}_.,+\/-])(\d+)\s+$/u)?.[1];
          const quantity = Number(quantityText);
          if (Number.isSafeInteger(quantity) && quantity > 0) evidence.quantities.push(quantity);
        }
        if (type === 'refrigerator') {
          const following = clause.slice(match.index! + match[0].length);
          const size = following.match(/^\s+(קטן|רגיל|גדול|4\s+דלתות|ארבע\s+דלתות)(?![\p{L}\p{N}])/u)?.[1];
          if (size) evidence.sizes.push(REFRIGERATOR_SIZES[size.replace(/\s+/gu, ' ')]);
        }
      }
    }

    for (const segment of segments(clause)) {
      const cities = [...segment.text.matchAll(cityPattern)];
      if (segment.side) {
        const evidence = explicit[segment.side];
        const oppositePrefix = segment.side === 'pickup' ? 'ל' : 'מ';
        evidence.cities.push(...cities.filter(match => match[1] !== oppositePrefix).map(match => match[2].replace(/\s+/gu, ' ')));
        for (const match of segment.text.matchAll(/(?<!\p{L})(?:קומת\s+קרקע|קומה\s+(-?\d+|ראשונה|שנייה|שניה|שלישית))(?![\p{L}\p{N}.,\/-])/gu)) {
          const floor = match[1] === undefined ? 0 : FLOOR_WORDS[match[1]] ?? Number(match[1]);
          if (Number.isSafeInteger(floor)) evidence.floors.push(floor);
        }
        for (const match of segment.text.matchAll(/(?<!\p{L})(עם|יש|בלי|אין)\s+מעלית(?!\p{L})/gu)) {
          evidence.elevators.push(match[1] === 'עם' || match[1] === 'יש');
        }
      } else {
        for (const match of cities) {
          if (match[1] === 'מ') route.pickup.push(match[2].replace(/\s+/gu, ' '));
          if (match[1] === 'ל') route.dropoff.push(match[2].replace(/\s+/gu, ' '));
        }
      }
    }
    for (const match of clause.matchAll(/(?<![\p{L}\p{N}-])\d{4}-\d{2}-\d{2}(?![\p{L}\p{N}-])/gu)) {
      if (validISODate(match[0])) dates.push(match[0]);
    }
  }

  const moveDetails: NonNullable<ExtractionResult['moveDetails']> = {};
  for (const side of ['pickup', 'dropoff'] as const) {
    const evidence = explicit[side];
    const location: LocationPatch = {};
    const city = unique(evidence.cities.length > 0 ? evidence.cities : route[side]);
    const floor = unique(evidence.floors);
    const elevator = unique(evidence.elevators);
    if (city !== undefined) location.city = city;
    if (floor !== undefined) location.floor = floor;
    if (elevator !== undefined) location.elevator = elevator;
    if (Object.keys(location).length > 0) moveDetails[side] = location;
  }
  if (itemEvidence.size > 0) {
    moveDetails.items = [...itemEvidence].map(([type, evidence]): ItemPatch => {
      const item: ItemPatch = { type };
      const quantity = unique(evidence.quantities);
      const sizeCategory = unique(evidence.sizes);
      if (quantity !== undefined) item.quantity = quantity;
      if (sizeCategory !== undefined) item.sizeCategory = sizeCategory;
      return item;
    });
  }
  const requestedDate = unique(dates);
  if (requestedDate !== undefined) moveDetails.requestedDate = requestedDate;
  return Object.keys(moveDetails).length > 0 ? { moveDetails } : {};
}
