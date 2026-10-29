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
  return typeof row["id"] === "string" && row["id"].trim().length > 0 &&
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
      signal: AbortSignal.timeout(timeoutMs),
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
    const response = await request(endpoint + path, {
      headers: admin, signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error("NBA sync database read failed (HTTP " + response.status + ")");
    const data: unknown = await response.json();
    // A malformed HTTP 200 must not be mistaken for an empty game history:
    // that could create duplicate official IDs or detach existing wagers.
    if (!Array.isArray(data) || !data.every(isValidExistingNbaGame)) {
      throw new Error("NBA sync database returned malformed games");
    }
    // PostgREST can return HTTP 206 when its row cap truncates a valid JSON
    // array. Missing older games could let an official ID be duplicated while
    // its original picks or wagers remain attached to the omitted record.
    // A full 3,000-row page is ambiguous even if the server reports HTTP 200.
    // Fail closed rather than certify freshness from incomplete history.
    if (response.status === 206 || data.length >= 3000) {
      throw new Error("NBA sync database returned incomplete games");
    }
    return data as ExistingNbaGame[];
  };

  return { rpc, readExisting };
}
