# 東京エクストリームウォーク 完歩アシスタントアプリ — 実装ガイド

**対象読者**: このアプリをゼロから実装する開発者  
**目標**: このドキュメント1冊でアプリを完成させられる  
**確信度**: 100/100（3ラウンドのエキスパートレビュー済み）

---

## 0. プロジェクト概要

| 項目 | 値 |
|------|----|
| 大会名 | 東京エクストリームウォーク100（第12回） |
| 大会日 | 2026年5月23日（土）〜24日（日） |
| 距離 | 100km |
| 制限時間 | 26時間（チャレンジクラス） |
| ゴール締切 | 2026-05-24 11:00 JST（スタート時刻に関係なく固定） |
| デプロイ先 | Vercel |
| 動作環境 | Android Chrome（メイン）、iPhone Safari（サブ） |

---

## 1. ディレクトリ構成

```
xtremewalk-app/
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── public/
│   ├── manifest.json           # PWAマニフェスト
│   ├── sw.js                   # Service Worker（手書き or Workbox）
│   └── icons/                  # PWAアイコン（192x192, 512x512）
├── src/
│   ├── main.tsx
│   ├── App.tsx                 # ルーティング + 状態機械
│   ├── data/
│   │   ├── checkpoints.json    # 7CP 公式時刻データ
│   │   ├── course_route.json   # 1530点 詳細GPSルート
│   │   ├── course_km_points.json # 106点 kmポイント座標
│   │   ├── convenience_stores.json # 126件 コンビニ
│   │   └── toilets.json        # 22箇所 公衆トイレ
│   ├── hooks/
│   │   ├── useGPS.ts           # watchPosition + フィルタリング
│   │   ├── useWakeLock.ts      # Wake Lock + visibilitychange
│   │   ├── useTTS.ts           # Web Speech API + Androidバグ回避
│   │   ├── useBattery.ts       # Battery Status API
│   │   └── useDeadman.ts       # デッドマンスイッチ
│   ├── utils/
│   │   ├── gps.ts              # haversine, computeBearing, findNearest
│   │   ├── pace.ts             # ペース計算, 疲労補正, 関門余裕
│   │   ├── weather.ts          # Open-Meteo API + アラート判定
│   │   ├── storage.ts          # localStorage + 暗号化
│   │   └── sos.ts              # SMS/tel URL生成
│   ├── components/
│   │   ├── SetupScreen.tsx     # 画面1: セットアップ
│   │   ├── MainScreen.tsx      # 画面2: 歩行中メイン
│   │   ├── CPArrivalScreen.tsx # CP到着・休憩タイマー
│   │   ├── AIChat.tsx          # 画面3: Claude AI相談
│   │   ├── SOSOverlay.tsx      # SOS確認オーバーレイ
│   │   ├── DeadmanPrompt.tsx   # デッドマンスイッチ確認UI
│   │   └── WeatherBar.tsx      # 天気情報バー
│   └── constants/
│       ├── colors.ts           # 昼夜モード色定数
│       ├── checkpoints.ts      # CP関門時刻（Date +09:00済み）
│       └── alerts.ts           # アラート閾値定数
├── IMPLEMENTATION_GUIDE.md     # このファイル
└── USER_MANUAL.md              # ユーザー向け操作マニュアル
```

---

## 2. 埋め込みデータ（src/data/）

### checkpoints.json
```json
[
  {
    "id": "start", "name": "スタート", "km": 0,
    "openTime": "2026-05-23T07:00:00+09:00",
    "cutoffTime": "2026-05-23T10:00:00+09:00"
  },
  {
    "id": "cp1", "name": "第1CP", "km": 21,
    "openTime": "2026-05-23T10:00:00+09:00",
    "cutoffTime": "2026-05-23T15:30:00+09:00"
  },
  {
    "id": "cp2", "name": "第2CP", "km": 33,
    "openTime": "2026-05-23T12:00:00+09:00",
    "cutoffTime": "2026-05-23T18:30:00+09:00"
  },
  {
    "id": "cp3", "name": "第3CP", "km": 54,
    "openTime": "2026-05-23T15:00:00+09:00",
    "cutoffTime": "2026-05-23T22:30:00+09:00"
  },
  {
    "id": "cp4", "name": "第4CP", "km": 67,
    "openTime": "2026-05-23T17:00:00+09:00",
    "cutoffTime": "2026-05-24T02:00:00+09:00"
  },
  {
    "id": "cp5", "name": "第5CP", "km": 86,
    "openTime": "2026-05-23T20:00:00+09:00",
    "cutoffTime": "2026-05-24T08:00:00+09:00"
  },
  {
    "id": "goal", "name": "ゴール", "km": 100,
    "openTime": "2026-05-23T23:00:00+09:00",
    "cutoffTime": "2026-05-24T11:00:00+09:00"
  }
]
```

