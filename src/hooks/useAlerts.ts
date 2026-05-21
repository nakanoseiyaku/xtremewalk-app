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
  raceStartedAt: number | null;
  stores: ConvenienceStore[];
  wakeScreen?: (ms?: number) => void;
  isWalking: boolean | null;
  cadence: number | null;
}

const CADENCE_WARN = 85; // steps/min below this triggers alert
const CADENCE_MESSAGES = [
  'ケイデンスが落ちています。腕を大きく振ってリズムを取り戻してください。ここまで来たんです、まだ行けます！',
  '歩くリズムが遅くなっています。背筋を伸ばして、テンポよく足を運びましょう。諦めたら終わりです、続けてください！',
  'ペースが落ちてきました。深呼吸して、前を向いて歩きましょう。一歩一歩がゴールに近づいています！',
  '少しペースダウンしています。音楽を思い浮かべて、そのリズムに乗って歩きましょう。あなたはもっとできる！',
];

interface AlertFlags {
  km15Warned: boolean;
  km35Warned: boolean;
  km66ToiletWarned: boolean;
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
  nutritionDueTimeout: ReturnType<typeof setTimeout> | null;
  cadenceLowLast: number;
  cadenceMsgIndex: number;
  wall28NutritionWarned: boolean;
  stretchLast: number;
  stretchIndex: number;
  km30KneeWarned: boolean;
  formCoachingFired: Set<number>;
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

// ---------- Sports-medicine stretch matrix (phase × walking state) ----------
// All messages are designed to be understood from audio alone:
//   - step-by-step sequence  • explicit hold durations  • bilateral cues included
//   - no visual references   • walking messages: immediate 1-action cue
const STRETCH_MATRIX = {
  // Phase 1: km 0-25 — warm-up & Achilles/calf prevention
  warmup: {
    walking: [
      'ストレッチです。歩きながらできます。まず両肩を耳に近づけるようにすくめます。そのままぎゅっと力を入れて、スッと力を抜いて肩を落とします。3回繰り返してください。次に首をゆっくり右に傾けて5秒、左に傾けて5秒。上半身の力みが取れます。',
      'かかとストレッチです。歩きながらできます。次の10歩だけ、かかとから地面に着いてつま先でしっかり蹴り出すことを意識してください。ふくらはぎと足首が動いて血流が良くなります。終わったら元のペースに戻してください。',
    ],
    stopped: [
      'アキレス腱のストレッチです。少し立ち止まってください。近くの壁や電柱に両手を添えます。右足を後ろに引いて、かかとを地面につけたまま前の膝を曲げます。アキレス腱が伸びているのを感じたら、そのまま20秒キープ。20秒たったら次は反対側。左足を後ろに引いて同じように20秒。足底筋膜炎の予防になります。',
      'ふくらはぎのストレッチです。少し立ち止まってください。壁に両手をついて右足を後ろに大きく引き、かかとを地面につけたまま膝を伸ばして20秒キープ。それが終わったら右膝を少し曲げてさらに10秒。これでヒラメ筋まで伸ばせます。左足も同じようにやってください。',
    ],
  },
  // Phase 2: km 25-45 — IT band & knee protection [top priority]
  knee_protect: {
    walking: [
      '膝保護のストレッチです。歩きながらできます。次の20歩、一歩踏み出すたびに後ろ足のお尻をぎゅっと絞ってください。お尻の筋肉が使えると膝の外側への横ぶれが半分になります。これが腸脛靭帯を守る一番の方法です。',
      '膝の外側痛を防ぐ歩き方です。歩きながらできます。次の50歩だけ、つま先を今より少し外側に向けて歩いてみてください。10度から15度外に開くイメージです。股関節が開いて腸脛靭帯への張力が下がります。',
    ],
    stopped: [
      '腸脛靭帯のストレッチです。今すぐ立ち止まってください。これが膝を守る最重要ストレッチです。右足を左足の後ろに交差させて、両足をそろえて立ちます。そのまま上体をゆっくり右側に倒してください。右の腰からお腿の外側にかけて伸びる感覚があれば正しい姿勢です。10秒キープ。戻して、反対側。左足を右足の後ろに交差させて左に倒して10秒。これを3セット繰り返してください。',
      '太ももの前のストレッチです。少し立ち止まってください。壁や電柱に左手を添えます。右手で右の足首をつかんで、かかとをお尻に近づけます。そのまま膝を後ろに引くようにして20秒キープ。ふらつく場合は壁に近づいてください。終わったら左足も同じように。膝のお皿への負担が減ります。',
    ],
  },
  // Phase 3: km 45-65 — hip flexor & lower back protection
  hip_lower: {
    walking: [
      '腸腰筋を動かすストレッチです。歩きながらできます。歩幅を今より少し広げて、骨盤を前後に揺らすようなイメージで歩いてみてください。前の足に体重を乗せるとき骨盤が前に出る、後ろ足で蹴るとき骨盤が後ろに引く。この動きで腸腰筋が固まりにくくなります。後半の腰痛を防ぎます。',
      '体幹を使う歩き方です。歩きながらできます。腕を肩甲骨から動かすように意識して大きく前後に振ってください。肘を後ろに引くとき肩甲骨が寄ります。これだけで体幹が連動して腰への集中負荷が分散されます。腕振りを30歩続けてみてください。',
    ],
    stopped: [
      '腸腰筋のストレッチです。少し立ち止まってください。右足を大きく前に踏み出して、右膝を90度に曲げます。左膝をゆっくり地面につけます。そのまま骨盤を前に押し出すように体重を前にかけて、左の股関節前側が伸びるのを感じてください。20秒キープ。戻して、今度は左足を前に出して右膝を地面について20秒。腰痛と膝前の痛みの根本原因を伸ばします。',
      'お尻の深い筋肉のストレッチです。少し立ち止まってください。右足首を左膝の上に乗せて、ゆっくり腰を後ろに引いて座るように体重を落とします。お尻の奥が伸びる感覚があれば正しいです。20秒キープ。反対側も同じように。坐骨神経痛の予防になります。',
    ],
  },
  // Phase 4: km 65-85 — fatigue management & hamstring
  fatigue: {
    walking: [
      '全身リセットです。歩きながらできます。まず両肩をぐっと上に持ち上げて、スッと一気に落とします。これを3回。次に鼻からゆっくり4秒吸って、口からゆっくり8秒かけて吐きます。これを3回繰り返してください。乳酸が流れて疲労感が少し和らぎます。',
      '疲れた時の歩き方です。歩きながらできます。今より少し前傾みを意識して、重心を前気味にしてみてください。坂を上るような姿勢です。筋肉が衝撃を吸収して関節への負担が下がります。それから一歩ごとに地面を後ろに蹴り出すことを意識してください。',
    ],
    stopped: [
      'ハムストリングのストレッチです。少し立ち止まってください。右足を前に伸ばして地面に置きます。膝をなるべく伸ばしたまま、上体をゆっくり前に倒します。太ももの裏が伸びる感覚を確認したら20秒キープ。腰が痛い場合は膝を少し曲げても大丈夫です。左足も同じように。ハムストリングが硬いと腰痛が加速します。',
      '腰のストレッチです。少し立ち止まってください。両手を腰骨に当てます。上体をゆっくり後ろに反らして10秒。戻して今度は前に丸めて10秒。次に右にゆっくりひねって10秒、左にひねって10秒。これを2セット。長時間歩き続けて固まった腰が解放されます。',
    ],
  },
  // Phase 5: km 85+ — survival, gentle only
  survival: {
    walking: [
      '残りわずかです。歩きながら聞いてください。痛みがある部位があれば、一歩ごとに体重のかかり方を少し変えてみてください。内側に痛みがあれば少し外側に、外側なら内側に。使う筋肉を少しずつ変えることで痛みが分散されます。焦らなくて大丈夫です。このペースでゴールできます。',
      'ゴールまでもう少しです。腕をしっかり振ると脚が楽になります。膝や足首に衝撃を感じたら歩幅を小さくして、足を動かす回数を上げてください。歩幅が小さいほど関節への衝撃が減ります。',
    ],
    stopped: [
      '足の状態を確認します。少し立ち止まってください。靴の外から指で足の甲をそっと触ってみてください。腫れや熱感があるところはないですか。次に足指をひとつずつ動かしてみて、引っかかる感じや痛みがある指はないですか。何か気になる点があれば今のうちにテーピングか靴下の調整をしてください。',
      '股関節の解放です。少し立ち止まってください。片手を壁か電柱に添えます。右足を地面からゆっくり持ち上げて、前後にゆっくり振り子のように10回振ります。次に左右に10回。左足も同じように。関節液が広がって硬さが取れます。残りは確実に歩けます。',
    ],
  },
} as const;

type StretchPhase = keyof typeof STRETCH_MATRIX;

function selectStretch(km: number, isWalking: boolean | null, index: number): string {
  const phase: StretchPhase =
    km < 25 ? 'warmup' :
    km < 45 ? 'knee_protect' :
    km < 65 ? 'hip_lower' :
    km < 85 ? 'fatigue' :
    'survival';

  const pool = STRETCH_MATRIX[phase];
  if (isWalking === true)  return pool.walking[index % pool.walking.length];
  if (isWalking === false) return pool.stopped[index % pool.stopped.length];
  // sensor unavailable: alternate walking/stopped each call
  const all = [...pool.walking, ...pool.stopped];
  return all[index % all.length];
}
// ---------------------------------------------------------------------------

// ---------- Biomechanics-based form coaching cues (fires once per km milestone) ----------
const FORM_COACHING: { km: number; msg: string }[] = [
  {
    km: 5,
    msg: 'フォームチェックです。5キロ地点。腰の高さをキープして、骨盤を水平に保ちましょう。腰が左右に揺れると余分なエネルギーを消費します。背筋を伸ばして視線は10メートル先。このフォームを後半まで維持することが完歩の鍵です。',
  },
  {
    km: 10,
    msg: 'フォームチェックです。10キロ地点。腕の振り方を確認してください。肘を90度に曲げて、肩甲骨から腕を前後にしっかり振ります。腕を後ろに引くとき肩甲骨が寄り体幹が連動します。腕をダラリと下げると腰への負担が増えます。',
  },
  {
    km: 15,
    msg: 'フォームチェックです。15キロ地点。着地の質を確認します。かかとのやや外側から着地して、足の外側を伝わりながら親指の付け根で蹴り出す。この流れが理想的です。かかと全体でドスンと着地すると膝への衝撃が3倍になります。柔らかく転がるように着地してください。',
  },
  {
    km: 20,
    msg: 'フォームチェックです。20キロ地点。体全体の前傾姿勢を確認します。足首から頭まで一直線のまま、ほんの少し前に傾けてください。この前傾で重力が推進力になります。腰だけ曲げてお辞儀するのはNGです。お腹を締めて体の軸ごと傾けてください。',
  },
  {
    km: 25,
    msg: 'フォームチェックです。25キロ地点。股関節主導の歩き方を確認します。脚を膝から動かすのではなく、股関節から動かすことを意識してください。一歩踏み出すたびにお尻の筋肉が使われている感覚があれば正解です。お尻が使えると大腿四頭筋の疲労が半分になり膝も守れます。',
  },
  {
    km: 35,
    msg: 'フォームチェックです。35キロ地点。蹴り出しを確認します。後ろ足のつま先で地面を押して蹴り出す動作は推進力の30パーセントを生み出します。疲れてくると蹴り出しが弱くなりがちです。今の自分の蹴り出しを意識してみてください。足首をしっかり使って蹴り出せていますか？',
  },
  {
    km: 40,
    msg: 'フォームチェックです。40キロ地点。腸腰筋チェックです。前足を前に出すとき、股関節の前側の筋肉が引っ張られている感覚はありますか？ここが腸腰筋です。腸腰筋が使えていると股関節から脚全体が前に運ばれます。使えていないと太ももの前だけで頑張ることになり後半の大きな疲労につながります。',
  },
  {
    km: 50,
    msg: 'フォームチェックです。50キロ折り返し地点。後半に入りました。ここから大事なのは歩幅を広げないことです。疲れてくると無意識に歩幅を広げようとして膝が伸び切ってしまいます。歩幅を少し狭めて、その分ケイデンスを維持するイメージで歩いてください。関節への衝撃が下がります。',
  },
  {
    km: 58,
    msg: 'フォームチェックです。58キロ地点。腕振りで体幹を動かす確認です。腕を振るとき、肩だけでなく肩甲骨と背骨全体が連動しているか確認してください。上半身が固まって腕だけが動いていると下半身に余分な負担がかかります。大きく深呼吸しながら肩甲骨を意識して腕を振ってみてください。',
  },
  {
    km: 63,
    msg: 'フォームチェックです。63キロ地点。体幹の確認です。呼吸に合わせて、吐くときにお腹を軽く引き込むと自然に体幹が入ります。体幹が緩むと腰が左右に揺れ足への衝撃が左右不均等になります。意識せず体幹を使い続ける方法は深い呼吸です。今すぐ深呼吸を3回してみてください。',
  },
  {
    km: 68,
    msg: 'フォームチェックです。68キロ地点。つま先の向きを確認します。疲れてくるとつま先が外側を向きやすくなります。つま先が外を向くと内側の膝に大きな負担がかかります。自分のつま先の向きを見てみてください。真っすぐか少し内側を向いているくらいが理想です。意識的に修正して膝を守ってください。',
  },
  {
    km: 72,
    msg: 'フォームチェックです。72キロ地点。夜間の歩行フォームに切り替えてください。暗くなると足元が見えにくくなり足を高く上げる歩き方になりがちです。これは疲れを加速させます。路面が見える範囲では足を上げすぎず、地面をかするように歩く省エネ歩行を維持してください。',
  },
  {
    km: 78,
    msg: 'フォームチェックです。78キロ地点。残り22キロ。ここからはストライドではなくケイデンスで勝負です。一歩の歩幅を広げると膝と腰への衝撃が倍増します。歩幅は今のまま、足を動かす回数を維持することだけを考えてください。小さく速く動かす方が長距離では効率が高いです。',
  },
  {
    km: 83,
    msg: 'フォームチェックです。83キロ地点。膝の伸展を確認します。後ろ足で地面を蹴り出したとき、膝がしっかり伸びていますか？疲れてくると膝が曲がったまま蹴り出すようになります。大腿四頭筋と膝裏への集中負荷になります。蹴り出しのたびに膝をしっかり伸ばして推進力を回復させてください。',
  },
  {
    km: 87,
    msg: 'フォームチェックです。87キロ地点。体の左右差を確認します。右と左で違う感覚はありますか？痛みや疲れが片側に集中している場合、反対側に余分な負荷がかかっています。一歩ごとに左右均等に体重を乗せることを意識してください。意識するだけで負荷が軽減されます。',
  },
  {
    km: 92,
    msg: 'フォームチェックです。92キロ地点。残り8キロ。今感じている体の一番不快な部位はどこですか？その部位への負荷を意識的に減らす歩き方に微調整してください。足首が痛ければ歩幅を小さく、膝が痛ければ少し外股に、腰が痛ければ少し前傾を強めに。あと少し、歩き切ってください。',
  },
  {
    km: 98,
    msg: 'フォームチェックです。98キロ地点。残り2キロです。頭を持ち上げて前を向いてください。目線を上げると姿勢が自然に伸びます。腕をしっかり振って最後の力を振り絞ってください。このフォームを崩さずにゴールまで歩き切ってください！',
  },
];
// ---------------------------------------------------------------------------

export function useAlerts(input: AlertInput) {
  const { speak } = useTTS();

  // inputRef pattern: handleAlerts stays stable, always reads latest values
  const inputRef = useRef<AlertInput>(input);
  inputRef.current = input;

  const flagsRef = useRef<AlertFlags>({
    km15Warned: false,
    km35Warned: false,
    km66ToiletWarned: false,
    km96Warned: false,
    km0Started: false,
    batteryLowAlerted: false,
    gpsLostAlerted: false,
    heatAlerted: false,
    rainAlerted: false,
    cutoffAlertLast: 0,
    etaNegativeLast: 0,
    waterLast: Number.MAX_SAFE_INTEGER, // anchored to actual race start by an effect
    kmMilestones: new Set(),
    prevKm: null,
    wall45Warned: false,
    wall75Warned: false,
    nutritionLast: Number.MAX_SAFE_INTEGER, // anchored to actual race start by an effect
    wall28NutritionWarned: false,
    stretchLast: Number.MAX_SAFE_INTEGER, // anchored to actual race start by an effect
    stretchIndex: 0,
    km30KneeWarned: false,
    nutritionDueTimeout: null,
    cadenceLowLast: 0,
    cadenceMsgIndex: 0,
    formCoachingFired: new Set<number>(),
  });

  // Guards the one-time anchoring of elapsed-time reminders to the race start.
  const elapsedAnchoredRef = useRef(false);

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
      speak?.(text);
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

    // Reset battery flag if battery recovered (e.g. plugged in), so future drops re-alert
    if ((input.batteryLevel ?? 100) >= 15) flags.batteryLowAlerted = false;

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

    // Heat alert — reset when condition clears so re-alert is possible
    if (!input.weatherCondition?.isHeat) flags.heatAlerted = false;
    if (input.weatherCondition?.isHeat && !flags.heatAlerted) {
      flags.heatAlerted = true;
      vibrate([200, 100, 200]);
      speakAndWake(
        '熱中症注意！気温が高く湿度も高い状態です。こまめな水分補給と休憩を心がけてください。'
      );
    }

    // Rain alert — reset when condition clears so re-alert is possible
    if (!input.weatherCondition?.isRain) flags.rainAlerted = false;
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
      if (flags.nutritionDueTimeout) clearTimeout(flags.nutritionDueTimeout);
      flags.nutritionDueTimeout = setTimeout(() => {
        setNutritionDueRef.current(false);
        flags.nutritionDueTimeout = null;
      }, 5 * 60 * 1000);
    }

