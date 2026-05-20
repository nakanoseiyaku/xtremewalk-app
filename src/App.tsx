import { useState, useEffect, useRef } from 'react';
import { SetupScreen } from './screens/SetupScreen';
import { MainScreen } from './screens/MainScreen';
import { useGPS } from './hooks/useGPS';
import { useWakeLock } from './hooks/useWakeLock';
import { useBattery } from './hooks/useBattery';
import { useDeadman } from './hooks/useDeadman';
import { useAlerts } from './hooks/useAlerts';
import { buildCheckpoints } from './constants/checkpoints';
import { isNightMode } from './constants/colors';
import { getAppState, saveAppState, getSettings } from './utils/storage';
import { MockPanel, isDebugMode, getMockKm } from './components/MockPanel';
import { fetchWeather, getCurrentWeather } from './utils/weather';
import { calcPaceInfo, calcFullProjection } from './utils/pace';
import type { PaceInfo, CPProjection } from './utils/pace';
import type { WeatherData } from './utils/weather';
import { haversineDistance } from './utils/gps';

// Data imports
import kmPointsData from './data/course_km_points.json';
import storesData from './data/convenience_stores.json';
import toiletsData from './data/toilets.json';

type AppState = 'setup' | 'pre_start' | 'active' | 'goal' | 'retired';

// Km-5min-ago tracking
interface KmSnapshot {
  km: number;
  ts: number;
}

function GoalScreen({ onReset }: { onReset: () => void }) {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 text-center">
      <div className="text-8xl mb-6">🎉</div>
      <h1 className="text-4xl font-bold text-amber-400 mb-3">ゴール完走！</h1>
      <p className="text-xl text-gray-300 mb-2">東京エクストリームウォーク100</p>
      <p className="text-gray-400 mb-8">100kmを完歩しました！おめでとうございます！</p>
      <button
        onClick={onReset}
        className="bg-gray-800 text-white px-8 py-4 rounded-2xl text-lg"
      >
        最初からやり直す
      </button>
    </div>
  );
}

function RetiredScreen({ onReset }: { onReset: () => void }) {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6 text-center">
      <div className="text-6xl mb-6">🏳️</div>
      <h1 className="text-3xl font-bold text-gray-300 mb-3">お疲れさまでした</h1>
      <p className="text-gray-400 mb-8">リタイアを記録しました。また次回チャレンジしましょう！</p>
      <button
        onClick={onReset}
        className="bg-gray-800 text-white px-8 py-4 rounded-2xl text-lg"
      >
        最初からやり直す
      </button>
    </div>
  );
}

function PreStartScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6 text-center">
      <div className="text-6xl mb-4">🚶</div>
      <h1 className="text-2xl font-bold text-amber-400 mb-2">スタート待機中</h1>
      <p className="text-gray-400 mb-4">スタート地点に向かってください</p>
      <p className="text-gray-500 text-sm mb-8">
        スタート: 小田原城址公園 銅門広場（神奈川県小田原市）
        <br />
        受付: 7:00〜 / スタート: 7:30〜
      </p>
      <button
        onClick={onStart}
        className="w-full max-w-xs min-h-[72px] bg-amber-500 text-black text-2xl font-bold rounded-2xl active:scale-95 transition-transform"
      >
        ウォーク開始！
      </button>
    </div>
  );
}

