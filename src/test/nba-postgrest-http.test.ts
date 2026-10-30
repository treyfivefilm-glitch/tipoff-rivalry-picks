// @vitest-environment node
// Real PostgREST -> disposable PostgreSQL integration, never Supabase/production.
// The service exposes a local CI-only role without JWT verification. This
// tests HTTP/SQL compatibility, NOT deployment auth or owner secret setup.
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUnattendedNbaHandler } from "../../supabase/functions/_shared/nba-worker-handler";

const enabled = process.env["CI"] === "true" &&
  process.env["RUN_DISPOSABLE_NBA_POSTGREST_TESTS"] === "true";
const dbUrl = process.env["STAGING_TEST_DB_URL"];
const restUrl = "http://127.0.0.1:3000";
if (enabled) {
  if (!dbUrl) throw new Error("Missing disposable database URL");
  const target = new URL(dbUrl);
  if (target.hostname !== "127.0.0.1" || target.port !== "5432" ||
      target.pathname !== "/tipoff_test" || target.search || target.hash) {
    throw new Error("PostgREST smoke test refuses a non-disposable database");
  }
}

describe.skipIf(!enabled)("NBA worker through real PostgREST and disposable PostgreSQL", () => {
  let db: ReturnType<typeof postgres> | undefined;
  const day = "2026-11-17";
  const gameId = "nba:0022600012";
  const startUtc = "2026-11-18T03:00:00Z";
  const secret = "test-only-real-postgrest-worker-secret-at-least-32-characters";
  const scheduleGame = {
    gameId: "0022600012", gameDateTimeUTC: startUtc,
    gameStatus: 1, gameStatusText: "Scheduled",
    awayTeam: { teamTricode: "LAL", score: null },
    homeTeam: { teamTricode: "GSW", score: null },
  };
  const finalGame = {
    ...scheduleGame, gameStatus: 3, gameStatusText: "Final",
    awayTeam: { teamTricode: "LAL", score: 109 },
    homeTeam: { teamTricode: "GSW", score: 107 },
  };
  const reply = (value: unknown) => new Response(JSON.stringify(value), {
    status: 200, headers: { "content-type": "application/json" },
  });

  beforeAll(async () => {
    if (!dbUrl) throw new Error("Disposable test database not configured");
    db = postgres(dbUrl, { max: 2, prepare: false, connect_timeout: 5 });
    const [target] = await db<{ name: string }[]>`SELECT current_database() AS name`;
    if (target?.name !== "tipoff_test") throw new Error("Wrong database");
    // The isolated job starts with an empty games table; do not overwrite data.
    expect(await db`SELECT id FROM public.games WHERE id=${gameId}`).toHaveLength(0);
    await db`INSERT INTO public.games (
      id, start_utc, away_code, away_name, home_code, home_name,
      away_score, home_score, state, status_detail, source
    ) VALUES (
      ${gameId}, ${startUtc}::timestamptz, 'LAL', 'Los Angeles Lakers',
      'GSW', 'Golden State Warriors', NULL, NULL, 'scheduled',
      'Scheduled', 'nba_official_schedule'
    )`;
  });

  afterAll(async () => { await db?.end({ timeout: 5 }); });

  it("authenticates, reads exact history, reconciles the same game and releases leases", async () => {
    if (!db) throw new Error("Database unavailable");
    const backendPaths: string[] = [];
    const request = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = String(input);
      if (target.includes("scheduleLeagueV2")) {
        return reply({ leagueSchedule: { gameDates: [{ gameDate: day, games: [scheduleGame] }] } });
      }
      if (target.includes("todaysScoreboard")) {
        return reply({ scoreboard: { gameDate: day, games: [finalGame] } });
      }
      if (!target.startsWith(restUrl + "/rest/v1/")) throw new Error("Unexpected outbound target");
      backendPaths.push(new URL(target).pathname);
      // Supabase's API gateway mounts PostgREST under /rest/v1; the
      // standalone PostgREST container exposes those routes at its root.
      // Translate only this known local prefix, preserving real HTTP and SQL.
      const directUrl = restUrl + target.slice((restUrl + "/rest/v1").length);
      return fetch(directUrl, init);
    }) as typeof fetch;
    const handler = createUnattendedNbaHandler({
      env: name => ({
        NBA_SYNC_WORKER_ENABLED: "true",
        NBA_SYNC_CRON_SECRET: secret,
        SUPABASE_URL: restUrl,
        SUPABASE_SERVICE_ROLE_KEY: "sb_secret_ci-fake-postgrest-key",
      } as Record<string, string>)[name],
      request, now: () => new Date("2026-11-17T12:00:00Z"),
      newToken: () => randomUUID(),
      log: { error: () => {}, warn: () => {}, info: () => {} },
    });
    const unauthorized = await handler(new Request("http://worker.invalid", {
      method: "POST", headers: { authorization: "Bearer wrong" },
    }));
    expect(unauthorized.status).toBe(401);
    expect(backendPaths).toEqual([]);

    const authorized = await handler(new Request("http://worker.invalid", {
      method: "POST", headers: { authorization: "Bearer " + secret },
    }));
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toEqual({
      checked: 3, updated: 1, skipped: 0, failed: 0, errors: [],
    });
    expect(backendPaths.filter(p => p === "/rest/v1/games")).toHaveLength(1);
    expect(backendPaths.filter(p => p === "/rest/v1/rpc/try_claim_nba_sync")).toHaveLength(3);
    expect(backendPaths.filter(p => p === "/rest/v1/rpc/commit_nba_sync_day")).toHaveLength(3);
    expect(backendPaths.filter(p => p === "/rest/v1/rpc/release_nba_sync")).toHaveLength(3);
    const [stored] = await db`SELECT source, state, away_score, home_score
      FROM public.games WHERE id=${gameId}`;
    expect(stored).toMatchObject({
      source: "nba", state: "final", away_score: 109, home_score: 107,
    });
    expect(await db`SELECT id FROM public.games WHERE id=${gameId}`).toHaveLength(1);
    const [fresh] = await db`SELECT game_count FROM public.sync_state WHERE day=${day}`;
    expect(fresh?.["game_count"]).toBe(1);
    expect(await db`SELECT day FROM public.nba_sync_leases`).toHaveLength(0);
  });

  it("enforces competing lease owners through PostgREST RPC and real row locks", async () => {
    if (!db) throw new Error("Database unavailable");
    const ownerA = randomUUID(), ownerB = randomUUID();
    const leaseDay = "2026-11-16";
    const claim = async (token: string) => {
      const response = await fetch(restUrl + "/rpc/try_claim_nba_sync", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ p_day: leaseDay, p_owner_token: token, p_lease_seconds: 180 }),
      });
      expect(response.status).toBe(200);
      return response.json() as Promise<boolean>;
    };
    const [a, b] = await Promise.all([claim(ownerA), claim(ownerB)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const winner = a ? ownerA : ownerB;
    const loser = a ? ownerB : ownerA;
    expect(await claim(loser)).toBe(false);
    const release = await fetch(restUrl + "/rpc/release_nba_sync", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ p_day: leaseDay, p_owner_token: winner }),
    });
    expect(release.status).toBe(200);
    expect(await release.json()).toBe(true);
    expect(await db`SELECT day FROM public.nba_sync_leases WHERE day=${leaseDay}::date`).toHaveLength(0);
  });
});
