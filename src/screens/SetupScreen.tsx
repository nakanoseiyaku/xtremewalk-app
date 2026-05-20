import { useState, useEffect } from 'react';
import { getSettings, saveSettings, saveAppState, decodeSettingsFromHash, buildShareUrl } from '../utils/storage';
import type { AppSettings } from '../utils/storage';

interface SetupScreenProps {
  onComplete: () => void;
}

export function SetupScreen({ onComplete }: SetupScreenProps) {
  const [settings, setSettings] = useState<AppSettings>(getSettings);
  const [showBatteryTips, setShowBatteryTips] = useState(false);
  const [copied, setCopied] = useState(false);
  const [importedFromUrl, setImportedFromUrl] = useState(false);

  // Auto-import settings from URL hash on first load
  useEffect(() => {
    const fromHash = decodeSettingsFromHash();
    if (fromHash && Object.keys(fromHash).length > 0) {
      setSettings(s => ({ ...s, ...fromHash }));
      setImportedFromUrl(true);
      // Clear hash after import (don't leave API key in browser bar)
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveSettings(settings);
    saveAppState('pre_start');
    onComplete();
  };

  const handleCopyUrl = async () => {
    const url = buildShareUrl(settings);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // Fallback: select text
      const el = document.createElement('textarea');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
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

        {/* URL import success banner */}
        {importedFromUrl && (
          <div className="mb-4 p-3 bg-green-900/50 border border-green-600 rounded-xl text-green-300 text-sm text-center">
            ✅ URLから設定を読み込みました。内容を確認して「完了」を押してください。
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Target finish time */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              目標完走時間
            </label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={20}
                max={30}
                step={0.5}
                value={settings.targetHours}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, targetHours: parseFloat(e.target.value) }))
                }
                className="flex-1 accent-amber-400"
              />
              <span className="text-2xl font-mono font-bold text-amber-400 w-16 text-right">
                {Math.floor(settings.targetHours)}h
                {settings.targetHours % 1 !== 0 ? '30m' : ''}
              </span>
            </div>
            <p className="text-gray-500 text-xs mt-1">
              チャレンジ制限: 26h / エキスパート制限: 24h
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
            <p className="text-gray-500 text-xs mt-1">SOS時にSMSを送信する相手</p>
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
              autoComplete="off"
              className="w-full bg-gray-800 border border-gray-600 rounded-xl px-4 py-4 text-white font-mono text-sm focus:outline-none focus:border-amber-400"
            />
            <p className="text-gray-500 text-xs mt-1">
              AIコーチ機能に使用。未入力でも他の機能は使えます
            </p>
          </div>

          {/* Share URL section */}
          <div className="bg-gray-900 rounded-2xl p-4">
            <p className="text-sm font-medium text-gray-300 mb-3">
              📲 他のデバイスで開く
            </p>
            <p className="text-xs text-gray-500 mb-3">
              APIキーを含む設定をURLにエンコードしてコピーします。
              そのURLを他のデバイスで開くと設定が自動的に入力されます。
            </p>
            <button
              type="button"
              onClick={handleCopyUrl}
              className="w-full py-3 bg-gray-800 border border-gray-600 rounded-xl text-sm font-medium transition-colors"
              style={{ color: copied ? '#34d399' : '#fbbf24' }}
            >
              {copied ? '✅ コピーしました！' : '🔗 設定URLをコピー'}
            </button>
            {copied && (
              <p className="text-xs text-gray-500 mt-2 text-center">
                URLを他のデバイスのブラウザで開いてください
              </p>
            )}
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
                  <li>「アプリ」→「Chrome」を選択</li>
                  <li>「バッテリー」をタップ</li>
                  <li>「最適化しない」または「無制限」を選択</li>
                </ol>
                <div className="bg-gray-800 rounded-xl p-3 mt-2">
                  <p className="text-amber-400 font-bold mb-1">ホーム画面に追加（推奨）</p>
                  <p>Chrome右上「︙」→「ホーム画面に追加」でPWAとしてインストールすると安定します</p>
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
