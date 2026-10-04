// Copies third-party browser assets into www/vendor so the Android app works without a CDN.
import { cpSync, mkdirSync } from 'node:fs';
const n = 'node_modules';
mkdirSync('www/vendor/fonts', { recursive: true });
cpSync(`${n}/leaflet/dist/leaflet.js`, 'www/vendor/leaflet.js');
cpSync(`${n}/leaflet/dist/leaflet.css`, 'www/vendor/leaflet.css');
cpSync(`${n}/leaflet/dist/images`, 'www/vendor/images', { recursive: true });
cpSync(`${n}/html5-qrcode/html5-qrcode.min.js`, 'www/vendor/html5-qrcode.min.js');
cpSync(`${n}/qrcode-generator/dist/qrcode.js`, 'www/vendor/qrcode.js');
for (const [pkg, f] of [
  ['bricolage-grotesque', 'bricolage-grotesque-latin-wght-normal.woff2'],
  ['figtree', 'figtree-latin-wght-normal.woff2'],
]) cpSync(`${n}/@fontsource-variable/${pkg}/files/${f}`, `www/vendor/fonts/${f}`);
console.log('vendor assets copied');
