import { useState, useEffect } from 'react';
import type { Checkpoint } from '../constants/checkpoints';
import type { ConvenienceStore } from '../utils/convenience';
import { formatTime, formatMinutes } from '../utils/pace';

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

export function CPArrivalScreen({
  cp,
  currentKm,
  paceKmH,
  toilets,
  nextStores,
  nightMode,
  onDepart,
}: CPArrivalScreenProps) {
  const bg = nightMode ? 'bg-black' : 'bg-gray-950';
  const card = nightMode ? 'bg-gray-900' : 'bg-gray-800';

  // Find toilets near this CP (within 0.5km)
  const nearbyToilets = toilets.filter(
    (t) => t.km_pos !== undefined && Math.abs(t.km_pos - cp.km) <= 0.5
  );

  // Calculate recommended departure time
  // travel_time = remaining_km / pace
  // safe_departure = cutoff - travel_time - 30min buffer

  // For departure time: from current CP to next CP (avg ~13km per segment)
  const travelTimeHours = paceKmH > 0 ? 13 / paceKmH : 2;
  const safeDepartureMs =
    cp.cutoff.getTime() - travelTimeHours * 3600 * 1000 - 30 * 60 * 1000;
  const safeDeparture = new Date(safeDepartureMs);
  const maxRestMs = Math.max(0, safeDepartureMs - Date.now());
  const maxRestMin = Math.floor(maxRestMs / (60 * 1000));

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
        </div>

        {/* Countdown to cutoff */}
        <div className={`${card} rounded-2xl p-4`}>
          <CountdownTimer targetDate={cp.cutoff} />
          <p className="text-center text-gray-400 text-sm mt-2">
            制限時刻: {formatTime(cp.cutoff)}
          </p>
        </div>

        {/* Recommended departure & max rest */}
        <div className={`${card} rounded-2xl p-4 space-y-3`}>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">推奨出発時刻</span>
            <span className="text-2xl font-mono font-bold text-green-400">
              {formatTime(safeDeparture)}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">最大休憩時間</span>
            <span className={`text-2xl font-mono font-bold ${maxRestMin < 10 ? 'text-red-400' : 'text-amber-400'}`}>
              {maxRestMin}分
            </span>
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

        <p className="text-center text-gray-500 text-xs">
          次のCP: {formatMinutes(travelTimeHours * 60)}の道のり（推定）
        </p>
      </div>
    </div>
  );
}
