import { useState, useEffect, useRef } from 'react';

export interface MotionState {
  isWalking: boolean | null; // null = sensor unavailable or still sampling
  isAvailable: boolean;
}

// Acceleration magnitude standard deviation thresholds (m/s²)
// Walking produces ~1-4 Hz oscillation; standing still is near-zero variance
const WALK_THRESHOLD = 1.2;
const STOP_THRESHOLD = 0.4;
const DEBOUNCE_MS = 15_000; // must hold state for 15s before committing
const SAMPLE_INTERVAL_MS = 5_000;
const MAX_BUFFER = 300; // ~5 s at 60 Hz

export function useMotionSensor(): MotionState {
  const [state, setState] = useState<MotionState>({ isWalking: null, isAvailable: false });
  const bufferRef = useRef<number[]>([]);
  const pendingStateRef = useRef<boolean | null>(null);
  const pendingChangedAtRef = useRef<number>(0);
  const committedStateRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!('DeviceMotionEvent' in window)) return;

    setState((s) => ({ ...s, isAvailable: true }));

    const handleMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x === null || a.y === null || a.z === null) return;
      const mag = Math.sqrt((a.x ?? 0) ** 2 + (a.y ?? 0) ** 2 + (a.z ?? 0) ** 2);
      bufferRef.current.push(mag);
      if (bufferRef.current.length > MAX_BUFFER) {
        bufferRef.current.shift();
      }
    };

    window.addEventListener('devicemotion', handleMotion);

    const classify = setInterval(() => {
      const buf = bufferRef.current;
      if (buf.length < 30) return;

      const mean = buf.reduce((s, v) => s + v, 0) / buf.length;
      const variance = buf.reduce((s, v) => s + (v - mean) ** 2, 0) / buf.length;
      const stdDev = Math.sqrt(variance);

      let candidate: boolean | null;
      if (stdDev > WALK_THRESHOLD) candidate = true;
      else if (stdDev < STOP_THRESHOLD) candidate = false;
      else candidate = committedStateRef.current; // ambiguous: keep current

      const now = Date.now();
      if (candidate !== pendingStateRef.current) {
        pendingStateRef.current = candidate;
        pendingChangedAtRef.current = now;
      } else if (now - pendingChangedAtRef.current >= DEBOUNCE_MS) {
        if (candidate !== committedStateRef.current) {
          committedStateRef.current = candidate;
          setState((s) => ({ ...s, isWalking: candidate }));
        }
      }
    }, SAMPLE_INTERVAL_MS);

    return () => {
      window.removeEventListener('devicemotion', handleMotion);
      clearInterval(classify);
    };
  }, []);

  return state;
}
