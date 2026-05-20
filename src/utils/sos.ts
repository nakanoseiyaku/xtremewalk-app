// SOS SMS URL builder

/**
 * Sanitize phone number: keep digits and + only
 */
export function sanitizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

/**
 * Build SMS URL with preset body including current location.
 * iOS uses & separator, Android uses ? separator for body.
 */
export function buildSmsUrl(
  phone: string,
  lat: number | null,
  lng: number | null
): string {
  const sanitized = sanitizePhone(phone);
  const locationText =
    lat !== null && lng !== null
      ? `現在地: https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`
      : '現在地: 不明';

  const body = encodeURIComponent(
    `【SOS】東京エクストリームウォーク100参加中に緊急事態が発生しました。${locationText} 助けを送ってください。`
  );

  // Detect iOS vs Android
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const separator = isIOS ? '&' : '?';

  return `sms:${sanitized}${separator}body=${body}`;
}

// Race emergency number (official race hotline)
export const RACE_EMERGENCY_TEL = '0120-000-000'; // placeholder - update with real number
