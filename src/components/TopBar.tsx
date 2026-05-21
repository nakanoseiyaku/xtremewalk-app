import type { GPSStatus } from '../hooks/useGPS';
import type { WakeLockStatus } from '../hooks/useWakeLock';
import type { BatteryState } from '../hooks/useBattery';

interface TopBarProps {
  currentKm: number;
  battery: BatteryState;
  wakeLockStatus: WakeLockStatus;
  gpsStatus: GPSStatus;
  nightMode: boolean;
  musicMode?: boolean;
  onMusicModeToggle?: () => void;
}

function GPSIndicator({ status }: { status: GPSStatus }) {
  if (status === 'active') {
    return (
      <span className="flex items-center gap-1 text-sm">
        <span className="text-green-400">●</span>
        <span className="text-gray-300">GPS</span>
      </span>
    );
  }
  if (status === 'degraded') {
    return (
      <span className="flex items-center gap-1 text-sm">
        <span className="text-yellow-400">●</span>
        <span className="text-gray-300">GPS</span>
      </span>
    );
  }
  if (status === 'lost') {
    return (
      <span className="flex items-center gap-1 text-sm">
        <span className="text-red-400">⚠</span>
        <span className="text-red-400">GPS消失</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-sm">
      <span className="text-gray-500">●</span>
      <span className="text-gray-500">GPS</span>
    </span>
  );
}

function WakeLockIndicator({ status }: { status: WakeLockStatus }) {
  if (status === 'active') {
    return (
      <span className="flex items-center gap-1 text-sm" title="画面常時ON">
        <span className="text-green-400">●</span>
      </span>
    );
  }
  if (status === 'inactive') {
    return (
      <span className="flex items-center gap-1 text-sm" title="画面ロック解除失敗">
        <span className="text-red-400">●</span>
      </span>
    );
  }
  return null;
}

function BatteryIcon({ level, charging }: { level: number | null; charging: boolean }) {
  if (level === null) return <span className="text-gray-500 text-sm">--</span>;

  const color =
    level < 10 ? 'text-red-400' : level < 30 ? 'text-yellow-400' : 'text-green-400';

  return (
    <span className={`${color} text-sm font-mono`}>
      {charging ? '⚡' : '🔋'}
      {level}%
    </span>
  );
}

export function TopBar({ currentKm, battery, wakeLockStatus, gpsStatus, nightMode, musicMode = false, onMusicModeToggle }: TopBarProps) {
  const bg = nightMode ? 'bg-black border-gray-800' : 'bg-gray-900 border-gray-700';
  const text = nightMode ? 'text-white' : 'text-gray-100';

  return (
    <div className={`${bg} ${text} border-b px-3 py-2 flex items-center justify-between sticky top-0 z-10`}>
      {/* Current km */}
      <div className="flex items-center gap-2">
        <span className="text-2xl font-bold text-amber-400 font-mono">
          {currentKm.toFixed(1)}
        </span>
        <span className="text-gray-400 text-sm">km</span>
      </div>

      {/* Right side indicators */}
      <div className="flex items-center gap-3">
        {/* Music mode toggle */}
        {onMusicModeToggle && (
          <button
            onClick={onMusicModeToggle}
            className={`text-lg px-1 rounded transition-colors active:scale-90 ${
              musicMode ? 'text-amber-400' : 'text-gray-600'
            }`}
            aria-label={musicMode ? 'ながら聴きモード ON' : 'ながら聴きモード OFF'}
            title={musicMode ? '音楽モードON（重要警告のみ音声）' : '音楽モードOFF（全音声）'}
          >
            🎵
          </button>
        )}
        <BatteryIcon level={battery.level} charging={battery.charging} />
        {battery.estimatedHours !== null && (
          <span className="text-gray-400 text-xs">
            {battery.estimatedHours.toFixed(1)}h
          </span>
        )}
        <WakeLockIndicator status={wakeLockStatus} />
        <GPSIndicator status={gpsStatus} />
      </div>
    </div>
  );
}
