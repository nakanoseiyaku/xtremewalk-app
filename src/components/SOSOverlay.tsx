import { useState, useEffect, useRef } from 'react';
import { buildSmsUrl, RACE_EMERGENCY_TEL } from '../utils/sos';

interface SOSOverlayProps {
  phone: string;
  lat: number | null;
  lng: number | null;
  onCancel: () => void;
}

export function SOSOverlay({ phone, lat, lng, onCancel }: SOSOverlayProps) {
  const [countdown, setCountdown] = useState(3);
  const [launched, setLaunched] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          setLaunched(true);
          const url = buildSmsUrl(phone, lat, lng);
          window.location.href = url;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCancel = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    onCancel();
  };

  const latStr = lat !== null ? lat.toFixed(6) : '不明';
  const lngStr = lng !== null ? lng.toFixed(6) : '不明';

  return (
    <div className="fixed inset-0 bg-red-900 z-50 flex flex-col items-center justify-center p-6 text-white">
      <div className="text-6xl mb-4">🆘</div>
      <h1 className="text-3xl font-bold mb-2">緊急SOS</h1>

      {!launched ? (
        <div className="text-center mb-6">
          <div className="text-7xl font-mono font-bold text-red-200 mb-2">
            {countdown}
          </div>
          <p className="text-lg">秒後にSMSアプリを開きます</p>
        </div>
      ) : (
        <div className="text-center mb-6">
          <p className="text-lg">SMSアプリを開いています...</p>
        </div>
      )}

      {/* Current position in large text for verbal communication */}
      <div className="bg-red-800 rounded-xl p-4 mb-6 w-full text-center">
        <p className="text-sm text-red-300 mb-1">現在地（口頭で伝える）</p>
        <p className="text-2xl font-mono font-bold">{latStr}</p>
        <p className="text-2xl font-mono font-bold">{lngStr}</p>
        {lat !== null && lng !== null && (
          <a
            href={`https://maps.google.com/?q=${latStr},${lngStr}`}
            className="text-blue-300 underline text-sm mt-2 block"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google マップで開く
          </a>
        )}
      </div>

      {/* Race emergency number */}
      <div className="bg-red-800 rounded-xl p-4 mb-6 w-full text-center">
        <p className="text-sm text-red-300 mb-1">大会緊急連絡先</p>
        <a
          href={`tel:${RACE_EMERGENCY_TEL}`}
          className="text-3xl font-mono font-bold text-yellow-300 block"
        >
          {RACE_EMERGENCY_TEL}
        </a>
        <p className="text-sm text-red-300 mt-1">タップで電話</p>
      </div>

      {/* Cancel button - prominent */}
      <button
        onClick={handleCancel}
        className="w-full min-h-[72px] bg-white text-red-800 text-2xl font-bold rounded-2xl shadow-lg active:scale-95 transition-transform"
        aria-label="SOSをキャンセル"
      >
        キャンセル（誤操作）
      </button>
    </div>
  );
}
