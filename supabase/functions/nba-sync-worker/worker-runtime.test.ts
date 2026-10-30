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
import { createNbaWorkerBackend, normalizeNbaWorkerBackendUrl } from "../_shared/nba-worker-backend.ts";

const secret = "test-only-deno-runtime-secret-at-least-32-characters";
const config: Record<string, string> = {
  NBA_SYNC_WORKER_ENABLED: "true",
  NBA_SYNC_CRON_SECRET: secret,
  SUPABASE_URL: "https://example.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "test-only-backend-key",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status, headers: {
      "content-type": "application/json",
      ...(Array.isArray(data) ? {
        "content-range": data.length ? `0-${data.length - 1}/${data.length}` : "*/0",
      } : {}),
    },
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

Deno.test("Privileged NBA backend accepts HTTPS or loopback HTTP, not remote plaintext or ambiguous URLs", () => {
  assert.equal(normalizeNbaWorkerBackendUrl("https://example.invalid/"), "https://example.invalid");
  assert.equal(normalizeNbaWorkerBackendUrl("http://127.0.0.1:54321/"), "http://127.0.0.1:54321");
  assert.equal(normalizeNbaWorkerBackendUrl("http://localhost:54321"), "http://localhost:54321");
  const invalid = [
    "http://example.invalid", "http://localhost.evil.invalid",
    "https://user:password@example.invalid", "https://example.invalid/rest/v1",
    "https://example.invalid?token=secret", "https://example.invalid/#fragment",
    "ftp://example.invalid", "not a URL",
  ];
  for (const endpoint of invalid) {
    let rejected = false;
    try {
      normalizeNbaWorkerBackendUrl(endpoint);
    } catch {
      rejected = true;
    }
    assert.equal(rejected, true);
  }
});

Deno.test("Worker rejects insecure backend configuration before any outbound request", async () => {
  let outbound = 0;
  const handler = createUnattendedNbaHandler({
    env: name => name === "SUPABASE_URL" ? "http://example.invalid" : config[name],
    request: (async () => {
      outbound++;
      throw new Error("Must not send privileged requests");
    }) as typeof fetch,
    now: () => new Date("2026-11-17T12:00:00Z"),
    log: { error: () => {}, warn: () => {}, info: () => {} },
  });
  const response = await handler(new Request("https://worker.invalid/", {
    method: "POST", headers: { authorization: "Bearer " + secret },
  }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Backend configuration invalid" });
  assert.equal(outbound, 0);
});

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


Deno.test("Edge handler crosses a real loopback PostgREST HTTP boundary and fails closed on missing history counts", async () => {
  // Unlike the injected-response smoke tests, these requests traverse two
  // real Deno HTTP servers. The backend is a synthetic PostgREST-shaped stub,
  // NOT Supabase or a database; no external network or credentials are used.
  const calls: string[] = [];
  let omitHistoryCount = false;
  const backend = Deno.serve({
    hostname: "127.0.0.1", port: 0, onListen: () => {},
  }, async request => {
    const path = new URL(request.url).pathname;
    assert.equal(request.headers.get("apikey"), config.SUPABASE_SERVICE_ROLE_KEY);
    if (path === "/rest/v1/games") {
      assert.equal(request.method, "GET");
      assert.equal(request.headers.get("prefer"), "count=exact");
      calls.push("history");
      return omitHistoryCount
        ? new Response("[]", { status: 200, headers: { "content-type": "application/json" } })
        : json([]);
    }
    const name = path.split("/rest/v1/rpc/")[1];
    if (!name) return json({ error: "Unknown path" }, 404);
    assert.equal(request.method, "POST");
    const body = await request.json() as { p_day?: string; p_rows?: unknown[] };
    calls.push(name + ":" + (body.p_day ?? ""));
    if (name === "try_claim_nba_sync" || name === "release_nba_sync") return json(true);
    if (name === "commit_nba_sync_day") return json(body.p_rows?.length ?? 0);
    return json({ error: "Unknown RPC" }, 404);
  });
  const backendUrl = `http://127.0.0.1:${backend.addr.port}`;
  const outbound = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("scheduleLeagueV2")) return json(schedule);
    if (url.includes("todaysScoreboard")) return json(live);
    if (!url.startsWith(backendUrl + "/rest/v1/")) {
      throw new Error("Unexpected outbound URL");
    }
    return fetch(input, init);
  }) as typeof fetch;
  const handler = createUnattendedNbaHandler({
    env: name => name === "SUPABASE_URL" ? backendUrl : config[name],
    request: outbound,
    now: () => new Date("2026-11-17T12:00:00Z"),
    newToken: () => "loopback-test-lease-token",
    log: { error: () => {}, warn: () => {}, info: () => {} },
  });
  const worker = Deno.serve({
    hostname: "127.0.0.1", port: 0, onListen: () => {},
  }, handler);
  try {
    const url = `http://127.0.0.1:${worker.addr.port}/`;
    const post = () => fetch(url, {
      method: "POST", headers: { authorization: "Bearer " + secret },
    });
    const healthy = await post();
    assert.equal(healthy.status, 200);
    assert.deepEqual(await healthy.json(), {
      checked: 3, updated: 1, skipped: 0, failed: 0, errors: [],
    });
    assert.equal(calls.filter(call => call === "history").length, 1);
    assert.equal(calls.filter(call => call.startsWith("commit_nba_sync_day:")).length, 3);
    assert.equal(calls.filter(call => call.startsWith("release_nba_sync:")).length, 3);

    // An HTTP 200 empty array without PostgREST's exact Content-Range must
    // never certify three days, even when it arrived over a real HTTP hop.
    omitHistoryCount = true;
    const degraded = await post();
    assert.equal(degraded.status, 503);
    assert.deepEqual(await degraded.json(), {
      checked: 0, updated: 0, skipped: 0, failed: 3,
      errors: ["NBA refresh failed"],
    });
    assert.equal(calls.filter(call => call === "history").length, 2);
    assert.equal(calls.filter(call => call.startsWith("commit_nba_sync_day:")).length, 3);
    assert.equal(calls.filter(call => call.startsWith("release_nba_sync:")).length, 6);
  } finally {
    await worker.shutdown();
    await backend.shutdown();
  }
});

