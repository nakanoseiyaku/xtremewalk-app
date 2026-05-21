interface PermissionGateProps {
  onAcknowledge: () => void;
}

/**
 * Priming screen shown once on the native build before the OS permission
 * dialogs appear. Explaining the "why" up front significantly improves grant
 * rates — especially for the always-on location and activity permissions that
 * background measurement depends on.
 */
export function PermissionGate({ onAcknowledge }: PermissionGateProps) {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col p-6 overflow-y-auto">
      <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full">
        <div className="text-5xl text-center mb-4">🚶📍</div>
        <h1 className="text-2xl font-bold text-amber-400 text-center mb-2">
          バックグラウンド計測について
        </h1>
        <p className="text-gray-300 text-sm mb-5 text-center">
          このアプリは画面を消してもGPSと歩数を計測し続けます。
          そのため、次に表示される許可ダイアログをすべて「許可」してください。
        </p>

        <ul className="space-y-3 mb-5">
          <li className="bg-gray-900 rounded-xl p-3">
            <p className="font-bold text-sm">📍 位置情報（常に許可）</p>
            <p className="text-xs text-gray-400 mt-1">
              コース上の現在地と距離を計測します。「アプリの使用中のみ」では
              画面を消したときに距離が止まります。
            </p>
          </li>
          <li className="bg-gray-900 rounded-xl p-3">
            <p className="font-bold text-sm">🚶 身体活動</p>
            <p className="text-xs text-gray-400 mt-1">
              端末の歩数センサーで歩数を計測します。
            </p>
          </li>
          <li className="bg-gray-900 rounded-xl p-3">
            <p className="font-bold text-sm">🔔 通知</p>
            <p className="text-xs text-gray-400 mt-1">
              計測中であることを示す常駐通知を表示します。
            </p>
          </li>
        </ul>

        <div className="bg-amber-900/40 border border-amber-700 rounded-xl p-3 mb-6">
          <p className="font-bold text-sm text-amber-300">⚠️ 電池の最適化を解除してください</p>
          <p className="text-xs text-amber-100/80 mt-1">
            端末の「設定 → アプリ → 電池」で本アプリを「最適化しない／制限なし」に
            設定してください。解除しないと、長時間のレース中にOSがアプリを停止し、
            計測が止まることがあります。
          </p>
        </div>

        <button
          onClick={onAcknowledge}
          className="w-full min-h-[64px] bg-amber-500 text-black text-xl font-bold rounded-2xl active:scale-95 transition-transform"
        >
          許可に進む
        </button>
      </div>
    </div>
  );
}
