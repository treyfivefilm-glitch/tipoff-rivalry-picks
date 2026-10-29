// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createUnattendedNbaHandler } from "../../supabase/functions/_shared/nba-worker-handler";

const secret = "test-only-cron-secret-32-characters-long";
const game = {
  gameId: "0022600012", gameDateTimeUTC: "2026-11-18T03:00:00Z",
  gameStatus: 1, gameStatusText: "7:00 PM ET",
  awayTeam: { teamTricode: "LAL", score: null },
  homeTeam: { teamTricode: "GSW", score: null },
};
const schedule = { leagueSchedule: { gameDates: [{ gameDate: "2026-11-17", games: [game] }] } };
const live = { scoreboard: { gameDate: "2026-11-17", games: [] } };
const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const mockFetch = (handler: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch =>
  handler as unknown as typeof fetch;
const env = {
  NBA_SYNC_WORKER_ENABLED: "true",
  NBA_SYNC_CRON_SECRET: secret,
  SUPABASE_URL: "https://example.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "test-only-service-role-placeholder",
};
type Options = {
  feedsDown?: boolean; historyDown?: boolean; historyMalformed?: boolean; commitDown?: string;
  releaseDown?: string; releaseDenied?: string; skipLease?: string;
};
function fixture(options: Options = {}) {
  const calls: Array<{ operation: string; day: string | undefined; rows?: number | undefined }> = [];
  const request = mockFetch(async (url, init) => {
    if (url.includes("scheduleLeagueV2")) return options.feedsDown ? reply({}, 503) : reply(schedule);
    if (url.includes("todaysScoreboard")) return options.feedsDown ? reply({}, 503) : reply(live);
    if (url.includes("/rest/v1/games?")) {
      calls.push({ operation: "history", day: undefined });
      return options.historyDown ? reply({ error: "offline" }, 503) :
        options.historyMalformed ? reply([{}]) : reply([]);
    }
    const operation = url.split("/rpc/")[1];
    if (!operation) throw new Error("Unexpected request URL");
    const body = JSON.parse(String(init?.body)) as {
      p_day?: string; p_rows?: unknown[];
    };
    calls.push({ operation, day: body.p_day, rows: body.p_rows?.length });
    if (operation === "try_claim_nba_sync") return reply(body.p_day !== options.skipLease);
    if (operation === "release_nba_sync") {
      if (body.p_day === options.releaseDown) return reply({}, 503);
      return reply(body.p_day !== options.releaseDenied);
    }
    if (operation === "commit_nba_sync_day") {
      return body.p_day === options.commitDown ? reply({}, 503) : reply(body.p_rows?.length ?? 0);
    }
    throw new Error("Unexpected privileged RPC");
  });
  const handler = createUnattendedNbaHandler({
    env: name => env[name as keyof typeof env],
    request,
    now: () => new Date("2026-11-17T12:00:00Z"),
    newToken: () => "test-only-lease-token",
    log: { error: () => {}, warn: () => {}, info: () => {} },
  });
  const post = (authorization = "Bearer " + secret) =>
    handler(new Request("https://worker.invalid/", {
      method: "POST", headers: { authorization },
    }));
  return { calls, handler, post };
}

describe("complete unattended NBA worker request flow (mock HTTP, no secrets or DB)", () => {
  it("rejects non-POST, disabled, unconfigured and unauthorized calls before network access", async () => {
    let requests = 0;
    const request = mockFetch(async () => { requests++; throw new Error("must not fetch"); });
    const make = (overrides: Record<string, string>) => createUnattendedNbaHandler({
      env: name => ({ ...env, ...overrides })[name as keyof typeof env],
      request,
    });
    const validPost = () => new Request("https://worker.invalid", {
      method: "POST", headers: { authorization: "Bearer " + secret },
    });
    expect((await make({})(new Request("https://worker.invalid"))).status).toBe(405);
    expect((await make({ NBA_SYNC_WORKER_ENABLED: "false" })(validPost())).status).toBe(503);
    expect((await make({ NBA_SYNC_CRON_SECRET: "short" })(validPost())).status).toBe(503);
    expect((await make({})(new Request("https://worker.invalid", {
      method: "POST", headers: { authorization: "Bearer wrong" },
    }))).status).toBe(401);
    expect((await make({ SUPABASE_SERVICE_ROLE_KEY: "" })(validPost())).status).toBe(503);
    expect(requests).toBe(0);
  });

  it("claims, verifies, commits and releases three Pacific days without a browser", async () => {
    const { calls, post } = fixture();
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      checked: 3, updated: 1, skipped: 0, failed: 0, errors: [],
    });
    expect(calls.filter(call => call.operation === "try_claim_nba_sync")
      .map(call => call.day)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18"]);
    expect(calls.filter(call => call.operation === "commit_nba_sync_day")
      .map(call => call.rows)).toEqual([0, 1, 0]);
    expect(calls.filter(call => call.operation === "release_nba_sync")).toHaveLength(3);
    expect(calls.filter(call => call.operation === "history")).toHaveLength(1);
  });

  it("does not certify freshness when both NBA feeds fail and still releases leases", async () => {
    const { calls, post } = fixture({ feedsDown: true });
    const response = await post();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ checked: 0, updated: 0, failed: 3 });
    expect(calls.some(call => call.operation === "commit_nba_sync_day")).toBe(false);
    expect(calls.filter(call => call.operation === "release_nba_sync")).toHaveLength(3);
  });

  it("reports a shared backend-history outage for every claimed day and releases leases", async () => {
    const { calls, post } = fixture({ historyDown: true });
    const response = await post();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      checked: 0, updated: 0, failed: 3, errors: ["NBA refresh failed"],
    });
    expect(calls.some(call => call.operation === "commit_nba_sync_day")).toBe(false);
    expect(calls.filter(call => call.operation === "release_nba_sync")).toHaveLength(3);
  });


  it("fails closed on a malformed successful game-history row and releases all leases", async () => {
    const { calls, post } = fixture({ historyMalformed: true });
    const response = await post();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      checked: 0, updated: 0, failed: 3, errors: ["NBA refresh failed"],
    });
    expect(calls.some(call => call.operation === "commit_nba_sync_day")).toBe(false);
    expect(calls.filter(call => call.operation === "release_nba_sync")).toHaveLength(3);
  });

  it("isolates one failed fenced commit while releasing every claimed lease", async () => {
    const { calls, post } = fixture({ commitDown: "2026-11-17" });
    const response = await post();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      checked: 2, updated: 0, failed: 1,
      errors: ["2026-11-17: fenced commit failed"],
    });
    expect(calls.filter(call => call.operation === "release_nba_sync")).toHaveLength(3);
  });

  it("surfaces lease cleanup failures instead of reporting a fully healthy run", async () => {
    const { calls, post } = fixture({ releaseDown: "2026-11-17" });
    const response = await post();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      checked: 3, updated: 1, failed: 1,
      errors: ["2026-11-17: lease release failed"],
    });
    expect(calls.filter(call => call.operation === "release_nba_sync")).toHaveLength(3);
  });

  it("reports a false lease-release reply as degraded instead of silently succeeding", async () => {
    const { calls, post } = fixture({ releaseDenied: "2026-11-17" });
    const response = await post();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      checked: 3, updated: 1, failed: 1,
      errors: ["2026-11-17: lease release failed"],
    });
    expect(calls.filter(call => call.operation === "release_nba_sync")).toHaveLength(3);
  });

  it("never commits or releases a day owned by another worker", async () => {
    const { calls, post } = fixture({ skipLease: "2026-11-17" });
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ checked: 2, skipped: 1, failed: 0 });
    expect(calls.filter(call => call.operation === "commit_nba_sync_day")
      .map(call => call.day)).toEqual(["2026-11-16", "2026-11-18"]);
    expect(calls.filter(call => call.operation === "release_nba_sync")
      .map(call => call.day)).toEqual(["2026-11-16", "2026-11-18"]);
  });
});