    // Cadence drop alert — fires when cadence < 85 steps/min for sustained period
    if (
      input.cadence !== null &&
      input.cadence < CADENCE_WARN &&
      input.isWalking === true &&
      now - flags.cadenceLowLast > 8 * 60 * 1000 // throttle: once per 8 min
    ) {
      flags.cadenceLowLast = now;
      const msg = CADENCE_MESSAGES[flags.cadenceMsgIndex % CADENCE_MESSAGES.length];
      flags.cadenceMsgIndex += 1;
      vibrate([200, 100, 200]);
      speakAndWake(msg);
    }

    // Phase-aware, walking-state-aware stretch reminder (sports medicine panel design)
    const STRETCH_INTERVAL_MS =
      input.isWalking === true  ? 45 * 60 * 1000 :
      input.isWalking === false ? 60 * 60 * 1000 :
      90 * 60 * 1000; // sensor unavailable fallback
    if (now - flags.stretchLast >= STRETCH_INTERVAL_MS) {
      flags.stretchLast = now;
      const msg = selectStretch(km, input.isWalking, flags.stretchIndex);
      flags.stretchIndex += 1;
      speakAndWake(msg);
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

    // km 0-4: start announcement (prevKm < 2 to handle GPS first reading of 0.x)
    if (prevKm < 2 && !flags.km0Started) {
      flags.km0Started = true;
      speakAndWake(
        'スタートおめでとうございます！コンビニで補給を済ませてからスタートしましょう。'
      );
    }

    // km 14-18: no-store zone warning — specific shopping list to prevent bonking
    if (prevKm < 14 && km >= 14 && !flags.km15Warned) {
      flags.km15Warned = true;
      speakAndWake(
        'この先11キロ以上コンビニなし区間に入ります。' +
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
        `今食べないとガス欠やシャリバテになります。`
      );
    }

    // km 30: IT band / knee collapse prevention [most critical injury point]
    if (prevKm < 30 && km >= 30 && !flags.km30KneeWarned) {
      flags.km30KneeWarned = true;
      vibrate([200, 100, 200]);
      speakAndWake(
        '重要な警告です。これから30キロから45キロが膝の最大の危機です。' +
        '今すぐ立ち止まって腸脛靭帯をストレッチしてください。' +
        '右足を左足の後ろに交差させて、上体を右にゆっくり倒して10秒。左右3回。' +
        '膝の外側に少しでも違和感がある場合は今対処しないと残り70キロを歩けなくなります。'
      );
    }

    // km 34: Yuyuji slope warning
    if (prevKm < 34 && km >= 34 && !flags.km35Warned) {
      flags.km35Warned = true;
      vibrate([100, 50, 100]);
      speakAndWake(
        'まもなく遊行寺坂です。急な上り坂が始まります。' +
        'ペースを落として体力を温存してください。' +
        '頂上を越えると下り坂になります。下りでは歩幅を小さくして、膝をかばいながらゆっくり歩いてください。'
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

    // km 66: toilet desert zone warning (13km gap: km66 → km79)
    if (prevKm < 66 && km >= 66 && !flags.km66ToiletWarned) {
      flags.km66ToiletWarned = true;
      vibrate([100, 50, 100]);
      speakAndWake(
        'ここからトイレが13キロありません。次のトイレはkm79です。今のうちに済ませておいてください。'
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

    // Form coaching cues — biomechanics-based, fires once per km milestone
    for (const cue of FORM_COACHING) {
      if (prevKm < cue.km && km >= cue.km && !flags.formCoachingFired.has(cue.km)) {
        flags.formCoachingFired.add(cue.km);
        speakAndWake(cue.msg);
      }
    }
  }, []); // stable — GPS updates do not recreate this callback

  // Anchor elapsed-time reminders (water/nutrition/stretch) to the ACTUAL race
  // start. flagsRef is created at hook mount (pre-race) so this cannot be done
  // in the initializer. Reset on de-activation so a new race re-anchors.
  useEffect(() => {
    if (!input.active) {
      elapsedAnchoredRef.current = false;
      return;
    }
    if (elapsedAnchoredRef.current) return;
    elapsedAnchoredRef.current = true;
    const now = Date.now();
    const rawAnchor = input.raceStartedAt ?? now;
    const flags = flagsRef.current;
    // Cap so a mid-race reload doesn't replay a long-overdue catch-up burst.
    flags.nutritionLast = Math.max(rawAnchor, now - 45 * 60 * 1000);
    flags.waterLast = Math.max(rawAnchor, now - 60 * 60 * 1000);
    flags.stretchLast = Math.max(rawAnchor, now - 90 * 60 * 1000);
  }, [input.active, input.raceStartedAt]);

  // Run alerts check every 60 seconds
  useEffect(() => {
    if (!input.active) return;
    const interval = setInterval(handleAlerts, 60 * 1000);
    handleAlerts();
    return () => clearInterval(interval);
  }, [input.active, handleAlerts]);

  return { nutritionDue };
}
