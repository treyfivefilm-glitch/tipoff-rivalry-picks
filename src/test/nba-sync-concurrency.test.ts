// @vitest-environment node
import postgres from "postgres";
import { createUnattendedNbaHandler } from "../../supabase/functions/_shared/nba-worker-handler";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stagingDatabaseUrl } from "./staging-db";

// These tests intentionally use separate committed PostgreSQL sessions. They
// are permitted ONLY against the empty, local CI service; never a shared
// staging, Supabase, or production database.
const enabled =
  process.env["CI"] === "true" &&
  process.env["RUN_DISPOSABLE_NBA_CONCURRENCY_TESTS"] === "true";
const url = enabled ? stagingDatabaseUrl(process.env) : null;
if (url) {
  const target = new URL(url);
  if (target.hostname !== "127.0.0.1" || target.port !== "5432" ||
      target.pathname !== "/tipoff_test" || target.search || target.hash) {
    throw new Error("NBA concurrency tests require the local disposable tipoff_test database.");
  }
}

describe.skipIf(!enabled)("NBA lease concurrency (disposable CI database only)", () => {
  let pool: ReturnType<typeof postgres> | undefined;
  const day = "2032-07-11"; // synthetic future day, never a real player game

  beforeAll(async () => {
    if (!url) throw new Error("Disposable database URL is required.");
    pool = postgres(url, { max: 3, prepare: false, connect_timeout: 5, idle_timeout: 5 });
    const [target] = await pool<{ name: string }[]>`SELECT current_database() AS name`;
    if (target?.name !== "tipoff_test") throw new Error("Refusing non-disposable database.");
    const leases = await pool`SELECT day FROM public.nba_sync_leases WHERE day=${day}::date`;
    if (leases.length) throw new Error("Refusing to overwrite a pre-existing lease.");
  });

  afterAll(async () => { await pool?.end({ timeout: 5 }); });

  it("allows exactly one winner when two independent sessions claim simultaneously", async () => {
    if (!pool) throw new Error("Test pool unavailable.");
    const first = await pool.reserve();
    const second = await pool.reserve();
    const firstOwner = randomUUID();
    const secondOwner = randomUUID();
    try {
      const [firstPid] = await first`SELECT pg_backend_pid() AS pid`;
      const [secondPid] = await second`SELECT pg_backend_pid() AS pid`;
      expect(firstPid?.["pid"]).not.toBe(secondPid?.["pid"]);

      const [[a], [b]] = await Promise.all([
        first`SELECT public.try_claim_nba_sync(${day}::date, ${firstOwner}::uuid, 180) AS claimed`,
        second`SELECT public.try_claim_nba_sync(${day}::date, ${secondOwner}::uuid, 180) AS claimed`,
      ]);
      expect([a?.["claimed"], b?.["claimed"]].filter(Boolean)).toHaveLength(1);
      const winner = a?.["claimed"] ? firstOwner : secondOwner;
      const loser = a?.["claimed"] ? secondOwner : firstOwner;
      const [stored] = await first`SELECT owner_token FROM public.nba_sync_leases WHERE day=${day}::date`;
      expect(stored?.["owner_token"]).toBe(winner);
      const [retry] = await second`SELECT public.try_claim_nba_sync(${day}::date, ${loser}::uuid, 180) AS claimed`;
      expect(retry?.["claimed"]).toBe(false);
    } finally {
      // Release only synthetic tokens owned by this test; no direct deletes.
      await first`SELECT public.release_nba_sync(${day}::date, ${firstOwner}::uuid)`;
      await second`SELECT public.release_nba_sync(${day}::date, ${secondOwner}::uuid)`;
      first.release();
      second.release();
    }
    expect(await pool`SELECT day FROM public.nba_sync_leases WHERE day=${day}::date`).toHaveLength(0);
  });

  it("fences an expired worker after a second database session reclaims its lease", async () => {
    if (!pool) throw new Error("Test pool unavailable.");
    const staleWorker = await pool.reserve();
    const replacement = await pool.reserve();
    const staleToken = randomUUID();
    const replacementToken = randomUUID();
    // Synthetic future day unique to this test, in an ephemeral CI database.
    const expiryDay = "2032-07-13";
    try {
      expect(await staleWorker`SELECT day FROM public.nba_sync_leases
        WHERE day=${expiryDay}::date`).toHaveLength(0);
      expect(await staleWorker`SELECT day FROM public.sync_state
        WHERE day=${expiryDay}`).toHaveLength(0);
      const [first] = await staleWorker`SELECT public.try_claim_nba_sync(
        ${expiryDay}::date, ${staleToken}::uuid, 180
      ) AS claimed`;
      expect(first?.["claimed"]).toBe(true);

      // Simulate a worker exceeding its deadline. A different committed
      // session reclaims the lease before the original worker can write.
      await replacement`UPDATE public.nba_sync_leases
        SET expires_at = clock_timestamp() - interval '1 second'
        WHERE day=${expiryDay}::date AND owner_token=${staleToken}::uuid`;
      const [second] = await replacement`SELECT public.try_claim_nba_sync(
        ${expiryDay}::date, ${replacementToken}::uuid, 180
      ) AS claimed`;
      expect(second?.["claimed"]).toBe(true);
      const [ownerRow] = await replacement`SELECT owner_token
        FROM public.nba_sync_leases WHERE day=${expiryDay}::date`;
      expect(ownerRow?.["owner_token"]).toBe(replacementToken);

      // A stale owner cannot publish even an empty day's freshness after
      // losing its lease; a failed statement must not affect the successor.
      await expect(staleWorker`SELECT public.commit_nba_sync_day(
        ${expiryDay}::date, ${staleToken}::uuid, '[]'::jsonb
      ) AS written`).rejects.toThrow(/lease is missing or expired/);
      expect(await replacement`SELECT day FROM public.sync_state
        WHERE day=${expiryDay}`).toHaveLength(0);
      const [staleRelease] = await staleWorker`SELECT public.release_nba_sync(
        ${expiryDay}::date, ${staleToken}::uuid
      ) AS released`;
      expect(staleRelease?.["released"]).toBe(false);

      const [written] = await replacement`SELECT public.commit_nba_sync_day(
        ${expiryDay}::date, ${replacementToken}::uuid, '[]'::jsonb
      ) AS written`;
      expect(written?.["written"]).toBe(0);
      const [fresh] = await replacement`SELECT game_count FROM public.sync_state
        WHERE day=${expiryDay}`;
      expect(fresh?.["game_count"]).toBe(0);
    } finally {
      // The entire CI database is disposable; release only our test leases.
      await staleWorker`SELECT public.release_nba_sync(
        ${expiryDay}::date, ${staleToken}::uuid
      )`;
      await replacement`SELECT public.release_nba_sync(
        ${expiryDay}::date, ${replacementToken}::uuid
      )`;
      staleWorker.release();
      replacement.release();
    }
    expect(await pool`SELECT day FROM public.nba_sync_leases
      WHERE day=${expiryDay}::date`).toHaveLength(0);
  });

  it("rejects a stale score snapshot after another session advances the live game", async () => {
    if (!pool) throw new Error("Test pool unavailable.");
    const worker = await pool.reserve();
    const scoreWriter = await pool.reserve();
    const owner = randomUUID();
    // Synthetic future fixture: the CI database is discarded after this job.
    // No real game, player, room, or wager data is read or modified.
    const gameId = "nba:0023200999";
    const startUtc = "2032-07-12T02:00:00Z"; // July 11 in Los Angeles
    const stale = {
      id: gameId, start_utc: startUtc,
      away_code: "LAL", away_name: "Los Angeles Lakers",
      home_code: "GSW", home_name: "Golden State Warriors",
      away_score: 80, home_score: 78, state: "live", status_detail: "Q3",
    };
    try {
      expect(await worker`SELECT id FROM public.games WHERE id=${gameId}`).toHaveLength(0);
      const [claimed] = await worker`SELECT public.try_claim_nba_sync(${day}::date, ${owner}::uuid, 180) AS claimed`;
      expect(claimed?.["claimed"]).toBe(true);

      // The worker reads a legitimate live score. A separate committed
      // database session then advances it before the worker's fenced commit.
      await scoreWriter`INSERT INTO public.games (
        id, start_utc, away_code, away_name, home_code, home_name,
        away_score, home_score, state, status_detail, source
      ) VALUES (
        ${gameId}, ${startUtc}::timestamptz, 'LAL', 'Los Angeles Lakers',
        'GSW', 'Golden State Warriors', 80, 78, 'live', 'Q3', 'nba'
      )`;
      const [snapshot] = await worker`SELECT away_score, home_score FROM public.games WHERE id=${gameId}`;
      expect(snapshot).toMatchObject({ away_score: 80, home_score: 78 });
      await scoreWriter`UPDATE public.games SET away_score=92, home_score=89,
        updated_at=clock_timestamp() WHERE id=${gameId}`;

      // The lease alone cannot prevent another legitimate writer from
      // advancing a score. The SQL commit must detect this stale snapshot,
      // roll back its write, and leave the day without false freshness.
      await expect(worker`SELECT public.commit_nba_sync_day(
        ${day}::date, ${owner}::uuid, ${worker.json([stale])}::jsonb
      ) AS written`).rejects.toThrow(/NBA game ID matchup or day collision/);
      const [stored] = await worker`SELECT state, away_score, home_score
        FROM public.games WHERE id=${gameId}`;
      expect(stored).toMatchObject({ state: "live", away_score: 92, home_score: 89 });
      expect(await worker`SELECT day FROM public.sync_state WHERE day=${day}`).toHaveLength(0);
    } finally {
      await worker`SELECT public.release_nba_sync(${day}::date, ${owner}::uuid)`;
      worker.release();
      scoreWriter.release();
    }
    expect(await pool`SELECT day FROM public.nba_sync_leases WHERE day=${day}::date`).toHaveLength(0);
  });

  it("holds the lease lock through an uncommitted fenced write", async () => {
    if (!pool) throw new Error("Test pool unavailable.");
    const writer = await pool.reserve();
    const contender = await pool.reserve();
    const owner = randomUUID();
    const other = randomUUID();
    let inTransaction = false;
    try {
      const [claimed] = await writer`SELECT public.try_claim_nba_sync(${day}::date, ${owner}::uuid, 180) AS claimed`;
      expect(claimed?.["claimed"]).toBe(true);
      await writer`BEGIN`;
      inTransaction = true;
      const [written] = await writer`SELECT public.commit_nba_sync_day(${day}::date, ${owner}::uuid, '[]'::jsonb) AS written`;
      expect(written?.["written"]).toBe(0);
      // A second connection must not slip through while the writer holds the
      // lease row lock. A short timeout makes this deterministic and bounded.
      await contender`SET lock_timeout = '300ms'`;
      await expect(contender`SELECT public.try_claim_nba_sync(${day}::date, ${other}::uuid, 180)`)
        .rejects.toThrow(/lock timeout/i);
      await writer`ROLLBACK`;
      inTransaction = false;
      expect(await contender`SELECT day FROM public.sync_state WHERE day=${day}`).toHaveLength(0);
      const [retry] = await contender`SELECT public.try_claim_nba_sync(${day}::date, ${other}::uuid, 180) AS claimed`;
      expect(retry?.["claimed"]).toBe(false);
    } finally {
      if (inTransaction) await writer`ROLLBACK`;
      await contender`RESET lock_timeout`;
      await writer`SELECT public.release_nba_sync(${day}::date, ${owner}::uuid)`;
      await contender`SELECT public.release_nba_sync(${day}::date, ${other}::uuid)`;
      writer.release();
      contender.release();
    }
    expect(await pool`SELECT day FROM public.nba_sync_leases WHERE day=${day}::date`).toHaveLength(0);
  });

  it("runs the authenticated worker through real fenced SQL using an isolated REST adapter", async () => {
    if (!pool) throw new Error("Disposable pool unavailable.");
    const db = await pool.reserve();
    const testDay = "2026-11-17";
    const gameId = "nba:0022600012";
    const startUtc = "2026-11-18T03:00:00Z";
    const secret = "test-only-postgres-bridge-secret-at-least-32-characters";
    const token = randomUUID();
    const reply = (value: unknown) => new Response(JSON.stringify(value), {
      headers: {
        "content-type": "application/json",
        ...(Array.isArray(value) ? {
          "content-range": value.length ? `0-${value.length - 1}/${value.length}` : "*/0",
        } : {}),
      },
    });
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
    let committed = false;
    try {
      await db`BEGIN`;
      await db`SET LOCAL statement_timeout = '5s'`;
      // Simulate a previously imported official game that may already have picks.
      await db`INSERT INTO public.games (
        id, start_utc, away_code, away_name, home_code, home_name,
        away_score, home_score, state, status_detail, source
      ) VALUES (
        ${gameId}, ${startUtc}::timestamptz, 'LAL', 'Los Angeles Lakers',
        'GSW', 'Golden State Warriors', NULL, NULL, 'scheduled',
        'Scheduled', 'nba_official_schedule'
      )`;
      const request = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const target = String(input);
        if (target.includes("scheduleLeagueV2")) {
          return reply({ leagueSchedule: { gameDates: [{
            gameDate: testDay, games: [scheduleGame],
          }] } });
        }
        if (target.includes("todaysScoreboard")) {
          return reply({ scoreboard: { gameDate: testDay, games: [finalGame] } });
        }
        if (target.includes("/rest/v1/games?")) {
          const rows = await db`SELECT id, start_utc, away_code, home_code,
            away_score, home_score, state, status_detail, source
            FROM public.games`;
          return reply(rows);
        }
        const rpcName = target.split("/rest/v1/rpc/")[1];
        const args = JSON.parse(String(init?.body)) as {
          p_day: string; p_owner_token: string; p_lease_seconds?: number;
          p_rows?: Record<string, string | number | null>[];
        };
        if (rpcName === "try_claim_nba_sync") {
          const [result] = await db`SELECT public.try_claim_nba_sync(
            ${args.p_day}::date, ${args.p_owner_token}::uuid,
            ${args.p_lease_seconds ?? 180}
          ) AS value`;
          return reply(result?.["value"]);
        }
        if (rpcName === "commit_nba_sync_day") {
          const [result] = await db`SELECT public.commit_nba_sync_day(
            ${args.p_day}::date, ${args.p_owner_token}::uuid,
            ${db.json(args.p_rows ?? [])}::jsonb
          ) AS value`;
          return reply(result?.["value"]);
        }
        if (rpcName === "release_nba_sync") {
          const [result] = await db`SELECT public.release_nba_sync(
            ${args.p_day}::date, ${args.p_owner_token}::uuid
          ) AS value`;
          return reply(result?.["value"]);
        }
        throw new Error("Unexpected outbound worker request");
      }) as typeof fetch;
      const handler = createUnattendedNbaHandler({
        env: name => ({
          NBA_SYNC_WORKER_ENABLED: "true",
          NBA_SYNC_CRON_SECRET: secret,
          SUPABASE_URL: "https://backend.invalid",
          SUPABASE_SERVICE_ROLE_KEY: "test-only-backend-key",
        } as Record<string, string>)[name],
        request, now: () => new Date("2026-11-18T12:00:00Z"),
        newToken: () => token,
        log: { error: () => {}, warn: () => {}, info: () => {} },
      });
      const unauthorized = await handler(new Request("https://worker.invalid", {
        method: "POST", headers: { authorization: "Bearer wrong" },
      }));
      expect(unauthorized.status).toBe(401);
      const response = await handler(new Request("https://worker.invalid", {
        method: "POST", headers: { authorization: "Bearer " + secret },
      }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        checked: 3, updated: 1, skipped: 0, failed: 0, errors: [],
      });
      const [stored] = await db`SELECT source, state, away_score, home_score
        FROM public.games WHERE id=${gameId}`;
      expect(stored).toMatchObject({
        source: "nba", state: "final", away_score: 109, home_score: 107,
      });
      const [fresh] = await db`SELECT game_count FROM public.sync_state
        WHERE day=${testDay}`;
      expect(fresh?.["game_count"]).toBe(1);
      expect(await db`SELECT day FROM public.nba_sync_leases
        WHERE day=${testDay}::date`).toHaveLength(0);
      committed = true;
    } finally {
      // Roll back every synthetic game and freshness record, even on failure.
      await db`ROLLBACK`;
      db.release();
    }
    expect(committed).toBe(true);
  });

});
