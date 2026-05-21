// Pace calculation utilities
import type { Checkpoint } from '../constants/checkpoints';

export interface PaceInfo {
  currentPaceKmH: number;
  predictedPaceKmH: number;
  etaToNextCp: Date | null;
  marginMinutes: number | null;       // vs cutoff (safety floor — negative = disqualified)
  targetMarginMinutes: number | null; // vs 26h target (main KPI — negative = behind plan)
  requiredPaceKmH: number | null;     // pace needed to hit target (with fatigue correction)
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
  nextCpTargetArrival: Date | null = null,
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
  // now to compensate for the slowdown they'll experience later.
  // Uses target arrival (26h plan) if provided, falls back to cutoff (minimum safety line).
  const deadline = nextCpTargetArrival ?? nextCpCutoff;
  const timeToDeadline = (deadline.getTime() - now.getTime()) / (3600 * 1000);
  const requiredPaceKmH =
    timeToDeadline > 0
      ? (remainingKm / timeToDeadline) * ff * circadianFactor()
      : null;

  // Target margin: positive = ahead of 26h plan, negative = behind plan
  const targetMarginMinutes: number | null =
    etaToNextCp !== null && nextCpTargetArrival !== null
      ? (nextCpTargetArrival.getTime() - etaToNextCp.getTime()) / (60 * 1000)
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
    targetMarginMinutes,
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
 * Format Date as HH:MM with a next-day prefix relative to the race start's
 * calendar day. "翌" = +1 calendar day, "翌々" = +2 days.
 * Uses local midnight boundaries, not raw 24h elapsed.
 */
export function formatDayTime(date: Date, raceStart: Date): string {
  const sm = new Date(
    raceStart.getFullYear(),
    raceStart.getMonth(),
    raceStart.getDate()
  ).getTime();
  const dm = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ).getTime();
  const dayDiff = Math.round((dm - sm) / 86_400_000);
  const prefix = dayDiff <= 0 ? '' : dayDiff === 1 ? '翌' : '翌々';
  return `${prefix}${formatTime(date)}`;
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
  scheduledArrival: Date; // predictedArrival + cumulative rest of preceding CPs
  restMinutes: number;    // recommended rest at this CP (sports-medicine model); 0 for goal
  vsTargetMin: number; // positive = ahead of target
  vsCutoffMin: number; // positive = before cutoff
  willMissTarget: boolean;
  willMissCutoff: boolean;
}

// Per-CP rest tuning, keyed by checkpoint index (1-5). Sports-medicine model.
interface RestParam {
  weight: number;
  min: number;
  max: number;
}
const REST_PARAMS: Record<number, RestParam> = {
  1: { weight: 0.1, min: 0, max: 15 },
  2: { weight: 0.25, min: 5, max: 25 },
  3: { weight: 0.3, min: 8, max: 40 },
  4: { weight: 0.2, min: 5, max: 30 },
  5: { weight: 0.15, min: 3, max: 35 },
};
// Surplus-redistribution priority when a CP hits its max (CP3 first).
const REDISTRIBUTE_ORDER = [3, 2, 4, 5, 1];

// Provisional rest budget (minutes) used before a real pace is measured —
// roughly the sports-medicine "ideal" total for a 26h plan.
const PROVISIONAL_REST_BUDGET_MIN = 100;

/**
 * Allocate a total rest budget (minutes) across the remaining non-goal CPs
 * using a sports-medicine-informed weighting. Mutates restMinutes in place.
 */
function allocateRest(projections: CPProjection[], budgetMin: number): void {
  for (const p of projections) p.restMinutes = 0;

  const remaining = projections.filter(
    (p) => p.cp.km !== 100 && REST_PARAMS[p.cp.index] !== undefined
  );

  const T = Math.max(0, budgetMin);
  if (T <= 0 || remaining.length === 0) return;

  // Stamina bias on base weights, using T as the walker's standing proxy.
  const biased = new Map<number, number>();
  for (const p of remaining) {
    const idx = p.cp.index;
    let w = REST_PARAMS[idx].weight;
    if (T < 30) {
      if (idx === 3 || idx === 4 || idx === 5) w *= 1.2;
      if (idx === 1) w *= 0.7;
    } else if (T > 110) {
      if (idx === 1 || idx === 2) w *= 1.1;
      if (idx === 4 || idx === 5) w *= 0.85;
    }
    biased.set(idx, w);
  }
  const biasedSum = [...biased.values()].reduce((a, b) => a + b, 0);
  const weight = new Map<number, number>();
  for (const [idx, w] of biased) weight.set(idx, w / biasedSum);

  const floor = remaining.reduce((s, p) => s + REST_PARAMS[p.cp.index].min, 0);
  const alloc = new Map<number, number>();

  if (T < floor) {
    // Below safe-care minimums: scale every min proportionally.
    const scale = T / floor;
    for (const p of remaining) {
      alloc.set(p.cp.index, REST_PARAMS[p.cp.index].min * scale);
    }
  } else {
    // Give each its min, then distribute surplus by renormalized weight.
    for (const p of remaining) {
      alloc.set(p.cp.index, REST_PARAMS[p.cp.index].min);
    }
    let surplus = T - floor;
    for (let pass = 0; pass < 6 && surplus > 0.01; pass++) {
      const open = remaining.filter(
        (p) => (alloc.get(p.cp.index) ?? 0) < REST_PARAMS[p.cp.index].max - 0.01
      );
      if (open.length === 0) break;
      const openWeightSum = open.reduce(
        (s, p) => s + (weight.get(p.cp.index) ?? 0),
        0
      );
      if (openWeightSum <= 0) break;
      const ordered = [...open].sort(
        (a, b) =>
          REDISTRIBUTE_ORDER.indexOf(a.cp.index) -
          REDISTRIBUTE_ORDER.indexOf(b.cp.index)
      );
      let consumed = 0;
      for (const p of ordered) {
        const idx = p.cp.index;
        const want = surplus * ((weight.get(idx) ?? 0) / openWeightSum);
        const room = REST_PARAMS[idx].max - (alloc.get(idx) ?? 0);
        const give = Math.min(want, room);
        alloc.set(idx, (alloc.get(idx) ?? 0) + give);
        consumed += give;
      }
      surplus -= consumed;
      if (consumed < 0.01) break;
    }
  }

  for (const p of remaining) {
    p.restMinutes = Math.round(alloc.get(p.cp.index) ?? 0);
  }
}

