import { randomUUID } from 'node:crypto';
import type { Lead } from './lead.js';

export function createLead(): Lead {
  const timestamp = new Date().toISOString();

  return {
    id: randomUUID(),
    status: 'COLLECTING_INFORMATION',
    moveDetails: {
      items: [],
      pickup: { city: null, address: null, floor: null, elevator: null },
      dropoff: { city: null, address: null, floor: null, elevator: null },
      requestedDate: null,
      requestedTime: null,
      specialAccessNotes: null,
    },
    messages: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
