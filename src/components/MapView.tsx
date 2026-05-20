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
}

const COURSE_ROUTE = (courseRouteData as Array<{ lat: number; lng: number }>).map(
  (p) => [p.lat, p.lng] as [number, number]
);

// Fallback center: Fujisawa start area
const DEFAULT_CENTER: [number, number] = [35.33, 139.45];

export function MapView({ gps, stores, nightMode }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const posMarkerRef = useRef<L.CircleMarker | null>(null);
  const accuracyCircleRef = useRef<L.Circle | null>(null);
  const storeLayerRef = useRef<L.LayerGroup | null>(null);
  const followRef = useRef(true);

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
    }).setView(initialCenter, 14);

    // Dark-ish OSM tile
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map);

    // Course route (amber line)
    L.polyline(COURSE_ROUTE, {
      color: '#FFB347',
      weight: 4,
      opacity: 0.85,
    }).addTo(map);

    // KM labels: every 10km (0, 10, 20, … 100)
    (kmPointsData as Array<{ km: number; lat: number; lng: number }>)
      .filter((p) => p.km % 10 === 0)
      .forEach((p) => {
        L.marker([p.lat, p.lng], {
          icon: L.divIcon({
            html: `<div class="xw-km-label">${p.km}km</div>`,
            className: '',
            iconSize: [40, 18],
            iconAnchor: [20, 9],
          }),
          interactive: false,
        }).addTo(map);
      });

    // CP markers
    (
      checkpointsData as Array<{
        name: string;
        km: number;
        lat: number;
        lng: number;
      }>
    ).forEach((cp) => {
      const short = cp.km === 0 ? 'スタート' : cp.km === 100 ? 'ゴール' : `CP${cp.km}km`;
      L.marker([cp.lat, cp.lng], {
        icon: L.divIcon({
          html: `<div class="xw-cp-label">${short}</div>`,
          className: '',
          iconSize: [70, 20],
          iconAnchor: [35, 10],
        }),
        interactive: false,
      }).addTo(map);
    });

    // Convenience store layer (updated on each GPS change)
    storeLayerRef.current = L.layerGroup().addTo(map);

    // Stop auto-follow when user drags the map
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
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update current position marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || gps.lat === null || gps.lng === null) return;

    const latlng: [number, number] = [gps.lat, gps.lng];

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

    // Auto-follow current position (re-center only, preserve zoom)
    if (followRef.current) {
      map.setView(latlng, map.getZoom(), { animate: true, duration: 0.5 });
    }
  }, [gps.lat, gps.lng, gps.accuracy]);

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

  // Re-center button handler
  const handleReCenter = () => {
    if (mapRef.current && gps.lat !== null && gps.lng !== null) {
      mapRef.current.setView([gps.lat, gps.lng], 15, { animate: true });
      followRef.current = true;
    }
  };

  return (
    <div className="relative w-full rounded-2xl overflow-hidden" style={{ height: '52vw', maxHeight: '280px', minHeight: '180px' }}>
      <div ref={containerRef} className="w-full h-full" />
      {/* Re-center button */}
      <button
        onClick={handleReCenter}
        className="absolute bottom-3 right-3 z-[1000] bg-gray-900 text-white text-xs font-bold px-3 py-2 rounded-xl shadow-lg border border-gray-700 active:scale-95 transition-transform"
        style={{ minHeight: 36 }}
      >
        現在地に戻る
      </button>
      {nightMode && (
        <div
          className="absolute inset-0 pointer-events-none z-[500]"
          style={{ background: 'rgba(0,0,0,0.18)', mixBlendMode: 'multiply' }}
        />
      )}
    </div>
  );
}
