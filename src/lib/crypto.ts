import { createHash, randomBytes, timingSafeEqual } from "crypto";

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function qrPayload(token: string) {
  return `CALLNBARB:${token}`;
}

export function parseQrPayload(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("CALLNBARB:")) {
    return trimmed.slice("CALLNBARB:".length);
  }
  return trimmed || null;
}

export function tokensEqual(a: string, b: string) {
  const ha = Buffer.from(hashToken(a));
  const hb = Buffer.from(hashToken(b));
  if (ha.length !== hb.length) return false;
  return timingSafeEqual(ha, hb);
}

export function publicBookingRef() {
  const n = randomBytes(4).toString("hex").toUpperCase();
  return `CNB-${n}`;
}

export function paymentReference() {
  return `CNB-PAY-${randomBytes(8).toString("hex")}`;
}

export function withdrawalReference() {
  return `CNB-WD-${randomBytes(8).toString("hex")}`;
}
