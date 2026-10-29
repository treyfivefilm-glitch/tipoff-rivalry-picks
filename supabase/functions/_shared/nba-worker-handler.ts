// Testable request handler for the disabled, owner-approval-only NBA worker.
// No scheduler, credentials or database changes are made by importing this file.
import { loadUnattendedNbaFeeds } from "./nba-worker-feeds.ts";
import {
  authorizedNbaCron, hasOverdueScheduledNbaGame, prepareUnattendedNbaDay,
  unattendedNbaDays, unattendedNbaHttpStatus,
} from "./nba-unattended.ts";
import { createNbaWorkerBackend } from "./nba-worker-backend.ts";

export type NbaWorkerDependencies = {
  env: (name: string) => string | undefined;
  request?: typeof fetch;
  now?: () => Date;
  newToken?: () => string;
  log?: Pick<Console, "error" | "warn" | "info">;
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});

export function createUnattendedNbaHandler(deps: NbaWorkerDependencies) {
  const requestHttp = deps.request ?? fetch;
  const now = deps.now ?? (() => new Date());
  const newToken = deps.newToken ?? (() => crypto.randomUUID());
  const log = deps.log ?? console;

  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return json({ error: "POST required" }, 405);
    // Both gates must pass before a privileged backend or provider request.
    if (deps.env("NBA_SYNC_WORKER_ENABLED") !== "true") return json({ error: "Worker disabled" }, 503);
    const secret = deps.env("NBA_SYNC_CRON_SECRET");
    if (!secret || secret.length < 32) return json({ error: "Worker credentials not configured" }, 503);
    if (!await authorizedNbaCron(request.headers.get("authorization"), secret)) {
      return json({ error: "Unauthorized" }, 401);
    }
    const endpoint = deps.env("SUPABASE_URL");
    const key = deps.env("SUPABASE_SERVICE_ROLE_KEY");
    if (!endpoint || !key) return json({ error: "Backend configuration missing" }, 503);
    const { rpc, readExisting } = createNbaWorkerBackend(endpoint, key, requestHttp);

    const days = unattendedNbaDays(now());
    const token = newToken();
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
          log.error("[nba-unattended] lease", error instanceof Error ? error.message : "unknown");
        }
      }
      if (claimed.length) {
        const { schedule, live, errors: feedErrors } = await loadUnattendedNbaFeeds(requestHttp);
        errors.push(...feedErrors);
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
              if (hasOverdueScheduledNbaGame(batch.rows, now())) {
                failed++;
                errors.push(day + ": scheduled NBA game overdue without verified live/final status");
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
              log.error("[nba-unattended] commit", error instanceof Error ? error.message : "unknown");
            }
          }
        }
      }
    } catch (error) {
      // A failed shared history read or unexpected provider error affects
      // every claimed day, not just one. Do not report partial success.
      failed += Math.max(1, claimed.length);
      errors.push("NBA refresh failed");
      log.error("[nba-unattended] refresh", error instanceof Error ? error.message : "unknown");
    } finally {
      for (const day of claimed) {
        try {
          await rpc<boolean>("release_nba_sync", { p_day: day, p_owner_token: token });
        } catch {
          // Expiry makes a failed release recoverable, but monitoring must
          // still see a degraded run instead of a misleading HTTP 200.
          failed++;
          errors.push(day + ": lease release failed");
          log.warn("[nba-unattended] lease release failed for", day);
        }
      }
    }
    log.info("[nba-unattended]", JSON.stringify({ checked, updated, skipped, failed }));
    return json({ checked, updated, skipped, failed, errors }, unattendedNbaHttpStatus(failed, errors));
  };
}
