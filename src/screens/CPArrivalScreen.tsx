import { useState, useEffect } from 'react';
import type { Checkpoint } from '../constants/checkpoints';
import type { ConvenienceStore } from '../utils/convenience';
import { formatTime, formatMinutes } from '../utils/pace';
import type { CPVisit } from '../utils/storage';

interface ToiletEntry {
  name: string;
  lat: number;
  lng: number;
  km_pos?: number;
}

interface CPArrivalScreenProps {
  cp: Checkpoint;
  currentKm: number;
  paceKmH: number;
  toilets: ToiletEntry[];
  nextStores: ConvenienceStore[];
  nightMode: boolean;
  onDepart: () => void;
  visit: CPVisit | null;
  nextCp: Checkpoint | null;
  targetArrivalAtNextCp: Date | null;
}

function CountdownTimer({ targetDate }: { targetDate: Date }) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const update = () => {
      const ms = targetDate.getTime() - Date.now();
      setRemaining(Math.max(0, ms));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  const totalSec = Math.floor(remaining / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  const isUrgent = remaining < 30 * 60 * 1000; // < 30 min

  return (
    <div className={`text-center ${isUrgent ? 'animate-pulse' : ''}`}>
      <p className="text-gray-400 text-sm mb-1">制限時間まで</p>
      <p className={`text-4xl font-mono font-bold ${isUrgent ? 'text-red-400' : 'text-white'}`}>
        {h > 0 ? `${h}:` : ''}
        {String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
      </p>
    </div>
  );
}

function RestElapsed({ arrivedAt }: { arrivedAt: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const update = () => setElapsed(Date.now() - arrivedAt);
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [arrivedAt]);

  const totalSec = Math.floor(elapsed / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  return (
    <span className="font-mono">
      {h > 0 ? `${h}:` : ''}
      {String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
    </span>
  );
}

export function CPArrivalScreen({
  cp,
  currentKm,
  paceKmH,
  toilets,
  nextStores,
  nightMode,
  onDepart,
  visit,
  nextCp,
  targetArrivalAtNextCp,
}: CPArrivalScreenProps) {
  const bg = nightMode ? 'bg-black' : 'bg-gray-950';
  const card = nightMode ? 'bg-gray-900' : 'bg-gray-800';

  // Find toilets near this CP (within 0.5km)
  const nearbyToilets = toilets.filter(
    (t) => t.km_pos !== undefined && Math.abs(t.km_pos - cp.km) <= 0.5
  );

  // Distance and travel time to next CP (actual distance, not hardcoded 13km)
  const distToNextCp = nextCp ? nextCp.km - cp.km : 13;
  const travelTimeHours = paceKmH > 0 ? distToNextCp / paceKmH : distToNextCp / 4;
  const travelTimeMs = travelTimeHours * 3600 * 1000;

  // Cutoff-based: must arrive at next CP before its cutoff
  const cutoffBaseMs = nextCp
    ? nextCp.cutoff.getTime() - travelTimeMs - 30 * 60 * 1000
    : cp.cutoff.getTime();
  const cutoffDeparture = new Date(Math.min(cutoffBaseMs, cp.cutoff.getTime()));
  const maxRestByCutoffMin = Math.max(0, Math.floor((cutoffDeparture.getTime() - Date.now()) / 60000));

  // Target-based: arrive at next CP by target time
  const targetDeparture = targetArrivalAtNextCp
    ? new Date(targetArrivalAtNextCp.getTime() - travelTimeMs)
    : null;
  const maxRestByTargetMin = targetDeparture
    ? Math.max(0, Math.floor((targetDeparture.getTime() - Date.now()) / 60000))
    : null;

  // Next store ahead
  const nextStore = nextStores[0];

  return (
    <div className={`min-h-screen ${bg} text-white p-4 pb-8`}>
      <div className="max-w-sm mx-auto space-y-4">
        {/* Header */}
        <div className="text-center py-4">
          <div className="text-4xl mb-2">🏁</div>
          <h1 className="text-xl font-bold text-amber-400">{cp.name}</h1>
          <p className="text-gray-400 text-sm">チェックポイント到着！</p>
          {visit && (
            <p className="text-gray-400 text-sm mt-1">
              到着 {formatTime(new Date(visit.arrivedAt))}
              {visit.departedAt === null && (
                <span className="ml-2">
                  休憩 <RestElapsed arrivedAt={visit.arrivedAt} />
                </span>
              )}
            </p>
          )}
        </div>

        {/* Countdown to cutoff */}
        <div className={`${card} rounded-2xl p-4`}>
          <CountdownTimer targetDate={cp.cutoff} />
          <p className="text-center text-gray-400 text-sm mt-2">
            制限時刻: {formatTime(cp.cutoff)}
          </p>
        </div>

        {/* Departure timing */}
        <div className={`${card} rounded-2xl p-4 space-y-3`}>
          {/* Target-based */}
          {targetDeparture && maxRestByTargetMin !== null && (
            <div>
              <p className="text-xs text-gray-400 mb-1">推奨出発（目標ペース）</p>
              <div className="flex justify-between items-center">
                <span className="text-xl font-mono font-bold text-green-400">
                  {formatTime(targetDeparture)}
                </span>
                <span className="text-gray-400 text-sm">
                  最大 {maxRestByTargetMin}分休憩
                </span>
              </div>
            </div>
          )}

          {/* Cutoff-based */}
          <div className={targetDeparture ? 'border-t border-gray-700 pt-3' : ''}>
            <p className="text-xs text-gray-400 mb-1">最終出発（関門ライン）</p>
            <div className="flex justify-between items-center">
              <span className={`text-xl font-mono font-bold ${maxRestByCutoffMin < 10 ? 'text-red-400' : 'text-orange-400'}`}>
                {formatTime(cutoffDeparture)}
              </span>
              <span className="text-gray-400 text-sm">
                最大 {maxRestByCutoffMin}分休憩
              </span>
            </div>
          </div>
        </div>

        {/* Toilets */}
        <div className={`${card} rounded-2xl p-4`}>
          <h2 className="font-bold text-amber-400 mb-2">トイレ</h2>
          {nearbyToilets.length > 0 ? (
            <ul className="space-y-1">
              {nearbyToilets.map((t, i) => (
                <li key={i} className="text-sm text-gray-300">
                  ✅ {t.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500 text-sm">このCP付近にトイレ情報なし</p>
          )}
        </div>

        {/* Next store */}
        <div className={`${card} rounded-2xl p-4`}>
          <h2 className="font-bold text-amber-400 mb-2">次のコンビニ</h2>
          {nextStore ? (
            <div className="text-sm text-gray-300">
              <p className="font-bold text-white">{nextStore.name}</p>
              <p>
                {(nextStore.km_pos - currentKm).toFixed(1)}km先
                {paceKmH > 0 && (
                  <span className="text-gray-400 ml-2">
                    （約{Math.round(((nextStore.km_pos - currentKm) / paceKmH) * 60)}分）
                  </span>
                )}
              </p>
              <p>
                {nextStore.side_ja}
                {nextStore.access === 'cross_road' && (
                  <span className="text-yellow-400 ml-2">[要横断]</span>
                )}
                {nextStore.is_24h && (
                  <span className="text-green-400 ml-2">24h</span>
                )}
              </p>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">前方にコンビニ情報なし</p>
          )}
        </div>

        {/* Depart button */}
        <button
          onClick={onDepart}
          className="w-full min-h-[72px] bg-amber-500 text-black text-2xl font-bold rounded-2xl active:scale-95 transition-transform shadow-lg mt-4"
        >
          出発する →
        </button>

        {nextCp && (
          <p className="text-center text-gray-500 text-xs">
            次の{nextCp.name.split(' ')[0]}まで{distToNextCp.toFixed(0)}km（推定{formatMinutes(travelTimeHours * 60)}）
          </p>
        )}
      </div>
    </div>
  );
}
