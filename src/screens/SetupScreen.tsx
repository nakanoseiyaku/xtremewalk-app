import { useState } from 'react';
import { getSettings, saveSettings, saveAppState } from '../utils/storage';
import type { AppSettings } from '../utils/storage';

interface SetupScreenProps {
  onComplete: () => void;
}

export function SetupScreen({ onComplete }: SetupScreenProps) {
  const [settings, setSettings] = useState<AppSettings>(getSettings);
  const [showBatteryTips, setShowBatteryTips] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveSettings(settings);
    saveAppState('pre_start');
    onComplete();
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4 pb-8">
      <div className="max-w-sm mx-auto">
        <div className="text-center py-6">
          <div className="text-5xl mb-2">🚶</div>
          <h1 className="text-2xl font-bold text-amber-400">
            東京エクストリームウォーク100
          </h1>
          <p className="text-gray-400 text-sm mt-1">セットアップ</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Start time */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              スタート予定時刻
            </label>
            <input
              type="time"
              value={settings.startTime}
              onChange={(e) =>
                setSettings((s) => ({ ...s, startTime: e.target.value }))
              }
              className="w-full bg-gray-800 border border-gray-600 rounded-xl px-4 py-4 text-white text-2xl font-mono focus:outline-none focus:border-amber-400"
              required
            />
            <p className="text-gray-500 text-xs mt-1">
              通常 07:30〜07:42
            </p>
          </div>

          {/* Emergency contact */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              緊急連絡先（電話番号）
            </label>
            <input
              type="tel"
              value={settings.emergencyPhone}
              onChange={(e) =>
                setSettings((s) => ({ ...s, emergencyPhone: e.target.value }))
              }
              placeholder="090-XXXX-XXXX"
              className="w-full bg-gray-800 border border-gray-600 rounded-xl px-4 py-4 text-white text-xl font-mono focus:outline-none focus:border-amber-400"
            />
            <p className="text-gray-500 text-xs mt-1">
              SOS時にSMSを送信する相手
            </p>
          </div>

          {/* Claude API key */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Claude API キー（任意）
            </label>
            <input
              type="password"
              value={settings.claudeApiKey}
              onChange={(e) =>
                setSettings((s) => ({ ...s, claudeApiKey: e.target.value }))
              }
              placeholder="sk-ant-..."
              className="w-full bg-gray-800 border border-gray-600 rounded-xl px-4 py-4 text-white font-mono text-sm focus:outline-none focus:border-amber-400"
            />
            <p className="text-gray-500 text-xs mt-1">
              AIコーチ機能に使用。未入力でも他の機能は使えます
            </p>
          </div>

          {/* Battery optimization */}
          <div className="bg-gray-900 rounded-2xl p-4">
            <button
              type="button"
              onClick={() => setShowBatteryTips(!showBatteryTips)}
              className="w-full flex items-center justify-between text-left"
            >
              <span className="font-bold text-amber-400">
                📱 Androidバッテリー最適化を無効化
              </span>
              <span className="text-gray-400">{showBatteryTips ? '▲' : '▼'}</span>
            </button>

            {showBatteryTips && (
              <div className="mt-4 space-y-3 text-sm text-gray-300">
                <p className="text-yellow-300 font-bold">
                  ※ GPSとアプリが途切れないよう必ず設定してください
                </p>
                <ol className="space-y-2 list-decimal list-inside">
                  <li>「設定」アプリを開く</li>
                  <li>「アプリ」→「このアプリ（ブラウザ）」を選択</li>
                  <li>「バッテリー」をタップ</li>
                  <li>「最適化しない」または「無制限」を選択</li>
                  <li>Chromeの場合は「Chromeの設定」→「サイトの設定」→
                    「センサー」をONにする</li>
                </ol>
                <div className="bg-gray-800 rounded-xl p-3 mt-2">
                  <p className="text-amber-400 font-bold mb-1">Chromeで開く場合</p>
                  <p>画面右上のメニュー（⋮）→「ホーム画面に追加」でPWAとしてインストールすると安定します</p>
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            className="w-full min-h-[72px] bg-amber-500 text-black text-xl font-bold rounded-2xl active:scale-95 transition-transform shadow-lg"
          >
            セットアップ完了 →
          </button>
        </form>
      </div>
    </div>
  );
}