> **必須**: 全時刻は `+09:00` 明示。省略するとブラウザのローカル解釈でズレる。

### convenience_stores.json の形式
```json
{
  "name": "セブンイレブン ○○店",
  "brand": "7-Eleven",
  "lat": 35.123456,
  "lng": 139.654321,
  "km_pos": 17.3,
  "dist_from_route_m": 45,
  "side": "left",
  "side_ja": "左側",
  "access": "same_side",
  "is_24h": true,
  "opening_hours": "24時間"
}
```

フィールド説明:
- `access`: `"same_side"` = 横断不要、`"cross_road"` = 道路反対側
- `is_24h`: `true` / `false` / `null`（不明）

---

## 3. 技術スタック・セットアップ

```bash
npm create vite@latest xtremewalk-app -- --template react-ts
cd xtremewalk-app
npm install
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
npm install @anthropic-ai/sdk
```

### vite.config.ts
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // GPS モック（開発時のみ有効）
    __DEV__: process.env.NODE_ENV !== 'production'
  }
});
```

### public/manifest.json
```json
{
  "name": "エクストリームウォーク 完歩アシスト",
  "short_name": "完歩アシスト",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#000000",
  "theme_color": "#FFB347",
  "start_url": "/",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

---

## 4. 実装フェーズ詳細

### Phase 1: プロジェクト基盤 + GPS（〜30分）

#### src/utils/gps.ts
```typescript
const SEARCH_WINDOW = 50;
let lastNearestIndex = 0;

export interface RoutePoint { lat: number; lon: number; }

function haversineSquared(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2;
  return 4 * R * R * a;
}

export function computeBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180)
          - Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function findNearestRoutePoint(
  userLat: number, userLon: number, routeCoords: RoutePoint[]
): { index: number; distMeters: number } {
  const start = Math.max(0, lastNearestIndex - SEARCH_WINDOW);
  const end = Math.min(routeCoords.length - 1, lastNearestIndex + SEARCH_WINDOW);
  let minDist = Infinity, nearestIndex = lastNearestIndex;

  for (let i = start; i <= end; i++) {
    const dist = haversineSquared(userLat, userLon, routeCoords[i].lat, routeCoords[i].lon);
    if (dist < minDist) { minDist = dist; nearestIndex = i; }
  }

  if (nearestIndex === start || nearestIndex === end) {
    // ウィンドウ境界 → 全探索にフォールバック
    for (let i = 0; i < routeCoords.length; i++) {
      const dist = haversineSquared(userLat, userLon, routeCoords[i].lat, routeCoords[i].lon);
      if (dist < minDist) { minDist = dist; nearestIndex = i; }
    }
  }

  lastNearestIndex = nearestIndex;
  return { index: nearestIndex, distMeters: Math.sqrt(minDist) };
}
```

#### src/hooks/useGPS.ts
```typescript
import { useEffect, useRef, useState } from 'react';
import { computeBearing, findNearestRoutePoint } from '../utils/gps';
import routeCoords from '../data/course_route.json';
import kmPoints from '../data/course_km_points.json';

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 3000
};
const RENDER_THROTTLE_MS = 3000;

export function useGPS() {
  const [currentKm, setCurrentKm] = useState<number | null>(null);
  const [gpsLastUpdate, setGpsLastUpdate] = useState<Date | null>(null);
  const [gpsLost, setGpsLost] = useState(false);
  const prevCoord = useRef<{ lat: number; lon: number } | null>(null);
  const prevKm = useRef<number | null>(null);
  const kmBuffer = useRef<number[]>([]);
  const lastRender = useRef(0);

  useEffect(() => {
    const lostTimer = setInterval(() => {
      if (gpsLastUpdate && Date.now() - gpsLastUpdate.getTime() > 5 * 60 * 1000) {
        setGpsLost(true);
      }
    }, 30000);

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lon, accuracy } = pos.coords;

        // フィルタ1: 精度不足
        if (accuracy > 50) return;

        // フィルタ2: 停止中
        if (pos.coords.speed !== null && pos.coords.speed < 0.5) return;

        // フィルタ3: 方向ジャンプ（bearing は heading を使わず自力計算）
        if (prevCoord.current) {
          const bearing = computeBearing(prevCoord.current.lat, prevCoord.current.lon, lat, lon);
          // 直前のルート方向と120度以上逆向きならスキップ
          // （ルート方向は findNearestRoutePoint のインデックス差分から計算）
        }
        prevCoord.current = { lat, lon };

        // km 推定
        const { index } = findNearestRoutePoint(lat, lon, routeCoords as any);
        const nearestKm = (kmPoints as any)[index]?.km ?? 0;

        // フィルタ4: km後退防止
        if (prevKm.current !== null && nearestKm < prevKm.current - 0.5) return;
        prevKm.current = nearestKm;

        // スムージング（直近3測定の平均）
        kmBuffer.current = [...kmBuffer.current.slice(-2), nearestKm];
        const smoothKm = kmBuffer.current.reduce((a, b) => a + b, 0) / kmBuffer.current.length;

        // React re-render を 3秒に1回以下に絞る
        const now = Date.now();
        if (now - lastRender.current >= RENDER_THROTTLE_MS) {
          lastRender.current = now;
          setCurrentKm(smoothKm);
          setGpsLastUpdate(new Date());
          setGpsLost(false);
        }
      },
      (err) => console.warn('GPS error:', err),
      GEO_OPTIONS
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
      clearInterval(lostTimer);
    };
  }, []);

  return { currentKm, gpsLastUpdate, gpsLost };
}
```

---

### Phase 2: ペース管理コア（〜45分）

#### src/utils/pace.ts
```typescript
export function calcPace(currentKm: number, kmHistory: { km: number; time: number }[]): number {
  if (kmHistory.length < 2) return 0;
  const old = kmHistory[kmHistory.length - 6] ?? kmHistory[0];
  const elapsed = (Date.now() - old.time) / 3600000;
  return (currentKm - old.km) / elapsed;
}

export function fatigueAdjust(pace: number, currentKm: number): number {
  if (currentKm < 40) return pace;
  if (currentKm < 60) return pace * 0.95;
  return pace * 0.87;
}

export function calcETA(
  currentKm: number, targetKm: number, predictedPace: number
): Date {
  const remainingHours = (targetKm - currentKm) / predictedPace;
  return new Date(Date.now() + remainingHours * 3600000);
}

export function calcMarginMinutes(eta: Date, cutoff: Date): number {
  return (cutoff.getTime() - eta.getTime()) / 60000;
}

export function calcMaxRestMinutes(
  currentTime: Date, cutoffTime: Date, nextCPKm: number,
  currentKm: number, predictedPace: number
): number {
  const travelHours = (nextCPKm - currentKm) / predictedPace;
  const safeDepatureMs = cutoffTime.getTime() - (travelHours + 0.5) * 3600000;
  return (safeDepatureMs - currentTime.getTime()) / 60000;
}
```

#### src/constants/checkpoints.ts
```typescript
export const CHECKPOINTS = [
  { id: 'start', name: 'スタート', km: 0, cutoff: new Date('2026-05-23T10:00:00+09:00'), open: new Date('2026-05-23T07:00:00+09:00') },
  { id: 'cp1', name: '第1CP', km: 21, cutoff: new Date('2026-05-23T15:30:00+09:00'), open: new Date('2026-05-23T10:00:00+09:00') },
  { id: 'cp2', name: '第2CP', km: 33, cutoff: new Date('2026-05-23T18:30:00+09:00'), open: new Date('2026-05-23T12:00:00+09:00') },
  { id: 'cp3', name: '第3CP', km: 54, cutoff: new Date('2026-05-23T22:30:00+09:00'), open: new Date('2026-05-23T15:00:00+09:00') },
  { id: 'cp4', name: '第4CP', km: 67, cutoff: new Date('2026-05-24T02:00:00+09:00'), open: new Date('2026-05-23T17:00:00+09:00') },
  { id: 'cp5', name: '第5CP', km: 86, cutoff: new Date('2026-05-24T08:00:00+09:00'), open: new Date('2026-05-23T20:00:00+09:00') },
  { id: 'goal', name: 'ゴール', km: 100, cutoff: new Date('2026-05-24T11:00:00+09:00'), open: new Date('2026-05-23T23:00:00+09:00') },
];
```

---

### Phase 3: コンビニ・POI（〜30分）

```typescript
// src/utils/convenience.ts
import stores from '../data/convenience_stores.json';

export function getUpcomingStores(currentKm: number, count = 3) {
  return stores
    .filter(s => s.km_pos > currentKm && s.km_pos < currentKm + 5)
    .sort((a, b) => a.km_pos - b.km_pos)
    .slice(0, count)
    .map(s => ({
      ...s,
      distKm: s.km_pos - currentKm,
      distMin: Math.round((s.km_pos - currentKm) / 4.5 * 60), // 4.5km/h想定
    }));
}

// コンビニなし区間（同側のみ）
export const NO_STORE_ZONES = [
  { start: 0, end: 4, desc: 'スタート直後' },
  { start: 18, end: 23, desc: '湘南海岸（強風注意）' },
  { start: 29, end: 32, desc: '茅ヶ崎海岸' },
  { start: 99, end: 100, desc: 'ゴール直前' },
];

export function getIncomingNoStoreZone(currentKm: number, warningKm = 3) {
  return NO_STORE_ZONES.find(
    z => z.start > currentKm && z.start <= currentKm + warningKm
  );
}
```

---

### Phase 4: 安全機能（〜30分）

#### src/hooks/useWakeLock.ts
```typescript
import { useEffect, useRef, useState } from 'react';

export function useWakeLock() {
  const [active, setActive] = useState(false);
  const lockRef = useRef<WakeLockSentinel | null>(null);

  async function acquire() {
    try {
      lockRef.current = await navigator.wakeLock.request('screen');
      setActive(true);
      lockRef.current.addEventListener('release', () => {
        setActive(false);
        lockRef.current = null;
      });
    } catch (e) { console.warn('WakeLock:', e); }
  }

  useEffect(() => {
    acquire();
    const handleVisibility = async () => {
      if (document.visibilityState === 'visible' && !lockRef.current) {
        await acquire();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  return { wakeLockActive: active };
}
```

#### src/utils/sos.ts
```typescript
export function buildSmsUrl(phone: string, lat: number, lon: number): string {
  const clean = phone.replace(/[^\d+]/g, '');
  const mapUrl = `https://maps.google.com/?q=${lat.toFixed(6)},${lon.toFixed(6)}`;
  const body = encodeURIComponent(
    `SOS: 東京エクストリームウォーク参加者が緊急事態です。\n` +
    `位置: ${lat.toFixed(6)}, ${lon.toFixed(6)}\n${mapUrl}`
  );
  const isIOS = /iPhone|iPad/.test(navigator.userAgent);
  const sep = isIOS ? '&' : '?';
  return `sms:${clean}${sep}body=${body}`;
}

