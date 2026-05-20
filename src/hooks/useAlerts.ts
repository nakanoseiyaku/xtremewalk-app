import { useEffect, useRef, useCallback } from 'react';
import { useTTS } from './useTTS';
import { isNightMode } from '../constants/colors';
import type { GPSStatus } from './useGPS';
import type { WeatherCondition } from '../utils/weather';

export interface AlertInput {
  currentKm: number;
  marginMinutes: number | null;
  batteryLevel: number | null;
  gpsStatus: GPSStatus;
  gpsLostSince: Date | null;
  weatherCondition: WeatherCondition | null;
  paceKmH: number;
  active: boolean;
}

// Track which alerts have been fired to avoid repeats
interface AlertFlags {
  km15Warned: boolean;
  km35Warned: boolean;
  km96Warned: boolean;
  km0Started: boolean;
  batteryLowAlerted: boolean;
  gpsLostAlerted: boolean;
  heatAlerted: boolean;
  rainAlerted: boolean;
  paceReportLast: number; // timestamp
  waterLast: number;
  footCareLast: number;
  kmMilestones: Set<number>;
}

function vibrate(pattern: number | number[]) {
  if ('vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}

function flashScreen(color: string = '#FF0000') {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: ${color}; opacity: 0.7; z-index: 9999;
    pointer-events: none; animation: fadeOut 1s forwards;
  `;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 1000);
}

export function useAlerts(input: AlertInput) {
  const { speak } = useTTS();
  const flagsRef = useRef<AlertFlags>({
    km15Warned: false,
    km35Warned: false,
    km96Warned: false,
    km0Started: false,
    batteryLowAlerted: false,
    gpsLostAlerted: false,
    heatAlerted: false,
    rainAlerted: false,
    paceReportLast: 0,
    waterLast: 0,
    footCareLast: 0,
    kmMilestones: new Set(),
  });

  const handleAlerts = useCallback(() => {
    if (!input.active) return;
    const flags = flagsRef.current;
    const now = Date.now();
    const km = input.currentKm;

    // ---- LEVEL 1: CRITICAL (red flash + vibrate + TTS) ----

    // Cutoff < 30min
    if (
      input.marginMinutes !== null &&
      input.marginMinutes < 30 &&
      input.marginMinutes > 0
    ) {
      flashScreen('#FF0000');
      vibrate([500, 200, 500, 200, 500]);
      speak(
        `警告！チェックポイントの制限時間まで${Math.round(input.marginMinutes)}分です。ペースを上げてください。`
      );
    }

    // Battery < 10%
    if (
      input.batteryLevel !== null &&
      input.batteryLevel < 10 &&
      !flags.batteryLowAlerted
    ) {
      flags.batteryLowAlerted = true;
      flashScreen('#FF0000');
      vibrate([1000, 500, 1000]);
      speak(
        `緊急警告！バッテリーが${input.batteryLevel}%です。今すぐモバイルバッテリーで充電してください。`
      );
    }

    // GPS lost 10 min
    if (
      input.gpsLostSince &&
      now - input.gpsLostSince.getTime() > 10 * 60 * 1000 &&
      !flags.gpsLostAlerted
    ) {
      flags.gpsLostAlerted = true;
      flashScreen('#FF8800');
      vibrate([300, 100, 300]);
      speak(
        'GPSを10分以上ロストしています。スマートフォンを空に向けて、GPS信号を確認してください。'
      );
    } else if (input.gpsStatus !== 'lost') {
      flags.gpsLostAlerted = false;
    }

    // ---- LEVEL 2: WARNING (vibrate + TTS) ----

    // ETA negative (will not make cutoff)
    if (input.marginMinutes !== null && input.marginMinutes < 0) {
      vibrate([200, 100, 200]);
      // Speak every 10 min
      if (now - flags.paceReportLast > 10 * 60 * 1000) {
        flags.paceReportLast = now;
        speak(
          `警告！このペースでは次のチェックポイントの制限時間に間に合いません。ペースを上げてください。`
        );
      }
    }

    // Heat alert
    if (input.weatherCondition?.isHeat && !flags.heatAlerted) {
      flags.heatAlerted = true;
      vibrate([200, 100, 200]);
      speak(
        '熱中症注意！気温が高く湿度も高い状態です。こまめな水分補給と休憩を心がけてください。'
      );
    }

    // Rain alert
    if (input.weatherCondition?.isRain && !flags.rainAlerted) {
      flags.rainAlerted = true;
      vibrate([200, 100, 200]);
      speak('雨の予報があります。レインウェアの準備をしてください。');
    }

    // ---- LEVEL 3: INFO (TTS only) ----

    // 30min pace report
    if (now - flags.paceReportLast > 30 * 60 * 1000 && input.paceKmH > 0) {
      flags.paceReportLast = now;
      const night = isNightMode();
      if (!night) {
        speak(
          `現在のペースは${input.paceKmH.toFixed(1)}キロメートル毎時です。`
        );
      }
    }

    // 60min water reminder
    if (now - flags.waterLast > 60 * 60 * 1000) {
      flags.waterLast = now;
      speak('水分補給の時間です。コップ一杯の水を飲みましょう。');
    }

    // Foot care milestones
    const footCareMilestones = [20, 40, 60, 80, 90];
    for (const milestone of footCareMilestones) {
      if (km >= milestone && !flags.kmMilestones.has(milestone)) {
        flags.kmMilestones.add(milestone);
        speak(
          `${milestone}キロ通過！足のケアをしてください。靴下のシワを伸ばし、水ぶくれがないか確認しましょう。`
        );
      }
    }

    // km 0-4 start announcement
    if (km < 4 && !flags.km0Started) {
      flags.km0Started = true;
      speak(
        'スタートおめでとうございます！コンビニで補給を済ませてからスタートしましょう。'
      );
    }

    // km 15: no-store zone warning
    if (km >= 14 && km < 15 && !flags.km15Warned) {
      flags.km15Warned = true;
      speak(
        '3キロ先から18キロまでコンビニなし区間です。今すぐ補給を行ってください。'
      );
    }

    // km 35: Yuyuji slope warning
    if (km >= 34 && km < 35 && !flags.km35Warned) {
      flags.km35Warned = true;
      vibrate([100, 50, 100]);
      speak(
        '遊行寺坂まで1キロ。ペースを落として体力を温存してください。急坂が続きます。'
      );
    }

    // km 96: final supply chance
    if (km >= 96 && !flags.km96Warned) {
      flags.km96Warned = true;
      speak('残り4キロ。最後の補給チャンスです。ゴールまでもう少しです！');
    }
  }, [input, speak]);

  // Run alerts check every 60 seconds
  useEffect(() => {
    if (!input.active) return;
    const interval = setInterval(handleAlerts, 60 * 1000);
    // Also run immediately on active
    handleAlerts();
    return () => clearInterval(interval);
  }, [input.active, handleAlerts]);
}
