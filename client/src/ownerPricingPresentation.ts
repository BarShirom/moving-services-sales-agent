import type { OwnerSnapshot } from './api';
import type { ReviewReason, PricingComponent, OmittedComponent } from '../../server/src/domain/pricing/types';
import type { MoveItem } from '../../server/src/domain/lead';
import { highBoxVolumeLabel, itemLabel, itemPricingReviewLabel } from './leadPresentation';
import { sizeLabels as sizes } from './displayFormatting';

const omittedLabels: Record<string, string> = { BOXES: 'ארגזים: כמות לא ידועה או נפח חריג', DISTANCE: 'מרחק: טרם נמסר מרחק מספרי', SPECIAL_DIFFICULTY: 'קושי גישה: נדרשת בדיקה', EXTRA_STOP_ACCESS: 'גישה בנקודות נוספות',
  REFRIGERATOR: 'מקרר: נדרש בירור לתמחור', WASHING_MACHINE: 'מכונת כביסה: נדרש בירור לתמחור',
  FLOORS: 'קומות: נדרשת בדיקה', ASSEMBLY_DISASSEMBLY: 'פירוק והרכבה: דורשים תמחור ידני', UNSUPPORTED_ITEM: 'הובלת פריט ללא תעריף',
  ITEM_DIMENSIONS: 'מידות הפריט: נדרשת השלמה או בדיקה', UNSUPPORTED_ITEM_ACCESS: 'נשיאה וגישה: דורשות בדיקה ותמחור ידני',
  SERVICE_REQUIREMENTS: 'צורך בפירוק / הרכבה: נדרש בירור',
  WORKERS: 'צוות', TIME: 'משך העבודה' };
