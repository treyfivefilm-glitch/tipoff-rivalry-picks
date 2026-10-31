// @vitest-environment node
// Disposable PostgreSQL only: real payment RPC with transaction-rollback fixtures.
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isStagingDatabaseName, stagingDatabaseUrl } from "./staging-db";

const url = stagingDatabaseUrl(process.env);
describe.skipIf(!url)("record_payment server-side outstanding cap", () => {
  let pool: ReturnType<typeof postgres> | undefined;
  let connection: postgres.ReservedSql | undefined;
  const owner = randomUUID();
  const member = randomUUID();
  const outsider = randomUUID();
  const room = randomUUID();
  const game = `payment-cap-${randomUUID()}`;
  const invite = `PAY-${randomUUID().slice(0, 8).toUpperCase()}`;
  function db(strings: TemplateStringsArray, ...values: postgres.ParameterOrFragment<never>[]) {
    if (!connection) throw new Error("No reserved test connection");
    return connection(strings, ...values);
  }
  beforeAll(async () => {
    if (!url) throw new Error("Staging tests disabled");
    pool = postgres(url, { max: 1, prepare: false, connect_timeout: 5, idle_timeout: 5 });
    const [target] = await pool<{ name: string }[]>`SELECT current_database() AS name`;
    if (!target || !isStagingDatabaseName(target.name)) throw new Error("Refusing non-test database");
  });
  afterAll(async () => { await pool?.end({ timeout: 5 }); });
  beforeEach(async () => {
    if (!pool) throw new Error("Test pool unavailable");
    connection = await pool.reserve();
    await db`BEGIN`;
    await db`SET LOCAL statement_timeout='5s'`;
    await db`SET LOCAL lock_timeout='2s'`;
    await db`INSERT INTO public.rooms(id,name,owner_id,invite_code) VALUES(${room},'Payment cap test',${owner},${invite})`;
    await db`INSERT INTO public.room_members(room_id,user_id,display_name) VALUES(${room},${owner},'Owner'),(${room},${member},'Member')`;
    await db`INSERT INTO public.games(id,start_utc,away_code,away_name,home_code,home_name,state,away_score,home_score)
      VALUES(${game},now()-interval '1 day','LAL','Lakers','GSW','Warriors','final',109,107)`;
    await db`INSERT INTO public.picks(room_id,game_id,user_id,team_code)
      VALUES(${room},${game},${owner},'LAL'),(${room},${game},${member},'GSW')`;
    await db`INSERT INTO public.wagers(room_id,game_id,stake_each_cents,proposed_by,accepted_by,status,kind)
      VALUES(${room},${game},1000,${owner},${member},'accepted','cash')`;
  });
  afterEach(async () => {
    const reserved = connection;
    if (!reserved) return;
    try {
      await reserved`ROLLBACK`;
      await reserved`RESET ROLE`;
      await reserved`RESET request.jwt.claim.sub`;
      await reserved`RESET request.jwt.claims`;
      expect(await reserved`SELECT id FROM public.rooms WHERE id=${room}`).toHaveLength(0);
      expect(await reserved`SELECT id FROM public.payments WHERE room_id=${room}`).toHaveLength(0);
    } finally { connection = undefined; reserved.release(); }
  });
  async function asUser(id: string) {
    await db`RESET ROLE`;
    await db`SELECT set_config('request.jwt.claim.sub',${id},true),set_config('request.jwt.claims',${JSON.stringify({sub:id,role:"authenticated"})},true)`;
    await db`SET LOCAL ROLE authenticated`;
  }
  async function record(cents: number | null) {
    await db`SELECT public.record_payment(${room}::uuid,${cents}::int,NULL::text)`;
  }
  async function reject(cents: number | null, pattern: RegExp) {
    await db`SAVEPOINT payment_attempt`;
    try { await expect(record(cents)).rejects.toThrow(pattern); }
    finally {
      await db`ROLLBACK TO SAVEPOINT payment_attempt`;
      await db`RELEASE SAVEPOINT payment_attempt`;
    }
  }
  it("rejects overpayment and invalid cents but permits the exact balance", async () => {
    await asUser(member);
    await reject(1001,/exceeds outstanding/);
    await reject(0,/valid payment amount/);
    await reject(null,/valid payment amount/);
    expect(await db`SELECT id FROM public.payments WHERE room_id=${room}`).toHaveLength(0);
    await record(1000);
    expect((await db`SELECT cents,status FROM public.payments WHERE room_id=${room}`)[0]?.['cents']).toBe(1000);
  });
  it("respects one pending payment and caps the remaining cents after confirmation", async () => {
    await asUser(member);
    await record(999);
    await reject(1,/awaiting confirmation/);
    await db`RESET ROLE`;
    const [payment] = await db`SELECT id FROM public.payments WHERE room_id=${room}`;
    await asUser(owner);
    await db`SELECT public.respond_payment(${payment?.['id']}::uuid,true)`;
    await asUser(member);
    await reject(2,/exceeds outstanding/);
    await record(1);
    expect((await db`SELECT sum(cents)::int AS total FROM public.payments WHERE room_id=${room}`)[0]?.['total']).toBe(1000);
  });
  it("rejects payer without debt and outsider; never writes a payment", async () => {
    await asUser(owner);
    await reject(1,/exceeds outstanding/);
    await asUser(outsider);
    await reject(1,/Not a member/);
    expect(await db`SELECT id FROM public.payments WHERE room_id=${room}`).toHaveLength(0);
  });
  it("uses the room result override rather than the unmodified NBA result", async () => {
    await db`INSERT INTO public.result_overrides(room_id,game_id,away_score,home_score,state,entered_by)
      VALUES(${room},${game},101,110,'final',${owner})`;
    await asUser(member);
    await reject(1,/exceeds outstanding/);
    await asUser(owner);
    await record(1000);
    expect((await db`SELECT payer_id FROM public.payments WHERE room_id=${room}`)[0]?.['payer_id']).toBe(owner);
  });
  it("does not allow cash payment for challenge-only or unresolved wagers", async () => {
    await db`UPDATE public.wagers SET kind='other' WHERE room_id=${room}`;
    await asUser(member);
    await reject(1,/exceeds outstanding/);
    await db`RESET ROLE`;
    await db`UPDATE public.wagers SET kind='cash' WHERE room_id=${room}`;
    await db`UPDATE public.games SET state='live' WHERE id=${game}`;
    await asUser(member);
    await reject(1,/exceeds outstanding/);
  });
});
