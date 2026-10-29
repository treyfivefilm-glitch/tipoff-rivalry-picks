// @vitest-environment node
import postgres from "postgres";
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
});
