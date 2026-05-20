// localStorage wrapper with fallback for environments where storage is unavailable

export interface AppSettings {
  startTime: string; // "HH:MM"
  emergencyPhone: string;
  claudeApiKey: string;
  targetHours: number; // 目標完走時間（時間）
}

const DEFAULT_SETTINGS: AppSettings = {
  startTime: '07:30',
  emergencyPhone: '',
  claudeApiKey: '',
  targetHours: 26,
};

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function getSettings(): AppSettings {
  const raw = safeGet('xtremewalk_settings');
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  safeSet('xtremewalk_settings', JSON.stringify(settings));
}

export function getAppState(): string {
  return safeGet('xtremewalk_state') ?? 'setup';
}

export function saveAppState(state: string): void {
  safeSet('xtremewalk_state', state);
}

export function getWeatherCache(): { data: unknown; ts: number } | null {
  const raw = safeGet('xtremewalk_weather');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveWeatherCache(data: unknown): void {
  safeSet('xtremewalk_weather', JSON.stringify({ data, ts: Date.now() }));
}

export function clearAll(): void {
  safeRemove('xtremewalk_settings');
  safeRemove('xtremewalk_state');
  safeRemove('xtremewalk_weather');
}

// Encode settings to URL hash (hash is NOT sent to server — relatively safe for API key)
export function encodeSettingsToHash(settings: AppSettings): string {
  try {
    const json = JSON.stringify(settings);
    return '#s=' + btoa(encodeURIComponent(json));
  } catch {
    return '';
  }
}

// Decode settings from URL hash (returns null if not found or invalid)
export function decodeSettingsFromHash(): Partial<AppSettings> | null {
  try {
    const hash = window.location.hash;
    if (!hash.startsWith('#s=')) return null;
    const encoded = hash.slice(3);
    const parsed = JSON.parse(decodeURIComponent(atob(encoded)));
    return parsed as Partial<AppSettings>;
  } catch {
    return null;
  }
}

// Build shareable URL with current settings encoded in hash
export function buildShareUrl(settings: AppSettings): string {
  const base = window.location.origin + window.location.pathname;
  return base + encodeSettingsToHash(settings);
}
