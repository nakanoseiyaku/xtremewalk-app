import type { WeatherCondition } from '../utils/weather';

interface WeatherBarProps {
  condition: WeatherCondition | null;
  nightMode: boolean;
}

export function WeatherBar({ condition, nightMode }: WeatherBarProps) {
  if (!condition) {
    return (
      <div className="px-3 py-2 text-gray-500 text-sm">
        天気情報を取得中...
      </div>
    );
  }

  const bg = nightMode ? 'bg-gray-900' : 'bg-gray-800';
  const warnings: string[] = [];
  if (condition.isHeat) warnings.push('熱中症注意');
  if (condition.isRain) warnings.push('雨具推奨');
  if (condition.isHypothermia) warnings.push('低体温注意');
  if (condition.isHeadwind) warnings.push('強風');

  return (
    <div className={`${bg} px-3 py-2 flex items-center gap-3 text-sm`}>
      <span className="text-xl">{condition.icon}</span>
      <span className="text-white font-mono font-bold">
        {condition.temperature.toFixed(1)}°C
      </span>
      <span className="text-blue-300">
        {condition.precipitationProbability}%
      </span>
      <span className="text-gray-400">
        湿度 {condition.humidity}%
      </span>
      {condition.windspeed >= 3 && (
        <span className="text-gray-400">
          風 {condition.windspeed.toFixed(0)}m/s
        </span>
      )}
      {warnings.map((w) => (
        <span key={w} className="bg-red-700 text-white px-2 py-0.5 rounded text-xs font-bold">
          {w}
        </span>
      ))}
    </div>
  );
}