function requestedServices(item?: MoveItem): string | null {
  const services = [item?.requiresDisassembly === true && 'פירוק', item?.requiresAssembly === true && 'הרכבה'].filter(Boolean);
  return services.length ? services.join(' ו') : null;
}
export function omittedLabel(component: OmittedComponent, owner: OwnerSnapshot): string {
  if (component.itemIndex !== undefined) {
    const items = owner.pricingEvaluation?.inputSnapshot.moveDetails.items ?? owner.customer.lead.moveDetails.items;
    const label = itemLabel(items, component.itemIndex);
    const definite = itemLabel(items, component.itemIndex, true);
    if (component.code === 'UNSUPPORTED_ITEM') return `${label}: הובלה דורשת תמחור ידני`;
    if (component.code === 'ASSEMBLY_DISASSEMBLY') return `${requestedServices(items[component.itemIndex]) ?? 'שירותים'} של ${definite}: נדרש תמחור ידני`;
    if (component.code === 'SERVICE_REQUIREMENTS') return `צורך בפירוק / הרכבה של ${definite}: נדרש בירור`;
    if (component.code === 'ITEM_DIMENSIONS') return `מידות ${definite}: נדרשת השלמה או בדיקה`;
    if (component.code === 'UNSUPPORTED_ITEM_ACCESS') return `נשיאה וגישה עבור ${definite}: דורשות בדיקה ותמחור ידני`;
    if (component.code === 'REFRIGERATOR' || component.code === 'WASHING_MACHINE') return `${label}: נדרש בירור לתמחור`;
  }
  return omittedLabels[component.code] ?? 'רכיב נוסף: דורש תמחור ידני';
}
function reasonLabel(reason: ReviewReason, owner: OwnerSnapshot): string {
  const items = owner.pricingEvaluation?.inputSnapshot.moveDetails.items ?? owner.customer.lead.moveDetails.items;
  const unsupported = /^ITEM_(\d+)_UNSUPPORTED$/.exec(reason.code);
  if (unsupported) return itemPricingReviewLabel(items, Number(unsupported[1]));
  if (reason.code === 'HIGH_VOLUME') return highBoxVolumeLabel(items) ?? 'נפח ההובלה דורש בדיקה';
  if (reason.code === 'SINGULAR_ITEM_QUANTITY') {
    const assumptions = owner.pricingEvaluation!.inputSnapshot.assumptions;
    const labels = [...assumptions.singularRefrigeratorQuantity, ...assumptions.singularWardrobeQuantity]
      .sort((a, b) => a - b).map(index => `${itemLabel(items, index)} אחד`);
    return `התמחור מניח ${labels.join(' ו')} לפי רשימת הפריטים. יש לאשר את ${labels.length > 1 ? 'הכמויות' : 'הכמות'}`;
  }
  const labels: Record<string, string> = {
    PROVISIONAL_BOX_RATE: 'תעריף נפח הארגזים הוא הנחת עבודה זמנית', PROVISIONAL_DISTANCE_RATE: 'תעריף המרחק הוא הנחת עבודה זמנית',
    ITEM_COMPOSITION: 'מחירי הפריטים מחוברים ללא חיוב בסיס נוסף', SERVICE_COMPOSITION: 'פירוק והרכבה מחויבים כחבילת שירות אחת',
    WAITING_ROUNDING: 'המתנה מחושבת לפי חצאי שעה שהחלו', DISCOUNT_SCOPE: 'הנחת סטודנט חלה על הרכיבים שתומחרו',
    WORKERS_COMPLEXITY: 'גודל הצוות דורש בדיקת מורכבות', DURATION_COMPLEXITY: 'משך העבודה דורש בדיקת מורכבות',
    PROVISIONAL_RULES: 'התעריפים מבוססים על נתונים היסטוריים ודורשים אישור בעל העסק', MISSING_DISTANCE: 'מרחק המסלול אינו ידוע',
    DISTANCE_RATE_UNAVAILABLE: 'חסר תעריף למרחק ההובלה, גם כשהמרחק ידוע', MISSING_DATE: 'תאריך ההובלה חסר',
    INCOMPLETE_INVENTORY: 'רשימת הפריטים אינה מלאה או שהכמויות משוערות', MANY_ITEM_TYPES: 'מגוון פריטים דורש בדיקה פרטנית',
    HIGH_VOLUME: 'נפח ההובלה דורש בדיקה', MULTIPLE_POINTS: 'מספר נקודות איסוף או פריקה דורש בדיקה',
    SPECIAL_ACCESS: 'קושי גישה דורש בדיקה', ACCESS_UNKNOWN: 'תנאי הגישה טרם אושרו', NO_ITEMS: 'טרם נמסרו פריטים',
    REFRIGERATOR_QUANTITY: 'כמות המקררים חסרה או מעבר לתחום התמחור', FLOOR_COMPOSITION: 'שילוב תעריף המקרר והקומות דורש בדיקה',
    SINGULAR_REFRIGERATOR_QUANTITY: 'התמחור מניח מקרר אחד לפי רשימת הפריטים. יש לאשר את הכמות',
    SINGULAR_WARDROBE_QUANTITY: 'הבדיקה מתייחסת לארון אחד לפי רשימת הפריטים. יש לאשר את הכמות',
    WORKERS_RATE_UNAVAILABLE: 'אין תעריף מוגדר לצוות', TIME_RATE_UNAVAILABLE: 'אין תעריף מוגדר למשך העבודה',
  };
  if (labels[reason.code]) return labels[reason.code];
  const suffixes: Record<string, string> = { BOX_RATE: 'אין עדיין תעריף לארגזים', QUANTITY: 'כמות הפריט חסרה',
    DIMENSIONS_UNAVAILABLE: 'הלקוח אינו יכול למסור את כל המידות כרגע. נדרשת השלמה או בדיקה',
    SERVICE_COMPLEXITY: 'מורכבות הפירוק או ההרכבה דורשת בדיקה', SERVICES_UNKNOWN: 'צורך בפירוק או בהרכבה טרם הובהר', SERVICES: 'פירוק או הרכבה דורשים תמחור ידני', SERVICES_MANUAL: 'פירוק / הרכבה דורשים בירור ותמחור ידני',
    UNSUPPORTED: 'פריט שאינו נתמך בתמחור הנוכחי', VISUAL_EVIDENCE: 'חסרים צילום או מידות מלאות', SIZE: 'גודל המקרר חסר או אינו נתמך',
    LOCATION: 'כתובת או עיר חסרה', FLOOR: 'הקומה אינה ידועה', ELEVATOR: 'זמינות המעלית אינה ידועה',
    ELEVATOR_FIT_UNKNOWN: 'לא ידוע אם הפריט נכנס במעלית', ELEVATOR_DOES_NOT_FIT: 'הפריט לא נכנס במעלית. נדרשת בדיקת נשיאה',
    BASEMENT: 'גישה לקומת מרתף דורשת בדיקה', FLOOR_RULE_NOT_APPLIED: 'תמחור המדרגות לא נכלל בשל מורכבות ההובלה' };
  const suffix = reason.code.replace(/^(ITEM_\d+|pickup|dropoff)_/, '');
  const side = reason.code.startsWith('pickup_') ? 'באיסוף: ' : reason.code.startsWith('dropoff_') ? 'בפריקה: ' : '';
  const item = /^ITEM_(\d+)_/.exec(reason.code);
  if (item && suffix === 'SERVICES_MANUAL') return `${itemLabel(items, Number(item[1]))}: נדרש תמחור ידני עבור ${requestedServices(items[Number(item[1])]) ?? 'שירותים'}`;
  return (item ? `${itemLabel(items, Number(item[1]))}: ` : side) + (suffixes[suffix] ?? reason.message);
}
export function reviewNotes(owner: OwnerSnapshot) {
  const notes = new Map<string, { label: string; confidenceDeduction: number }>();
  for (const reason of owner.pricingEvaluation?.reviewReasons ?? []) {
    const label = reasonLabel(reason, owner);
    // Merge identical business wording, retaining separate items/endpoints and all score deductions.
    const scope = /^(ITEM_\d+|pickup|dropoff)_/.exec(reason.code)?.[1] ?? 'move';
    const key = `${scope}:${label}`;
    const previous = notes.get(key);
    notes.set(key, { label, confidenceDeduction: (previous?.confidenceDeduction ?? 0) + reason.confidenceDeduction });
  }
  return [...notes].map(([key, note]) => ({ key, ...note }));
}
export function componentLabel(component: PricingComponent, owner: OwnerSnapshot): string {
  if (component.code === 'REFRIGERATOR') return 'מקרר ' + (sizes[owner.pricingEvaluation?.inputSnapshot.moveDetails.items.find(item => item.type === 'refrigerator')?.sizeCategory ?? ''] ?? '');
  if (component.code === 'BOXES') {
    const boxes = owner.pricingEvaluation?.inputSnapshot.moveDetails.items.filter(item => item.type === 'box') ?? [];
    if (boxes.length && boxes.every(item => item.quantity !== null)) return `${boxes.reduce((sum, item) => sum + item.quantity!, 0)} ארגזים`;
  }
  if (component.code !== 'FLOORS') return ({ WASHING_MACHINE: 'מכונת כביסה', BOXES: 'נפח ארגזים', DISTANCE: 'מרחק המסלול', ASSEMBLY_DISASSEMBLY: 'פירוק / הרכבה', EXTRA_STOP: 'נקודות נוספות', WAITING: 'המתנה', DISCOUNT: 'הנחת סטודנט' } as Record<string, string>)[component.code] ?? component.label;
  return 'קומות ללא מעלית ' + (component.label.startsWith('pickup') ? 'באיסוף' : 'בפריקה');
}
