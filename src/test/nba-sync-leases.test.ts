// @vitest-environment node
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { isStagingDatabaseName, stagingDatabaseUrl } from "./staging-db";

// Opt-in ONLY. Requires migrations 0013 and 0014 on a dedicated disposable staging DB.
// Every lease fixture is rolled back; never run against production.
const url = stagingDatabaseUrl(process.env);
describe.skipIf(!url)("NBA sync lease RPC isolation (staging only)", () => {
  let pool: ReturnType<typeof postgres> | undefined;
  let connection: postgres.ReservedSql | undefined;
  const day = "2026-11-17";
  const owner = randomUUID();
  const contender = randomUUID();

  function db(strings: TemplateStringsArray, ...values: postgres.ParameterOrFragment<never>[]) {
    if (!connection) throw new Error("No reserved staging connection");
    return connection(strings, ...values);
  }

  beforeAll(async () => {
    if (!url) throw new Error("Staging DB tests are not enabled");
    pool = postgres(url, { max: 1, prepare: false, connect_timeout: 5, idle_timeout: 5 });
    const [target] = await pool<{ name: string }[]>`SELECT current_database() AS name`;
    if (!target || !isStagingDatabaseName(target.name)) {
      throw new Error("Refusing to test NBA leases outside a dedicated staging database");
    }
  });

  afterAll(async () => { await pool?.end({ timeout: 5 }); });

  beforeEach(async () => {
    if (!pool) throw new Error("Staging test pool unavailable");
    connection = await pool.reserve();
    await db`BEGIN`;
    await db`SET LOCAL statement_timeout = '5s'`;
    await db`SET LOCAL lock_timeout = '2s'`;
  });

  afterEach(async () => {
    const reserved = connection;
    if (!reserved) return;
    try {
      await reserved`ROLLBACK`;
      await reserved`RESET ROLE`;
      expect(await reserved`SELECT day FROM public.nba_sync_leases WHERE day=${day}::date`).toHaveLength(0);
    } finally {
      connection = undefined;
      reserved.release();
    }
  });

  async function claim(token: string) {
    const [row] = await db`SELECT public.try_claim_nba_sync(${day}::date, ${token}::uuid, 180) AS claimed`;
    return row?.['claimed'];
  }
  async function release(token: string) {
    const [row] = await db`SELECT public.release_nba_sync(${day}::date, ${token}::uuid) AS released`;
    return row?.['released'];
  }

  it("blocks a competing owner until the original owner releases", async () => {
    expect(await claim(owner)).toBe(true);
    expect(await claim(owner)).toBe(true); // idempotent renewal
    expect(await claim(contender)).toBe(false);
    expect(await release(contender)).toBe(false);
    expect(await release(owner)).toBe(true);
    expect(await claim(contender)).toBe(true);
  });

  it("reclaims an expired lease without letting the old owner release it", async () => {
    expect(await claim(owner)).toBe(true);
    await db`UPDATE public.nba_sync_leases SET expires_at = clock_timestamp() - interval '1 second' WHERE day=${day}::date`;
    expect(await claim(contender)).toBe(true);
    expect(await release(owner)).toBe(false);
    expect(await claim(owner)).toBe(false);
    expect(await release(contender)).toBe(true);
  });

  const sampleGame = {
    id: "nba:0022600012",
    start_utc: "2026-11-18T02:00:00Z", // Nov 17 in Los Angeles
    away_code: "LAL", away_name: "Los Angeles Lakers",
    home_code: "GSW", home_name: "Golden State Warriors",
    away_score: 103, home_score: 100,
    state: "final", status_detail: "Final",
  };
  async function commit(token: string, rows: unknown[] = [sampleGame]) {
    const [row] = await db`SELECT public.commit_nba_sync_day(
      ${day}::date, ${token}::uuid, ${JSON.stringify(rows)}::jsonb
    ) AS written`;
    return row?.['written'];
  }

  it("atomically writes verified games and the day freshness under its lease", async () => {
    expect(await claim(owner)).toBe(true);
    expect(await commit(owner)).toBe(1);
    const [game] = await db`SELECT state, away_score, home_score FROM public.games
      WHERE id=${sampleGame.id}`;
    expect(game).toMatchObject({ state: "final", away_score: 103, home_score: 100 });
    const [fresh] = await db`SELECT game_count FROM public.sync_state WHERE day=${day}`;
    expect(fresh?.['game_count']).toBe(1);
  });

  it("does not downgrade a verified final to a stale scheduled snapshot", async () => {
    expect(await claim(owner)).toBe(true);
    expect(await commit(owner)).toBe(1);
    expect(await commit(owner, [{
      ...sampleGame, state: "scheduled", status_detail: "Scheduled",
      away_score: null, home_score: null,
    }])).toBe(1);
    const [game] = await db`SELECT state, away_score, home_score FROM public.games
      WHERE id=${sampleGame.id}`;
    expect(game).toMatchObject({ state: "final", away_score: 103, home_score: 100 });
  });

  it("rejects a stored game-ID matchup collision without advancing freshness", async () => {
    expect(await claim(owner)).toBe(true);
    expect(await commit(owner)).toBe(1);
    const [before] = await db`SELECT synced_at, game_count FROM public.sync_state WHERE day=${day}`;

    const otherGame = {
      ...sampleGame, id: "nba:0022600016",
      away_code: "BOS", away_name: "Boston Celtics",
      home_code: "NYK", home_name: "New York Knicks",
    };
    const collision = {
      ...sampleGame,
      away_code: "BOS", away_name: "Boston Celtics",
      home_code: "NYK", home_name: "New York Knicks",
      away_score: 120, home_score: 98,
    };
    await db`SAVEPOINT matchup_collision`;
    await expect(commit(owner, [otherGame, collision]))
      .rejects.toThrow(/NBA game ID matchup collision/);
    await db`ROLLBACK TO SAVEPOINT matchup_collision`;

    expect(await db`SELECT id FROM public.games WHERE id=${otherGame.id}`).toHaveLength(0);
    const [original] = await db`SELECT away_code, home_code, state, away_score, home_score
      FROM public.games WHERE id=${sampleGame.id}`;
    expect(original).toMatchObject({
      away_code: "LAL", home_code: "GSW", state: "final",
      away_score: 103, home_score: 100,
    });
    const [after] = await db`SELECT synced_at, game_count FROM public.sync_state WHERE day=${day}`;
    expect(after).toEqual(before);
  });

  it("accepts canonical team aliases for an existing NBA game ID", async () => {
    expect(await claim(owner)).toBe(true);
    expect(await commit(owner, [{ ...sampleGame, home_code: "GS" }])).toBe(1);
    expect(await commit(owner, [{
      ...sampleGame, away_score: 110, home_score: 107,
    }])).toBe(1);
    const [stored] = await db`SELECT away_code, home_code, away_score, home_score
      FROM public.games WHERE id=${sampleGame.id}`;
    expect(stored).toMatchObject({
      away_code: "LAL", home_code: "GSW", away_score: 110, home_score: 107,
    });
  });

  it("rejects stale owners without publishing any games or freshness", async () => {
    expect(await claim(owner)).toBe(true);
    expect(await claim(contender)).toBe(false);
    await db`SAVEPOINT rejected_commit`;
    await expect(commit(contender)).rejects.toThrow(/lease is missing or expired/);
    await db`ROLLBACK TO SAVEPOINT rejected_commit`;
    expect(await db`SELECT id FROM public.games WHERE id=${sampleGame.id}`).toHaveLength(0);
    expect(await db`SELECT day FROM public.sync_state WHERE day=${day}`).toHaveLength(0);

    await db`UPDATE public.nba_sync_leases SET expires_at = clock_timestamp() - interval '1 second'
      WHERE day=${day}::date`;
    await db`SAVEPOINT expired_commit`;
    await expect(commit(owner)).rejects.toThrow(/lease is missing or expired/);
    await db`ROLLBACK TO SAVEPOINT expired_commit`;
  });

  it("rejects wrong-day and unscored final rows as one atomic batch", async () => {
    expect(await claim(owner)).toBe(true);
    for (const invalid of [
      { ...sampleGame, id: "nba:0022600013", start_utc: "2026-11-19T02:00:00Z" },
      { ...sampleGame, id: "nba:0022600014", home_score: null },
      { ...sampleGame, id: "nba:0022600015", home_score: 103 },
      { ...sampleGame, id: "nba:provider-error" },
      { ...sampleGame, id: "nba:0022600012x" },
    ]) {
      await db`SAVEPOINT invalid_batch`;
      await expect(commit(owner, [sampleGame, invalid])).rejects.toThrow(/Invalid NBA game row or day mismatch/);
      await db`ROLLBACK TO SAVEPOINT invalid_batch`;
    }
    expect(await db`SELECT id FROM public.games WHERE id=${sampleGame.id}`).toHaveLength(0);
    expect(await db`SELECT day FROM public.sync_state WHERE day=${day}`).toHaveLength(0);
  });

  it("rejects same-team aliases before publishing games or freshness", async () => {
    expect(await claim(owner)).toBe(true);
    // Different tricode strings can still identify the same NBA team.
    await db`SAVEPOINT same_team_alias`;
    await expect(commit(owner, [{
      ...sampleGame, away_code: "GS", home_code: "GSW",
    }])).rejects.toThrow(/Invalid NBA game row or day mismatch/);
    await db`ROLLBACK TO SAVEPOINT same_team_alias`;
    expect(await db`SELECT id FROM public.games WHERE id=${sampleGame.id}`).toHaveLength(0);
    expect(await db`SELECT day FROM public.sync_state WHERE day=${day}`).toHaveLength(0);
  });

  it("keeps the table and SECURITY DEFINER functions private", async () => {
    const [grants] = await db`
      SELECT
        has_function_privilege('anon','public.try_claim_nba_sync(date,uuid,integer)','EXECUTE') AS anonymous,
        has_function_privilege('authenticated','public.release_nba_sync(date,uuid)','EXECUTE') AS authenticated,
        has_table_privilege('authenticated','public.nba_sync_leases','SELECT') AS table_access,
        has_function_privilege('service_role','public.try_claim_nba_sync(date,uuid,integer)','EXECUTE') AS service,
        has_function_privilege('anon','public.commit_nba_sync_day(date,uuid,jsonb)','EXECUTE') AS anon_commit,
        has_function_privilege('authenticated','public.commit_nba_sync_day(date,uuid,jsonb)','EXECUTE') AS user_commit,
        has_function_privilege('service_role','public.commit_nba_sync_day(date,uuid,jsonb)','EXECUTE') AS service_commit,
        has_function_privilege('anon','public.nba_canonical_team_code(text)','EXECUTE') AS anon_canonical,
        has_function_privilege('authenticated','public.nba_canonical_team_code(text)','EXECUTE') AS user_canonical,
        has_function_privilege('service_role','public.nba_canonical_team_code(text)','EXECUTE') AS service_canonical
    `;
    expect(grants?.['anonymous']).toBe(false);
    expect(grants?.['authenticated']).toBe(false);
    expect(grants?.['table_access']).toBe(false);
    expect(grants?.['service']).toBe(true);
    expect(grants?.['anon_commit']).toBe(false);
    expect(grants?.['user_commit']).toBe(false);
    expect(grants?.['service_commit']).toBe(true);
    expect(grants?.['anon_canonical']).toBe(false);
    expect(grants?.['user_canonical']).toBe(false);
    expect(grants?.['service_canonical']).toBe(true);
  });
});
