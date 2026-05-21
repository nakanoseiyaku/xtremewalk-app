import { useState, useEffect, useRef, useMemo } from 'react';
import { SetupScreen } from './screens/SetupScreen';
import { MainScreen } from './screens/MainScreen';
import { useGPS } from './hooks/useGPS';
import { useWakeLock } from './hooks/useWakeLock';
import { useBattery } from './hooks/useBattery';
import { useAlerts } from './hooks/useAlerts';
import { buildCheckpoints } from './constants/checkpoints';
import { isNightMode } from './constants/colors';
import { getAppState, saveAppState, getSettings, savePaceHistory, loadPaceHistory, saveCpVisits, loadCpVisits, loadRaceStartedAt, saveRaceStartedAt, getMusicMode, saveMusicMode } from './utils/storage';
import type { CPVisit } from './utils/storage';
import { useTTS } from './hooks/useTTS';
import { MockPanel, isDebugMode, getMockKm } from './components/MockPanel';
import { useScreenSleep } from './hooks/useScreenSleep';
import { useMotionSensor } from './hooks/useMotionSensor';
import { useGPSKeepalive } from './hooks/useGPSKeepalive';
import { resetStepBaseline } from './services/stepProvider';
import { fetchWeather, getCurrentWeather } from './utils/weather';
import { calcPaceInfo, calcFullProjection } from './utils/pace';
import type { PaceInfo, CPProjection } from './utils/pace';
import type { PacePoint } from './components/PaceGraph';
import type { WeatherData } from './utils/weather';
import { haversineDistance } from './utils/gps';
import type { KmPoint } from './utils/gps';
import { enrichToilets } from './utils/toilet';

// Data imports
import kmPointsData from './data/course_km_points.json';
import storesData from './data/convenience_stores.json';
import toiletsData from './data/toilets.json';

// Pre-compute toilet km positions once at module load (not in a hook — data never changes)
const enrichedToilets = enrichToilets(
  toiletsData as { name: string; lat: number; lng: number }[],
  kmPointsData as KmPoint[]
);

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
  // appState drives settings re-read: settings change only when user completes setup,
  // which transitions appState. GPS updates don't change appState, so no wasted reads.
  const [appState, setAppState] = useState<AppState>(() => {
    const saved = getAppState();
    const valid = ['setup', 'pre_start', 'active', 'goal', 'retired'].includes(saved)
      ? (saved as AppState)
      : 'setup';
    // Legacy migration: a user mid-race on a pre-this-version build has no
    // recorded start timestamp — backfill it before the first render.
    if (valid === 'active' && loadRaceStartedAt() === null) {
      saveRaceStartedAt(Date.now());
    }
    return valid;
  });

  // Race start = the moment the user pressed the start button (persisted).
  const raceStartedAt = useMemo(() => loadRaceStartedAt(), [appState]);
  const effectiveStartDate = useMemo(
    () => (raceStartedAt != null ? new Date(raceStartedAt) : new Date()),
    [raceStartedAt]
  );
  const effectiveCheckpoints = useMemo(
    () => buildCheckpoints(effectiveStartDate),
    [effectiveStartDate]
  );

  const [nightMode, setNightMode] = useState(isNightMode);
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [debugMode] = useState(isDebugMode);
  const [musicMode, setMusicMode] = useState(getMusicMode);
  const toggleMusicMode = () => {
    setMusicMode((prev) => {
      const next = !prev;
      saveMusicMode(next);
      return next;
    });
  };
  const [mockKm, setMockKm] = useState<number | null>(getMockKm);
  // Debug-only: simulate being near a checkpoint without real GPS.
  const [mockNearCpKm, setMockNearCpKm] = useState<number | null>(null);
  // Debug-only: simulate a pace so the forecast can be verified without GPS.
  const [mockPaceKmH, setMockPaceKmH] = useState<number | null>(null);
  // Checkpoint arrival/departure records (drives 通過記録 + projection progress).
  const [cpVisits, setCpVisits] = useState<CPVisit[]>(() => loadCpVisits());
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
  const [forecastProvisional, setForecastProvisional] = useState(true);

  const kmSnapshotsRef = useRef<KmSnapshot[]>([]);
  const paceHistoryRef = useRef<PacePoint[]>(
    appState === 'active' ? loadPaceHistory() : []
  );
  const gpsLostSinceRef = useRef<Date | null>(null);
  const lastWeatherPosRef = useRef<{ lat: number; lng: number } | null>(null);

  // Hooks
  const gps = useGPS(kmPointsData, mockKm, appState === 'active');
  useGPSKeepalive(appState === 'active');
  const wakeLock = useWakeLock();
  const battery = useBattery();
