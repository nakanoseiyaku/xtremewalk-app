// Convenience store utilities

export interface ConvenienceStore {
  name: string;
  brand: string;
  lat: number;
  lng: number;
  km_pos: number;
  dist_from_route_m: number;
  side: string;
  side_ja: string;
  access: 'same_side' | 'cross_road';
  is_24h: boolean | null;
}

/**
 * Get the next N convenience stores ahead of current km position
 */
export function getNextStores(
  stores: ConvenienceStore[],
  currentKm: number,
  count: number = 3
): ConvenienceStore[] {
  return stores
    .filter((s) => s.km_pos > currentKm)
    .sort((a, b) => a.km_pos - b.km_pos)
    .slice(0, count);
}

/**
 * Get minutes to reach a store at current pace
 */
export function minutesToStore(
  storeKm: number,
  currentKm: number,
  paceKmH: number
): number | null {
  if (paceKmH <= 0) return null;
  const distKm = storeKm - currentKm;
  if (distKm <= 0) return null;
  return (distKm / paceKmH) * 60;
}

// No-store zones: km ranges where there are no convenience stores
// km 15-18 area (3km warning starts at km 15)
export const NO_STORE_ZONES: Array<{ start: number; end: number; label: string }> = [
  { start: 15, end: 18, label: '補給なし区間（15〜18km）' },
];

/**
 * Check if we're approaching a no-store zone (within 3km before start)
 */
export function getApproachingNoStoreZone(
  currentKm: number
): { start: number; end: number; label: string } | null {
  for (const zone of NO_STORE_ZONES) {
    const warningStart = zone.start - 3;
    if (currentKm >= warningStart && currentKm < zone.start) {
      return zone;
    }
  }
  return null;
}

/**
 * Check if currently inside a no-store zone
 */
export function isInNoStoreZone(currentKm: number): boolean {
  return NO_STORE_ZONES.some((z) => currentKm >= z.start && currentKm <= z.end);
}
