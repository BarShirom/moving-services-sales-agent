import type { MoveItem } from './lead.js';

export function createMoveItem(type: string | null = null): MoveItem {
  return {
    type,
    quantity: null,
    description: null,
    sizeCategory: null,
    photoStatus: type === 'refrigerator' ? 'REQUIRED' : 'NOT_APPLICABLE',
    dimensions: { width: null, height: null, depth: null },
    requiresDisassembly: null,
    requiresAssembly: null,
  };
}
