import { useEffect, useRef, useCallback } from 'react';
import { useTTS } from './useTTS';
import type { GPSStatus } from './useGPS';
import type { WeatherCondition } from '../utils/weather';
import type { ConvenienceStore } from '../utils/convenience';
import { getNextStores } from '../utils/convenience';

export interface AlertInput {
  currentKm: number;
  marginMinutes: number | null;
  batteryLevel: number | null;
  gpsStatus: GPSStatus;
  gpsLostSince: Date | null;
  weatherCondition: WeatherCondition | null;
  paceKmH: number;
  active: boolean;
  stores: ConvenienceStore[];
}

interface AlertFlags {
  km15Warned: boolean;
  km35Warned: boolean;
  km96Warned: boolean;
  km0Started: boolean;
  batteryLowAlerted: boolean;
  gpsLostAlerted: boolean;
  heatAlerted: boolean;
  rainAlerted: boolean;
  etaNegativeLast: number;
  waterLast: number;
  kmMilestones: Set<number>;
  prevKm: number | null;
  wall45Warned: boolean;
  wall75Warned: boolean;
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

  // inputRef pattern: handleAlerts stays stable, always reads latest values
  const inputRef = useRef<AlertInput>(input);
  inputRef.current = input;

  const flagsRef = useRef<AlertFlags>({
    km15Warned: false,
    km35Warned: false,
    km96Warned: false,
    km0Started: false,
    batteryLowAlerted: false,
    gpsLostAlerted: false,
    heatAlerted: false,
    rainAlerted: false,
    etaNegativeLast: 0,
    waterLast: Date.now(),
    kmMilestones: new Set(),
    prevKm: null,
    wall45Warned: false,
    wall75Warned: false,
  });

  const handleAlerts = useCallback(() => {
    const input = inputRef.current;
    if (!input.active) return;
    // Skip km-crossing detection while GPS hasn't started tracking yet
    if (input.gpsStatus === 'inactive') return;

    const flags = flagsRef.current;
    const now = Date.now();
    const km = input.currentKm;

    // ---- LEVEL 1: CRITICAL (red flash + vibrate + TTS) ----

    // Cutoff < 30 min
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

    // ETA negative — throttled to every 10 min to avoid repetition
    if (input.marginMinutes !== null && input.marginMinutes < 0) {
      vibrate([200, 100, 200]);
      if (now - flags.etaNegativeLast > 10 * 60 * 1000) {
        flags.etaNegativeLast = now;
        speak(
          '警告！このペースでは次のチェックポイントの制限時間に間に合いません。ペースを上げてください。'
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
      speak('雨の予報があります。今すぐレインウェアを手元に出してください。');
    }

    // ---- LEVEL 3: INFO / ACTION (TTS only) ----

    // 60 min water reminder — include nearest store distance (action-oriented)
    if (now - flags.waterLast > 60 * 60 * 1000) {
      flags.waterLast = now;
      const nextStores = getNextStores(input.stores, km, 1);
      const storeDist =
        nextStores[0] ? (nextStores[0].km_pos - km).toFixed(1) : null;
      const storeMsg = storeDist ? `次のコンビニまで${storeDist}キロです。` : '';
      speak(`水分補給の時間です。コップ一杯の水を飲みましょう。${storeMsg}`);
    }

    // ---- KM-crossing detection ----
    // prevKm=null means first call; record km and skip to avoid replaying past milestones
    const prevKm = flags.prevKm;
    flags.prevKm = km;
    if (prevKm === null) return;

    // Foot care milestones (20, 40, 60, 80, 90 km)
    const footCareMilestones = [20, 40, 60, 80, 90];
    for (const milestone of footCareMilestones) {
      if (prevKm < milestone && km >= milestone) {
        flags.kmMilestones.add(milestone);
        vibrate([100, 50, 100]);
        speak(
          `${milestone}キロ通過！足のケアをしてください。靴下のシワを伸ばし、水ぶくれがないか確認しましょう。`
        );
      }
    }

    // km 0-4: start announcement
    if (prevKm === 0 && km < 4 && !flags.km0Started) {
      flags.km0Started = true;
      speak(
        'スタートおめでとうございます！コンビニで補給を済ませてからスタートしましょう。'
      );
    }

    // km 14-18: no-store zone warning (action: resupply now)
    if (prevKm < 14 && km >= 14 && !flags.km15Warned) {
      flags.km15Warned = true;
      speak(
        '3キロ先から18キロまでコンビニなし区間です。今すぐ水分と食料を補給してください。'
      );
    }

    // km 34: Yuyuji slope warning
    if (prevKm < 34 && km >= 34 && !flags.km35Warned) {
      flags.km35Warned = true;
      vibrate([100, 50, 100]);
      speak(
        '遊行寺坂まで1キロ。ペースを落として体力を温存してください。急坂が続きます。坂の上には下りがあります。膝をかばって歩いてください。'
      );
    }

    // km 44: Wall pre-warning (many walkers hit the wall around km45)
    if (prevKm < 44 && km >= 44 && !flags.wall45Warned) {
      flags.wall45Warned = true;
      vibrate([200, 100, 200]);
      speak(
        '45キロ手前です。多くの選手がここから急激な疲労を感じます。今すぐペースを5パーセント落として補給してください。焦らず完歩を目指しましょう。'
      );
    }

    // km 74: Second wall warning (km75 region)
    if (prevKm < 74 && km >= 74 && !flags.wall75Warned) {
      flags.wall75Warned = true;
      vibrate([200, 100, 200]);
      speak(
        '75キロ手前です。残り25キロ。ここから疲労が加速します。ペースを維持するだけで十分です。補給と休憩を忘れずに。'
      );
    }

    // km 96: final supply chance
    if (prevKm < 96 && km >= 96 && !flags.km96Warned) {
      flags.km96Warned = true;
      speak('残り4キロ。最後の補給チャンスです。ゴールまでもう少しです！');
    }
  }, []); // stable — GPS updates do not recreate this callback

  // Run alerts check every 60 seconds
  useEffect(() => {
    if (!input.active) return;
    const interval = setInterval(handleAlerts, 60 * 1000);
    handleAlerts();
    return () => clearInterval(interval);
  }, [input.active, handleAlerts]);
}
