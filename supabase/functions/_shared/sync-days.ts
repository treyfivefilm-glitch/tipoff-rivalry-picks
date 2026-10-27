/** Validate and order untrusted day selections before reading NBA games.
 * A reversed request used to generate an inverted PostgREST time range.
 */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDay(day: string): boolean {
  if (!ISO_DAY.test(day)) return false;
  const time = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day;
}

export function normalizeSyncDays(
  raw: unknown,
  seasonStart: string,
  seasonEnd: string,
  limit = 21,
): string[] {
  if (!Array.isArray(raw)) return [];
  const days = raw.filter((day): day is string =>
    typeof day === "string" && isCalendarDay(day) && day >= seasonStart && day <= seasonEnd,
  );
  return [...new Set(days)].sort().slice(0, limit);
}

export function syncUtcBounds(days: readonly string[]): { lower: string; upper: string } {
  if (days.length === 0) throw new Error("Cannot calculate NBA sync bounds without days");
  const ordered = [...days].sort();
  const shift = (day: string, offset: number) =>
    new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
  // Pad both ends for Pacific-day NBA tipoffs and postponed games.
  return { lower: shift(ordered[0]!, -2), upper: shift(ordered[ordered.length - 1]!, 2) };
}

/** Return null for an invalid provider timestamp rather than throwing inside
 * Intl.DateTimeFormat and aborting an otherwise healthy NBA score refresh.
 */
export function safeNbaPacificDay(value: unknown): string | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value;
  const year = get("year"), month = get("month"), day = get("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}
