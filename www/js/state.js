// Small shared app state: server metadata (Delta towns, rules, payment mode) and the chosen town.
import { api } from './api.js';

export const state = { meta: null, unread: 0, listeners: new Set() };
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

export async function loadMeta() {
  if (!state.meta) state.meta = (await api('/meta', { auth: false }));
  return state.meta;
}
export const getTown = () => read('cnb_town') || 'Asaba';
export function setTown(t) { try { localStorage.setItem('cnb_town', t); } catch {} state.listeners.forEach((fn) => fn()); }
export const townInfo = (name) => (state.meta?.towns || []).find((t) => t.name === name);
export const onStateChange = (fn) => { state.listeners.add(fn); return () => state.listeners.delete(fn); };
export function setUnread(n) { state.unread = n; state.listeners.forEach((fn) => fn()); }
