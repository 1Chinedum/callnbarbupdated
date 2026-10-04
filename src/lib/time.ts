export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function addMinutes(hhmm: string, minutes: number): string {
  return fromMinutes(toMinutes(hhmm) + minutes);
}

export function overlaps(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): boolean {
  return toMinutes(startA) < toMinutes(endB) && toMinutes(startB) < toMinutes(endA);
}

export function todayISO(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function dayOfWeek(dateISO: string) {
  return new Date(`${dateISO}T12:00:00`).getDay();
}

export function bookingDateTime(dateISO: string, time: string) {
  return new Date(`${dateISO}T${time}:00`);
}
