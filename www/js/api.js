import { apiBase } from './config.js';

const TOKEN_KEY = 'cnb_token';
const USER_KEY = 'cnb_user';
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

export const session = {
  get token() { return read(TOKEN_KEY); },
  get user() { try { return JSON.parse(read(USER_KEY) || 'null'); } catch { return null; } },
  set(token, user) { write(TOKEN_KEY, token); write(USER_KEY, JSON.stringify(user)); },
  setUser(user) { write(USER_KEY, JSON.stringify(user)); },
  clear() { write(TOKEN_KEY, null); write(USER_KEY, null); },
};

export class ApiError extends Error {
  constructor(message, status, code, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

/** api('/bookings', { method:'POST', body:{...} }) -> parsed JSON. Throws ApiError with a user-safe message. */
export async function api(path, { method = 'GET', body, query, auth = true, signal } = {}) {
  let url = apiBase() + '/api' + path;
  if (query) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') q.set(k, v);
    const s = q.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && session.token) headers.Authorization = 'Bearer ' + session.token;
  let res;
  try {
    res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError('Cannot reach CallNBarb. Check your internet connection and try again.', 0, 'NETWORK');
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = data && data.error ? data.error : {};
    if (res.status === 401 && auth && session.token) { session.clear(); onUnauthorized(); }
    throw new ApiError(err.message || 'Something went wrong. Please try again.', res.status, err.code, err.details);
  }
  return data;
}

/** Uploads a File to /me/uploads. kind: 'avatar' | 'portfolio' (public photos), 'document' | 'evidence' (private). Returns { url, private }. */
export async function uploadFile(file, kind = 'avatar') {
  if (file.size > 4 * 1024 * 1024) throw new ApiError('That file is too large. Choose one under 4 MB.', 0, 'FILE_TOO_LARGE');
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new ApiError('Could not read that file.', 0, 'FILE'));
    r.readAsDataURL(file);
  });
  return api('/me/uploads', { method: 'POST', body: { kind, dataUrl: String(dataUrl) } });
}

/** Fetches a private upload (needs the auth header) and returns an object URL you can use in <img>/<a>. */
export async function privateFileUrl(url) {
  const res = await fetch(apiBase() + url, { headers: { Authorization: 'Bearer ' + session.token } });
  if (!res.ok) throw new ApiError('Could not open that file.', res.status, 'FILE');
  return URL.createObjectURL(await res.blob());
}
