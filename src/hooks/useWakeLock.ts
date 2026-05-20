import { useState, useEffect, useRef, useCallback } from 'react';

export type WakeLockStatus = 'active' | 'inactive' | 'unsupported';

export interface WakeLockState {
  status: WakeLockStatus;
  acquire: () => Promise<void>;
  release: () => Promise<void>;
}

export function useWakeLock(): WakeLockState {
  const [status, setStatus] = useState<WakeLockStatus>('inactive');
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const isSupported =
    typeof navigator !== 'undefined' && 'wakeLock' in navigator;

  const acquire = useCallback(async () => {
    if (!isSupported) {
      setStatus('unsupported');
      return;
    }
    try {
      wakeLockRef.current = await (navigator as Navigator & { wakeLock: { request: (type: string) => Promise<WakeLockSentinel> } }).wakeLock.request('screen');
      setStatus('active');
      wakeLockRef.current.addEventListener('release', () => {
        setStatus('inactive');
        wakeLockRef.current = null;
      });
    } catch {
      setStatus('inactive');
    }
  }, [isSupported]);

  const release = useCallback(async () => {
    if (wakeLockRef.current) {
      await wakeLockRef.current.release();
      wakeLockRef.current = null;
      setStatus('inactive');
    }
  }, []);

  // Re-acquire on visibility change (critical for Android)
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && wakeLockRef.current === null && status === 'active') {
        acquire();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [acquire, status]);

  // Auto-acquire on mount
  useEffect(() => {
    acquire();
    return () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { status, acquire, release };
}
