import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';

// Keeps an AudioContext running while the race is active.
// Chrome treats tabs with an active AudioContext as "audio-producing" and
// avoids throttling them when they go to the background — preventing the
// GPS watchPosition from slowing or stopping when the user switches to
// YouTube Music or another app.
export function useGPSKeepalive(active: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    // Native builds keep GPS alive via a foreground service — the silent
    // AudioContext anti-throttling trick is a web-only workaround.
    if (Capacitor.isNativePlatform()) return;

    if (!active) {
      ctxRef.current?.close();
      ctxRef.current = null;
      return;
    }

    try {
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      gain.gain.value = 0.001; // near-silent, below audible threshold
      const osc = ctx.createOscillator();
      osc.frequency.value = 1; // 1 Hz — inaudible to humans
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      ctxRef.current = ctx;
    } catch {
      // iOS Safari requires a user gesture to create AudioContext — skip silently
    }

    const onVisibilityChange = () => {
      if (ctxRef.current?.state === 'suspended') {
        ctxRef.current.resume().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, [active]);
}
