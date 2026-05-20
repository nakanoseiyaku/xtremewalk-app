// Pace calculation utilities
import type { Checkpoint } from '../constants/checkpoints';

export interface PaceInfo {
  currentPaceKmH: number;
  predictedPaceKmH: number;
  etaToNextCp: Date | null;
  marginMinutes: number | null;
  requiredPaceKmH: number | null;
  maxRestMinutes: number | null;
}

/**
 * Fatigue factor based on km walked.
 * Returns >= 1.0: how much slower a median walker becomes relative to current pace.
 * Polynomial fit to median ultra-walking data:
 * km=0: 1.00, km=40: 1.128, km=60: 1.228, km=75: 1.319, km=90: 1.423
 */
function fatigueFactor(km: number): number {
  return 1.0 + 0.002 * km + 0.00003 * km * km;
}

/**
 * Circadian rhythm correction for nighttime hours.
 * Returns >= 1.0: additional slowdown due to time of day.
 */
function circadianFactor(): number {
  const h = new Date().getHours();
  if (h >= 0 && h < 3) return 1.15;
  if (h >= 3 && h < 5) return 1.12;
  if (h >= 22) return 1.08;
  return 1.0;
}

/**
 * Calculate current pace from a reference km snapshot.
 * Uses dynamic elapsed time (30-min window) instead of a fixed 5-min assumption.
 */
export function calcCurrentPace(
  currentKm: number,
  kmNMinAgo: number | null,
  elapsedMin: number | null
): number {
  if (
    kmNMinAgo === null ||
    elapsedMin === null ||
    elapsedMin <= 0 ||
    kmNMinAgo >= currentKm
  )
    return 0;
  return (currentKm - kmNMinAgo) / (elapsedMin / 60);
}

/**
 * Full pace calculation for next CP.
 * Required pace is corrected for expected fatigue and circadian slowdown.
 */
export function calcPaceInfo(
  currentKm: number,
  kmNMinAgo: number | null,
  elapsedMin: number | null,
  nextCpKm: number,
  nextCpCutoff: Date,
  now: Date = new Date()
): PaceInfo {
  const currentPaceKmH = calcCurrentPace(currentKm, kmNMinAgo, elapsedMin);

  // Predicted pace accounts for fatigue: they'll be slower than current
  const ff = fatigueFactor(currentKm);
  const predictedPaceKmH = currentPaceKmH > 0 ? currentPaceKmH / ff : 0;

  const remainingKm = Math.max(0, nextCpKm - currentKm);

  let etaToNextCp: Date | null = null;
  let marginMinutes: number | null = null;

  if (predictedPaceKmH > 0) {
    const hoursToNextCp = remainingKm / predictedPaceKmH;
    etaToNextCp = new Date(now.getTime() + hoursToNextCp * 3600 * 1000);
    marginMinutes =
      (nextCpCutoff.getTime() - etaToNextCp.getTime()) / (60 * 1000);
  }
  // else: no pace data yet → leave marginMinutes null so UI shows '--'

  // Required pace corrected for fatigue + circadian: walker needs to go faster
  // now to compensate for the slowdown they'll experience later
  const timeToDeadline =
    (nextCpCutoff.getTime() - now.getTime()) / (3600 * 1000);
  const requiredPaceKmH =
    timeToDeadline > 0
      ? (remainingKm / timeToDeadline) * ff * circadianFactor()
      : null;

  // Max rest time: safe_departure = cutoff - travel_time - 30min buffer
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
 * Format margin as "+Xh Ym" or "-Xm 不足"
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

export interface CPProjection {
  cp: Checkpoint;
  targetArrival: Date;
  predictedArrival: Date;
  vsTargetMin: number; // positive = ahead of target
  vsCutoffMin: number; // positive = before cutoff
  willMissTarget: boolean;
  willMissCutoff: boolean;
}

/**
 * Simulate arrival at all remaining CPs using leg-by-leg fatigue.
 * Un-fatigues the current pace to get base pace, then re-applies fatigue
 * at the midpoint of each leg.
 */
export function calcFullProjection(
  currentKm: number,
  currentPaceKmH: number,
  checkpoints: Checkpoint[],
  startDate: Date,
  targetHours: number,
  now: Date = new Date()
): CPProjection[] {
  if (currentPaceKmH <= 0) return [];

  // Un-fatigue: recover the "fresh" base pace
  const basePaceKmH = currentPaceKmH * fatigueFactor(currentKm);

  let simKm = currentKm;
  let simTimeMs = now.getTime();

  return checkpoints
    .filter((cp) => cp.km > currentKm)
    .map((cp) => {
      const midKm = (simKm + cp.km) / 2;
      const legPaceKmH = basePaceKmH / fatigueFactor(midKm);
      const legHours = (cp.km - simKm) / legPaceKmH;
      simTimeMs += legHours * 3600 * 1000;
      simKm = cp.km;

      const predictedArrival = new Date(simTimeMs);
      const targetArrival = new Date(
        startDate.getTime() + (cp.km / 100) * targetHours * 3600 * 1000
      );
      const vsTargetMin =
        (targetArrival.getTime() - predictedArrival.getTime()) / 60000;
      const vsCutoffMin =
        (cp.cutoff.getTime() - predictedArrival.getTime()) / 60000;

      return {
        cp,
        targetArrival,
        predictedArrival,
        vsTargetMin,
        vsCutoffMin,
        willMissTarget: vsTargetMin < 0,
        willMissCutoff: vsCutoffMin < 0,
      };
    });
}
