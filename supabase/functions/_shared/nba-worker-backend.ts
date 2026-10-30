// Isolated HTTP boundary for the disabled unattended NBA worker.
// The caller controls activation, credentials, leases and fenced writes.
import type { ExistingNbaGame } from "./nba-unattended.ts";
import { syncUtcBounds } from "./sync-days.ts";

export const NBA_BACKEND_REQUEST_TIMEOUT_MS = 10000;

/** A successful HTTP 200 array is not sufficient: a malformed stored row
 * can hide a picked game or bypass identity/score reconciliation. */
export function isValidExistingNbaGame(value: unknown): value is ExistingNbaGame {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const validScore = (score: unknown) => score === null ||
    (typeof score === "number" && Number.isSafeInteger(score) && score >= 0);
  // History includes other sports, so validate shared states but only apply
  // NBA-specific final-score rules to official NBA IDs. A corrupt NBA final
  // must not certify freshness or silently affect existing wager outcomes.
  const validState = ["scheduled", "live", "final", "postponed", "canceled"].includes(
    row["state"] as string,
  );
  const officialNba = typeof row["id"] === "string" &&
    /^nba:[0-9]{10}$/.test(row["id"]) &&
    (row["source"] == null || row["source"] === "nba" ||
      row["source"] === "nba_official_schedule");
  const validNbaFinal = !officialNba || row["state"] !== "final" ||
    (typeof row["away_score"] === "number" &&
      typeof row["home_score"] === "number" &&
      row["away_score"] !== row["home_score"]);
  return validState && validNbaFinal &&
    typeof row["id"] === "string" && row["id"].trim().length > 0 &&
    typeof row["start_utc"] === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(row["start_utc"]) &&
    Number.isFinite(Date.parse(row["start_utc"])) &&
    typeof row["away_code"] === "string" && row["away_code"].trim().length > 0 &&
    typeof row["home_code"] === "string" && row["home_code"].trim().length > 0 &&
    typeof row["state"] === "string" && row["state"].trim().length > 0 &&
    (row["status_detail"] === null || typeof row["status_detail"] === "string") &&
    (row["source"] == null || typeof row["source"] === "string") &&
    validScore(row["away_score"]) && validScore(row["home_score"]);
}


export function createNbaWorkerBackend(
  endpoint: string,
  key: string,
  request: typeof fetch = fetch,
  timeoutMs = NBA_BACKEND_REQUEST_TIMEOUT_MS,
) {
  const admin = {
    apikey: key,
    ...(key.startsWith("sb_secret_") ? {} : { Authorization: "Bearer " + key }),
    "content-type": "application/json",
  };

  const rpc = async <T,>(name: string, args: unknown): Promise<T> => {
    // Never send privileged credentials to an arbitrary RPC path.
    if (name !== "try_claim_nba_sync" && name !== "release_nba_sync" &&
        name !== "commit_nba_sync_day") {
      throw new Error("Unexpected NBA sync RPC");
    }
    const response = await request(endpoint + "/rest/v1/rpc/" + name, {
      method: "POST", headers: admin, body: JSON.stringify(args),
      // Never forward service-role credentials to a redirected host.
      redirect: "error", signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error("NBA sync RPC " + name + " failed (HTTP " + response.status + ")");
    // A successful HTTP status is not proof that PostgREST returned the
    // expected scalar. In particular, a truthy object must never be treated
    // as an acquired lease, and a malformed commit count must not be reported
    // as a successful score refresh.
    const result: unknown = await response.json();
    if (name === "try_claim_nba_sync" || name === "release_nba_sync") {
      if (typeof result !== "boolean") {
        throw new Error("NBA sync RPC " + name + " returned malformed result");
      }
    } else if (name === "commit_nba_sync_day") {
      if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 0 || result > 40) {
        throw new Error("NBA sync RPC " + name + " returned malformed result");
      }
    }
    return result as T;
  };

  const readExisting = async (days: string[]): Promise<ExistingNbaGame[]> => {
    const bounds = syncUtcBounds(days);
    const path = "/rest/v1/games?select=id,start_utc,away_code,home_code,away_score,home_score,state,status_detail,source" +
      "&start_utc=gte." + bounds.lower + "T00:00:00Z&start_utc=lt." + bounds.upper + "T00:00:00Z&limit=3000";
    // Request an exact row count: PostgREST may silently cap a 3,000-row
    // request at its configured max_rows (often 1,000) while returning 200.
    const response = await request(endpoint + path, {
      headers: { ...admin, Prefer: "count=exact" },
      // A proxy redirect must not forward the privileged apikey header.
      redirect: "error", signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error("NBA sync database read failed (HTTP " + response.status + ")");
    const data: unknown = await response.json();
    // A malformed HTTP 200 must not be mistaken for an empty game history:
    // that could create duplicate official IDs or detach existing wagers.
    if (!Array.isArray(data)) throw new Error("NBA sync database returned malformed games");
    // PostgREST can return HTTP 206 when its row cap truncates a valid JSON
    // array. Missing older games could let an official ID be duplicated while
    // its original picks or wagers remain attached to the omitted record.
    // A full 3,000-row page is ambiguous even if the server reports HTTP 200.
    // Fail closed rather than certify freshness from incomplete history.
    const range = response.headers.get("content-range");
    // An exact count was requested. Without Content-Range, even an empty
    // HTTP 200 list cannot prove that PostgREST returned every stored game.
    // Fail closed rather than risk orphaning existing picks or wagers.
    if (range === null) throw new Error("NBA sync database returned incomplete games");
    {
      // PostgREST uses "0-9/10" for complete results, "0-999/1500"
      // for truncated pages, and "*/0" for an empty result. An unknown
      // total cannot prove completeness even with fewer than 1,000 rows.
      const match = /^(\d+)-(\d+)\/(\d+|\*)$/.exec(range);
      const empty = range === "*/0" && data.length === 0;
      const start = match ? Number(match[1]) : NaN;
      const end = match ? Number(match[2]) : NaN;
      const total = match?.[3] === "*" ? null : Number(match?.[3]);
      if (!empty && (!match || start !== 0 || end - start + 1 !== data.length ||
          total === null || total !== data.length)) {
        throw new Error("NBA sync database returned incomplete games");
      }
    }
    // Reject partial responses and an ambiguous full requested page even
    // when the server reports an apparently matching exact count.
    if (response.status === 206 || data.length >= 3000) {
      throw new Error("NBA sync database returned incomplete games");
    }
    if (!data.every(isValidExistingNbaGame)) {
      throw new Error("NBA sync database returned malformed games");
    }
    return data as ExistingNbaGame[];
  };

  return { rpc, readExisting };
}
