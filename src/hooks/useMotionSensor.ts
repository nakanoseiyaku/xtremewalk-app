import { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { subscribeNativeSteps } from '../services/stepProvider';

export interface MotionState {
  isWalking: boolean | null; // null = sensor unavailable or still sampling
  isAvailable: boolean;
  stepCount: number;
  cadence: number | null; // steps/min, null = insufficient data
}

// Acceleration magnitude standard deviation thresholds (m/s²)
const WALK_THRESHOLD = 1.2;
const STOP_THRESHOLD = 0.4;
const DEBOUNCE_MS = 15_000;
const SAMPLE_INTERVAL_MS = 5_000;
const MAX_BUFFER = 300; // ~5s at 60Hz

// Step detection — gravity-subtracted dynamic acceleration with hysteresis
const GRAVITY_LPF_ALPHA = 0.1; // slow LPF estimates the gravity baseline (~9.8 m/s²)
const STEP_EMA_ALPHA = 0.6; // light smoothing on dynamic accel — preserves step peaks
const DYNAMIC_STEP_THRESHOLD = 1.1; // m/s² of dynamic accel — rising edge = one step
const DYNAMIC_STEP_RESET = 0.3; // hysteresis: dynamic must fall below this to arm the next step
const MIN_STEP_INTERVAL_MS = 300; // min 300ms between steps (max ~200 steps/min)
const CADENCE_WINDOW_MS = 60_000; // rolling 60s window for cadence

export function useMotionSensor(): MotionState {
  const [state, setState] = useState<MotionState>({
    isWalking: null,
    isAvailable: false,
    stepCount: 0,
    cadence: null,
  });

  const bufferRef = useRef<number[]>([]);
  const pendingStateRef = useRef<boolean | null>(null);
  const pendingChangedAtRef = useRef<number>(0);
  const committedStateRef = useRef<boolean | null>(null);

  // Step detection state
  const gravityRef = useRef<number>(9.8); // running gravity-baseline estimate
  const smoothedDynRef = useRef<number>(0); // smoothed dynamic (gravity-removed) accel
  const stepArmedRef = useRef<boolean>(true); // hysteresis: ready to count the next step
  const lastStepTimeRef = useRef<number>(0);
  const stepTimestampsRef = useRef<number[]>([]);
  const stepCountRef = useRef<number>(0);

  useEffect(() => {
    // Native: read the hardware step counter, which keeps counting with the
    // screen off. Web: fall back to the devicemotion accelerometer below.
    if (Capacitor.isNativePlatform()) {
      return subscribeNativeSteps(setState);
    }

    if (!('DeviceMotionEvent' in window)) return;

    setState((s) => ({ ...s, isAvailable: true }));

    const handleMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x === null || a.y === null || a.z === null) return;

      const mag = Math.sqrt((a.x ?? 0) ** 2 + (a.y ?? 0) ** 2 + (a.z ?? 0) ** 2);

      // Slow low-pass estimates the gravity baseline (~9.8 m/s²). Subtracting it
      // leaves only the dynamic acceleration produced by each footfall.
      gravityRef.current =
        (1 - GRAVITY_LPF_ALPHA) * gravityRef.current + GRAVITY_LPF_ALPHA * mag;
      const dynamic = mag - gravityRef.current;

      // Light EMA: just enough to suppress sensor noise without flattening the
      // step peaks (the old α=0.3 over-smoothed them below the threshold).
      smoothedDynRef.current =
        (1 - STEP_EMA_ALPHA) * smoothedDynRef.current + STEP_EMA_ALPHA * dynamic;

      // Step detection with hysteresis: count once when the dynamic signal rises
      // past the threshold, then disarm until it falls back near baseline — this
      // prevents a single footfall from registering as several steps.
      const now = Date.now();
      if (
        stepArmedRef.current &&
        smoothedDynRef.current >= DYNAMIC_STEP_THRESHOLD &&
        now - lastStepTimeRef.current >= MIN_STEP_INTERVAL_MS
      ) {
        stepArmedRef.current = false;
        lastStepTimeRef.current = now;
        stepCountRef.current += 1;
        stepTimestampsRef.current.push(now);
        // Trim to cadence window
        stepTimestampsRef.current = stepTimestampsRef.current.filter(
          (t) => now - t <= CADENCE_WINDOW_MS
        );
      } else if (
        !stepArmedRef.current &&
        smoothedDynRef.current <= DYNAMIC_STEP_RESET
      ) {
        stepArmedRef.current = true;
      }

      // Buffer for walking/stopped classification
      bufferRef.current.push(mag);
      if (bufferRef.current.length > MAX_BUFFER) {
        bufferRef.current.shift();
      }
    };

    window.addEventListener('devicemotion', handleMotion);

    const classify = setInterval(() => {
      const buf = bufferRef.current;
      const now = Date.now();

      // Cadence: steps in last 60s / elapsed fraction
      const recentSteps = stepTimestampsRef.current.filter(
        (t) => now - t <= CADENCE_WINDOW_MS
      );
      const oldestStep = recentSteps[0];
      const elapsedSec = oldestStep ? (now - oldestStep) / 1000 : null;
      const cadence =
        recentSteps.length >= 5 && elapsedSec && elapsedSec >= 10
          ? Math.round((recentSteps.length / elapsedSec) * 60)
          : null;

      // Walking / stopped classification (unchanged)
      if (buf.length >= 30) {
        const mean = buf.reduce((s, v) => s + v, 0) / buf.length;
        const variance = buf.reduce((s, v) => s + (v - mean) ** 2, 0) / buf.length;
        const stdDev = Math.sqrt(variance);

        let candidate: boolean | null;
        if (stdDev > WALK_THRESHOLD) candidate = true;
        else if (stdDev < STOP_THRESHOLD) candidate = false;
        else candidate = committedStateRef.current;

        if (candidate !== pendingStateRef.current) {
          pendingStateRef.current = candidate;
          pendingChangedAtRef.current = now;
        } else if (now - pendingChangedAtRef.current >= DEBOUNCE_MS) {
          if (candidate !== committedStateRef.current) {
            committedStateRef.current = candidate;
          }
        }
      }

      setState({
        isWalking: committedStateRef.current,
        isAvailable: true,
        stepCount: stepCountRef.current,
        cadence,
      });
    }, SAMPLE_INTERVAL_MS);

    return () => {
      window.removeEventListener('devicemotion', handleMotion);
      clearInterval(classify);
    };
  }, []);

  return state;
}
