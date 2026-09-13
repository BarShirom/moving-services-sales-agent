export type LeadStatus =
  | 'COLLECTING_INFORMATION'
  | 'READY_FOR_PRICING'
  | 'AWAITING_REVIEW'
  | 'QUOTE_SENT'
  | 'WON'
  | 'LOST';

export type MessageSender = 'CUSTOMER' | 'AGENT' | 'HUMAN';

// Dimensions are in centimeters. Each measurement can be collected separately.
export interface Dimensions {
  width: number | null;
  height: number | null;
  depth: number | null;
}

export interface MoveItem {
  type: string | null;
  quantity: number | null;
  // A structured, accepted size classification; free-text description is not assessed here.
  sizeCategory: string | null;
  photoStatus: 'REQUIRED' | 'RECEIVED' | 'NOT_APPLICABLE';
  description: string | null;
  dimensions: Dimensions;
  requiresDisassembly: boolean | null;
  requiresAssembly: boolean | null;
}

export interface Location {
  city: string | null;
  address: string | null;
  floor: number | null;
  elevator: boolean | null;
}

export interface MoveDetails {
  // An empty array means no items have been recorded yet.
  items: MoveItem[];
  pickup: Location;
  dropoff: Location;
  // Requested local calendar date (YYYY-MM-DD) and time (HH:mm), not UTC instants.
  requestedDate: string | null;
  requestedTime: string | null;
  specialAccessNotes: string | null;
}

export interface Message {
  id: string;
  sender: MessageSender;
  text: string;
  // ISO 8601 UTC timestamp.
  timestamp: string;
}

export interface Lead {
  id: string;
  status: LeadStatus;
  moveDetails: MoveDetails;
  messages: Message[];
  // ISO 8601 UTC timestamps.
  createdAt: string;
  updatedAt: string;
}
