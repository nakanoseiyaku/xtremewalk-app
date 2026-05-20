import { useEffect, useRef, useCallback, useState } from 'react';
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
  wakeScreen?: (ms?: number) => void;
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
  cutoffAlertLast: number;
  etaNegativeLast: number;
  waterLast: number;
  kmMilestones: Set<number>;
  prevKm: number | null;
  wall45Warned: boolean;
  wall75Warned: boolean;
  nutritionLast: number;
  wall28NutritionWarned: boolean;
  stretchLast: number;
  stretchIndex: number;
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
    cutoffAlertLast: 0,
    etaNegativeLast: 0,
    waterLast: Date.now(),
    kmMilestones: new Set(),
    prevKm: null,
    wall45Warned: false,
    wall75Warned: false,
    nutritionLast: Date.now() - 30 * 60 * 1000, // first alert fires at 30 min after start
    wall28NutritionWarned: false,
    stretchLast: Date.now() - 60 * 60 * 1000, // first alert fires at 60 min after start
    stretchIndex: 0,
  });

  const [nutritionDue, setNutritionDue] = useState(false);
  const setNutritionDueRef = useRef(setNutritionDue);
  setNutritionDueRef.current = setNutritionDue;

  const handleAlerts = useCallback(() => {
    const input = inputRef.current;
    if (!input.active) return;
    // Skip km-crossing detection while GPS hasn't started tracking yet
    if (input.gpsStatus === 'inactive') return;

    const flags = flagsRef.current;
    const now = Date.now();
    const km = input.currentKm;

    // Wrapper: wake screen 30s before speaking so user can read the UI after the alert
    const speakAndWake = (text: string) => {
      input.wakeScreen?.(30_000);
      speak(text);
    };

    // ---- LEVEL 1: CRITICAL (red flash + vibrate + TTS) ----

    // Cutoff < 30 min — throttled to 5 min to avoid TTS/vibration every 60s for 30+ min
    if (
      input.marginMinutes !== null &&
      input.marginMinutes < 30 &&
      input.marginMinutes > 0 &&
      now - flags.cutoffAlertLast > 5 * 60 * 1000
    ) {
      flags.cutoffAlertLast = now;
      flashScreen('#FF0000');
      vibrate([500, 200, 500, 200, 500]);
      speakAndWake(
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
      speakAndWake(
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
      speakAndWake(
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
        speakAndWake(
          '警告！このペースでは次のチェックポイントの制限時間に間に合いません。ペースを上げてください。'
        );
      }
    }

    // Heat alert
    if (input.weatherCondition?.isHeat && !flags.heatAlerted) {
      flags.heatAlerted = true;
      vibrate([200, 100, 200]);
      speakAndWake(
        '熱中症注意！気温が高く湿度も高い状態です。こまめな水分補給と休憩を心がけてください。'
      );
    }

    // Rain alert
    if (input.weatherCondition?.isRain && !flags.rainAlerted) {
      flags.rainAlerted = true;
      vibrate([200, 100, 200]);
      speakAndWake('雨の予報があります。今すぐレインウェアを手元に出してください。');
    }

    // ---- LEVEL 3: INFO / ACTION (TTS only) ----

    // 60 min water reminder — include nearest store distance (action-oriented)
    if (now - flags.waterLast > 60 * 60 * 1000) {
      flags.waterLast = now;
      const nextStores = getNextStores(input.stores, km, 1);
      const storeDist =
        nextStores[0] ? (nextStores[0].km_pos - km).toFixed(1) : null;
      const storeMsg = storeDist ? `次のコンビニまで${storeDist}キロです。` : '';
      speakAndWake(`水分補給の時間です。コップ一杯の水を飲みましょう。${storeMsg}`);
    }

    // 45-min nutrition reminder — bonking prevention (solid food takes 30 min to absorb)
    const NUTRITION_INTERVAL_MS = 45 * 60 * 1000;
    if (now - flags.nutritionLast >= NUTRITION_INTERVAL_MS) {
      flags.nutritionLast = now;
      const nextStore = getNextStores(input.stores, km, 1)[0];
      const storeText = nextStore
        ? `次のコンビニまで${(nextStore.km_pos - km).toFixed(1)}キロです。`
        : '';
      speakAndWake(
        `エネルギー補給のタイミングです。おにぎりやパン、羊羹など炭水化物を今すぐ食べてください。` +
        `固形食は食べてから30分後にエネルギーになるので、空腹を感じる前に食べることが重要です。` +
        storeText
      );
      setNutritionDueRef.current(true);
      setTimeout(() => setNutritionDueRef.current(false), 5 * 60 * 1000);
    }

    // 90-min stretch reminder — rotates through 6 body-area cues
    const STRETCH_MESSAGES = [
      'ふくらはぎと足首のストレッチです。かかとを大きく踏み込んで歩きましょう。足首をゆっくり回すと血流が改善します。',
      '肩と首のストレッチをしましょう。肩を後ろに大きく5回まわしてください。首をゆっくり左右に傾けて筋肉をほぐしましょう。',
      '股関節と腸腰筋のストレッチです。歩幅を意識的に広げて股関節を大きく使いましょう。腰に手を当てて背中をまっすぐ伸ばしてください。',
      'ハムストリングと膝のケアです。次のベンチや段差で片足を伸ばして前屈してください。膝の曲げ伸ばしを5回やっておきましょう。',
      '全身リセットの時間です。立ち止まって両腕を上に伸ばして深呼吸を3回してください。背中を丸めて猫背ストレッチ。上半身の張りが取れます。',
      '足裏とアキレス腱のケアです。壁や手すりに手をついてアキレス腱を伸ばしてください。足裏を指で押して痛いところがないか確認しましょう。',
    ];
    const STRETCH_INTERVAL_MS = 90 * 60 * 1000;
    if (now - flags.stretchLast >= STRETCH_INTERVAL_MS) {
      flags.stretchLast = now;
      const msg = STRETCH_MESSAGES[flags.stretchIndex % STRETCH_MESSAGES.length];
      flags.stretchIndex += 1;
      speakAndWake(`ストレッチの時間です。${msg}`);
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
        speakAndWake(
          `${milestone}キロ通過！足のケアをしてください。靴下のシワを伸ばし、水ぶくれがないか確認しましょう。`
        );
      }
    }

    // km 0-4: start announcement
    if (prevKm === 0 && km < 4 && !flags.km0Started) {
      flags.km0Started = true;
      speakAndWake(
        'スタートおめでとうございます！コンビニで補給を済ませてからスタートしましょう。'
      );
    }

    // km 14-18: no-store zone warning — specific shopping list to prevent bonking
    if (prevKm < 14 && km >= 14 && !flags.km15Warned) {
      flags.km15Warned = true;
      speakAndWake(
        'この先10キロ以上コンビニなし区間に入ります。' +
        '今すぐコンビニに立ち寄ってください。' +
        '推奨購入品：おにぎり2個、スポーツドリンク、塩タブレットまたは梅干し。' +
        '次の補給まで2時間以上かかる可能性があります。'
      );
    }

    // km 28: glycogen wall pre-warning — eat NOW so it absorbs by km 30-32
    if (prevKm < 28 && km >= 28 && !flags.wall28NutritionWarned) {
      flags.wall28NutritionWarned = true;
      vibrate([200, 100, 200, 100, 200]);
      speakAndWake(
        `30キロ手前です。体内のグリコーゲンが残り少なくなっています。` +
        `今すぐおにぎりか羊羹を食べてください。` +
        `30分後にエネルギーになり、30キロの壁を越える頃に効果が出ます。` +
        `今食べないとガス欠、シャリバテになります。`
      );
    }

    // km 34: Yuyuji slope warning
    if (prevKm < 34 && km >= 34 && !flags.km35Warned) {
      flags.km35Warned = true;
      vibrate([100, 50, 100]);
      speakAndWake(
        '遊行寺坂まで1キロ。ペースを落として体力を温存してください。急坂が続きます。坂の上には下りがあります。膝をかばって歩いてください。'
      );
    }

    // km 44: Wall pre-warning (many walkers hit the wall around km45)
    if (prevKm < 44 && km >= 44 && !flags.wall45Warned) {
      flags.wall45Warned = true;
      vibrate([200, 100, 200]);
      speakAndWake(
        '45キロ手前です。多くの選手がここから急激な疲労を感じます。今すぐペースを5パーセント落として補給してください。焦らず完歩を目指しましょう。'
      );
    }

    // km 74: Second wall warning (km75 region)
    if (prevKm < 74 && km >= 74 && !flags.wall75Warned) {
      flags.wall75Warned = true;
      vibrate([200, 100, 200]);
      speakAndWake(
        '75キロ手前です。残り25キロ。ここから疲労が加速します。ペースを維持するだけで十分です。補給と休憩を忘れずに。'
      );
    }

    // km 96: final supply chance
    if (prevKm < 96 && km >= 96 && !flags.km96Warned) {
      flags.km96Warned = true;
      speakAndWake('残り4キロ。最後の補給チャンスです。ゴールまでもう少しです！');
    }
  }, []); // stable — GPS updates do not recreate this callback

  // Run alerts check every 60 seconds
  useEffect(() => {
    if (!input.active) return;
    const interval = setInterval(handleAlerts, 60 * 1000);
    handleAlerts();
    return () => clearInterval(interval);
  }, [input.active, handleAlerts]);

  return { nutritionDue };
}
