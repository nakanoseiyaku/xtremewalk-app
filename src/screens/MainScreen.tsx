import { useState, useEffect, useMemo } from 'react';
import { TopBar } from '../components/TopBar';
import { WeatherBar } from '../components/WeatherBar';
import { MapView } from '../components/MapView';
import { SOSOverlay } from '../components/SOSOverlay';
import { AIChat } from './AIChat';
import { CPArrivalScreen } from './CPArrivalScreen';
import type { GPSState } from '../hooks/useGPS';
import type { WakeLockState } from '../hooks/useWakeLock';
import type { BatteryState } from '../hooks/useBattery';
import type { WeatherCondition } from '../utils/weather';
import type { Checkpoint } from '../constants/checkpoints';
import type { ConvenienceStore } from '../utils/convenience';
import { getNextStores, minutesToStore } from '../utils/convenience';
import { getNextToilets } from '../utils/toilet';
import type { ToiletEntry } from '../utils/toilet';
import { formatTime, formatMargin, formatPace } from '../utils/pace';
import type { PaceInfo, CPProjection } from '../utils/pace';
import { getSettings } from '../utils/storage';
import { getActionAdvice } from '../utils/actionAdvice';
import { PaceGraph } from '../components/PaceGraph';
import type { PacePoint } from '../components/PaceGraph';
import { haversineDistance } from '../utils/gps';

interface MainScreenProps {
  gps: GPSState;
  wakeLock: WakeLockState;
  battery: BatteryState;
  paceInfo: PaceInfo;
  weatherCondition: WeatherCondition | null;
  checkpoints: Checkpoint[];
  stores: ConvenienceStore[];
  toilets: ToiletEntry[];
  nightMode: boolean;
  onRetire: () => void;
  onSetup: () => void;
  projections: CPProjection[];
  nutritionDue?: boolean;
  isSleeping?: boolean;
  wakeScreen?: (ms?: number) => void;
  onSleepNow?: () => void;
  paceHistory?: PacePoint[];
  stepCount?: number;
  cadence?: number | null;
}

type SubScreen = 'main' | 'ai_chat' | 'cp_arrival';

