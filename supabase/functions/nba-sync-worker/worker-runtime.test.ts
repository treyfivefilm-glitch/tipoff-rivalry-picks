// Real Deno-runtime smoke checks for the disabled NBA Edge handler.
// Uses only synthetic fixtures and local mock HTTP: no network, DB or secrets.
// Local assertions avoid Node/npm dependencies in the isolated Deno job.
const assert = {
  equal(actual: unknown, expected: unknown) {
    if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  },
  deepEqual(actual: unknown, expected: unknown) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  },
};
import { createUnattendedNbaHandler } from "../_shared/nba-worker-handler.ts";

const secret = "test-only-deno-runtime-secret-at-least-32-characters";
const config: Record<string, string> = {
  NBA_SYNC_WORKER_ENABLED: "true",
  NBA_SYNC_CRON_SECRET: secret,
  SUPABASE_URL: "https://example.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "test-only-backend-key",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json" },
  });
const schedule = {
  leagueSchedule: { gameDates: [{
    gameDate: "2026-11-17",
    games: [{
      gameId: "0022600012", gameDateTimeUTC: "2026-11-18T03:00:00Z",
      gameStatus: 1, gameStatusText: "7:00 PM ET",
      awayTeam: { teamTricode: "LAL", score: null },
      homeTeam: { teamTricode: "GSW", score: null },
    }],
  }] },
};
const live = { scoreboard: { gameDate: "2026-11-17", games: [] } };

function setup(feedsDown = false) {
  const calls: string[] = [];
  const request = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("scheduleLeagueV2")) return feedsDown ? json({}, 503) : json(schedule);
    if (url.includes("todaysScoreboard")) return feedsDown ? json({}, 503) : json(live);
    if (url.includes("/rest/v1/games?")) {
      calls.push("history");
      return json([]);
    }
    const name = url.split("/rpc/")[1];
    if (!name) throw new Error("Unexpected outbound request");
    const body = JSON.parse(String(init?.body)) as { p_day?: string; p_rows?: unknown[] };
    calls.push(name + ":" + (body.p_day ?? ""));
    if (name === "try_claim_nba_sync" || name === "release_nba_sync") return json(true);
    if (name === "commit_nba_sync_day") return json(body.p_rows?.length ?? 0);
    throw new Error("Unexpected privileged RPC");
  }) as typeof fetch;
  const handler = createUnattendedNbaHandler({
    env: name => config[name],
    request,
    now: () => new Date("2026-11-17T12:00:00Z"),
    newToken: () => "synthetic-lease-token",
    log: { error: () => {}, warn: () => {}, info: () => {} },
  });
  const post = (authorization = "Bearer " + secret) =>
    handler(new Request("https://worker.invalid/", {
      method: "POST", headers: { authorization },
    }));
  return { handler, post, calls };
}

Deno.test("Edge handler rejects unauthorized requests without network activity", async () => {
  const { post, calls } = setup();
  assert.equal((await post("Bearer incorrect")).status, 401);
  assert.deepEqual(calls, []);
});

Deno.test("Edge handler claims, commits and releases three Pacific days in Deno", async () => {
  const { post, calls } = setup();
  const response = await post();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    checked: 3, updated: 1, skipped: 0, failed: 0, errors: [],
  });
  assert.equal(calls.filter(value => value.startsWith("try_claim_nba_sync:")).length, 3);
  assert.equal(calls.filter(value => value.startsWith("commit_nba_sync_day:")).length, 3);
  assert.equal(calls.filter(value => value.startsWith("release_nba_sync:")).length, 3);
  assert.equal(calls.filter(value => value === "history").length, 1);
});

Deno.test("Edge handler fails closed on both NBA feeds failing and releases leases", async () => {
  const { post, calls } = setup(true);
  const response = await post();
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.equal(result.checked, 0);
  assert.equal(result.failed, 3);
  assert.equal(calls.filter(value => value.startsWith("commit_nba_sync_day:")).length, 0);
  assert.equal(calls.filter(value => value.startsWith("release_nba_sync:")).length, 3);
});


Deno.test("Edge handler serves real loopback HTTP with auth enforced before any backend call", async () => {
  // Exercise Deno.serve + fetch, not just a direct handler invocation.
  // The handler's NBA feeds and backend remain injected synthetic responses.
  const { handler, calls } = setup();
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    onListen: () => {},
  }, handler);
  try {
    const url = `http://127.0.0.1:${server.addr.port}/`;
    const get = await fetch(url);
    assert.equal(get.status, 405);
    const unauthorized = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer incorrect" },
    });
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(calls, []);

    const authorized = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer " + secret },
    });
    assert.equal(authorized.status, 200);
    assert.deepEqual(await authorized.json(), {
      checked: 3, updated: 1, skipped: 0, failed: 0, errors: [],
    });
    assert.equal(calls.filter(value => value.startsWith("try_claim_nba_sync:")).length, 3);
    assert.equal(calls.filter(value => value.startsWith("commit_nba_sync_day:")).length, 3);
    assert.equal(calls.filter(value => value.startsWith("release_nba_sync:")).length, 3);
  } finally {
    await server.shutdown();
  }
});
