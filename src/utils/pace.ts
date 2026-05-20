// Pace calculation utilities

export interface PaceInfo {
  currentPaceKmH: number;
  predictedPaceKmH: number;
  etaToNextCp: Date | null;
  marginMinutes: number | null;
  requiredPaceKmH: number | null;
  maxRestMinutes: number | null;
}

/**
 * Fatigue multiplier based on km walked
 */
function fatigueFactor(km: number): number {
  if (km < 40) return 1.0;
  if (km < 60) return 0.95;
  return 0.87;
}

/**
 * Calculate current pace from km 5 minutes ago
 * current_pace = (current_km - km_5min_ago) / (5/60) km/h
 */
export function calcCurrentPace(
  currentKm: number,
  km5minAgo: number | null
): number {
  if (km5minAgo === null || km5minAgo >= currentKm) return 0;
  return (currentKm - km5minAgo) / (5 / 60);
}

/**
 * Full pace calculation for next CP
 */
export function calcPaceInfo(
  currentKm: number,
  km5minAgo: number | null,
  nextCpKm: number,
  nextCpCutoff: Date,
  now: Date = new Date()
): PaceInfo {
  const currentPaceKmH = calcCurrentPace(currentKm, km5minAgo);

  // Predicted pace with fatigue
  const factor = fatigueFactor(currentKm);
  const predictedPaceKmH = currentPaceKmH > 0 ? currentPaceKmH * factor : 0;

  // Remaining km to next CP
  const remainingKm = Math.max(0, nextCpKm - currentKm);

  // ETA to next CP
  let etaToNextCp: Date | null = null;
  let marginMinutes: number | null = null;

  if (predictedPaceKmH > 0) {
    const hoursToNextCp = remainingKm / predictedPaceKmH;
    etaToNextCp = new Date(now.getTime() + hoursToNextCp * 3600 * 1000);
    marginMinutes =
      (nextCpCutoff.getTime() - etaToNextCp.getTime()) / (60 * 1000);
  } else {
    // No movement yet: compute margin from cutoff to now
    marginMinutes = (nextCpCutoff.getTime() - now.getTime()) / (60 * 1000);
  }

  // Required pace to make cutoff
  const timeToDeadline =
    (nextCpCutoff.getTime() - now.getTime()) / (3600 * 1000);
  const requiredPaceKmH =
    timeToDeadline > 0 ? remainingKm / timeToDeadline : null;

  // Max rest time: safe_departure = cutoff - travel_time - 30min buffer
  // travel_time = remainingKm / predictedPaceKmH (hours)
  let maxRestMinutes: number | null = null;
  if (predictedPaceKmH > 0 && remainingKm > 0) {
    const travelHours = remainingKm / predictedPaceKmH;
    const safeDeparture = new Date(
      nextCpCutoff.getTime() - travelHours * 3600 * 1000 - 30 * 60 * 1000
    );
    maxRestMinutes = (safeDeparture.getTime() - now.getTime()) / (60 * 1000);
    if (maxRestMinutes < 0) maxRestMinutes = 0;
  }

  return {
    currentPaceKmH,
    predictedPaceKmH,
    etaToNextCp,
    marginMinutes,
    requiredPaceKmH,
    maxRestMinutes,
  };
}

/**
 * Format pace as "X.X km/h"
 */
export function formatPace(kmH: number): string {
  return `${kmH.toFixed(1)} km/h`;
}

/**
 * Format margin as "+Xh Ym" or "-Xm"
 */
export function formatMargin(minutes: number): string {
  if (minutes >= 0) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    if (h > 0) return `+${h}h ${m}m`;
    return `+${m}m`;
  } else {
    const absM = Math.round(Math.abs(minutes));
    return `-${absM}m 不足`;
  }
}

/**
 * Format Date as HH:MM
 */
export function formatTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Format minutes as "Xh Ym" or "Ym"
 */
export function formatMinutes(minutes: number): string {
  const absM = Math.abs(Math.round(minutes));
  const h = Math.floor(absM / 60);
  const m = absM % 60;
  if (h > 0) return `${h}時間${m}分`;
  return `${m}分`;
}
