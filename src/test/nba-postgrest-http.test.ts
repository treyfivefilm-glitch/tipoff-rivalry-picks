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
  it("prevents overlapping full worker runs against real PostgREST leases", async () => {
    if (!db) throw new Error("Database unavailable");
    // Hold the first worker after it has claimed all three days but before
    // its real PostgREST history read. The second worker must lose every
    // lease and must never read history or attempt a fenced commit.
    let signalHistory!: () => void;
    let releaseHistory!: () => void;
    const historyStarted = new Promise<void>(resolve => { signalHistory = resolve; });
    const historyGate = new Promise<void>(resolve => { releaseHistory = resolve; });
    const firstPaths: string[] = [];
    const secondPaths: string[] = [];
    const backendRequest = (paths: string[], pauseHistory: boolean) =>
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const target = String(input);
        if (target.includes("scheduleLeagueV2")) {
          return reply({ leagueSchedule: { gameDates: [{ gameDate: day, games: [scheduleGame] }] } });
        }
        if (target.includes("todaysScoreboard")) {
          return reply({ scoreboard: { gameDate: day, games: [finalGame] } });
        }
        if (!target.startsWith(restUrl + "/rest/v1/")) throw new Error("Unexpected outbound target");
        const pathname = new URL(target).pathname;
        paths.push(pathname);
        if (pauseHistory && pathname === "/rest/v1/games") {
          signalHistory();
          await historyGate;
        }
        return fetch(restUrl + target.slice((restUrl + "/rest/v1").length), init);
      }) as typeof fetch;
    const worker = (paths: string[], pauseHistory: boolean) =>
      createUnattendedNbaHandler({
        env: name => ({
          NBA_SYNC_WORKER_ENABLED: "true",
          NBA_SYNC_CRON_SECRET: secret,
          SUPABASE_URL: restUrl,
          SUPABASE_SERVICE_ROLE_KEY: "sb_secret_ci-fake-postgrest-key",
        } as Record<string, string>)[name],
        request: backendRequest(paths, pauseHistory),
        now: () => new Date("2026-11-17T12:00:00Z"),
        newToken: () => randomUUID(),
        log: { error: () => {}, warn: () => {}, info: () => {} },
      });
    const authorizedPost = () => new Request("http://worker.invalid", {
      method: "POST", headers: { authorization: "Bearer " + secret },
    });
    const firstRun = worker(firstPaths, true)(authorizedPost());
    await historyStarted;
    let secondResponse: Response;
    try {
      secondResponse = await worker(secondPaths, false)(authorizedPost());
    } finally {
      // Always let the first worker finish, even if the second request fails.
      releaseHistory();
    }
    const firstResponse = await firstRun;
    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.json()).toEqual({
      checked: 0, updated: 0, skipped: 3, failed: 0, errors: [],
    });
    expect(secondPaths.filter(p => p === "/rest/v1/rpc/try_claim_nba_sync")).toHaveLength(3);
    expect(secondPaths).not.toContain("/rest/v1/games");
    expect(secondPaths).not.toContain("/rest/v1/rpc/commit_nba_sync_day");
    expect(secondPaths).not.toContain("/rest/v1/rpc/release_nba_sync");
    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.json()).toEqual({
      checked: 3, updated: 1, skipped: 0, failed: 0, errors: [],
    });
    expect(firstPaths.filter(p => p === "/rest/v1/rpc/commit_nba_sync_day")).toHaveLength(3);
    expect(firstPaths.filter(p => p === "/rest/v1/rpc/release_nba_sync")).toHaveLength(3);
    expect(await db`SELECT day FROM public.nba_sync_leases`).toHaveLength(0);
    const [stored] = await db`SELECT state, away_score, home_score FROM public.games WHERE id=${gameId}`;
    expect(stored).toMatchObject({ state: "final", away_score: 109, home_score: 107 });
  });

  it("fences stale workers after real PostgreSQL lease expiry and takeover", async () => {
    if (!db) throw new Error("Database unavailable");
    const leaseDay = "2026-11-14";
    const staleOwner = randomUUID(), currentOwner = randomUUID();
    const call = async (rpc: string, args: Record<string, unknown>) => {
      return fetch(restUrl + "/rpc/" + rpc, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
    };
    const claimArgs = (token: string) => ({
      p_day: leaseDay, p_owner_token: token, p_lease_seconds: 180,
    });
    const original = await call("try_claim_nba_sync", claimArgs(staleOwner));
    expect(original.status).toBe(200);
    expect(await original.json()).toBe(true);

    // Advance only the disposable test lease into the past. No sleep or
    // production data is involved; takeover still goes through real SQL.
    await db`UPDATE public.nba_sync_leases
      SET expires_at = clock_timestamp() - interval '1 second'
      WHERE day = ${leaseDay}::date AND owner_token = ${staleOwner}::uuid`;
    const takeover = await call("try_claim_nba_sync", claimArgs(currentOwner));
    expect(takeover.status).toBe(200);
    expect(await takeover.json()).toBe(true);

    // The old worker may have finished fetching, but its fenced write must
    // fail atomically and must not mark this day freshly synchronized.
    const staleCommit = await call("commit_nba_sync_day", {
      p_day: leaseDay, p_owner_token: staleOwner, p_rows: [],
    });
    expect(staleCommit.ok).toBe(false);
    expect(await db`SELECT day FROM public.sync_state WHERE day=${leaseDay}`).toHaveLength(0);
    const staleRelease = await call("release_nba_sync", {
      p_day: leaseDay, p_owner_token: staleOwner,
    });
    expect(staleRelease.status).toBe(200);
    expect(await staleRelease.json()).toBe(false);
    const [owner] = await db`SELECT owner_token FROM public.nba_sync_leases
      WHERE day=${leaseDay}::date`;
    expect(owner?.["owner_token"]).toBe(currentOwner);

    const currentCommit = await call("commit_nba_sync_day", {
      p_day: leaseDay, p_owner_token: currentOwner, p_rows: [],
    });
    expect(currentCommit.status).toBe(200);
    expect(await currentCommit.json()).toBe(0);
    const [fresh] = await db`SELECT game_count FROM public.sync_state WHERE day=${leaseDay}`;
    expect(fresh?.["game_count"]).toBe(0);
    const release = await call("release_nba_sync", {
      p_day: leaseDay, p_owner_token: currentOwner,
    });
    expect(release.status).toBe(200);
    expect(await release.json()).toBe(true);
    expect(await db`SELECT day FROM public.nba_sync_leases WHERE day=${leaseDay}::date`).toHaveLength(0);
  });


  it("fails closed when real PostgREST history is blocked by a PostgreSQL table lock", async () => {
    if (!db) throw new Error("Database unavailable");
    // Unlike a synthetic delayed fetch, this holds a genuine PostgreSQL
    // ACCESS EXCLUSIVE lock. PostgREST's real SELECT must wait until the
    // worker's HTTP deadline aborts; no fenced commit may be attempted.
    const before = await db`SELECT day::text, game_count FROM public.sync_state ORDER BY day`;
    let signalLocked!: () => void;
    let unlock!: () => void;
    const locked = new Promise<void>(resolve => { signalLocked = resolve; });
    const releaseLock = new Promise<void>(resolve => { unlock = resolve; });
    const lockTransaction = db.begin(async tx => {
      await tx`LOCK TABLE public.games IN ACCESS EXCLUSIVE MODE`;
      signalLocked();
      await releaseLock;
    });
    const paths: string[] = [];
    try {
      await locked;
      const request = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const target = String(input);
        if (target.includes("scheduleLeagueV2")) {
          return reply({ leagueSchedule: { gameDates: [{ gameDate: day, games: [scheduleGame] }] } });
        }
        if (target.includes("todaysScoreboard")) {
          return reply({ scoreboard: { gameDate: day, games: [finalGame] } });
        }
        if (!target.startsWith(restUrl + "/rest/v1/")) throw new Error("Unexpected outbound target");
        paths.push(new URL(target).pathname);
        return fetch(restUrl + target.slice((restUrl + "/rest/v1").length), init);
      }) as typeof fetch;
      const handler = createUnattendedNbaHandler({
        env: name => ({
          NBA_SYNC_WORKER_ENABLED: "true",
          NBA_SYNC_CRON_SECRET: secret,
          SUPABASE_URL: restUrl,
          SUPABASE_SERVICE_ROLE_KEY: "sb_secret_ci-fake-postgrest-key",
        } as Record<string, string>)[name],
        request,
        backendTimeoutMs: 800,
        now: () => new Date("2026-11-17T12:00:00Z"),
        newToken: () => randomUUID(),
        log: { error: () => {}, warn: () => {}, info: () => {} },
      });
      const response = await handler(new Request("http://worker.invalid", {
        method: "POST", headers: { authorization: "Bearer " + secret },
      }));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        checked: 0, updated: 0, skipped: 0, failed: 3,
        errors: ["NBA refresh failed"],
      });
      expect(paths.filter(p => p === "/rest/v1/games")).toHaveLength(1);
      expect(paths.filter(p => p === "/rest/v1/rpc/try_claim_nba_sync")).toHaveLength(3);
      expect(paths.filter(p => p === "/rest/v1/rpc/commit_nba_sync_day")).toHaveLength(0);
      expect(paths.filter(p => p === "/rest/v1/rpc/release_nba_sync")).toHaveLength(3);
    } finally {
      // Always unlock the disposable database even on assertion failure.
      unlock();
      await lockTransaction;
    }
    expect(await db`SELECT day::text, game_count FROM public.sync_state ORDER BY day`).toEqual(before);
    expect(await db`SELECT day FROM public.nba_sync_leases`).toHaveLength(0);
    const [stored] = await db`SELECT state, away_score, home_score FROM public.games WHERE id=${gameId}`;
    expect(stored).toMatchObject({ state: "final", away_score: 109, home_score: 107 });
  });

});
