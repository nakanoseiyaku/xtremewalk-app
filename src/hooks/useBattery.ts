import { useState, useEffect } from 'react';

export interface BatteryState {
  level: number | null; // 0-100
  charging: boolean;
  estimatedHours: number | null;
  isLow: boolean; // < 10%
}

type BatteryManager = {
  level: number;
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
  addEventListener: (event: string, cb: () => void) => void;
  removeEventListener: (event: string, cb: () => void) => void;
};

export function useBattery(): BatteryState {
  const [state, setState] = useState<BatteryState>({
    level: null,
    charging: false,
    estimatedHours: null,
    isLow: false,
  });

  useEffect(() => {
    let battery: BatteryManager | null = null;
    let handler: (() => void) | null = null;

    const update = (b: BatteryManager) => {
      const level = Math.round(b.level * 100);
      const dischargingTimeSec = b.dischargingTime;
      const estimatedHours =
        dischargingTimeSec !== Infinity && dischargingTimeSec > 0
          ? dischargingTimeSec / 3600
          : null;

      setState({
        level,
        charging: b.charging,
        estimatedHours,
        isLow: level < 10,
      });
    };

    const nav = navigator as Navigator & {
      getBattery?: () => Promise<BatteryManager>;
    };

    if (nav.getBattery) {
      nav.getBattery().then((b) => {
        battery = b;
        update(b);
        handler = () => update(b);
        b.addEventListener('levelchange', handler);
        b.addEventListener('chargingchange', handler);
        b.addEventListener('dischargingtimechange', handler);
      }).catch(() => {
        // Battery API unavailable (iOS, permission denied, etc.) — silently degrade
      });
    }

    return () => {
      if (battery && handler) {
        battery.removeEventListener('levelchange', handler);
        battery.removeEventListener('chargingchange', handler);
        battery.removeEventListener('dischargingtimechange', handler);
      }
    };
  }, []);

  return state;
}
