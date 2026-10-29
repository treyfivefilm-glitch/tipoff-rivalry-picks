// Isolated HTTP boundary for the disabled unattended NBA worker.
// The caller controls activation, credentials, leases and fenced writes.
import type { ExistingNbaGame } from "./nba-unattended.ts";
import { syncUtcBounds } from "./sync-days.ts";

export const NBA_BACKEND_REQUEST_TIMEOUT_MS = 10000;

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
    const response = await request(endpoint + "/rest/v1/rpc/" + name, {
      method: "POST", headers: admin, body: JSON.stringify(args),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error("NBA sync RPC " + name + " failed (HTTP " + response.status + ")");
    return await response.json() as T;
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
    if (!Array.isArray(data)) throw new Error("NBA sync database returned malformed games");
    return data as ExistingNbaGame[];
  };

  return { rpc, readExisting };
}
