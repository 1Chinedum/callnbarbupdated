// Where the API lives.
// - Served by the CallNBarb backend (browser / admin dashboard): same origin, so ''.
// - Inside the Android app (Capacitor): the page is served from https://localhost, so the API
//   address is stored on the device. Default targets the Android emulator's host machine.
const DEFAULT_NATIVE_API = 'http://10.0.2.2:4000';

export const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

export function apiBase() {
  try {
    const saved = localStorage.getItem('cnb_api');
    if (saved) return saved.replace(/\/+$/, '');
  } catch {}
  return isNative() ? DEFAULT_NATIVE_API : '';
}
export function setApiBase(url) {
  try { url ? localStorage.setItem('cnb_api', url.trim().replace(/\/+$/, '')) : localStorage.removeItem('cnb_api'); } catch {}
}
export const assetUrl = (p) => (!p ? '' : /^https?:/.test(p) ? p : apiBase() + p);
