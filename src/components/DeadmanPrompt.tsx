import type { DeadmanStatus } from '../hooks/useDeadman';

interface DeadmanPromptProps {
  deadman: DeadmanStatus;
  nightMode: boolean;
  onSOS: () => void;
}

export function DeadmanPrompt({ deadman, nightMode, onSOS }: DeadmanPromptProps) {
  const bg = nightMode ? 'bg-black' : 'bg-gray-900';
  const border = nightMode ? 'border-amber-500' : 'border-yellow-500';

  if (deadman.state === 'sos') {
    // 3 misses → show SOS screen
    onSOS();
    return null;
  }

  if (deadman.state === 'rest') {
    return (
      <div className={`fixed bottom-0 left-0 right-0 ${bg} border-t ${border} p-4 z-40`}>
        <div className="max-w-sm mx-auto text-center">
          <p className="text-amber-400 text-lg font-bold mb-3">休憩モード中</p>
          <p className="text-gray-400 text-sm mb-4">安全を確認して再開してください</p>
          <button
            onClick={deadman.endRest}
            className="w-full min-h-[72px] bg-amber-500 text-black text-xl font-bold rounded-2xl active:scale-95 transition-transform"
          >
            歩行を再開する
          </button>
        </div>
      </div>
    );
  }

  if (deadman.state !== 'prompt') return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 z-40 flex items-center justify-center p-4">
      <div className={`${bg} border-2 ${border} rounded-2xl p-6 w-full max-w-sm`}>
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">🚶</div>
          <h2 className="text-2xl font-bold text-white mb-2">
            まだ歩いていますか？
          </h2>
          {deadman.missedCount > 0 && (
            <p className="text-red-400 text-sm">
              未応答: {deadman.missedCount}回 / あと{3 - deadman.missedCount}回でSOS
            </p>
          )}
        </div>

        <button
          onClick={deadman.confirm}
          className="w-full min-h-[72px] bg-green-500 text-white text-2xl font-bold rounded-2xl mb-3 active:scale-95 transition-transform shadow-lg"
          aria-label="はい、歩いています"
        >
          はい、歩いています
        </button>

        <button
          onClick={deadman.startRest}
          className="w-full min-h-[72px] bg-gray-600 text-white text-xl font-bold rounded-2xl active:scale-95 transition-transform"
          aria-label="休憩モード（SOS防止）"
        >
          休憩モード（誤SOS防止）
        </button>
      </div>
    </div>
  );
}
