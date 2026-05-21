import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import type { MotionState } from '../hooks/useMotionSensor';
import { loadStepCount, saveStepCount } from '../utils/storage';

interface StepData {
  steps: number;
}

/**
 * Native hardware step counter (Android `Sensor.TYPE_STEP_COUNTER`). The sensor
 * keeps counting with the screen off and even while the app is killed; the
 * plugin returns a race-relative count using a persisted baseline.
 */
interface XwalkPedometerPlugin {
  start(): Promise<StepData>;
  stop(): Promise<void>;
  getSteps(): Promise<StepData>;
  resetBaseline(): Promise<StepData>;
  requestPermissions(): Promise<{ activity: string }>;
  checkPermissions(): Promise<{ activity: string }>;
  addListener(
    eventName: 'steps',
    listener: (data: StepData) => void,
  ): Promise<PluginListenerHandle>;
}

const XwalkPedometer = registerPlugin<XwalkPedometerPlugin>('XwalkPedometer');

/** Reset the race step count to zero. Call when a new race starts. No-op on web. */
export async function resetStepBaseline(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await XwalkPedometer.resetBaseline();
    saveStepCount(0);
  } catch {
    // plugin unavailable — ignore
  }
}

/**
 * Subscribe to the native hardware step counter. Cadence and walking state are
 * derived from the cumulative step stream so the returned `MotionState` matches
 * the web accelerometer path. Returns a cleanup function.
 */
export function subscribeNativeSteps(
  onState: (state: MotionState) => void,
): () => void {
  const history: { steps: number; ts: number }[] = [];
  let currentSteps = 0;
  // Offset added to the raw plugin count when a sensor reset is detected
  // (e.g. after a battery-death reboot). Allows the displayed total to
  // continue from where it left off rather than restarting from 0.
  let stepOffset = 0;
  let lastIncreaseTs = 0;
  let ready = false;
  let cleanedUp = false;
  let stepsHandle: PluginListenerHandle | null = null;
  let resumeHandle: PluginListenerHandle | null = null;

  const emit = () => {
    if (!ready) return;
    const now = Date.now();
    // Cadence: steps accumulated across the oldest sample still in the ~60s window.
    let cadence: number | null = null;
    const oldest = history[0];
    if (oldest && now - oldest.ts >= 10_000) {
      const elapsedMin = (now - oldest.ts) / 60_000;
      const delta = currentSteps - oldest.steps;
      if (delta >= 5) cadence = Math.round(delta / elapsedMin);
    }
    onState({
      isWalking: now - lastIncreaseTs <= 8_000,
      isAvailable: true,
      stepCount: currentSteps,
      cadence,
    });
  };

  const applySteps = (rawSteps: number) => {
    const steps = stepOffset + rawSteps;
    if (steps > currentSteps) lastIncreaseTs = Date.now();
    currentSteps = steps;
    emit();
  };

  // Snapshot the cumulative count every 5s — gives cadence its rolling window,
  // lets `isWalking` drop back to false when the user stops, and persists the
  // count so it survives battery-death reboots.
  const sample = setInterval(() => {
    const now = Date.now();
    history.push({ steps: currentSteps, ts: now });
    while (history.length > 2 && now - history[0].ts > 75_000) history.shift();
    saveStepCount(currentSteps);
    emit();
  }, 5_000);

  void (async () => {
    try {
      await XwalkPedometer.requestPermissions();
    } catch {
      // permission UX is handled separately; let start() try regardless
    }
    if (cleanedUp) return;
    let initial: StepData;
    try {
      initial = await XwalkPedometer.start();
    } catch {
      onState({ isWalking: null, isAvailable: false, stepCount: 0, cadence: null });
      return;
    }
    if (cleanedUp) {
      XwalkPedometer.stop().catch(() => {});
      return;
    }
    ready = true;
    const rawInitial = initial.steps ?? 0;
    const saved = loadStepCount();
    // If the plugin reports fewer steps than we last saved, the hardware
    // sensor was reset (battery died → phone rebooted). Use the saved total
    // as an offset so the count continues from where it left off.
    if (rawInitial < saved) {
      stepOffset = saved;
    }
    applySteps(rawInitial);
    stepsHandle = await XwalkPedometer.addListener('steps', (d) => applySteps(d.steps));
    // The hardware counter keeps running while the app is frozen — re-read it on
    // resume so any steps taken in the background are recovered immediately.
    resumeHandle = await App.addListener('resume', () => {
      XwalkPedometer.getSteps()
        .then((d) => applySteps(d.steps))
        .catch(() => {});
    });
  })();

  return () => {
    cleanedUp = true;
    clearInterval(sample);
    void stepsHandle?.remove();
    void resumeHandle?.remove();
    XwalkPedometer.stop().catch(() => {});
  };
}
