// @vitest-environment node
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Real RPC/RLS checks. Every fixture is rolled back; no test room is persisted.
const url = process.env["SUPABASE_DB_URL"];
describe.skipIf(!url)("leave_room database safety", () => {
  const db = postgres(url ?? "", { max: 1, prepare: false });
  const owner = "00000000-0000-4000-8000-000000000001";
  const member = "00000000-0000-4000-8000-000000000002";
  const outsider = "00000000-0000-4000-8000-000000000003";
  const room = "00000000-0000-4000-8000-000000000004";
  const game = "leave-room-transaction-test";
  beforeAll(async () => { await db`BEGIN`; });
  afterAll(async () => { await db`ROLLBACK`; await db.end(); });
  beforeEach(async () => {
    await db`SAVEPOINT scenario`;
    await db`INSERT INTO public.rooms(id,name,owner_id,invite_code) VALUES(${room},'Transactional departure test',${owner},'LEAVE-TRANSACTION-TEST')`;
    await db`INSERT INTO public.room_members(room_id,user_id,display_name) VALUES(${room},${owner},'Owner'),(${room},${member},'Member')`;
    await db`INSERT INTO public.games(id,start_utc,away_code,away_name,home_code,home_name,state,away_score,home_score) VALUES(${game},now()-interval '1 day','A','Away','H','Home','final',100,90)`;
    await db`INSERT INTO public.picks(room_id,game_id,user_id,team_code) VALUES(${room},${game},${owner},'A'),(${room},${game},${member},'H')`;
  });
  afterEach(async () => { await db`ROLLBACK TO SAVEPOINT scenario`; });
  async function asUser(id: string) {
    await db`SELECT set_config('request.jwt.claim.sub',${id},true),set_config('request.jwt.claims',${JSON.stringify({ sub: id, role: "authenticated" })},true)`;
    await db`SET LOCAL ROLE authenticated`;
  }
  async function leave(id = member) { await asUser(id); await db`SELECT public.leave_room(${room}::uuid)`; }
  async function wager(status: string, category = "cash") {
    await db`INSERT INTO public.wagers(room_id,game_id,stake_each_cents,proposed_by,accepted_by,status,kind) VALUES(${room},${game},1000,${owner},${member},${status},${category === "challenge" ? "other" : "cash"})`;
    await db`INSERT INTO public.wager_versions(room_id,game_id,version,proposer_id,recipient_id,category,cents,terms,status) VALUES(${room},${game},1,${owner},${member},${category},${category === "challenge" ? 0 : 1000},'Coffee',${status})`;
  }
  it("idle member leaves, loses room read access, and keeps original picks", async () => {
    await leave();
    expect((await db`SELECT id FROM public.rooms WHERE id=${room}`)).toHaveLength(0);
    await db`RESET ROLE`;
    expect((await db`SELECT * FROM public.picks WHERE room_id=${room}`)).toHaveLength(2);
    expect((await db`SELECT user_id FROM public.room_members WHERE room_id=${room}`)).toHaveLength(1);
    expect((await db`SELECT invites_closed FROM public.rooms WHERE id=${room}`)[0]?.invites_closed).toBe(true);
  });
  it("third party cannot leave", async () => { await expect(leave(outsider)).rejects.toThrow(/Not a member/); });
  it("pending offer blocks leave", async () => { await wager("proposed"); await expect(leave()).rejects.toThrow(/pending offers/); });
  it("accepted active game blocks leave", async () => { await wager("accepted"); await db`UPDATE public.games SET state='live' WHERE id=${game}`; await expect(leave()).rejects.toThrow(/awaiting results/); });
  it("outstanding 1000-cent loss blocks leave", async () => { await wager("accepted"); await expect(leave()).rejects.toThrow(/outstanding cash/); });
  for (const status of ["pending", "rejected"]) it(`${status} payment blocks leave`, async () => {
    await db`INSERT INTO public.payments(room_id,payer_id,recipient_id,cents,status) VALUES(${room},${member},${owner},1000,${status})`;
    await expect(leave()).rejects.toThrow(/payments must be resolved/);
  });
  for (const status of ["pending", "disputed"]) it(`${status} challenge blocks leave`, async () => {
    await wager("accepted", "challenge");
    await db`INSERT INTO public.challenge_submissions(room_id,game_id,version,loser_id,winner_id,status) VALUES(${room},${game},1,${member},${owner},${status})`;
    await expect(leave()).rejects.toThrow(/challenges must be confirmed/);
  });
  it("unsubmitted challenge blocks leave", async () => { await wager("accepted", "challenge"); await expect(leave()).rejects.toThrow(/challenge still needs/); });
  it("settled owner transfers atomically without deleting history", async () => {
    await wager("accepted");
    await db`INSERT INTO public.payments(room_id,payer_id,recipient_id,cents,status) VALUES(${room},${member},${owner},1000,'confirmed')`;
    await leave(owner); await db`RESET ROLE`;
    expect((await db`SELECT owner_id FROM public.rooms WHERE id=${room}`)[0]?.owner_id).toBe(member);
    expect((await db`SELECT * FROM public.wagers WHERE room_id=${room}`)).toHaveLength(1);
    expect((await db`SELECT * FROM public.audit_events WHERE room_id=${room} AND kind='ownership_transferred'`)).toHaveLength(1);
    await asUser(member);
    await db`SELECT public.rename_room(${room}::uuid,'Remaining owner')`;
    expect((await db`SELECT name FROM public.rooms WHERE id=${room}`)[0]?.name).toBe("Remaining owner");
  });
  it("sole owner is blocked rather than deleting room", async () => {
    await db`DELETE FROM public.room_members WHERE room_id=${room} AND user_id=${member}`;
    await expect(leave(owner)).rejects.toThrow(/sole owner/);
  });
  it("closed invite cannot admit replacement", async () => {
    await leave(); await db`RESET ROLE`; await asUser(outsider);
    await expect(db`SELECT public.join_room('LEAVE-TRANSACTION-TEST','Replacement')`).rejects.toThrow(/permanently closed/);
  });
  it("direct client membership deletion is forbidden", async () => {
    await asUser(member); await expect(db`DELETE FROM public.room_members WHERE room_id=${room}`).rejects.toThrow(/permission denied/);
  });
  it("direct owner mutation and destructive room deletion are forbidden", async () => {
    const [rights] = await db`SELECT has_table_privilege('authenticated','public.rooms','UPDATE') AS update_allowed,has_table_privilege('authenticated','public.rooms','DELETE') AS delete_allowed`;
    expect(rights?.update_allowed).toBe(false); expect(rights?.delete_allowed).toBe(false);
  });
});