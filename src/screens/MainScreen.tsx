import { useState, useEffect } from 'react';
import { TopBar } from '../components/TopBar';
import { WeatherBar } from '../components/WeatherBar';
import { SOSOverlay } from '../components/SOSOverlay';
import { DeadmanPrompt } from '../components/DeadmanPrompt';
import { AIChat } from './AIChat';
import { CPArrivalScreen } from './CPArrivalScreen';
import type { GPSState } from '../hooks/useGPS';
import type { WakeLockState } from '../hooks/useWakeLock';
import type { BatteryState } from '../hooks/useBattery';
import type { DeadmanStatus } from '../hooks/useDeadman';
import type { WeatherCondition } from '../utils/weather';
import type { Checkpoint } from '../constants/checkpoints';
import type { ConvenienceStore } from '../utils/convenience';
import { getNextStores, minutesToStore } from '../utils/convenience';
import { formatTime, formatMargin, formatPace } from '../utils/pace';
import type { PaceInfo } from '../utils/pace';
import { getSettings } from '../utils/storage';
import { haversineDistance } from '../utils/gps';

interface ToiletEntry {
  name: string;
  lat: number;
  lng: number;
  km_pos?: number;
}

interface MainScreenProps {
  gps: GPSState;
  wakeLock: WakeLockState;
  battery: BatteryState;
  deadman: DeadmanStatus;
  paceInfo: PaceInfo;
  weatherCondition: WeatherCondition | null;
  checkpoints: Checkpoint[];
  stores: ConvenienceStore[];
  toilets: ToiletEntry[];
  nightMode: boolean;
  onRetire: () => void;
}

type SubScreen = 'main' | 'ai_chat' | 'cp_arrival';

