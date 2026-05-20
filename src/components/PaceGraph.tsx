import { useState } from 'react';

export interface PacePoint {
  km: number;
  paceKmH: number;
}

interface Props {
  history: PacePoint[];
  currentKm: number;
  requiredPaceKmH?: number | null;
  predictedPaceKmH?: number | null;
  nightMode: boolean;
}

const W = 300;
const H = 110;
const PAD = { top: 8, right: 10, bottom: 22, left: 26 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const Y_MIN = 2;
const Y_MAX = 8;

function toX(km: number) {
  return PAD.left + (km / 100) * PLOT_W;
}

function toY(pace: number) {
  const c = Math.max(Y_MIN, Math.min(Y_MAX, pace));
  return PAD.top + PLOT_H - ((c - Y_MIN) / (Y_MAX - Y_MIN)) * PLOT_H;
}

function dotColor(pace: number, req: number | null, pred: number | null): string {
  if (req !== null && pace < req) return '#EF4444';
  if (pred !== null && pace < pred) return '#F59E0B';
  return '#10B981';
}

export function PaceGraph({ history, currentKm, requiredPaceKmH, predictedPaceKmH, nightMode }: Props) {
  const [open, setOpen] = useState(false);

  const textColor = nightMode ? '#9CA3AF' : '#6B7280';
  const gridColor = nightMode ? '#374151' : '#E5E7EB';
  const cardBg = nightMode ? 'bg-gray-900' : 'bg-gray-800';
  const headerColor = nightMode ? 'text-amber-400' : 'text-gray-300';

  const req = requiredPaceKmH ?? null;
  const pred = predictedPaceKmH ?? null;

  return (
    <div className={`${cardBg} rounded-2xl p-3 mb-3`}>
      <button
        className="w-full flex justify-between items-center"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`text-sm font-bold ${headerColor}`}>📈 ペース推移</span>
        <span className="text-gray-500 text-xs">{open ? '▲ 閉じる' : '▼ 開く'}</span>
      </button>

      {open && (
        history.length === 0 ? (
          <p className="text-gray-600 text-xs text-center mt-4 mb-2">
            歩き始めると表示されます
          </p>
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full mt-2"
            style={{ height: H }}
          >
            {/* グリッド横線 + Y軸ラベル */}
            {([3, 4, 5, 6] as const).map((y) => (
              <g key={y}>
                <line
                  x1={PAD.left} y1={toY(y)}
                  x2={W - PAD.right} y2={toY(y)}
                  stroke={gridColor} strokeWidth="0.5"
                />
                <text
                  x={PAD.left - 3} y={toY(y) + 3}
                  textAnchor="end" fontSize="7" fill={textColor}
                >
                  {y}
                </text>
              </g>
            ))}

            {/* 単位ラベル */}
            <text x={PAD.left - 3} y={PAD.top - 1} textAnchor="end" fontSize="6" fill={textColor}>
              km/h
            </text>

            {/* X軸ラベル */}
            {([0, 20, 40, 60, 80, 100] as const).map((km) => (
              <text
                key={km}
                x={toX(km)} y={H - 4}
                textAnchor="middle" fontSize="7" fill={textColor}
              >
                {km}
              </text>
            ))}

            {/* 目標ペース基準線（緑点線） */}
            {pred !== null && pred > 0 && (
              <line
                x1={PAD.left} y1={toY(pred)}
                x2={W - PAD.right} y2={toY(pred)}
                stroke="#10B981" strokeWidth="0.8" strokeDasharray="3,3"
              />
            )}

            {/* 必要ペース基準線（赤点線） */}
            {req !== null && req > 0 && (
              <line
                x1={PAD.left} y1={toY(req)}
                x2={W - PAD.right} y2={toY(req)}
                stroke="#EF4444" strokeWidth="0.8" strokeDasharray="3,3"
              />
            )}

            {/* 折れ線 */}
            {history.length > 1 && (
              <polyline
                points={history.map((p) => `${toX(p.km)},${toY(p.paceKmH)}`).join(' ')}
                fill="none"
                stroke="#4B5563"
                strokeWidth="1"
              />
            )}

            {/* 計測点ドット */}
            {history.map((p, i) => (
              <circle
                key={i}
                cx={toX(p.km)}
                cy={toY(p.paceKmH)}
                r="3.5"
                fill={dotColor(p.paceKmH, req, pred)}
              />
            ))}

            {/* 現在位置縦線 */}
            <line
              x1={toX(currentKm)} y1={PAD.top}
              x2={toX(currentKm)} y2={PAD.top + PLOT_H}
              stroke="#F59E0B" strokeWidth="1" strokeDasharray="2,2"
            />
          </svg>
        )
      )}
    </div>
  );
}
