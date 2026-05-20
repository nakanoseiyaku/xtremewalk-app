import { useState, useEffect, useRef, useCallback } from 'react';
import { findNearestKm, computeBearing } from '../utils/gps';
import type { KmPoint, LatLng } from '../utils/gps';

export type GPSStatus = 'inactive' | 'active' | 'degraded' | 'lost';

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

  const handlePosition = useCallback(
    (pos: GeolocationPosition) => {
      const { latitude, longitude, accuracy } = pos.coords;

      // Filter: skip if accuracy > 50m
      if (accuracy > 50) return;

      // Compute bearing from consecutive positions (NOT GeolocationCoordinates.heading which fails at walking speed)
      let bearing: number | null = null;
      const currentPos: LatLng = { lat: latitude, lng: longitude };

      if (prevPositionRef.current) {
        bearing = computeBearing(prevPositionRef.current, currentPos);
      }

      // Filter: skip if speed < 0.5m/s (nearly stationary noise)
      const nativeSpeed = pos.coords.speed;
      if (nativeSpeed !== null && nativeSpeed < 0.5) {
        prevPositionRef.current = currentPos;
        return;
      }

      // Only compute km position when the race is active.
      // Before the race starts the user's home GPS may coincidentally map
      // to a non-zero km point on the course — this prevents that confusion.
      let smoothedKm = prevKmRef.current;
      if (isRaceActive) {
        const nearest = findNearestKm(currentPos, kmPoints, prevKmIndexRef.current);

        // km rollback prevention: if new_km < prev_km - 0.5, skip
        if (nearest.km < prevKmRef.current - 0.5) {
          prevPositionRef.current = currentPos;
          return;
        }

        // Smoothing: average of last 3 valid km readings
        kmWindowRef.current.push(nearest.km);
        if (kmWindowRef.current.length > 3) kmWindowRef.current.shift();
        smoothedKm =
          kmWindowRef.current.reduce((a, b) => a + b, 0) /
          kmWindowRef.current.length;

        prevKmIndexRef.current = nearest.index;
        prevKmRef.current = smoothedKm;
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

      setState({
        lat: latitude,
        lng: longitude,
        accuracy,
        currentKm: smoothedKm,
        speed: nativeSpeed,
        bearing,
        status: accuracy <= 20 ? 'active' : 'degraded',
        lastUpdate: new Date(pos.timestamp),
        kmIndex: prevKmIndexRef.current,
      });
    },
    [kmPoints]
  );

  const handleError = useCallback(() => {
    setState((prev) => ({ ...prev, status: 'degraded' }));
  }, []);

  // When external mock km changes (from debug panel slider), update state directly
  useEffect(() => {
    if (externalMockKm == null) return;
    setState(prev => ({ ...prev, currentKm: externalMockKm, status: 'active', lastUpdate: new Date() }));
  }, [externalMockKm]);

  useEffect(() => {
    // If mock mode, skip real GPS
    if (initialMockKm !== null) return;
    if (!navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      handlePosition,
      handleError,
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 3000,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
      if (lostTimerRef.current) clearTimeout(lostTimerRef.current);
    };
  }, [handlePosition, handleError]);

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
