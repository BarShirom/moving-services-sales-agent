import type { MoveItem } from './lead.js';
import { getItemRequirementProfile } from './requirements/itemRequirementProfiles.js';

export function createMoveItem(type: string | null = null): MoveItem {
  return {
    type,
    quantity: null,
    description: null,
    sizeCategory: null,
    photoStatus: getItemRequirementProfile(type)?.initialPhotoRequired ? 'REQUIRED' : 'NOT_APPLICABLE',
    dimensions: { width: null, height: null, depth: null },
    dimensionsAvailable: null,
    requiresDisassembly: null,
    requiresAssembly: null,
  };
}
