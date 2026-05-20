import { useState, useEffect, useRef, useCallback } from 'react';

// Auto-sleep after 3 minutes of no interaction.
// Wake Lock is NOT released — GPS continues on Android Chrome.
// Only the visual content is hidden behind a near-black AMOLED overlay.
// AMOLED black pixels consume ~0mW vs bright UI's 300-400mW.
const AUTO_SLEEP_MS = 3 * 60 * 1000;

export interface ScreenSleepState {
  isSleeping: boolean;
  wakeFor: (ms?: number) => void;
  sleep: () => void;
}

export function useScreenSleep(isCharging: boolean): ScreenSleepState {
  const [isSleeping, setIsSleeping] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isChargingRef = useRef(isCharging);
  isChargingRef.current = isCharging;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleAutoSleep = useCallback((delay = AUTO_SLEEP_MS) => {
    clearTimer();
    timerRef.current = setTimeout(() => setIsSleeping(true), delay);
  }, [clearTimer]);

  const wakeFor = useCallback((ms = 30_000) => {
    setIsSleeping(false);
    if (!isChargingRef.current) {
      scheduleAutoSleep(ms);
    }
  }, [scheduleAutoSleep]);

  const sleep = useCallback(() => {
    clearTimer();
    setIsSleeping(true);
  }, [clearTimer]);

  // When charging starts: stay awake indefinitely.
  // When unplugged: restart the 3-min auto-sleep countdown.
  useEffect(() => {
    if (isCharging) {
      clearTimer();
      setIsSleeping(false);
    } else {
      scheduleAutoSleep();
    }
  }, [isCharging, clearTimer, scheduleAutoSleep]);

  // Any touch/click resets the auto-sleep countdown and wakes the screen.
  useEffect(() => {
    const onInteraction = () => {
      if (isChargingRef.current) return;
      setIsSleeping(false);
      scheduleAutoSleep();
    };
    document.addEventListener('touchstart', onInteraction, { passive: true });
    document.addEventListener('mousedown', onInteraction, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onInteraction);
      document.removeEventListener('mousedown', onInteraction);
      clearTimer();
    };
  }, [scheduleAutoSleep, clearTimer]);

  return { isSleeping, wakeFor, sleep };
}