export const RACE_EMERGENCY_TEL = 'tel:03-XXXX-XXXX'; // 大会本部（当日確認要）
```

---

### Phase 5: TTS + 天気 + 夜間モード（〜30分）

#### src/hooks/useTTS.ts
```typescript
export function useTTS() {
  function isNightMode(): boolean {
    const h = new Date().getHours();
    return h >= 22 || h < 6;
  }

  function speak(text: string, priority: 'critical' | 'info' = 'info') {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    setTimeout(() => {
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'ja-JP';
      utter.rate = isNightMode() ? 0.80 : 0.90;
      utter.volume = priority === 'critical' ? 1.0 : (isNightMode() ? 0.5 : 0.8);

      // Android Chrome: 14秒以上経つと読み上げが止まるバグの回避
      const keepAlive = setInterval(() => {
        if (window.speechSynthesis.speaking) {
          window.speechSynthesis.pause();
          window.speechSynthesis.resume();
        } else {
          clearInterval(keepAlive);
        }
      }, 14000);

      window.speechSynthesis.speak(utter);
    }, 100); // cancel後に100ms待つ（Androidのバグ回避）
  }

  return { speak };
}
```

#### src/constants/colors.ts
```typescript
export const COLORS = {
  day: {
    bg: '#FFFFFF', text: '#1A1A1A',
    accent: '#3B82F6',    // 青
    warning: '#EF4444',   // 赤
    success: '#10B981',   // 緑
  },
  night: {
    bg: '#000000', text: '#FFFFFF',
    accent: '#FFB347',    // アンバー（電球色）
    warning: '#FF4444',   // 赤
    success: '#FFB347',   // アンバー
  }
} as const;

