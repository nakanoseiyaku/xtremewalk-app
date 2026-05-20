import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { GPSState } from '../hooks/useGPS';
import type { ConvenienceStore } from '../utils/convenience';
import { getNextStores } from '../utils/convenience';

import courseRouteData from '../data/course_route.json';
import kmPointsData from '../data/course_km_points.json';
import checkpointsData from '../data/checkpoints.json';

interface MapViewProps {
  gps: GPSState;
  stores: ConvenienceStore[];
  nightMode: boolean;
  nextCpKm: number | null;
}

const COURSE_ROUTE = (courseRouteData as Array<{ lat: number; lng: number }>).map(
  (p) => [p.lat, p.lng] as [number, number]
);
const KM_POINTS = kmPointsData as Array<{ km: number; lat: number; lng: number }>;
const CP_DATA = checkpointsData as Array<{ name: string; km: number; lat: number; lng: number }>;

// 1530 route points over 100km
const POINTS_PER_KM = COURSE_ROUTE.length / 100;

// Default center: Odawara Castle (actual race start)
const DEFAULT_CENTER: [number, number] = [35.2499, 139.1559];

function getRouteSlice(startKm: number, endKm: number): [number, number][] {
  const si = Math.max(0, Math.floor(startKm * POINTS_PER_KM));
  const ei = Math.min(COURSE_ROUTE.length - 1, Math.ceil(endKm * POINTS_PER_KM));
  return COURSE_ROUTE.slice(si, ei + 1);
}

// Find the km point closest to a given km value
function findKmPoint(km: number): { lat: number; lng: number } | null {
  const exact = KM_POINTS.find((p) => p.km === km);
  if (exact) return exact;
  // Find nearest
  let best = KM_POINTS[0];
  let bestDiff = Math.abs(KM_POINTS[0].km - km);
  for (const p of KM_POINTS) {
    const d = Math.abs(p.km - km);
    if (d < bestDiff) { bestDiff = d; best = p; }
  }
  return best ?? null;
}

// Find the CP entry for a given km
function findCpByKm(km: number): { name: string; km: number; lat: number; lng: number } | null {
  return CP_DATA.find((cp) => cp.km === km) ?? null;
}

