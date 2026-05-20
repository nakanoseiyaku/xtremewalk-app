import { useState, useEffect, useRef, useCallback } from 'react';
import { isNightMode } from '../constants/colors';

export type DeadmanState = 'idle' | 'prompt' | 'rest' | 'sos';

export interface DeadmanStatus {
  state: DeadmanState;
  missedCount: number;
  confirm: () => void;
  startRest: () => void;
  endRest: () => void;
  dismiss: () => void;
}

const DAY_INTERVAL_MS = 45 * 60 * 1000;
const NIGHT_INTERVAL_MS = 25 * 60 * 1000;
const MAX_MISSES = 3;

export function useDeadman(active: boolean): DeadmanStatus {
  const [state, setState] = useState<DeadmanState>('idle');
  const [missedCount, setMissedCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRestRef = useRef(false);

  const getInterval = () =>
    isNightMode() ? NIGHT_INTERVAL_MS : DAY_INTERVAL_MS;

  const scheduleNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (isRestRef.current) {
        // In rest mode, just reschedule
        scheduleNext();
        return;
      }
      setState('prompt');
    }, getInterval());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!active) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setState('idle');
      return;
    }
    scheduleNext();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [active, scheduleNext]);

  const confirm = useCallback(() => {
    setState('idle');
    setMissedCount(0);
    scheduleNext();
  }, [scheduleNext]);

  const startRest = useCallback(() => {
    isRestRef.current = true;
    setState('rest');
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const endRest = useCallback(() => {
    isRestRef.current = false;
    setState('idle');
    scheduleNext();
  }, [scheduleNext]);

  const dismiss = useCallback(() => {
    // Missed: increment counter
    setMissedCount((prev) => {
      const next = prev + 1;
      if (next >= MAX_MISSES) {
        setState('sos');
      } else {
        setState('idle');
        scheduleNext();
      }
      return next;
    });
  }, [scheduleNext]);

  return { state, missedCount, confirm, startRest, endRest, dismiss };
}
