import { isItemType, type ItemType } from '../itemTypes.js';

interface ItemRequirementProfile {
  label: string;
  sizeRelevant: boolean;
  serviceQuestionsRelevant: boolean;
  quantityRequired: boolean;
  initialPhotoRequired: boolean;
  transportReview: 'STANDARD' | 'HUMAN';
}

// Every recognized type needs a deliberate collection policy, even when its
// transportation still requires human pricing. Preserve dresser's generic label.
export const itemRequirementProfiles = {
  refrigerator: {
    label: 'המקרר', sizeRelevant: true, serviceQuestionsRelevant: false,
    quantityRequired: false, initialPhotoRequired: true, transportReview: 'STANDARD',
  },
  box: {
    label: 'הארגזים', sizeRelevant: false, serviceQuestionsRelevant: false,
    quantityRequired: true, initialPhotoRequired: false, transportReview: 'STANDARD',
  },
  washing_machine: {
    label: 'מכונת הכביסה', sizeRelevant: false, serviceQuestionsRelevant: false,
    quantityRequired: false, initialPhotoRequired: false, transportReview: 'STANDARD',
  },
  wardrobe: {
    label: 'הארון', sizeRelevant: true, serviceQuestionsRelevant: true,
    quantityRequired: false, initialPhotoRequired: false, transportReview: 'HUMAN',
  },
  bed: {
    label: 'המיטה', sizeRelevant: true, serviceQuestionsRelevant: true,
    quantityRequired: false, initialPhotoRequired: false, transportReview: 'HUMAN',
  },
  dresser: {
    label: 'הפריט', sizeRelevant: false, serviceQuestionsRelevant: false,
    quantityRequired: false, initialPhotoRequired: false, transportReview: 'HUMAN',
  },
} satisfies Record<ItemType, ItemRequirementProfile>;

export function getItemRequirementProfile(type: string | null): ItemRequirementProfile | undefined {
  return isItemType(type) ? itemRequirementProfiles[type] : undefined;
}
