import { useState, useEffect } from 'react';

interface MockPanelProps {
  currentKm: number;
  onMockKmChange: (km: number) => void;
}

// PC debug panel — shown when ?debug=1 is in URL
export function MockPanel({ currentKm, onMockKmChange }: MockPanelProps) {
  const [km, setKm] = useState(currentKm);
  const [open, setOpen] = useState(true);

  // Sync external changes
  useEffect(() => { setKm(currentKm); }, [currentKm]);

  const apply = (val: number) => {
    setKm(val);
    onMockKmChange(val);
    // Persist to localStorage so GPS hook picks it up
    localStorage.setItem('mock_km', String(val));
  };

  const CHECKPOINTS = [
    { name: 'スタート', km: 0 },
    { name: '第1CP', km: 21 },
    { name: '第2CP', km: 33 },
    { name: '第3CP', km: 54 },
    { name: '第4CP', km: 67 },
    { name: '第5CP', km: 86 },
    { name: 'ゴール', km: 100 },
  ];

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 bg-purple-700 text-white text-xs px-3 py-2 rounded-full shadow-lg opacity-80"
      >
        🖥 DEBUG
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-purple-900/95 border border-purple-500 rounded-2xl p-4 w-64 shadow-xl text-white text-xs">
      <div className="flex items-center justify-between mb-3">
        <span className="font-bold text-purple-300">🖥 PCデバッグパネル</span>
        <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-white">✕</button>
      </div>

      {/* Current km display */}
      <div className="text-center mb-3">
        <span className="text-3xl font-bold text-amber-400">{km.toFixed(1)}</span>
        <span className="text-gray-400 ml-1">km</span>
      </div>

      {/* km slider */}
      <input
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={km}
        onChange={e => apply(Number(e.target.value))}
        className="w-full mb-3 accent-amber-400"
      />

      {/* CP quick-jump buttons */}
      <div className="grid grid-cols-2 gap-1 mb-3">
        {CHECKPOINTS.map(cp => (
          <button
            key={cp.km}
            onClick={() => apply(cp.km)}
            className="bg-purple-800 hover:bg-purple-700 rounded-lg py-1 px-2 text-center transition-colors"
          >
            <div className="font-medium">{cp.name}</div>
            <div className="text-purple-400">{cp.km}km</div>
          </button>
        ))}
      </div>

      {/* Manual km input */}
      <div className="flex gap-2">
        <input
          type="number"
          min={0}
          max={100}
          step={0.1}
          value={km}
          onChange={e => apply(Number(e.target.value))}
          className="flex-1 bg-purple-800 border border-purple-600 rounded-lg px-2 py-1 text-white text-center"
        />
        <span className="text-gray-400 self-center">km</span>
      </div>

      <p className="text-purple-400 text-center mt-3 text-[10px]">
        Chrome DevTools → Toggle Device Toolbar (Ctrl+Shift+M) でスマホ画面に
      </p>
    </div>
  );
}

// Returns true if debug mode is active (?debug=1 in URL)
export function isDebugMode(): boolean {
  return new URLSearchParams(window.location.search).get('debug') === '1';
}

// Returns mock km only when debug mode is active — never bleeds into production
export function getMockKm(): number | null {
  if (!isDebugMode()) {
    localStorage.removeItem('mock_km');
    return null;
  }
  const urlParam = new URLSearchParams(window.location.search).get('mock_km');
  if (urlParam !== null) return Number(urlParam);
  const stored = localStorage.getItem('mock_km');
  if (stored !== null) return Number(stored);
  return null;
}
