// CallNBarb launches in Delta State, Nigeria only. All geography lives here so
// other states/countries can be added later by extending this config.

export const SERVICE_STATE = 'Delta';

export interface Town {
  name: string;
  lat: number;
  lng: number;
}

// Approximate town-centre coordinates (used for default map centring and distance sorting).
export const DELTA_TOWNS: Town[] = [
  { name: 'Asaba', lat: 6.1983, lng: 6.7333 },
  { name: 'Warri', lat: 5.5167, lng: 5.75 },
  { name: 'Effurun', lat: 5.55, lng: 5.7833 },
  { name: 'Sapele', lat: 5.8939, lng: 5.6769 },
  { name: 'Ughelli', lat: 5.4896, lng: 6.0033 },
  { name: 'Agbor', lat: 6.25, lng: 6.2 },
  { name: 'Abraka', lat: 5.7833, lng: 6.1 },
  { name: 'Ozoro', lat: 5.5333, lng: 6.2167 },
  { name: 'Oleh', lat: 5.4667, lng: 6.2 },
  { name: 'Kwale', lat: 5.7, lng: 6.4333 },
  { name: 'Ogwashi-Uku', lat: 6.1833, lng: 6.5167 },
  { name: 'Burutu', lat: 5.35, lng: 5.5167 },
  { name: 'Bomadi', lat: 5.1667, lng: 5.9833 },
];

export const DELTA_CENTER = { lat: 5.8, lng: 6.0, zoom: 8 };

// Rough bounding box around Delta State. Used only as a sanity check on GPS
// coordinates; the address "state" field must also be Delta.
const BOX = { minLat: 5.0, maxLat: 6.5, minLng: 5.0, maxLng: 6.9 };

export function isInDeltaBox(lat: number, lng: number): boolean {
  return lat >= BOX.minLat && lat <= BOX.maxLat && lng >= BOX.minLng && lng <= BOX.maxLng;
}

export function isDeltaState(state: string): boolean {
  return state.trim().toLowerCase().replace(/\s*state$/, '') === 'delta';
}

export function findTown(name: string): Town | undefined {
  const n = name.trim().toLowerCase();
  return DELTA_TOWNS.find((t) => t.name.toLowerCase() === n);
}

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