Deno.test("Privileged PostgREST requests never follow a redirect to another server", async () => {
  // Real Deno fetch across two loopback servers: a misconfigured backend
  // must not redirect the service-role apikey to a different origin.
  let forwarded = 0;
  const destination = Deno.serve({
    hostname: "127.0.0.1", port: 0, onListen: () => {},
  }, () => {
    forwarded++;
    return json({ error: "Unexpected credential forwarding" }, 500);
  });
  const redirector = Deno.serve({
    hostname: "127.0.0.1", port: 0, onListen: () => {},
  }, () => new Response(null, {
    status: 307,
    headers: { location: `http://127.0.0.1:${destination.addr.port}/capture` },
  }));
  try {
    const backend = createNbaWorkerBackend(
      `http://127.0.0.1:${redirector.addr.port}`,
      config.SUPABASE_SERVICE_ROLE_KEY,
    );
    let rejectedRpc = false;
    try {
      await backend.rpc<boolean>("try_claim_nba_sync", {
        p_day: "2026-11-17", p_owner_token: "test-only-token",
      });
    } catch {
      rejectedRpc = true;
    }
    assert.equal(rejectedRpc, true);
    let rejectedHistory = false;
    try {
      await backend.readExisting(["2026-11-17"]);
    } catch {
      rejectedHistory = true;
    }
    assert.equal(rejectedHistory, true);
    assert.equal(forwarded, 0);
  } finally {
    await redirector.shutdown();
    await destination.shutdown();
  }
});

Deno.test("Real loopback PostgREST history timeout prevents fenced commits and releases leases", async () => {
  // Exercise an actual delayed HTTP response, not an injected thrown error.
  // A partial history read must never allow wager-linked scores to be written.
  const calls: string[] = [];
  const backend = Deno.serve({
    hostname: "127.0.0.1", port: 0, onListen: () => {},
  }, async request => {
    const path = new URL(request.url).pathname;
    assert.equal(request.headers.get("apikey"), config.SUPABASE_SERVICE_ROLE_KEY);
    if (path === "/rest/v1/games") {
      calls.push("history");
      await new Promise(resolve => setTimeout(resolve, 400));
      return json([]);
    }
    const name = path.split("/rest/v1/rpc/")[1];
    if (!name) return json({ error: "Unknown path" }, 404);
    calls.push(name);
    if (name === "try_claim_nba_sync" || name === "release_nba_sync") return json(true);
    if (name === "commit_nba_sync_day") return json(0);
    return json({ error: "Unknown RPC" }, 404);
  });
  const backendUrl = `http://127.0.0.1:${backend.addr.port}`;
  const outbound = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("scheduleLeagueV2")) return json(schedule);
    if (url.includes("todaysScoreboard")) return json(live);
    if (!url.startsWith(backendUrl + "/rest/v1/")) throw new Error("Unexpected outbound URL");
    return fetch(input, init);
  }) as typeof fetch;
  const handler = createUnattendedNbaHandler({
    env: name => name === "SUPABASE_URL" ? backendUrl : config[name],
    request: outbound,
    backendTimeoutMs: 80,
    now: () => new Date("2026-11-17T12:00:00Z"),
    newToken: () => "timeout-test-lease-token",
    log: { error: () => {}, warn: () => {}, info: () => {} },
  });
  const worker = Deno.serve({
    hostname: "127.0.0.1", port: 0, onListen: () => {},
  }, handler);
  try {
    const response = await fetch(`http://127.0.0.1:${worker.addr.port}/`, {
      method: "POST", headers: { authorization: "Bearer " + secret },
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      checked: 0, updated: 0, skipped: 0, failed: 3,
      errors: ["NBA refresh failed"],
    });
    assert.equal(calls.filter(call => call === "history").length, 1);
    assert.equal(calls.filter(call => call === "try_claim_nba_sync").length, 3);
    assert.equal(calls.filter(call => call === "commit_nba_sync_day").length, 0);
    assert.equal(calls.filter(call => call === "release_nba_sync").length, 3);
  } finally {
    await worker.shutdown();
    await backend.shutdown();
  }
});
