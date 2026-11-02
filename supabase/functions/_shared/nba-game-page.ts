/** Fail closed when a signed-in NBA refresh reads incomplete game history.
 * PostgREST can return a valid JSON array with HTTP 206 (or even 200)
 * after silently applying max_rows. Missing records may carry user picks or
 * wagers, so never reconcile official game IDs from a truncated page.
 *
 * Callers MUST request Prefer: count=exact on the games read.
 */
export function assertCompleteNbaGamePage(
  response: Pick<Response, "status" | "headers">,
  rows: unknown,
  limit = 3000,
): asserts rows is unknown[] {
  if (!Array.isArray(rows) || response.status !== 200 ||
      !Number.isSafeInteger(limit) || limit < 1 || rows.length >= limit) {
    throw new Error("NBA game history is incomplete");
  }
  const range = response.headers.get("content-range");
  if (rows.length === 0 && range === "*/0") return;
  const match = range?.match(/^(\d+)-(\d+)\/(\d+)$/);
  if (!match) throw new Error("NBA game history is incomplete");
  const first = Number(match[1]);
  const last = Number(match[2]);
  const total = Number(match[3]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) ||
      !Number.isSafeInteger(total) || first !== 0 ||
      last !== rows.length - 1 || total !== rows.length) {
    throw new Error("NBA game history is incomplete");
  }
}
