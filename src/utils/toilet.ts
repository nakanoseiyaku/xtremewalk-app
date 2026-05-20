import { findNearestKm } from './gps';
import type { KmPoint } from './gps';

export interface ToiletEntry {
  name: string;
  lat: number;
  lng: number;
  km_pos: number;
  wheelchair: boolean;
}

export function enrichToilets(
  raw: { name: string; lat: number; lng: number }[],
  kmPoints: KmPoint[]
): ToiletEntry[] {
  return raw
    .map((t) => ({
      name: t.name.replace(/^トイレ\s*/, '').trim(),
      lat: t.lat,
      lng: t.lng,
      km_pos: findNearestKm({ lat: t.lat, lng: t.lng }, kmPoints, null).km,
      wheelchair: t.name.includes('車椅子'),
    }))
    .sort((a, b) => a.km_pos - b.km_pos);
}

export function getNextToilets(
  toilets: ToiletEntry[],
  currentKm: number,
  count = 2
): ToiletEntry[] {
  return toilets.filter((t) => t.km_pos > currentKm).slice(0, count);
}