export interface CheckInAnchor {
  km: number;
  departedAtMs: number;
}

/**
 * Simulate arrival at the remaining CPs from a known anchor point using
 * leg-by-leg fatigue, then allocate recommended rest and compute the
 * scheduled (with-rest) arrival for each CP.
 */
function simulateFromAnchor(
  anchorKm: number,
  anchorTimeMs: number,
  basePaceKmH: number,
  remainingCps: Checkpoint[],
  startDate: Date,
  targetHours: number
): CPProjection[] {
  let simKm = anchorKm;
  let simTimeMs = anchorTimeMs;

  const projections: CPProjection[] = remainingCps.map((cp) => {
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
      scheduledArrival: predictedArrival, // provisional; set below
      restMinutes: 0, // filled in by allocateRest below
      vsTargetMin,
      vsCutoffMin,
      willMissTarget: vsTargetMin < 0,
      willMissCutoff: vsCutoffMin < 0,
    };
  });

  // Sports-medicine rest allocation, budgeted by the goal's slack vs the target.
  const goal = projections.find((p) => p.cp.km === 100);
  allocateRest(projections, goal ? Math.max(0, goal.vsTargetMin) : 0);

  // Scheduled arrival = predicted + cumulative rest of *preceding* CPs.
  let cumRestMs = 0;
  for (const p of projections) {
    p.scheduledArrival = new Date(p.predictedArrival.getTime() + cumRestMs);
    cumRestMs += p.restMinutes * 60_000;
  }

  return projections;
}

/**
 * Full CP arrival projection. Three tiers, in priority order:
 *  1. GPS / mock pace (currentPaceKmH > 0) — simulate from (currentKm, now).
 *  2. Check-in pace — average pace from the last departed CP; simulate from there.
 *  3. Provisional — the fixed 26h target plan (before any progress data).
 */
export function calcFullProjection(
  currentKm: number,
  currentPaceKmH: number,
  checkpoints: Checkpoint[],
  startDate: Date,
  targetHours: number,
  departedCpKms: number[] = [],
  now: Date = new Date(),
  checkInAnchor: CheckInAnchor | null = null
): CPProjection[] {
  const remainingCps = checkpoints.filter(
    (cp) => cp.km > currentKm && !departedCpKms.includes(cp.km)
  );
  if (remainingCps.length === 0) return [];

  // Tier 1: measured GPS pace (or debug mock pace).
  if (currentPaceKmH > 0) {
    const basePaceKmH = currentPaceKmH * fatigueFactor(currentKm);
    return simulateFromAnchor(
      currentKm,
      now.getTime(),
      basePaceKmH,
      remainingCps,
      startDate,
      targetHours
    );
  }

  // Tier 2: pace derived from actual check-in progress.
  if (checkInAnchor) {
    const elapsedH =
      (checkInAnchor.departedAtMs - startDate.getTime()) / 3_600_000;
    const observedPace = checkInAnchor.km / elapsedH;
    if (elapsedH > 0 && Number.isFinite(observedPace) && observedPace > 0) {
      const basePaceKmH = observedPace * fatigueFactor(checkInAnchor.km);
      return simulateFromAnchor(
        checkInAnchor.km,
        checkInAnchor.departedAtMs,
        basePaceKmH,
        remainingCps,
        startDate,
        targetHours
      );
    }
  }

  // Tier 3: provisional 26h target plan — visible from the start of the walk.
  const planned: CPProjection[] = remainingCps.map((cp) => {
    const targetArrival = new Date(
      startDate.getTime() + (cp.km / 100) * targetHours * 3600 * 1000
    );
    const vsCutoffMin = (cp.cutoff.getTime() - targetArrival.getTime()) / 60000;
    return {
      cp,
      targetArrival,
      predictedArrival: targetArrival,
      scheduledArrival: targetArrival,
      restMinutes: 0,
      vsTargetMin: 0,
      vsCutoffMin,
      willMissTarget: false,
      willMissCutoff: vsCutoffMin < 0,
    };
  });
  allocateRest(planned, PROVISIONAL_REST_BUDGET_MIN);
  return planned;
}
