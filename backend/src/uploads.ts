import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { badRequest } from './errors.js';

const MAX_BYTES = 4 * 1024 * 1024;

const SIGNATURES: { ext: string; mime: string; test: (b: Buffer) => boolean }[] = [
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  { ext: 'pdf', mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString() === '%PDF-' },
];

export type UploadKind = 'avatar' | 'portfolio' | 'document' | 'evidence';

/** Accepts a base64 data URL. File type is decided by magic bytes, never by the client's claimed type. */
export function saveUpload(kind: UploadKind, dataUrl: string): { url: string; private: boolean } {
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!m) throw badRequest('Upload must be a base64 data URL.', 'INVALID_UPLOAD');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length === 0 || buf.length > MAX_BYTES) throw badRequest('File is too large (max 4 MB).', 'FILE_TOO_LARGE');
  const sig = SIGNATURES.find((s) => s.test(buf));
  if (!sig) throw badRequest('Only JPG, PNG, WebP or PDF files are allowed.', 'INVALID_FILE_TYPE');
  if ((kind === 'avatar' || kind === 'portfolio') && sig.ext === 'pdf') throw badRequest('Photos must be JPG, PNG or WebP.', 'INVALID_FILE_TYPE');
  const isPrivate = kind === 'document' || kind === 'evidence';
  const dir = join(config.uploadDir, isPrivate ? 'private' : 'public');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const name = `${kind}-${randomBytes(12).toString('hex')}.${sig.ext}`; // random name: no user-controlled path segments
  writeFileSync(join(dir, name), buf);
  return { url: isPrivate ? `/api/me/uploads/private/${name}` : `/uploads/${name}`, private: isPrivate };
}
