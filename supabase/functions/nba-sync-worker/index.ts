// PREPARATION ONLY: no scheduler or credentials configured by this code.
// Owner must approve activation and application of migrations 0013-0014.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { isValidNbaScoreboard } from "../_shared/nba-feed-validation.ts";
import { authorizedNbaCron, prepareUnattendedNbaDay, unattendedNbaDays, unattendedNbaHttpStatus, verifiedUnattendedNbaSchedule } from "../_shared/nba-unattended.ts";
import type { ExistingNbaGame } from "../_shared/nba-unattended.ts";
import { syncUtcBounds } from "../_shared/sync-days.ts";

const BASE = "https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA";
const SCHEDULE = BASE + "/staticData/scheduleLeagueV2.json";
const LIVE = BASE + "/liveData/scoreboard/todaysScoreboard_00.json";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});
async function provider(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(11000), headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("NBA feed unavailable");
  return await response.json();
}

Deno.serve(async request => {
  if (request.method !== "POST") return json({ error: "POST required" }, 405);
  // Two independent gates: owner-controlled activation flag and strong cron bearer.
  if (Deno.env.get("NBA_SYNC_WORKER_ENABLED") !== "true") return json({ error: "Worker disabled" }, 503);
  const secret = Deno.env.get("NBA_SYNC_CRON_SECRET");
  if (!secret || secret.length < 32) return json({ error: "Worker credentials not configured" }, 503);
  if (!await authorizedNbaCron(request.headers.get("authorization"), secret)) {
    return json({ error: "Unauthorized" }, 401);
  }
  const endpoint = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!endpoint || !key) return json({ error: "Backend configuration missing" }, 503);
  const admin = {
    apikey: key,
    ...(key.startsWith("sb_secret_") ? {} : { Authorization: "Bearer " + key }),
    "content-type": "application/json",
  };
  const rpc = async <T,>(name: string, args: unknown): Promise<T> => {
    const response = await fetch(endpoint + "/rest/v1/rpc/" + name, {
      method: "POST", headers: admin, body: JSON.stringify(args),
    });
    if (!response.ok) throw new Error("NBA sync RPC " + name + " failed (HTTP " + response.status + ")");
    return await response.json() as T;
  };
  const readExisting = async (days: string[]): Promise<ExistingNbaGame[]> => {
    const bounds = syncUtcBounds(days);
    const path = "/rest/v1/games?select=id,start_utc,away_code,home_code,away_score,home_score,state,status_detail" +
      "&start_utc=gte." + bounds.lower + "T00:00:00Z&start_utc=lt." + bounds.upper + "T00:00:00Z&limit=3000";
    const response = await fetch(endpoint + path, { headers: admin });
    if (!response.ok) throw new Error("NBA sync database read failed (HTTP " + response.status + ")");
    return await response.json() as ExistingNbaGame[];
  };

  const days = unattendedNbaDays(new Date());
  const token = crypto.randomUUID();
  const claimed: string[] = [];
  let checked = 0, updated = 0, skipped = 0, failed = 0;
  const errors: string[] = [];
  try {
    for (const day of days) {
      try {
        const ok = await rpc<boolean>("try_claim_nba_sync", {
          p_day: day, p_owner_token: token, p_lease_seconds: 180,
        });
        if (ok) claimed.push(day);
        else skipped++;
      } catch (error) {
        failed++;
        errors.push(day + ": lease acquisition failed");
        console.error("[nba-unattended] lease", error instanceof Error ? error.message : "unknown");
      }
    }
    if (claimed.length) {
      const [scheduleResult, liveResult] = await Promise.allSettled([provider(SCHEDULE), provider(LIVE)]);
      const schedule = scheduleResult.status === "fulfilled" && verifiedUnattendedNbaSchedule(scheduleResult.value)
        ? scheduleResult.value : null;
      const live = liveResult.status === "fulfilled" && isValidNbaScoreboard(liveResult.value)
        ? liveResult.value : null;
      if (!schedule) errors.push("Season schedule unavailable");
      if (!live) errors.push("Live scoreboard unavailable");
      if (!schedule && !live) {
        failed += claimed.length;
      } else {
        const existing = await readExisting(claimed);
        for (const day of claimed) {
          try {
            const batch = prepareUnattendedNbaDay(day, schedule, live, existing);
            if (!batch.cacheable) {
              failed++;
              errors.push(day + ": no verified NBA feed");
              continue;
            }
            const count = await rpc<number>("commit_nba_sync_day", {
              p_day: day, p_owner_token: token, p_rows: batch.rows,
            });
            checked++;
            updated += count;
          } catch (error) {
            failed++;
            errors.push(day + ": fenced commit failed");
            console.error("[nba-unattended] commit", error instanceof Error ? error.message : "unknown");
          }
        }
      }
    }
  } catch (error) {
    failed++;
    errors.push("NBA refresh failed");
    console.error("[nba-unattended] refresh", error instanceof Error ? error.message : "unknown");
  } finally {
    for (const day of claimed) {
      try {
        await rpc<boolean>("release_nba_sync", { p_day: day, p_owner_token: token });
      } catch {
        // Expiring leases are safe to reclaim; never conceal the original result.
        console.warn("[nba-unattended] lease release failed for", day);
      }
    }
  }
  console.info("[nba-unattended]", JSON.stringify({ checked, updated, skipped, failed }));
  return json({ checked, updated, skipped, failed, errors }, unattendedNbaHttpStatus(failed, errors));
});
