// QR rendering (customer) and camera scanning (barber). Libraries are vendored globals: qrcode, Html5Qrcode.
import { h } from './ui.js';

/** Returns an <img> showing the QR for `text`. Only the opaque token is encoded, never personal data. */
export function qrImage(text, { cellSize = 8, alt = 'Appointment QR code' } = {}) {
  const qr = window.qrcode(0, 'M'); // type 0 = auto size
  qr.addData(text);
  qr.make();
  return h('img', { src: qr.createDataURL(cellSize, 16), alt, width: 280, height: 280 });
}

/**
 * Starts the camera scanner inside element `elId`. Calls onScan(text) once per decode (paused until resume()).
 * Returns { stop(), resume() }. Prefers the rear camera. Throws a friendly Error if the camera is unavailable.
 */
export async function startScanner(elId, onScan) {
  if (!window.Html5Qrcode) throw new Error('The scanner could not be loaded. Restart the app and try again.');
  const scanner = new window.Html5Qrcode(elId, { verbose: false });
  let paused = false;
  try {
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: (w, hgt) => { const s = Math.floor(Math.min(w, hgt) * 0.72); return { width: s, height: s }; }, aspectRatio: 1 },
      (text) => { if (paused) return; paused = true; onScan(text); },
      () => {},
    );
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/permission|denied|NotAllowed/i.test(msg)) throw new Error('Camera permission is off. Allow camera access for CallNBarb in your phone settings, then try again.');
    if (/NotFound|no camera|Requested device/i.test(msg)) throw new Error('No camera was found on this device.');
    throw new Error('The camera could not start. Close other apps using the camera and try again.');
  }
  return {
    resume() { paused = false; },
    async stop() { try { if (scanner.isScanning) await scanner.stop(); scanner.clear(); } catch {} },
  };
}
