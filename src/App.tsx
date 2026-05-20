import { useState, useEffect, useRef } from 'react';
import { SetupScreen } from './screens/SetupScreen';
import { MainScreen } from './screens/MainScreen';
import { useGPS } from './hooks/useGPS';
import { useWakeLock } from './hooks/useWakeLock';
import { useBattery } from './hooks/useBattery';
import { useDeadman } from './hooks/useDeadman';
import { useAlerts } from './hooks/useAlerts';
import { CHECKPOINTS } from './constants/checkpoints';
import { isNightMode } from './constants/colors';
import { getAppState, saveAppState } from './utils/storage';
import { MockPanel, isDebugMode, getMockKm } from './components/MockPanel';
import { fetchWeather, getCurrentWeather } from './utils/weather';
import { calcPaceInfo } from './utils/pace';
import type { PaceInfo } from './utils/pace';
import type { WeatherData } from './utils/weather';

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
        スタート: 藤沢市辻堂海浜公園
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
    requiredPaceKmH: null,
    maxRestMinutes: null,
  });

  const kmSnapshotsRef = useRef<KmSnapshot[]>([]);
  const gpsLostSinceRef = useRef<Date | null>(null);

  // Hooks
  const gps = useGPS(kmPointsData, mockKm);
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

  // Fetch weather on mount and every hour
  useEffect(() => {
    const doFetch = async () => {
      const data = await fetchWeather();
      setWeatherData(data);
    };
    doFetch();
    const interval = setInterval(doFetch, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Track km snapshots for pace
  useEffect(() => {
    if (appState !== 'active') return;
    const now = Date.now();
    kmSnapshotsRef.current.push({ km: gps.currentKm, ts: now });
    // Keep only last 15 minutes
    kmSnapshotsRef.current = kmSnapshotsRef.current.filter(
      (s) => now - s.ts < 15 * 60 * 1000
    );

    // Find km from ~5 min ago
    const fiveMinAgo = now - 5 * 60 * 1000;
    const old = [...kmSnapshotsRef.current]
      .filter((s) => s.ts <= fiveMinAgo)
      .sort((a, b) => b.ts - a.ts)[0];

    const km5minAgo = old?.km ?? null;

    // Compute pace info
    const nextCp = CHECKPOINTS.find((cp) => cp.km > gps.currentKm) ?? null;
    if (nextCp) {
      const info = calcPaceInfo(
        gps.currentKm,
        km5minAgo,
        nextCp.km,
        nextCp.cutoff
      );
      setPaceInfo(info);
    }
  }, [gps.currentKm, appState]);

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
      checkpoints={CHECKPOINTS}
      stores={storesData as import('./utils/convenience').ConvenienceStore[]}
      toilets={toiletsData}
      nightMode={nightMode}
      onRetire={() => transitionTo('retired')}
      onSetup={() => transitionTo('setup')}
    />
    </>
  );
}