export function MainScreen({
  gps,
  wakeLock,
  battery,
  paceInfo,
  weatherCondition,
  checkpoints,
  stores,
  toilets,
  nightMode,
  onRetire,
  onSetup,
  projections,
  nutritionDue = false,
  isSleeping = false,
  wakeScreen,
  onSleepNow,
  paceHistory = [],
  stepCount = 0,
  cadence = null,
}: MainScreenProps) {
  const [subScreen, setSubScreen] = useState<SubScreen>('main');
  const [showSOS, setShowSOS] = useState(false);
  const [aiInitialMessage, setAiInitialMessage] = useState<string | undefined>();
  const [showMap, setShowMap] = useState(false);
  const [showProjection, setShowProjection] = useState(true);
  // Settings don't change during the race; re-reads only on mount (after returning from setup screen)
  const settings = useMemo(() => getSettings(), []);

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

  // Next CP after effectiveCp (for CPArrivalScreen rest time calculation)
  const nextCpAfterEffective = effectiveCp
    ? checkpoints.find((cp) => cp.km > effectiveCp.km) ?? null
    : nextCp;
  const targetArrivalAtNextCp = nextCpAfterEffective
    ? projections.find((p) => p.cp.km === nextCpAfterEffective.km)?.targetArrival ?? null
    : null;

  // Next stores
  const nextStores = getNextStores(stores, gps.currentKm, 3);
  const nextToilets = getNextToilets(toilets, gps.currentKm, 2);

  const marginIsNegative =
    paceInfo.marginMinutes !== null && paceInfo.marginMinutes < 0;
  // Target arrival for next CP: computed directly from settings (independent of pace data)
  // so it shows even when pace=0 (race just started, or GPS lost)
  const effectiveStartDate = new Date(`${settings.raceDate}T${settings.startTime}:00+09:00`);
  const nextCpTargetArrival = nextCp
    ? new Date(effectiveStartDate.getTime() + (nextCp.km / 100) * settings.targetHours * 3_600_000)
    : null;
  // Target margin status flags (vs 26h plan)
  const targetMarginIsNegative = paceInfo.targetMarginMinutes !== null && paceInfo.targetMarginMinutes < 0;
  const targetMarginIsNegativeBig = paceInfo.targetMarginMinutes !== null && paceInfo.targetMarginMinutes < -30;

  // Action advice based on current situation
  const advice = getActionAdvice({
    currentKm: gps.currentKm,
    targetMarginMinutes: paceInfo.targetMarginMinutes,
    marginMinutes: paceInfo.marginMinutes,
    currentPaceKmH: paceInfo.currentPaceKmH,
    predictedPaceKmH: paceInfo.predictedPaceKmH,
    nightMode,
    isRaining: weatherCondition?.isRain ?? false,
  });

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
        nextCp={nextCpAfterEffective}
        targetArrivalAtNextCp={targetArrivalAtNextCp}
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

      {/* GPS permission denied banner */}
      {gps.status === 'permission_denied' && (
        <div className="mx-3 mt-2 bg-red-900 border border-red-600 text-white p-3 rounded-xl">
          <p className="font-bold text-sm">📍 GPS が無効です</p>
          <p className="text-xs text-red-200 mt-1">
            設定 → Chrome → 位置情報 → 許可 にしてからページを再読み込みしてください。
          </p>
        </div>
      )}

      {/* Weather bar */}
      <WeatherBar condition={weatherCondition} nightMode={nightMode} />

      {/* Map toggle */}
      <div className="px-3 pt-2">
        <button
          onClick={() => setShowMap((v) => !v)}
          className={`w-full min-h-[48px] rounded-2xl text-sm font-bold border transition-colors active:scale-95 ${
            showMap
              ? 'bg-amber-500 text-black border-amber-400'
              : 'bg-gray-800 text-gray-300 border-gray-700'
          }`}
        >
          {showMap ? '🗺️ 地図を閉じる' : '🗺️ 地図を開く'}
        </button>
        {showMap && (
          <div className="mt-2">
            <MapView gps={gps} stores={stores} nightMode={nightMode} nextCpKm={nextCp?.km ?? null} />
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 pb-4">

        {/* Nutrition reminder badge — shows for 5 min after TTS fires */}
        {nutritionDue && (
          <div className="bg-yellow-500 text-black text-sm font-bold px-3 py-2 rounded-xl text-center animate-pulse">
            🍙 補給タイム！ おにぎり・羊羹・スポドリ
          </div>
        )}

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
                <p className="text-white text-2xl font-mono font-bold mt-1">
                  あと {Math.max(0, nextCp.km - gps.currentKm).toFixed(1)}<span className="text-base font-normal text-gray-400"> km</span>
                </p>
              </div>

              {/* ETA | Target | Cutoff — 3 columns */}
              <div className="grid grid-cols-3 gap-1 mb-3">
                <div className="text-center">
                  <p className="text-gray-400 text-xs">予想到着</p>
                  <p className="text-xl font-mono font-bold text-white">
                    {paceInfo.etaToNextCp ? formatTime(paceInfo.etaToNextCp) : '--:--'}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-amber-400 text-xs">目標時刻</p>
                  <p className="text-xl font-mono font-bold text-amber-300">
                    {nextCpTargetArrival ? formatTime(nextCpTargetArrival) : '--:--'}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-gray-500 text-xs">制限時刻</p>
                  <p className="text-xl font-mono font-bold text-gray-500">
                    {formatTime(nextCp.cutoff)}
                  </p>
                </div>
              </div>

              {/* Pace status + action advice */}
              <div
                className={`rounded-xl p-3 ${
                  marginIsNegative || targetMarginIsNegativeBig
                    ? 'bg-red-900 animate-pulse'
                    : targetMarginIsNegative
                    ? 'bg-orange-900'
                    : 'bg-green-900'
                }`}
              >
                {/* Status label */}
                <p className={`text-sm font-bold text-center mb-1 ${
                  marginIsNegative || targetMarginIsNegativeBig
                    ? 'text-red-200'
                    : targetMarginIsNegative
                    ? 'text-orange-200'
                    : 'text-green-200'
                }`}>
                  {advice.situation}
                </p>

                {/* Margin value */}
                <p
                  className={`text-3xl font-mono font-bold text-center ${
                    marginIsNegative || targetMarginIsNegativeBig
                      ? 'text-red-300'
                      : targetMarginIsNegative
                      ? 'text-orange-300'
                      : 'text-green-300'
                  }`}
                >
                  {paceInfo.targetMarginMinutes !== null
                    ? formatMargin(paceInfo.targetMarginMinutes)
                    : '--'}
                </p>
                <p className="text-center text-xs text-gray-300 mb-2">（目標まで）</p>

                {/* Secondary: cutoff margin */}
                {paceInfo.marginMinutes !== null && (
                  <p className={`text-xs text-center ${marginIsNegative ? 'text-red-300' : 'text-gray-400'}`}>
                    関門余裕: {formatMargin(paceInfo.marginMinutes)}
                  </p>
                )}

                {/* Action tips */}
                <div className="mt-2 pt-2 border-t border-white/20">
                  <p className="text-xs text-gray-300 mb-1">💡 今やること</p>
                  <ul className="space-y-0.5">
                    {advice.tips.map((tip, i) => (
                      <li key={i} className="text-sm text-white">• {tip}</li>
                    ))}
                  </ul>
                </div>
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
                  <p className="text-gray-400 text-xs">目標達成に必要</p>
                  <p className="text-2xl font-mono font-bold text-gray-300">
                    {paceInfo.requiredPaceKmH !== null
                      ? formatPace(paceInfo.requiredPaceKmH)
                      : '--'}
                  </p>
                </div>
              </div>

              {/* Cadence / Step count */}
              <div className="grid grid-cols-2 gap-3 mt-3 border-t border-gray-700 pt-3">
                <div className="text-center">
                  <p className="text-gray-400 text-xs">ケイデンス</p>
                  <p className={`text-2xl font-mono font-bold ${
                    cadence === null ? 'text-gray-600' :
                    cadence >= 100 ? 'text-green-400' :
                    cadence >= 85  ? 'text-yellow-400' :
                    'text-red-400'
                  }`}>
                    {cadence !== null ? `${cadence}` : '--'}
                    <span className="text-sm font-normal text-gray-500 ml-1">歩/分</span>
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-gray-400 text-xs">総歩数</p>
                  <p className="text-2xl font-mono font-bold text-gray-300">
                    {stepCount > 0 ? stepCount.toLocaleString() : '--'}
                    <span className="text-sm font-normal text-gray-500 ml-1">歩</span>
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

        {/* ===== PACE HISTORY GRAPH ===== */}
        <PaceGraph
          history={paceHistory}
          currentKm={gps.currentKm}
          requiredPaceKmH={paceInfo.requiredPaceKmH}
          predictedPaceKmH={paceInfo.predictedPaceKmH}
          nightMode={nightMode}
        />

        {/* ===== FULL CP PROJECTION TABLE ===== */}
        {projections.length > 0 && (
          <div className={`${card} border rounded-2xl p-4`}>
            <button
              onClick={() => setShowProjection((v) => !v)}
              className="w-full flex justify-between items-center"
            >
              <h3 className={`font-bold ${accent}`}>各CP到着予測</h3>
              <span className="text-gray-400 text-sm">{showProjection ? '▲ 閉じる' : '▼ 開く'}</span>
            </button>
            {showProjection && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-700">
                      <th className="text-left pb-1">CP</th>
                      <th className="text-right pb-1">目標着</th>
                      <th className="text-right pb-1">予想着</th>
                      <th className="text-right pb-1">関門</th>
                      <th className="text-right pb-1">差</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projections.map((p) => {
                      const rowColor = p.willMissCutoff
                        ? 'text-red-400'
                        : p.willMissTarget
                        ? 'text-yellow-400'
                        : 'text-green-400';
                      const label =
                        p.cp.km === 100
                          ? 'ゴール'
                          : `CP${p.cp.index}`;
                      const vsMin = Math.round(Math.abs(p.vsTargetMin));
                      const vsLabel = p.vsTargetMin >= 0 ? `+${vsMin}m` : `-${vsMin}m`;
                      return (
                        <tr key={p.cp.km} className={`${rowColor} border-b border-gray-800 last:border-0`}>
                          <td className="py-1 pr-1 font-bold">{label}</td>
                          <td className="py-1 text-right font-mono">{formatTime(p.targetArrival)}</td>
                          <td className="py-1 text-right font-mono font-bold">{formatTime(p.predictedArrival)}</td>
                          <td className="py-1 text-right font-mono text-gray-400">{formatTime(p.cp.cutoff)}</td>
                          <td className="py-1 text-right font-mono">{vsLabel}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-gray-600 text-xs mt-2">予想着はペース+疲労モデルで自動更新</p>
              </div>
            )}
          </div>
        )}

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

        {/* ===== TOILETS SECTION ===== */}
        <div className={`${card} border rounded-2xl p-4`}>
          <h3 className={`font-bold ${accent} mb-3`}>🚻 前方のトイレ</h3>
          {nextToilets.length === 0 ? (
            <p className="text-gray-500 text-sm">前方にトイレ情報なし</p>
          ) : (
            <div className="space-y-3">
              {nextToilets.map((toilet, i) => {
                const distKm = toilet.km_pos - gps.currentKm;
                const mins = paceInfo.currentPaceKmH > 0
                  ? Math.round((distKm / paceInfo.currentPaceKmH) * 60)
                  : null;
                return (
                  <div
                    key={i}
                    className="flex justify-between items-start border-b border-gray-700 last:border-0 pb-2 last:pb-0"
                  >
                    <div>
                      <p className="font-bold text-sm text-white">{toilet.name}</p>
                      {toilet.wheelchair && (
                        <span className="text-blue-400 text-xs">♿ 車椅子可</span>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0 ml-3">
                      <p className="text-white font-mono font-bold">
                        {distKm.toFixed(1)}km
                      </p>
                      {mins !== null && (
                        <p className="text-gray-400 text-xs">約{mins}分</p>
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
          {/* Screen sleep: dims display to near-black to save AMOLED power (GPS stays on) */}
          {onSleepNow && (
            <button
              onClick={onSleepNow}
              className="w-full min-h-[56px] bg-gray-900 text-gray-400 text-base font-bold rounded-2xl border border-gray-700 active:scale-95 transition-transform"
            >
              🌑 画面を暗くする（バッテリー節約・GPS継続）
            </button>
          )}

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

          {/* Setup reset */}
          <button
            onClick={() => {
              if (confirm('設定画面に戻りますか？\n（スタート時刻・APIキー等の設定は保持されます）')) onSetup();
            }}
            className="w-full min-h-[56px] bg-gray-900 text-gray-600 text-sm font-bold rounded-2xl border border-gray-800 active:scale-95 transition-transform"
          >
            ⚙️ 設定に戻る／やり直す
          </button>
        </div>
      </div>

      {/* ===== SCREEN SLEEP OVERLAY =====
          Wake Lock stays ON (GPS continues on Android Chrome).
          This near-black overlay saves AMOLED power without stopping GPS.
          Shows only km so user can glance without fully waking. */}
      {isSleeping && (
        <div
          className="fixed inset-0 z-[9998] bg-black flex flex-col items-center justify-center select-none"
          onClick={() => wakeScreen?.(30_000)}
          onTouchStart={() => wakeScreen?.(30_000)}
        >
          <p className="text-amber-400 font-mono font-bold leading-none" style={{ fontSize: '5rem' }}>
            {gps.currentKm.toFixed(1)}
          </p>
          <p className="text-amber-600 text-xl font-mono mt-1">km</p>
          {nextCp && (
            <p className="text-gray-700 text-xs mt-6">
              次のCP {nextCp.km}km（残り{(nextCp.km - gps.currentKm).toFixed(1)}km）
            </p>
          )}
          <p className="text-gray-800 text-xs absolute bottom-10">タップで画面を表示</p>
        </div>
      )}

    </div>
  );
}
