import { useState, useEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { findNearestKm, computeBearing, haversineDistance } from '../utils/gps';
import type { KmPoint, LatLng } from '../utils/gps';
import { startLocationWatch } from '../services/locationProvider';
import type { LocationFix, LocationError, LocationWatch } from '../services/locationProvider';

export type GPSStatus = 'inactive' | 'active' | 'degraded' | 'lost' | 'permission_denied';

export interface GPSState {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  currentKm: number;
  walkedKm: number; // cumulative GPS distance actually walked this race
  speed: number | null; // m/s
  bearing: number | null;
  status: GPSStatus;
  lastUpdate: Date | null;
  kmIndex: number | null;
}

const MOCK_KM_PARAM = 'mock_km';

function getMockKm(): number | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const val = params.get(MOCK_KM_PARAM);
  if (val === null) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

export function useGPS(
  kmPoints: KmPoint[],
  externalMockKm?: number | null,
  isRaceActive = false,
  watchEnabled = false,
): GPSState {
  // Mock km: prefer external (from debug panel) → URL param → null
  const initialMockKm = externalMockKm ?? getMockKm();

  const [state, setState] = useState<GPSState>({
    lat: null,
    lng: null,
    accuracy: null,
    currentKm: initialMockKm ?? 0,
    walkedKm: 0,
    speed: null,
    bearing: null,
    status: initialMockKm !== null ? 'active' : 'inactive',
    lastUpdate: initialMockKm !== null ? new Date() : null,
    kmIndex: null,
  });

  // Latest isRaceActive, read inside the GPS callback without making it a
  // dependency — keeps handlePosition stable so the watch is not torn down and
  // GPS is not cold-restarted when the race begins. Synced in the effect below.
  const isRaceActiveRef = useRef(isRaceActive);

  const prevPositionRef = useRef<LatLng | null>(null);
  const prevKmIndexRef = useRef<number | null>(null);
  const prevKmRef = useRef<number>(0);
  const lastStateUpdateRef = useRef<number>(0);
  const lostTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sliding window for km smoothing (last 3 valid readings)
  const kmWindowRef = useRef<number[]>([]);

  // Sliding window for km-5min-ago tracking
  const km5minWindowRef = useRef<Array<{ km: number; ts: number }>>([]);

  // Time of last accepted GPS reading — used for forward-jump speed limiting.
  // Initialized to 0 (= "never accepted"). Reset to Date.now() when race becomes active.
  const lastAcceptedTimeRef = useRef<number>(0);

  // False until the first trustworthy fix of a race has been adopted as the
  // start position. The forward-jump guard is bypassed for that first fix.
  const hasInitialFixRef = useRef<boolean>(false);

  // Cumulative distance actually walked this race, in metres (sum of GPS
  // segments). Independent of course position — advances anywhere.
  const walkedMetersRef = useRef<number>(0);

  // When race becomes active, reset km tracking so GPS can't teleport from home to
  // wherever the route happens to pass near the user's location.
  useEffect(() => {
    isRaceActiveRef.current = isRaceActive;
    if (isRaceActive) {
      lastAcceptedTimeRef.current = Date.now();
      prevKmRef.current = 0;
      kmWindowRef.current = [];
      prevKmIndexRef.current = null;
      hasInitialFixRef.current = false;
      walkedMetersRef.current = 0;
    }
  }, [isRaceActive]);

  const handlePosition = useCallback(
    (fix: LocationFix) => {
      const { lat: latitude, lng: longitude, accuracy } = fix;

      // Display sanity check only: drop non-finite or absurd fixes (>2km accuracy).
      // This is NOT the km-tracking gate — degraded indoor fixes still pass through
      // so the map can always show the user's position.
      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        !Number.isFinite(accuracy) ||
        accuracy > 2000
      ) {
        return;
      }

      // Compute bearing from consecutive positions (NOT GeolocationCoordinates.heading which fails at walking speed)
      let bearing: number | null = null;
      const currentPos: LatLng = { lat: latitude, lng: longitude };

      if (prevPositionRef.current) {
        bearing = computeBearing(prevPositionRef.current, currentPos);
      }

      const nativeSpeed = fix.speed;

      // km-tracking gates — these gate the km computation only, NOT the displayed
      // position. A stationary or low-accuracy reading still updates lat/lng.
      const isStationary = nativeSpeed !== null && nativeSpeed < 0.5;
      const accuracyOk = accuracy <= 50;
      const kmTrackable = accuracyOk && !isStationary;

      // Only compute km position when the race is active and the reading is
      // trustworthy for km tracking. Otherwise smoothedKm stays at prevKmRef.
      // The first fix only needs good accuracy (movement not required) so the
      // start position is adopted immediately.
      let smoothedKm = prevKmRef.current;
      if (isRaceActiveRef.current && (kmTrackable || (!hasInitialFixRef.current && accuracyOk))) {
        const nearest = findNearestKm(currentPos, kmPoints, prevKmIndexRef.current);
        const nowMs = Date.now();

        if (!hasInitialFixRef.current) {
          // First trustworthy fix of the race: adopt the runner's actual
          // position on the course as the starting km. Without this the
          // forward-jump guard below pins currentKm at 0 forever whenever the
          // start point isn't course km 0 (e.g. test walks, or starting the
          // race anywhere other than the official start line).
          hasInitialFixRef.current = true;
          lastAcceptedTimeRef.current = nowMs;
          kmWindowRef.current = [nearest.km];
          smoothedKm = nearest.km;
          prevKmIndexRef.current = nearest.index;
          prevKmRef.current = nearest.km;
        } else {
          // Forward-jump speed limit: the km reading cannot advance more than
          // (time elapsed × 10 km/h) in one step, with a 2 km minimum tolerance.
          // This prevents GPS noise from teleporting the runner mid-race.
          const elapsedHours =
            lastAcceptedTimeRef.current > 0
              ? (nowMs - lastAcceptedTimeRef.current) / 3600000
              : 0;
          const maxForwardKm = Math.max(2.0, elapsedHours * 10);

          const forwardJump = nearest.km > prevKmRef.current + maxForwardKm;
          // km rollback prevention: if new_km < prev_km - 0.5
          const rollback = nearest.km < prevKmRef.current - 0.5;

          // Forward-jump / rollback: skip the km update only — do NOT drop the
          // position. smoothedKm remains prevKmRef.current.
          if (!forwardJump && !rollback) {
            // Accept this reading
            lastAcceptedTimeRef.current = nowMs;

            // Smoothing: average of last 3 valid km readings
            kmWindowRef.current.push(nearest.km);
            if (kmWindowRef.current.length > 3) kmWindowRef.current.shift();
            smoothedKm =
              kmWindowRef.current.reduce((a, b) => a + b, 0) /
              kmWindowRef.current.length;

            prevKmIndexRef.current = nearest.index;
            prevKmRef.current = smoothedKm;
          }
        }
      }

      // Cumulative distance actually walked — sums GPS segments so it advances
      // anywhere, even off the course. Uses the same trust gate as km tracking.
      if (prevPositionRef.current && kmTrackable) {
        const segMeters = haversineDistance(prevPositionRef.current, currentPos);
        if (segMeters >= 2 && segMeters <= 250) {
          walkedMetersRef.current += segMeters;
        }
      }

      prevPositionRef.current = currentPos;

      // Track km-5min-ago
      const now = Date.now();
      km5minWindowRef.current.push({ km: smoothedKm, ts: now });
      // Keep only last 10 minutes of data
      km5minWindowRef.current = km5minWindowRef.current.filter(
        (e) => now - e.ts < 10 * 60 * 1000
      );

      // React throttle: max 1 state update per 3000ms
      if (now - lastStateUpdateRef.current < 3000) return;
      lastStateUpdateRef.current = now;

      // Reset lost timer
      if (lostTimerRef.current) clearTimeout(lostTimerRef.current);
      lostTimerRef.current = setTimeout(() => {
        setState((prev) => ({ ...prev, status: 'lost' }));
      }, 5 * 60 * 1000);

      // Always publish the latest fix's display fields.
      setState({
        lat: latitude,
        lng: longitude,
        accuracy,
        currentKm: smoothedKm,
        walkedKm: walkedMetersRef.current / 1000,
        speed: nativeSpeed,
        bearing,
        status: accuracy <= 20 ? 'active' : 'degraded',
        lastUpdate: new Date(fix.timestamp),
        kmIndex: prevKmIndexRef.current,
      });
    },
    [kmPoints]
  );

  const handleError = useCallback((error: LocationError) => {
    setState((prev) => ({
      ...prev,
      status: error === 'denied' ? 'permission_denied' : 'degraded',
    }));
  }, []);

  // When external mock km changes (from debug panel slider), update state directly
  useEffect(() => {
    if (externalMockKm == null) return;
    setState(prev => ({ ...prev, currentKm: externalMockKm, status: 'active', lastUpdate: new Date() }));
  }, [externalMockKm]);

  useEffect(() => {
    // If mock mode, skip real GPS
    if (initialMockKm !== null) return;
    // Native: start GPS from the pre-start screen onward (watchEnabled) so it is
    // already warm with a fix by the time the race begins. Web watches from mount.
    if (Capacitor.isNativePlatform() && !watchEnabled) return;

    let watch: LocationWatch | null = null;
    let cancelled = false;

    void startLocationWatch(handlePosition, handleError).then((w) => {
      if (cancelled) w.stop();
      else watch = w;
    });

    return () => {
      cancelled = true;
      watch?.stop();
      if (lostTimerRef.current) clearTimeout(lostTimerRef.current);
    };
  }, [handlePosition, handleError, initialMockKm, watchEnabled]);

  return state;
}

/**
 * Get the km reading from 5 minutes ago for pace calculation
 * This is exported so components can call it
 */
export function getKm5MinAgo(
  kmWindow: Array<{ km: number; ts: number }>,
  now: number = Date.now()
): number | null {
  const fiveMinAgo = now - 5 * 60 * 1000;
  // Find the reading closest to 5 minutes ago
  const candidates = kmWindow.filter((e) => e.ts <= fiveMinAgo);
  if (candidates.length === 0) return null;
  return candidates[candidates.length - 1].km;
}