export default function App() {
  // Compute effective checkpoints from current settings (raceDate + startTime)
  // Re-computed every render so settings changes (after returning from setup) are picked up immediately
  const _settings = getSettings();
  const effectiveCheckpoints = buildCheckpoints(_settings.raceDate, _settings.startTime);
  const effectiveStartDate = new Date(`${_settings.raceDate}T${_settings.startTime}:00+09:00`);

  const [appState, setAppState] = useState<AppState>(() => {
    const saved = getAppState();
    if (['setup', 'pre_start', 'active', 'goal', 'retired'].includes(saved)) {
      return saved as AppState;
    }
    return 'setup';
  });

  const [nightMode, setNightMode] = useState(isNightMode);
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [debugMode] = useState(isDebugMode);
  const [mockKm, setMockKm] = useState<number | null>(getMockKm);
  const [paceInfo, setPaceInfo] = useState<PaceInfo>({
    currentPaceKmH: 0,
    predictedPaceKmH: 0,
    etaToNextCp: null,
    marginMinutes: null,
    targetMarginMinutes: null,
    requiredPaceKmH: null,
    maxRestMinutes: null,
  });

  const [projections, setProjections] = useState<CPProjection[]>([]);

  const kmSnapshotsRef = useRef<KmSnapshot[]>([]);
  const gpsLostSinceRef = useRef<Date | null>(null);
  const lastWeatherPosRef = useRef<{ lat: number; lng: number } | null>(null);

  // Hooks
  const gps = useGPS(kmPointsData, mockKm, appState === 'active');
  const wakeLock = useWakeLock();
  const battery = useBattery();
  const deadman = useDeadman(appState === 'active');

  // Update night mode every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setNightMode(isNightMode());
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch weather on mount (initial, before GPS is available)
  useEffect(() => {
    fetchWeather().then(setWeatherData);
  }, []);

  // GPS-following weather: re-fetch every 2 km of movement
  useEffect(() => {
    if (gps.lat === null || gps.lng === null) return;
    const last = lastWeatherPosRef.current;
    if (
      !last ||
      haversineDistance({ lat: gps.lat, lng: gps.lng }, last) > 2000
    ) {
      lastWeatherPosRef.current = { lat: gps.lat, lng: gps.lng };
      fetchWeather(gps.lat, gps.lng).then(setWeatherData);
    }
  }, [gps.lat, gps.lng]);

  // Track km snapshots for pace (30-min moving average window)
  useEffect(() => {
    if (appState !== 'active') return;
    const now = Date.now();
    kmSnapshotsRef.current.push({ km: gps.currentKm, ts: now });
    // Keep last 35 minutes so we always have a point at ~30 min ago
    kmSnapshotsRef.current = kmSnapshotsRef.current.filter(
      (s) => now - s.ts < 35 * 60 * 1000
    );

    // Find the most recent snapshot at or before 30 min ago
    const thirtyMinAgo = now - 30 * 60 * 1000;
    const old = [...kmSnapshotsRef.current]
      .filter((s) => s.ts <= thirtyMinAgo)
      .sort((a, b) => b.ts - a.ts)[0];

    const kmNMinAgo = old?.km ?? null;
    const elapsedMin = old ? (now - old.ts) / 60000 : null;

    // Compute pace info
    const nextCp = effectiveCheckpoints.find((cp) => cp.km > gps.currentKm) ?? null;
    if (nextCp) {
      const s = getSettings();
      const nextCpTargetArrival = new Date(
        effectiveStartDate.getTime() + (nextCp.km / 100) * s.targetHours * 3_600_000
      );
      const info = calcPaceInfo(
        gps.currentKm,
        kmNMinAgo,
        elapsedMin,
        nextCp.km,
        nextCp.cutoff,
        nextCpTargetArrival,
      );
      setPaceInfo(info);
    }
  }, [gps.currentKm, appState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute full CP projections when pace/km changes
  useEffect(() => {
    if (paceInfo.currentPaceKmH <= 0 || appState !== 'active') return;
    const s = getSettings();
    const p = calcFullProjection(
      gps.currentKm,
      paceInfo.currentPaceKmH,
      effectiveCheckpoints,
      effectiveStartDate,
      s.targetHours,
    );
    setProjections(p);
  }, [gps.currentKm, paceInfo.currentPaceKmH, appState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track GPS lost
  useEffect(() => {
    if (gps.status === 'lost') {
      if (!gpsLostSinceRef.current) {
        gpsLostSinceRef.current = new Date();
      }
    } else {
      gpsLostSinceRef.current = null;
    }
  }, [gps.status]);

  const weatherCondition = getCurrentWeather(weatherData);

  // Alerts
  useAlerts({
    currentKm: gps.currentKm,
    marginMinutes: paceInfo.marginMinutes,
    batteryLevel: battery.level,
    gpsStatus: gps.status,
    gpsLostSince: gpsLostSinceRef.current,
    weatherCondition,
    paceKmH: paceInfo.currentPaceKmH,
    active: appState === 'active',
    stores: storesData as import('./utils/convenience').ConvenienceStore[],
  });

  const transitionTo = (state: AppState) => {
    setAppState(state);
    saveAppState(state);
  };

  if (appState === 'setup') {
    return <SetupScreen onComplete={() => transitionTo('pre_start')} />;
  }

  if (appState === 'pre_start') {
    return <PreStartScreen onStart={() => transitionTo('active')} />;
  }

  if (appState === 'goal') {
    return <GoalScreen onReset={() => transitionTo('setup')} />;
  }

  if (appState === 'retired') {
    return <RetiredScreen onReset={() => transitionTo('setup')} />;
  }

  // Active state
  return (
    <>
    {debugMode && (
      <MockPanel
        currentKm={gps.currentKm}
        onMockKmChange={setMockKm}
      />
    )}
    <MainScreen
      gps={gps}
      wakeLock={wakeLock}
      battery={battery}
      deadman={deadman}
      paceInfo={paceInfo}
      weatherCondition={weatherCondition}
      checkpoints={effectiveCheckpoints}
      stores={storesData as import('./utils/convenience').ConvenienceStore[]}
      toilets={toiletsData}
      nightMode={nightMode}
      onRetire={() => transitionTo('retired')}
      onSetup={() => transitionTo('setup')}
      projections={projections}
    />
    </>
  );
}
