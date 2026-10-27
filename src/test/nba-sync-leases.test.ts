// @vitest-environment node
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { isStagingDatabaseName, stagingDatabaseUrl } from "./staging-db";

// Opt-in ONLY. Requires migration 0013 on a dedicated disposable staging DB.
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
    const [row] = await db<{ claimed: boolean }[]>`SELECT public.try_claim_nba_sync(${day}::date, ${token}::uuid, 180) AS claimed`;
    return row?.claimed;
  }
  async function release(token: string) {
    const [row] = await db<{ released: boolean }[]>`SELECT public.release_nba_sync(${day}::date, ${token}::uuid) AS released`;
    return row?.released;
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

  it("keeps the table and SECURITY DEFINER functions private", async () => {
    const [grants] = await db<{
      anonymous: boolean; authenticated: boolean; table_access: boolean; service: boolean;
    }[]>`
      SELECT
        has_function_privilege('anon','public.try_claim_nba_sync(date,uuid,integer)','EXECUTE') AS anonymous,
        has_function_privilege('authenticated','public.release_nba_sync(date,uuid)','EXECUTE') AS authenticated,
        has_table_privilege('authenticated','public.nba_sync_leases','SELECT') AS table_access,
        has_function_privilege('service_role','public.try_claim_nba_sync(date,uuid,integer)','EXECUTE') AS service
    `;
    expect(grants?.anonymous).toBe(false);
    expect(grants?.authenticated).toBe(false);
    expect(grants?.table_access).toBe(false);
    expect(grants?.service).toBe(true);
  });
});
