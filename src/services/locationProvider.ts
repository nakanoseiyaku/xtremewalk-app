import { Capacitor } from '@capacitor/core';
import { BackgroundGeolocation } from '@capgo/background-geolocation';

/**
 * A single normalized location reading. Produced by both the native
 * background-geolocation plugin and the browser Geolocation API so the rest of
 * the app never has to know which platform supplied it.
 */
export interface LocationFix {
  lat: number;
  lng: number;
  accuracy: number;
  speed: number | null;
  timestamp: number;
}

export type LocationError = 'denied' | 'unavailable';

export interface LocationWatch {
  stop: () => void;
}

const NATIVE_START_OPTIONS = {
  backgroundTitle: '東京エクストリームウォーク100 計測中',
  backgroundMessage: 'GPSと歩数を記録しています',
  requestPermissions: true,
  stale: false,
  distanceFilter: 5,
};

/**
 * Start receiving location updates.
 *
 * Native: a foreground service keeps GPS running with the screen off or the app
 * backgrounded (a persistent notification is shown). Web: falls back to
 * `geolocation.watchPosition`, which the browser suspends when the screen locks.
 *
 * The returned promise never rejects — delivery failures arrive via `onError`.
 */
export async function startLocationWatch(
  onFix: (fix: LocationFix) => void,
  onError: (error: LocationError) => void,
): Promise<LocationWatch> {
  if (Capacitor.isNativePlatform()) {
    try {
      await BackgroundGeolocation.start(NATIVE_START_OPTIONS, (location, error) => {
        if (error) {
          const code = (error.code ?? '').toUpperCase();
          onError(
            code.includes('PERMISSION') || code.includes('AUTHORIZ')
              ? 'denied'
              : 'unavailable',
          );
          return;
        }
        if (!location) return;
        onFix({
          lat: location.latitude,
          lng: location.longitude,
          accuracy: Number.isFinite(location.accuracy) ? location.accuracy : 9999,
          speed: location.speed,
          timestamp: location.time ?? Date.now(),
        });
      });
    } catch {
      onError('unavailable');
    }
    return {
      stop: () => {
        BackgroundGeolocation.stop().catch(() => {});
      },
    };
  }

  // Web fallback — browser Geolocation. Suspended by the browser on screen lock.
  if (!navigator.geolocation) {
    onError('unavailable');
    return { stop: () => {} };
  }
  const watchId = navigator.geolocation.watchPosition(
    (pos) =>
      onFix({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        speed: pos.coords.speed,
        timestamp: pos.timestamp,
      }),
    (e) => onError(e.code === e.PERMISSION_DENIED ? 'denied' : 'unavailable'),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 },
  );
  return { stop: () => navigator.geolocation.clearWatch(watchId) };
}