export function MainScreen({
  gps,
  wakeLock,
  battery,
  deadman,
  paceInfo,
  weatherCondition,
  checkpoints,
  stores,
  toilets,
  nightMode,
  onRetire,
}: MainScreenProps) {
  const [subScreen, setSubScreen] = useState<SubScreen>('main');
  const [showSOS, setShowSOS] = useState(false);
  const [aiInitialMessage, setAiInitialMessage] = useState<string | undefined>();
  const settings = getSettings();

  const bg = nightMode ? 'bg-black' : 'bg-gray-950';
  const card = nightMode ? 'bg-gray-900 border-gray-800' : 'bg-gray-800 border-gray-700';
  const accent = nightMode ? 'text-amber-400' : 'text-amber-400';

  // Find next CP (first CP with km > currentKm)
  const nextCp = checkpoints.find((cp) => cp.km > gps.currentKm) ?? null;

  // Check if near a CP (within 100m)
  const nearCp = checkpoints.find((cp) => {
    if (gps.lat === null || gps.lng === null) return false;
    if (cp.km > gps.currentKm + 0.5) return false;
    const distM = haversineDistance(
      { lat: gps.lat, lng: gps.lng },
      { lat: cp.lat, lng: cp.lng }
    );
    return distM <= 100;
  });

  // Near CP sub-screen
  const effectiveCp = nearCp ?? nextCp;

  // Next stores
  const nextStores = getNextStores(stores, gps.currentKm, 3);

  const marginIsNegative =
    paceInfo.marginMinutes !== null && paceInfo.marginMinutes < 0;
  const marginIsClose =
    paceInfo.marginMinutes !== null &&
    paceInfo.marginMinutes >= 0 &&
    paceInfo.marginMinutes < 30;

  const openAIChat = (msg?: string) => {
    setAiInitialMessage(msg);
    setSubScreen('ai_chat');
  };

  // Show CP arrival automatically when near
  useEffect(() => {
    if (nearCp && subScreen === 'main') {
      setSubScreen('cp_arrival');
    }
  }, [nearCp, subScreen]);

  if (showSOS) {
    return (
      <SOSOverlay
        phone={settings.emergencyPhone}
        lat={gps.lat}
        lng={gps.lng}
        onCancel={() => setShowSOS(false)}
      />
    );
  }

  if (subScreen === 'ai_chat') {
    return (
      <AIChat
        currentKm={gps.currentKm}
        paceKmH={paceInfo.currentPaceKmH}
        nextCp={nextCp}
        marginMinutes={paceInfo.marginMinutes}
        nightMode={nightMode}
        initialMessage={aiInitialMessage}
        onClose={() => setSubScreen('main')}
      />
    );
  }

  if (subScreen === 'cp_arrival' && effectiveCp) {
    return (
      <CPArrivalScreen
        cp={effectiveCp}
        currentKm={gps.currentKm}
        paceKmH={paceInfo.currentPaceKmH}
        toilets={toilets}
        nextStores={nextStores}
        nightMode={nightMode}
        onDepart={() => setSubScreen('main')}
      />
    );
  }

  return (
    <div className={`min-h-screen ${bg} text-white flex flex-col`}>
      {/* Top bar */}
      <TopBar
        currentKm={gps.currentKm}
        battery={battery}
        wakeLockStatus={wakeLock.status}
        gpsStatus={gps.status}
        nightMode={nightMode}
      />

      {/* Weather bar */}
      <WeatherBar condition={weatherCondition} nightMode={nightMode} />

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 pb-4">

        {/* ===== MAIN KPI SECTION (40% screen height) ===== */}
        <div
          className={`${card} border rounded-2xl p-4`}
          style={{ minHeight: '40vh' }}
        >
          {nextCp ? (
            <>
              {/* Next CP name */}
              <div className="text-center mb-3">
                <p className="text-gray-400 text-xs uppercase tracking-wider">次のチェックポイント</p>
                <h2 className={`text-lg font-bold ${accent} leading-tight mt-1`}>
                  {nextCp.name}
                </h2>
                <p className="text-gray-400 text-sm">{nextCp.km}km地点</p>
              </div>

              {/* ETA and cutoff */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="text-center">
                  <p className="text-gray-400 text-xs">予想到着</p>
                  <p className="text-3xl font-mono font-bold text-white">
                    {paceInfo.etaToNextCp ? formatTime(paceInfo.etaToNextCp) : '--:--'}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-gray-400 text-xs">制限時刻</p>
                  <p className="text-3xl font-mono font-bold text-gray-300">
                    {formatTime(nextCp.cutoff)}
                  </p>
                </div>
              </div>

              {/* Margin */}
              <div
                className={`rounded-xl p-3 text-center ${
                  marginIsNegative
                    ? 'bg-red-900 animate-pulse'
                    : marginIsClose
                    ? 'bg-orange-900'
                    : 'bg-green-900'
                }`}
              >
                <p className="text-xs text-gray-300 mb-1">マージン</p>
                <p
                  className={`text-3xl font-mono font-bold ${
                    marginIsNegative
                      ? 'text-red-300'
                      : marginIsClose
                      ? 'text-orange-300'
                      : 'text-green-300'
                  }`}
                >
                  {paceInfo.marginMinutes !== null
                    ? (marginIsNegative ? '' : '✅ ') + formatMargin(paceInfo.marginMinutes)
                    : '--'}
                </p>
                {marginIsNegative && (
                  <p className="text-red-400 text-sm font-bold mt-1">⚠ ペースを上げてください</p>
                )}
              </div>

              {/* Current pace / Required pace */}
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="text-center">
                  <p className="text-gray-400 text-xs">現在ペース</p>
                  <p className={`text-2xl font-mono font-bold ${accent}`}>
                    {formatPace(paceInfo.currentPaceKmH)}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-gray-400 text-xs">必要ペース</p>
                  <p className="text-2xl font-mono font-bold text-gray-300">
                    {paceInfo.requiredPaceKmH !== null
                      ? formatPace(paceInfo.requiredPaceKmH)
                      : '--'}
                  </p>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-8">
              <div className="text-5xl mb-3">🎉</div>
              <h2 className="text-2xl font-bold text-amber-400">ゴール達成！</h2>
              <p className="text-gray-400 mt-2">{gps.currentKm.toFixed(1)}km完歩</p>
            </div>
          )}
        </div>

        {/* ===== CONVENIENCE STORES SECTION ===== */}
        <div className={`${card} border rounded-2xl p-4`}>
          <h3 className={`font-bold ${accent} mb-3`}>前方のコンビニ</h3>
          {nextStores.length === 0 ? (
            <p className="text-gray-500 text-sm">前方にコンビニ情報なし</p>
          ) : (
            <div className="space-y-3">
              {nextStores.map((store, i) => {
                const distKm = store.km_pos - gps.currentKm;
                const mins = minutesToStore(
                  store.km_pos,
                  gps.currentKm,
                  paceInfo.currentPaceKmH
                );
                return (
                  <div
                    key={i}
                    className="flex justify-between items-start border-b border-gray-700 last:border-0 pb-2 last:pb-0"
                  >
                    <div>
                      <p className="font-bold text-sm text-white">{store.name}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        <span className="text-gray-400 text-xs">{store.side_ja}</span>
                        {store.access === 'cross_road' && (
                          <span className="text-yellow-400 text-xs font-bold">[要横断]</span>
                        )}
                        {store.is_24h === true && (
                          <span className="text-green-400 text-xs font-bold">24h</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-3">
                      <p className="text-white font-mono font-bold">
                        {distKm.toFixed(1)}km
                      </p>
                      {mins !== null && (
                        <p className="text-gray-400 text-xs">
                          約{Math.round(mins)}分
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ===== ACTION BUTTONS ===== */}
        <div className="space-y-3">
          {/* CP arrival */}
          {nextCp && (
            <button
              onClick={() => setSubScreen('cp_arrival')}
              className="w-full min-h-[72px] bg-blue-700 text-white text-xl font-bold rounded-2xl active:scale-95 transition-transform"
            >
              CP到着 🏁
            </button>
          )}

          {/* AI Chat presets */}
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => openAIChat('右かかとが痛くて歩くのがつらいです。どうすればいいですか？')}
              className="min-h-[72px] bg-gray-700 text-white text-sm font-bold rounded-2xl active:scale-95 transition-transform p-2"
            >
              足が<br />痛い
            </button>
            <button
              onClick={() => openAIChat('眠くて限界です。眠気覚ましの方法を教えてください。')}
              className="min-h-[72px] bg-gray-700 text-white text-sm font-bold rounded-2xl active:scale-95 transition-transform p-2"
            >
              眠い
            </button>
            <button
              onClick={() => openAIChat('気持ち悪くて、吐き気がします。どうすればいいですか？')}
              className="min-h-[72px] bg-gray-700 text-white text-sm font-bold rounded-2xl active:scale-95 transition-transform p-2"
            >
              気持ち<br />悪い
            </button>
          </div>

          {/* AI Chat free text */}
          <button
            onClick={() => openAIChat(undefined)}
            className="w-full min-h-[72px] bg-gray-700 text-white text-lg font-bold rounded-2xl active:scale-95 transition-transform"
          >
            💬 AIコーチに相談
          </button>

          {/* SOS */}
          <button
            onClick={() => setShowSOS(true)}
            className="w-full min-h-[96px] bg-red-600 text-white text-2xl font-bold rounded-2xl active:scale-95 transition-transform shadow-lg"
            aria-label="緊急SOS"
          >
            🆘 SOS 緊急
          </button>

          {/* Retire */}
          <button
            onClick={() => {
              if (confirm('本当にリタイアしますか？')) onRetire();
            }}
            className="w-full min-h-[72px] bg-gray-800 text-gray-400 text-lg font-bold rounded-2xl border border-gray-600 active:scale-95 transition-transform"
          >
            リタイアする
          </button>
        </div>
      </div>

      {/* Deadman prompt overlay */}
      <DeadmanPrompt
        deadman={deadman}
        nightMode={nightMode}
        onSOS={() => setShowSOS(true)}
      />
    </div>
  );
}
