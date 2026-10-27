/** A zero-count sync is a normal cache hit: the backend deliberately skips
 * fresh days until their TTL expires. Only reported provider/database errors
 * should surface as user-facing refresh warnings.
 */
export type ScheduleSyncResult = {
  checked: number;
  updated: number;
  errors: string[];
};

export function scheduleSyncWarning(
  result: ScheduleSyncResult,
  context: "Schedule refresh" | "Live scores" = "Schedule refresh",
): string | null {
  if (result.errors.length === 0) return null;
  return `${context}: ${result.errors.slice(0, 2).join("; ")}`;
}
