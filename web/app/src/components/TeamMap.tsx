import { useEffect, useRef, useState } from 'react';
import { DARK_STYLE, GOOGLE_MAPS_BROWSER_KEY, LIGHT_STYLE, loadGoogleMaps } from '../lib/googleMaps';

export type MapSite = { id: string; name: string; latitude: number; longitude: number };
export type MapPerson = { employee_id: string; employee_name: string; latitude: number; longitude: number; accuracy_meters: number; site_name: string | null };

// Morocco, when a company has no located site yet.
const FALLBACK = { center: { lat: 31.79, lng: -7.09 }, zoom: 5 };
const SITE_RADIUS_M = 150;

function currentTheme() { return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'; }

/**
 * Google map of the company's sites (circles) and the employees currently
 * sharing their position (pins). Always rendered, so the chef sees the
 * sites even when nobody is sharing; fits to whatever exists.
 */
export function TeamMap({ sites, people }: { sites: MapSite[]; people: MapPerson[] }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const overlays = useRef<{ setMap(m: google.maps.Map | null): void }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState(currentTheme);

  // Follow the workspace theme switch without reloading.
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(currentTheme()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    if (!GOOGLE_MAPS_BROWSER_KEY || !el.current) return;
    let cancelled = false;
    loadGoogleMaps().then((g) => {
      if (cancelled || !el.current) return;
      if (!map.current) {
        map.current = new g.maps.Map(el.current, {
          ...FALLBACK, disableDefaultUI: true, zoomControl: true, gestureHandling: 'cooperative',
          backgroundColor: theme === 'light' ? '#f2f3f5' : '#0e1116',
        });
      }
      map.current.setOptions({ styles: theme === 'light' ? LIGHT_STYLE : DARK_STYLE });
    }).catch((e: Error) => setError(e.message));
    return () => { cancelled = true; };
  }, [theme]);

  useEffect(() => {
    if (!GOOGLE_MAPS_BROWSER_KEY) return;
    let cancelled = false;
    loadGoogleMaps().then((g) => {
      const m = map.current;
      if (cancelled || !m) return;
      overlays.current.forEach((o) => o.setMap(null));
      overlays.current = [];
      const bounds = new g.maps.LatLngBounds();
      const accent = theme === 'light' ? '#2f4bc9' : '#cfd8ff';
      for (const s of sites) {
        const center = { lat: s.latitude, lng: s.longitude };
        overlays.current.push(new g.maps.Circle({ map: m, center, radius: SITE_RADIUS_M, strokeColor: accent, strokeOpacity: .8, strokeWeight: 1, fillColor: accent, fillOpacity: .08 }));
        overlays.current.push(new g.maps.Marker({ map: m, position: center, title: s.name, label: { text: s.name, color: accent, fontSize: '11px', fontFamily: 'IBM Plex Mono, monospace' },
          icon: { path: g.maps.SymbolPath.CIRCLE, scale: 4, fillColor: accent, fillOpacity: 1, strokeWeight: 0, labelOrigin: new g.maps.Point(0, -3) } }));
        bounds.extend(center);
      }
      for (const p of people) {
        const pos = { lat: p.latitude, lng: p.longitude };
        overlays.current.push(new g.maps.Circle({ map: m, center: pos, radius: Math.min(p.accuracy_meters, 500), strokeWeight: 0, fillColor: '#8be9c8', fillOpacity: .15 }));
        overlays.current.push(new g.maps.Marker({ map: m, position: pos, title: p.employee_name, label: { text: p.employee_name, color: theme === 'light' ? '#15895f' : '#8be9c8', fontSize: '12px', fontWeight: '600' },
          icon: { path: g.maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#8be9c8', fillOpacity: 1, strokeColor: '#07080a', strokeWeight: 2, labelOrigin: new g.maps.Point(0, -3) } }));
        bounds.extend(pos);
      }
      if (!bounds.isEmpty()) {
        m.fitBounds(bounds, 80);
        g.maps.event.addListenerOnce(m, 'idle', () => { if ((m.getZoom() ?? 0) > 16) m.setZoom(16); });
      }
    }).catch((e: Error) => setError(e.message));
    return () => { cancelled = true; };
  }, [sites, people, theme]);

  if (!GOOGLE_MAPS_BROWSER_KEY) {
    return <div className="map map--empty"><p className="mono muted">Carte indisponible</p><p className="hint">Clé Google Maps (navigateur) non configurée : VITE_GOOGLE_MAPS_BROWSER_KEY.</p></div>;
  }
  return (
    <div className="map">
      <div ref={el} className="map__canvas" />
      {error && <p className="error map__error">{error}</p>}
    </div>
  );
}
