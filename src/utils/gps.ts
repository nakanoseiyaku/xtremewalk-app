// GPS utilities: haversine distance, nearest point finding, bearing computation

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6371000;

/**
 * Haversine distance between two coordinates in meters
 */
export function haversineDistance(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const aVal =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
  return EARTH_RADIUS_M * c;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export interface KmPoint {
  km: number;
  lat: number;
  lng: number;
  name?: string;
}

/**
 * Find the nearest km marker to the given position.
 * Uses ±50 index window search with full-search fallback at boundaries.
 */
export function findNearestKm(
  position: LatLng,
  kmPoints: KmPoint[],
  prevIndex: number | null = null
): { km: number; index: number; distanceM: number } {
  if (kmPoints.length === 0) {
    return { km: 0, index: 0, distanceM: 0 };
  }

  let searchStart = 0;
  let searchEnd = kmPoints.length - 1;

  if (prevIndex !== null) {
    searchStart = Math.max(0, prevIndex - 50);
    searchEnd = Math.min(kmPoints.length - 1, prevIndex + 50);
  }

  let bestIndex = searchStart;
  let bestDist = Infinity;

  for (let i = searchStart; i <= searchEnd; i++) {
    const dist = haversineDistance(position, kmPoints[i]);
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i;
    }
  }

  // Boundary fallback: if best is at the edge of window, do full search
  if (
    prevIndex !== null &&
    (bestIndex === searchStart || bestIndex === searchEnd)
  ) {
    for (let i = 0; i < kmPoints.length; i++) {
      const dist = haversineDistance(position, kmPoints[i]);
      if (dist < bestDist) {
        bestDist = dist;
        bestIndex = i;
      }
    }
  }

  return {
    km: kmPoints[bestIndex].km,
    index: bestIndex,
    distanceM: bestDist,
  };
}

/**
 * Compute bearing in degrees from point A to point B (0=North, 90=East)
 * Uses coordinate deltas, NOT GeolocationCoordinates.heading
 */
export function computeBearing(from: LatLng, to: LatLng): number {
  const dLng = toRad(to.lng - from.lng);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

/**
 * Format a distance in meters to a human-readable string
 */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}