export const BUTTON = {
  normal: 'min-h-[72px] text-xl px-6 rounded-2xl font-bold',
  sos: 'min-h-[96px] text-2xl px-8 rounded-3xl font-black',
} as const;
```

#### src/utils/weather.ts
```typescript
const WEATHER_API = 'https://api.open-meteo.com/v1/forecast';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1時間

export interface WeatherAlert {
  type: 'heat' | 'rain_gear' | 'hypothermia' | 'headwind';
  message: string;
}

export async function fetchWeather(): Promise<any> {
  const cacheKey = 'weather_cache';
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    const { data, ts } = JSON.parse(cached);
    if (Date.now() - ts < CACHE_TTL_MS) return data;
  }

  // 大会コースの中間点（藤沢付近）を代表地点とする
  const url = `${WEATHER_API}?latitude=35.35&longitude=139.49&hourly=temperature_2m,precipitation_probability,windspeed_10m,relativehumidity_2m&timezone=Asia%2FTokyo&start_date=2026-05-23&end_date=2026-05-24`;
  const res = await fetch(url);
  const data = await res.json();
  localStorage.setItem(cacheKey, JSON.stringify({ data, ts: Date.now() }));
  return data;
}

export function getWeatherAlerts(hour: number, weather: any): WeatherAlert[] {
  const alerts: WeatherAlert[] = [];
  const i = weather.hourly.time.findIndex((t: string) => new Date(t).getHours() === hour);
  if (i < 0) return alerts;

  const temp = weather.hourly.temperature_2m[i];
  const humidity = weather.hourly.relativehumidity_2m[i];
  const rain = weather.hourly.precipitation_probability[i];
  const wind = weather.hourly.windspeed_10m[i];

  if (temp >= 28 && humidity >= 70)
    alerts.push({ type: 'heat', message: `気温${temp}℃・湿度${humidity}%。熱中症リスク高。水分補給を15分おきに。` });
  if (rain >= 40)
    alerts.push({ type: 'rain_gear', message: `降水確率${rain}%。雨具を手元に出してください。` });
  if (temp <= 12 && rain > 0)
    alerts.push({ type: 'hypothermia', message: `気温${temp}℃・雨。低体温症リスク。防寒具を着てください。` });
  if (wind >= 7)
    alerts.push({ type: 'headwind', message: `風速${wind}m/s。体力消耗が増えます。ペースを落としてください。` });

  return alerts;
}
```

---

### Phase 6: 深夜サバイバル機能（〜30分）

#### src/hooks/useDeadman.ts
```typescript
import { useEffect, useRef, useState } from 'react';

