// Time helpers. Every timestamp is the venue's wall-clock time held as UTC
// milliseconds, with no timezone conversion. A trading day runs 05:00 to 04:59.

export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export const MIN = 60_000;
const SHIFT = 5 * HOUR;

/** Trading day number (days since 1 Jan 1970). After-midnight sales belong to the night before. */
export const bizDay = (ts: number): number => Math.floor((ts - SHIFT) / DAY);
/** Trading hour, 5 to 29 (fractional), so 24 is midnight. */
export const bizHour = (ts: number): number => (((ts - SHIFT) % DAY) + DAY) % DAY / HOUR + 5;
/** Day of week, 0 = Monday. */
export const dow = (day: number): number => (((day + 3) % 7) + 7) % 7;
/** The Monday of that day's week, as a day number. */
export const weekOf = (day: number): number => day - dow(day);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtDay(day: number): string {
  const d = new Date(day * DAY);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
export const isoDay = (day: number): string => new Date(day * DAY).toISOString().slice(0, 10);
export function dayFromIso(s: string): number {
  const p = String(s).split("-");
  return Math.floor(Date.UTC(+p[0]!, +p[1]! - 1, +p[2]!) / DAY);
}

/**
 * Accepts `YYYY-MM-DD HH:MM[:SS]`, ISO `YYYY-MM-DDTHH:MM[:SS]` and UK
 * `DD/MM/YYYY HH:MM[:SS]`. Returns NaN when the text is none of these.
 */
export function parseTime(s: unknown): number {
  if (s == null) return NaN;
  const t = String(s).trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return Date.UTC(+m[3]!, +m[2]! - 1, +m[1]!, +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return NaN;
}

/** "19:00" style label for a trading hour (24 → 00:00). */
export const hourLabel = (h: number): string => `${String(h % 24).padStart(2, "0")}:00`;
