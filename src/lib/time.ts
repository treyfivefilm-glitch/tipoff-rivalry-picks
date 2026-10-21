export const TZ = "America/Los_Angeles";
export const SEASON_START = "2026-10-20";
export const SEASON_END = "2027-04-11";

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

/** Pacific calendar day (YYYY-MM-DD) for an instant. DST-aware via Intl. */
export function pacificDay(d: string | Date): string {
  return dayFmt.format(typeof d === "string" ? new Date(d) : d);
}
export function pacificTime(d: string | Date): string {
  return timeFmt.format(typeof d === "string" ? new Date(d) : d) + " PT";
}
function toUTCDate(day: string) {
  const [y, m, dd] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd));
}
export function addDays(day: string, n: number): string {
  const d = toUTCDate(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Monday of the Monday–Sunday week containing `day`. */
export function weekStart(day: string): string {
  const dow = toUTCDate(day).getUTCDay(); // 0 Sun
  return addDays(day, -((dow + 6) % 7));
}
export function weekDays(day: string): string[] {
  const s = weekStart(day);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}
export function clampSeason(day: string): string {
  if (day < SEASON_START) return SEASON_START;
  if (day > SEASON_END) return SEASON_END;
  return day;
}
export function todayPacific(): string {
  return pacificDay(new Date());
}
export function seasonWeeks(): string[] {
  const out: string[] = [];
  for (let w = weekStart(SEASON_START); w <= SEASON_END; w = addDays(w, 7)) out.push(w);
  return out;
}
export function weekNumber(day: string): number {
  return seasonWeeks().indexOf(weekStart(day)) + 1;
}
const chipFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" });
const monFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
export function dayLabel(day: string) {
  const d = toUTCDate(day);
  return { dow: chipFmt.format(d).toUpperCase(), md: monFmt.format(d), num: d.getUTCDate() };
}
export function weekLabel(ws: string) {
  return `${monFmt.format(toUTCDate(ws))} – ${monFmt.format(toUTCDate(addDays(ws, 6)))}`;
}
export function fmtMoney(cents: number, signed = false): string {
  const s = `$${(Math.abs(cents) / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
  if (!signed) return cents < 0 ? `-${s}` : s;
  return cents > 0 ? `+${s}` : cents < 0 ? `-${s}` : s;
}
