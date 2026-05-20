export const COLORS = {
  // Night mode (22:00-06:00)
  night: {
    bg: '#000000',
    text: '#FFFFFF',
    accent: '#FFB347',
    danger: '#FF4444',
    secondary: '#888888',
    cardBg: '#111111',
    border: '#333333',
  },
  // Day mode
  day: {
    bg: '#0F0F0F',
    text: '#F5F5F5',
    accent: '#FFB347',
    danger: '#FF4444',
    secondary: '#AAAAAA',
    cardBg: '#1A1A1A',
    border: '#333333',
  },
} as const;

export function isNightMode(date: Date = new Date()): boolean {
  const hour = date.getHours();
  return hour >= 22 || hour < 6;
}

export function getColors(date: Date = new Date()) {
  return isNightMode(date) ? COLORS.night : COLORS.day;
}