export function MapView({ gps, stores, nightMode, nextCpKm }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const posMarkerRef = useRef<L.CircleMarker | null>(null);
  const accuracyCircleRef = useRef<L.Circle | null>(null);
  const storeLayerRef = useRef<L.LayerGroup | null>(null);
  const fullCourseLineRef = useRef<L.Polyline | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const walkedLineRef = useRef<L.Polyline | null>(null);
  const nextCpMarkerRef = useRef<L.Marker | null>(null);
  const followRef = useRef(true);
  const nextCpLatLngRef = useRef<[number, number] | null>(null);

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initialCenter: [number, number] =
      gps.lat !== null && gps.lng !== null
        ? [gps.lat, gps.lng]
        : DEFAULT_CENTER;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
    }).setView(initialCenter, 16); // zoom 16: street level ~500m radius

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map);

    // Full course background line (entire 100km, always visible)
    fullCourseLineRef.current = L.polyline(COURSE_ROUTE, {
      color: '#6B7280',
      weight: 3,
      opacity: 0.45,
      interactive: false,
    }).addTo(map);

    // Walked route (behind, dim white) — overlaid on course line
    walkedLineRef.current = L.polyline([], {
      color: '#ffffff',
      weight: 2,
      opacity: 0.5,
      interactive: false,
    }).addTo(map);

    // Ahead route (amber, prominent) — overlaid on course line
    routeLineRef.current = L.polyline([], {
      color: '#FFB347',
      weight: 5,
      opacity: 0.9,
      interactive: false,
    }).addTo(map);

    // Convenience store layer
    storeLayerRef.current = L.layerGroup().addTo(map);

    // Stop auto-follow when user drags
    map.on('dragstart', () => {
      followRef.current = false;
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      posMarkerRef.current = null;
      accuracyCircleRef.current = null;
      storeLayerRef.current = null;
      fullCourseLineRef.current = null;
      routeLineRef.current = null;
      walkedLineRef.current = null;
      nextCpMarkerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update route lines whenever km or next CP changes (no GPS required)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Walked route: last 2km behind current position
    if (walkedLineRef.current) {
      const walkedStart = Math.max(0, gps.currentKm - 2);
      walkedLineRef.current.setLatLngs(getRouteSlice(walkedStart, gps.currentKm));
    }

    // Ahead route: current position to next CP (or +12km max)
    if (routeLineRef.current) {
      const endKm =
        nextCpKm !== null
          ? Math.min(nextCpKm, gps.currentKm + 12)
          : gps.currentKm + 12;
      routeLineRef.current.setLatLngs(getRouteSlice(gps.currentKm, endKm));
    }
  }, [gps.currentKm, nextCpKm]);

  // Update position marker + accuracy circle + auto-follow when GPS position changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || gps.lat === null || gps.lng === null) return;

    const latlng: [number, number] = [gps.lat, gps.lng];

    // Position marker
    if (posMarkerRef.current) {
      posMarkerRef.current.setLatLng(latlng);
    } else {
      posMarkerRef.current = L.circleMarker(latlng, {
        radius: 9,
        fillColor: '#3B82F6',
        color: '#fff',
        weight: 2.5,
        fillOpacity: 1,
      })
        .bindTooltip('現在地', { permanent: false, direction: 'top' })
        .addTo(map);
    }

    // Accuracy circle
    if (gps.accuracy !== null) {
      if (accuracyCircleRef.current) {
        accuracyCircleRef.current.setLatLng(latlng);
        accuracyCircleRef.current.setRadius(gps.accuracy);
      } else {
        accuracyCircleRef.current = L.circle(latlng, {
          radius: gps.accuracy,
          fillColor: '#3B82F6',
          fillOpacity: 0.12,
          color: '#3B82F6',
          weight: 1,
          interactive: false,
        }).addTo(map);
      }
    }

    // Auto-follow at current zoom
    if (followRef.current) {
      map.setView(latlng, map.getZoom(), { animate: true, duration: 0.5 });
    }
  }, [gps.lat, gps.lng, gps.accuracy]);

  // Update next CP marker when nextCpKm changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove old marker
    if (nextCpMarkerRef.current) {
      nextCpMarkerRef.current.remove();
      nextCpMarkerRef.current = null;
      nextCpLatLngRef.current = null;
    }

    if (nextCpKm === null) return;

    // Try to find from CP data first, fall back to km points
    const cp = findCpByKm(nextCpKm);
    const point = cp ?? findKmPoint(nextCpKm);
    if (!point) return;

    const latlng: [number, number] = [point.lat, point.lng];
    nextCpLatLngRef.current = latlng;

    const label = nextCpKm === 100 ? 'ゴール🏁' : `🎯 次のCP\n${nextCpKm}km`;
    nextCpMarkerRef.current = L.marker(latlng, {
      icon: L.divIcon({
        html: `<div class="xw-next-cp-marker">${label.replace('\n', '<br/>')}</div>`,
        className: '',
        iconSize: [80, 36],
        iconAnchor: [40, 36],
      }),
      interactive: false,
    }).addTo(map);
  }, [nextCpKm]);

  // Update nearby store pins (next 5)
  useEffect(() => {
    const layer = storeLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    const nearby = getNextStores(stores, gps.currentKm, 5);
    nearby.forEach((s) => {
      if (s.lat == null || s.lng == null) return;
      const label = s.name.length > 10 ? s.name.slice(0, 10) + '…' : s.name;
      L.marker([s.lat, s.lng], {
        icon: L.divIcon({
          html: `<div class="xw-store-label">🏪 ${label}</div>`,
          className: '',
          iconSize: [100, 16],
          iconAnchor: [50, 8],
        }),
        interactive: false,
      }).addTo(layer);
    });
  }, [gps.currentKm, stores]);

  // Re-center button: snap back to current position at zoom 16
  const handleReCenter = () => {
    if (mapRef.current && gps.lat !== null && gps.lng !== null) {
      mapRef.current.setView([gps.lat, gps.lng], 16, { animate: true });
      followRef.current = true;
    }
  };

  // Show next CP button: fit both current position and next CP in view
  const handleShowNextCp = () => {
    const map = mapRef.current;
    if (!map || gps.lat === null || gps.lng === null || nextCpLatLngRef.current === null) return;
    map.fitBounds(
      L.latLngBounds([[gps.lat, gps.lng], nextCpLatLngRef.current]),
      { padding: [40, 40], maxZoom: 15, animate: true }
    );
    followRef.current = false;
  };

  return (
    <div className="relative w-full rounded-2xl overflow-hidden" style={{ height: '52vw', maxHeight: '280px', minHeight: '180px' }}>
      <div ref={containerRef} className="w-full h-full" />

      {/* Buttons */}
      <div className="absolute bottom-3 right-3 z-[1000] flex gap-2">
        {nextCpKm !== null && gps.lat !== null && (
          <button
            onClick={handleShowNextCp}
            className="bg-red-700 text-white text-xs font-bold px-3 py-2 rounded-xl shadow-lg border border-red-600 active:scale-95 transition-transform"
            style={{ minHeight: 36 }}
          >
            🎯 次のCP
          </button>
        )}
        <button
          onClick={handleReCenter}
          className="bg-gray-900 text-white text-xs font-bold px-3 py-2 rounded-xl shadow-lg border border-gray-700 active:scale-95 transition-transform"
          style={{ minHeight: 36 }}
        >
          現在地
        </button>
      </div>

      {nightMode && (
        <div
          className="absolute inset-0 pointer-events-none z-[500]"
          style={{ background: 'rgba(0,0,0,0.18)', mixBlendMode: 'multiply' }}
        />
      )}
    </div>
  );
}