const screenSleep = useScreenSleep(battery.charging);
  const motion = useMotionSensor();
  useTTS();

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
    if (!gps.currentKm || isNaN(gps.currentKm)) return;
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

      // Accumulate pace history for graph (1 point per km) and persist
      if (info.currentPaceKmH > 0) {
        const history = paceHistoryRef.current;
        const last = history[history.length - 1];
        if (!last || gps.currentKm - last.km >= 1) {
          const next = [...history, { km: gps.currentKm, paceKmH: info.currentPaceKmH }];
          paceHistoryRef.current = next;
          savePaceHistory(next);
        }
      }
    }
  }, [gps.currentKm, appState, effectiveCheckpoints, effectiveStartDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist checkpoint visit records
  useEffect(() => {
    saveCpVisits(cpVisits);
  }, [cpVisits]);

  // Compute full CP projections when pace/km/check-ins change
  useEffect(() => {
    if (appState !== 'active') return;
    const s = getSettings();
    const departed = cpVisits.filter((v) => v.departedAt !== null);
    const departedCpKms = departed.map((v) => v.km);
    // Anchor for the check-in-derived forecast: the last departed CP.
    const lastDeparted = departed.length
      ? departed.reduce((a, b) => (b.km > a.km ? b : a))
      : null;
    const checkInAnchor =
      lastDeparted && lastDeparted.departedAt != null && raceStartedAt != null
        ? { km: lastDeparted.km, departedAtMs: lastDeparted.departedAt }
        : null;
    const effectivePace = mockPaceKmH ?? paceInfo.currentPaceKmH;
    const p = calcFullProjection(
      gps.currentKm,
      effectivePace,
      effectiveCheckpoints,
      effectiveStartDate,
      s.targetHours,
      departedCpKms,
      new Date(),
      checkInAnchor,
    );
    setProjections(p);
    setForecastProvisional(effectivePace <= 0 && checkInAnchor == null);
  }, [gps.currentKm, paceInfo.currentPaceKmH, appState, effectiveCheckpoints, effectiveStartDate, cpVisits, raceStartedAt, mockPaceKmH]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Memoize: getCurrentWeather only re-runs when weatherData changes (every ~2km), not on every GPS tick
  const weatherCondition = useMemo(() => getCurrentWeather(weatherData), [weatherData]);

  // Alerts
  const { nutritionDue, lastAlert } = useAlerts({
    currentKm: gps.currentKm,
    marginMinutes: paceInfo.marginMinutes,
    batteryLevel: battery.level,
    gpsStatus: gps.status,
    gpsLostSince: gpsLostSinceRef.current,
    weatherCondition,
    paceKmH: paceInfo.currentPaceKmH,
    active: appState === 'active',
    raceStartedAt,
    stores: storesData as import('./utils/convenience').ConvenienceStore[],
    wakeScreen: screenSleep.wakeFor,
    isWalking: motion.isWalking,
    cadence: motion.cadence,
    musicMode,
  });

  const transitionTo = (state: AppState) => {
    if (state === 'active') {
      paceHistoryRef.current = [];
      kmSnapshotsRef.current = [];
      savePaceHistory([]);
      setCpVisits([]);
      saveRaceStartedAt(Date.now());
      void resetStepBaseline();
    }
    if (state === 'setup') {
      savePaceHistory([]);
      setCpVisits([]);
      saveRaceStartedAt(null);
    }
    setAppState(state);
    saveAppState(state);
  };

  // Goal detection: km >= 100 while active
  useEffect(() => {
    if (appState === 'active' && gps.currentKm >= 100) {
      transitionTo('goal');
    }
  }, [gps.currentKm, appState]); // eslint-disable-line react-hooks/exhaustive-deps

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
        mockNearCpKm={mockNearCpKm}
        onMockNearCpChange={setMockNearCpKm}
        mockPaceKmH={mockPaceKmH}
        onMockPaceChange={setMockPaceKmH}
      />
    )}
    <MainScreen
      gps={gps}
      wakeLock={wakeLock}
      battery={battery}
      paceInfo={paceInfo}
      weatherCondition={weatherCondition}
      checkpoints={effectiveCheckpoints}
      raceStartedAt={raceStartedAt}
      mockNearCpKm={mockNearCpKm}
      cpVisits={cpVisits}
      setCpVisits={setCpVisits}
      forecastProvisional={forecastProvisional}
      stores={storesData as import('./utils/convenience').ConvenienceStore[]}
      toilets={enrichedToilets}
      nightMode={nightMode}
      onRetire={() => transitionTo('retired')}
      onSetup={() => transitionTo('setup')}
      projections={projections}
      nutritionDue={nutritionDue}
      stepCount={motion.stepCount}
      cadence={motion.cadence}
      isSleeping={screenSleep.isSleeping}
      wakeScreen={screenSleep.wakeFor}
      onSleepNow={screenSleep.sleep}
      paceHistory={paceHistoryRef.current}
      musicMode={musicMode}
      onMusicModeToggle={toggleMusicMode}
      lastAlert={lastAlert}
    />
    </>
  );
}