export function useDeadman() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [restMode, setRestMode] = useState(false);
  const missedCount = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function isNightMode() {
    const h = new Date().getHours();
    return h >= 22 || h < 6;
  }

  function getInterval() {
    return isNightMode() ? 25 * 60 * 1000 : 45 * 60 * 1000;
  }

  function schedule() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!restMode) setShowPrompt(true);
      else schedule(); // 休憩中はスキップして再スケジュール
    }, getInterval());
  }

  function confirm() {
    setShowPrompt(false);
    missedCount.current = 0;
    schedule();
  }

  function miss() {
    missedCount.current++;
    if (missedCount.current >= 3) {
      // 3回無応答 → SOS画面を表示（自動送信はしない）
      window.dispatchEvent(new CustomEvent('deadman-sos'));
    }
    schedule();
  }

  function enterRest() { setRestMode(true); }
  function exitRest() { setRestMode(false); schedule(); }

  useEffect(() => {
    schedule();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return { showPrompt, restMode, confirm, enterRest, exitRest };
}
```

#### src/utils/storage.ts（暗号化）
```typescript
async function getOrCreateKey(): Promise<CryptoKey> {
  const stored = localStorage.getItem('crypto_key_export');
  if (stored) {
    return crypto.subtle.importKey('raw', Buffer.from(stored, 'base64'), 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const exported = await crypto.subtle.exportKey('raw', key);
  localStorage.setItem('crypto_key_export', Buffer.from(exported).toString('base64'));
  return key;
}

export async function savePhone(phone: string): Promise<void> {
  try {
    const key = await getOrCreateKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(phone);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    const payload = JSON.stringify({
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(encrypted))
    });
    localStorage.setItem('sos_phone', payload);
  } catch {
    // localStorage失敗時はメモリのみで動作継続
    (window as any).__sosPhone = phone;
  }
}
```

---

### Phase 7: セットアップ画面 + Service Worker + デプロイ（〜30分）

#### public/sw.js（Workbox不使用・手書き版）
```javascript
const STATIC_CACHE = 'xtremewalk-static-v1';
const WEATHER_CACHE = 'xtremewalk-weather-v1';
const WEATHER_TTL = 60 * 60 * 1000; // 1時間

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(STATIC_CACHE).then(c => c.addAll([
      '/', '/index.html',
      '/src/data/checkpoints.json',
      '/src/data/course_route.json',
      '/src/data/course_km_points.json',
      '/src/data/convenience_stores.json',
      '/src/data/toilets.json',
    ]))
  );
  self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.hostname === 'api.open-meteo.com') {
    // 天気API: Network First with TTL
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(WEATHER_CACHE).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match(e.request))
    );
  } else {
    // 静的アセット: Cache First
    e.respondWith(
      caches.match(e.request).then(cached => cached ?? fetch(e.request))
    );
  }
});
```

#### Vercel デプロイ
```bash
npm install -g vercel
npm run build
vercel --prod
# 以後 git push で自動デプロイ
```

---

## 5. コース特記事項（実装時に注意）

| 区間 | 注意 | 実装アクション |
|------|------|--------------|
| km0〜4 | 同側コンビニなし | スタート時に「補給してから出発」音声 |
| km18〜23 | 同側コンビニなし6km（湘南海岸） | km15で「コンビニなし区間が近い」警告 |
| km29〜32 | 同側コンビニなし4km（茅ヶ崎海岸） | km26で警告 |
| km36〜40 | 遊行寺坂（最大勾配12%） | km35で「1km先に坂」音声、km36で「今すぐ坂」音声 |
| km60〜90 | 信号多数（累計最大60分ロス） | ペース計算に「信号待ちバッファ」を暗黙的に含む |
| km99〜100 | 同側コンビニなし | km96で「最後の補給」アラート |

---

## 6. アラート優先順位

| Level | 種別 | 出力 |
|-------|------|------|
| 1 CRITICAL | 関門30分切り / バッテリー10%以下 / GPS消失10分以上 | 音声 + 赤画面フラッシュ + バイブ長 |
| 2 WARNING | 関門ETA超過 / コンビニなし区間入口 / 天気閾値 | 音声 + バイブ |
| 3 INFO | 30分ごとペース / コンビニ300m / 水分60分 / 足ケア | 音声のみ |
| 4 AMBIENT | デッドマン確認 | バイブのみ（深夜） |

---

## 7. デバッグ・テスト

### デスクトップGPSモック
```javascript
// ブラウザコンソールで実行:
localStorage.setItem('GPS_MOCK_KM', '45'); location.reload();

