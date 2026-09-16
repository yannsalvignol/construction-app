// Loads the Maps JavaScript API once. The browser key is public by design
// (restricted to casprod.app referrers in Google Cloud); without it the map
// component explains what is missing instead of rendering.
export const GOOGLE_MAPS_BROWSER_KEY = (import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY as string | undefined) || '';

let loading: Promise<typeof google> | null = null;

export function loadGoogleMaps(): Promise<typeof google> {
  if (window.google?.maps) return Promise.resolve(window.google);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_BROWSER_KEY)}&v=weekly&language=fr&region=MA&loading=async`;
    script.async = true;
    script.onerror = () => { loading = null; reject(new Error('Google Maps n’a pas pu être chargé.')); };
    // With loading=async the namespace is empty at onload: the libraries used
    // (Map/Circle in "maps", legacy Marker in "marker") must be imported first.
    script.onload = () => {
      Promise.all([window.google.maps.importLibrary('maps'), window.google.maps.importLibrary('marker')])
        .then(() => resolve(window.google))
        .catch(() => { loading = null; reject(new Error('Google Maps n’a pas pu être initialisé.')); });
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Restrained dark styling so the map sits in the workspace instead of shouting. */
export const DARK_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#0e1116' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a90a0' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0b0d11' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1a1f28' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#0b0d11' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#262d3a' }] },
  { featureType: 'water', stylers: [{ color: '#070a10' }] },
  { featureType: 'landscape', stylers: [{ color: '#0e1116' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#2a3140' }] },
];
export const LIGHT_STYLE: google.maps.MapTypeStyle[] = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#5b6270' }] },
  { featureType: 'water', stylers: [{ color: '#dfe6f2' }] },
  { featureType: 'landscape', stylers: [{ color: '#f2f3f5' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#e3e6ec' }] },
];
