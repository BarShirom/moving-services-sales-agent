import type { MoveDetails } from '../domain/lead.js';

/** Demo-only lookup of an explicitly synthetic route, never a geography estimate.
 * A future Maps adapter can implement the same numeric contract outside pricing.
 */
export function demoRouteDistance(move: MoveDetails): number | null {
  if (move.pickup.city === 'רמת גן' && move.dropoff.city === 'תל אביב') {
    const registeredRoute = (move.pickup.address === 'רחוב דוגמה 1' && move.dropoff.address === 'רחוב דוגמה 2')
      || (move.pickup.address === 'ביאליק 20' && move.dropoff.address === 'סלמה 37');
    // Both registered demo fixtures use 20 km. This is not a measured road distance.
    if (registeredRoute) return 20;
  }
  return null;
}
