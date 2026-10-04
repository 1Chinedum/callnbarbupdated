// Map helpers. Leaflet + OpenStreetMap, locked to Delta State. Directions open the phone's map app.
import { h, icon } from './ui.js';
import { state } from './state.js';

// Delta State bounding box (slightly padded). Must match the server's sanity box in backend/src/delta.ts.
export const DELTA_BOUNDS = [[4.95, 4.95], [6.55, 6.95]];
export const DELTA_CENTER = [5.8, 6.0];
export const inDelta = (lat, lng) => lat >= 5.0 && lat <= 6.5 && lng >= 5.0 && lng <= 6.9;

const pinIcon = (cls = '') => window.L.divIcon({ className: '', html: `<div class="map-pin ${cls}"></div>`, iconSize: [30, 30], iconAnchor: [15, 30] });

/** Creates a map in `el` (an element already attached or about to be). Returns the Leaflet map. */
export function createMap(el, { center, zoom = 12, locked = true } = {}) {
  const L = window.L;
  const map = L.map(el, {
    center: center || DELTA_CENTER, zoom: center ? zoom : 9,
    minZoom: 8, maxZoom: 18, zoomControl: true, attributionControl: true,
    maxBounds: locked ? DELTA_BOUNDS : undefined, maxBoundsViscosity: 0.9,
  });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
  // Leaflet needs a size recalculation once the element is in the DOM / visible.
  setTimeout(() => map.invalidateSize(), 80);
  setTimeout(() => map.invalidateSize(), 400);
  return map;
}
export function mapBox(cls = '') { return h('div', { class: 'map ' + cls, role: 'region', 'aria-label': 'Map of Delta State' }); }

export function addMarker(map, lat, lng, { label, navy = false, onClick } = {}) {
  const m = window.L.marker([lat, lng], { icon: pinIcon(navy ? 'navy' : ''), title: label || '' }).addTo(map);
  if (label) m.bindTooltip(label, { direction: 'top', offset: [0, -28] });
  if (onClick) m.on('click', onClick);
  return m;
}
export function fitMarkers(map, points) {
  if (!points.length) return;
  if (points.length === 1) return map.setView(points[0], 14);
  map.fitBounds(points, { padding: [40, 40], maxZoom: 15 });
}

/**
 * Location picker: tap the map or drag the pin. onChange(lat, lng, insideDelta).
 * Returns { map, setPosition(lat,lng), getPosition() }.
 */
export function pickLocation(el, { lat, lng, onChange } = {}) {
  const start = lat != null ? [lat, lng] : DELTA_CENTER;
  const map = createMap(el, { center: lat != null ? start : null, zoom: 15 });
  if (lat == null) map.setView(start, 9);
  let marker = lat != null ? addMarker(map, lat, lng) : null;
  const place = (la, ln) => {
    if (!marker) marker = addMarker(map, la, ln);
    marker.setLatLng([la, ln]);
    onChange && onChange(la, ln, inDelta(la, ln));
  };
  map.on('click', (e) => place(e.latlng.lat, e.latlng.lng));
  return {
    map,
    setPosition(la, ln, zoom = 16) { place(la, ln); map.setView([la, ln], zoom); },
    getPosition() { return marker ? marker.getLatLng() : null; },
  };
}

/** Current GPS position. Uses the Capacitor plugin on Android, the browser API elsewhere. */
export async function currentPosition() {
  const cap = window.Capacitor;
  try {
    if (cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins && cap.Plugins.Geolocation) {
      const perm = await cap.Plugins.Geolocation.requestPermissions();
      if (perm.location === 'denied') throw new Error('denied');
      const p = await cap.Plugins.Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 });
      return { lat: p.coords.latitude, lng: p.coords.longitude };
    }
    if (!navigator.geolocation) throw new Error('unsupported');
    return await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), reject, { enableHighAccuracy: true, timeout: 15000 }));
  } catch (e) {
    throw new Error('Location is off or not allowed. Turn on location for CallNBarb, or tap the map to place the pin.');
  }
}

/** URL that opens turn-by-turn directions in Google Maps / the phone's default map app. */
export function directionsUrl(lat, lng, label = '') {
  if (lat != null && lng != null) return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label + ', Delta State, Nigeria')}`;
}
export function directionsButton(loc, cls = 'btn red') {
  return h('a', { class: cls, href: directionsUrl(loc.latitude, loc.longitude, [loc.address, loc.city].filter(Boolean).join(', ')), target: '_blank', rel: 'noopener' }, icon('nav', 20), 'Get directions');
}
export const townCenter = (name) => { const t = (state.meta?.towns || []).find((x) => x.name === name); return t ? [t.lat, t.lng] : DELTA_CENTER; };
