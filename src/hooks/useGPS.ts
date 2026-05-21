import { useState, useEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { findNearestKm, computeBearing } from '../utils/gps';
import type { KmPoint, LatLng } from '../utils/gps';
import { startLocationWatch } from '../services/locationProvider';
import type { LocationFix, LocationError, LocationWatch } from '../services/locationProvider';

export type GPSStatus = 'inactive' | 'active' | 'degraded' | 'lost' | 'permission_denied';

export interface GPSState {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  currentKm: number;
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

export function useGPS(kmPoints: KmPoint[], externalMockKm?: number | null, isRaceActive = false): GPSState {
  // Mock km: prefer external (from debug panel) → URL param → null
  const initialMockKm = externalMockKm ?? getMockKm();

  const [state, setState] = useState<GPSState>({
    lat: null,
    lng: null,
    accuracy: null,
    currentKm: initialMockKm ?? 0,
    speed: null,
    bearing: null,
    status: initialMockKm !== null ? 'active' : 'inactive',
    lastUpdate: initialMockKm !== null ? new Date() : null,
    kmIndex: null,
  });

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

  // When race becomes active, reset km tracking so GPS can't teleport from home to
  // wherever the route happens to pass near the user's location.
  useEffect(() => {
    if (isRaceActive) {
      lastAcceptedTimeRef.current = Date.now();
      prevKmRef.current = 0;
      kmWindowRef.current = [];
      prevKmIndexRef.current = null;
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
      const kmTrackable = accuracy <= 50 && !isStationary;

      // Only compute km position when the race is active and the reading is
      // trustworthy for km tracking. Otherwise smoothedKm stays at prevKmRef.
      let smoothedKm = prevKmRef.current;
      if (isRaceActive && kmTrackable) {
        const nearest = findNearestKm(currentPos, kmPoints, prevKmIndexRef.current);

        // Forward-jump speed limit: the km reading cannot advance more than
        // (time elapsed × 10 km/h) in one step, with a 2 km minimum tolerance
        // for GPS inaccuracy near the course start.
        // This prevents a user at home (e.g. 76 km on the route) from instantly
        // jumping to 76 km when the app starts.
        const nowMs = Date.now();
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
        speed: nativeSpeed,
        bearing,
        status: accuracy <= 20 ? 'active' : 'degraded',
        lastUpdate: new Date(fix.timestamp),
        kmIndex: prevKmIndexRef.current,
      });
    },
    [isRaceActive, kmPoints]  // isRaceActive added to fix stale-closure bug
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
    // Native: the background-geolocation foreground service shows a persistent
    // notification, so only run it during the race. Web watches from mount as before.
    if (Capacitor.isNativePlatform() && !isRaceActive) return;

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
  }, [handlePosition, handleError, initialMockKm, isRaceActive]);

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