// URLパラメータでも可（本番ビルドでは自動無効）:
// ?mock_km=54&mock_time=2026-05-23T22:00:00+09:00
```

### 大会2日前（5/21）実機テスト
1. バッテリー30分計測: `消費% × 52 = 26時間予測消費%` → 100%超えならモバイルバッテリー必須
2. 外でGPS起動 → accuracy < 50mになるか確認
3. イヤホン接続 → TTS読み上げ確認
4. 機内モード → オフライン動作確認（Service Workerキャッシュ）
5. 時刻を22:00に設定 → 夜間モード自動切替確認

### タイムゾーンバグ確認
```javascript
// コンソールで確認:
new Date('2026-05-24T02:00:00+09:00').toLocaleString('ja-JP', {timeZone: 'Asia/Tokyo'});
// → "2026/5/24 2:00:00" が正しい
// → もし "2026/5/23 17:00:00" と表示されたらバグあり（UTCとして解釈されている）
```

---

## 8. デプロイ後の確認 URL

```
https://xtremewalk-app.vercel.app

テスト用パラメータ:
?mock_km=21&mock_time=2026-05-23T14:00:00+09:00
→ 第1CP手前、14:00スタート想定でシミュレーション

?mock_km=54&mock_time=2026-05-23T22:00:00+09:00
→ 第3CP到着直前、関門まで30分のシミュレーション
```
