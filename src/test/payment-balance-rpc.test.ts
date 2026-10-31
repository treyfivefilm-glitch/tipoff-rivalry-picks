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

  it("rejects self-confirmation and lets a rejected payment be retried without reducing debt", async () => {
    await asUser(member);
    await record(400);
    await db`RESET ROLE`;
    const [first] = await db`SELECT id FROM public.payments WHERE room_id=${room}`;
    const firstId = first?.['id'] as string;
    expect(firstId).toBeTruthy();

    await asUser(member);
    await db`SAVEPOINT unauthorized_confirmation`;
    try {
      await expect(db`SELECT public.respond_payment(${firstId}::uuid,true)`).rejects.toThrow(/Only the recipient can respond once/);
    } finally {
      await db`ROLLBACK TO SAVEPOINT unauthorized_confirmation`;
      await db`RELEASE SAVEPOINT unauthorized_confirmation`;
    }

    await asUser(owner);
    await db`SELECT public.respond_payment(${firstId}::uuid,false)`;
    expect((await db`SELECT status FROM public.payments WHERE id=${firstId}`)[0]?.['status']).toBe('rejected');

    await asUser(member);
    await record(1000);
    const [retry] = await db`SELECT id FROM public.payments WHERE room_id=${room} AND status='pending'`;
    const retryId = retry?.['id'] as string;
    expect(retryId).toBeTruthy();
    await asUser(owner);
    await db`SELECT public.respond_payment(${retryId}::uuid,true)`;
    expect((await db`SELECT status FROM public.payments WHERE id=${retryId}`)[0]?.['status']).toBe('confirmed');

    await asUser(member);
    await reject(1,/exceeds outstanding/);
    expect((await db`SELECT status,count(*)::int AS total FROM public.payments WHERE room_id=${room} GROUP BY status ORDER BY status`)
      .map(row => [row['status'],row['total']])).toEqual([['confirmed',1],['rejected',1]]);
  });

  it("nets wins and losses across final games before permitting a payment", async () => {
    const secondGame = `payment-offset-${randomUUID()}`;
    await db`INSERT INTO public.games(id,start_utc,away_code,away_name,home_code,home_name,state,away_score,home_score)
      VALUES(${secondGame},now()-interval '1 day','LAL','Lakers','GSW','Warriors','final',99,110)`;
    await db`INSERT INTO public.picks(room_id,game_id,user_id,team_code)
      VALUES(${room},${secondGame},${owner},'LAL'),(${room},${secondGame},${member},'GSW')`;
    await db`INSERT INTO public.wagers(room_id,game_id,stake_each_cents,proposed_by,accepted_by,status,kind)
      VALUES(${room},${secondGame},600,${owner},${member},'accepted','cash')`;

    // Member loses $10 on the first game but wins $6 on the second: net debt is $4.
    await asUser(member);
    await reject(401,/exceeds outstanding/);
    await record(400);
    expect((await db`SELECT cents FROM public.payments WHERE room_id=${room}`)[0]?.['cents']).toBe(400);
  });

  it("recalculates the payer after a corrected result without forgetting confirmed partial payments", async () => {
    // Member initially loses $10 and sends $4, which the owner confirms.
    await asUser(member);
    await record(400);
    await db`RESET ROLE`;
    const [partial] = await db`SELECT id FROM public.payments WHERE room_id=${room}`;
    const partialId = partial?.['id'] as string;
    expect(partialId).toBeTruthy();
    await asUser(owner);
    await db`SELECT public.respond_payment(${partialId}::uuid,true)`;

    // A room result correction reverses the winner. The previous $4 was
    // already confirmed, so the owner now owes $10 + $4 = $14 net.
    await db`RESET ROLE`;
    await db`INSERT INTO public.result_overrides(room_id,game_id,away_score,home_score,state,entered_by)
      VALUES(${room},${game},101,110,'final',${owner})`;

    await asUser(member);
    await reject(1,/exceeds outstanding/);
    await asUser(owner);
    await reject(1401,/exceeds outstanding/);
    await record(1400);

    const payments = await db`SELECT payer_id,cents,status FROM public.payments WHERE room_id=${room} ORDER BY cents`;
    expect(payments.map(row => [row['payer_id'],row['cents'],row['status']]))
      .toEqual([[member,400,'confirmed'],[owner,1400,'pending']]);
  });

  it("keeps accepted picks and wagers payable only after an NBA game becomes final", async () => {
    // Simulate the official NBA game retaining its ID as a feed progresses
    // from scheduled to live to final. A wager must not settle early.
    await db`UPDATE public.games
      SET state='scheduled', away_score=NULL, home_score=NULL
      WHERE id=${game}`;
    await asUser(member);
    await reject(1, /exceeds outstanding/);

    await db`RESET ROLE`;
    await db`UPDATE public.games
      SET state='live', away_score=58, home_score=55
      WHERE id=${game}`;
    await asUser(member);
    await reject(1, /exceeds outstanding/);

    await db`RESET ROLE`;
    await db`UPDATE public.games
      SET state='final', away_score=109, home_score=107, source='nba'
      WHERE id=${game}`;
    await asUser(member);
    await reject(1001, /exceeds outstanding/);
    await record(1000);

    // Inspect fixture tables as the disposable DB owner, not the limited
    // authenticated role used to call the public payment RPC.
    await db`RESET ROLE`;
    const [stored] = await db`SELECT id,state,away_score,home_score FROM public.games WHERE id=${game}`;
    expect(stored).toMatchObject({ id: game, state: 'final', away_score: 109, home_score: 107 });
    expect((await db`SELECT user_id,team_code FROM public.picks
      WHERE room_id=${room} AND game_id=${game}`)).toHaveLength(2);
    expect((await db`SELECT status,stake_each_cents FROM public.wagers
      WHERE room_id=${room} AND game_id=${game}`)[0])
      .toMatchObject({ status: 'accepted', stake_each_cents: 1000 });
    expect((await db`SELECT payer_id,cents,status FROM public.payments WHERE room_id=${room}`)[0])
      .toMatchObject({ payer_id: member, cents: 1000, status: 'pending' });
  });
});
