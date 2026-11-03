// Real entrypoint -> loopback gateway -> authenticated PostgREST -> disposable PostgreSQL.
// Only runs in the dedicated CI database job. No real NBA, Supabase, or production traffic.
const enabled = Deno.env.get("CI") === "true" &&
  Deno.env.get("RUN_DISPOSABLE_NBA_POSTGREST_TESTS") === "true";
const cronSecret = "disposable-real-entrypoint-cron-secret-2026-not-production";
const jwtSecret = "tipoff-disposable-ci-jwt-secret-not-production-2026";
const workerUrl = "http://127.0.0.1:8000/";
const encoder = new TextEncoder();

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function base64url(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function localServiceJwt() {
  const unsigned = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" })) + "." +
    base64url(JSON.stringify({ role: "service_role" }));
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(jwtSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(unsigned)));
  return unsigned + "." + base64url(signature);
}

async function databaseSnapshot() {
  // Explicitly fixed to the disposable CI database. No URL or credentials from the user.
  const command = new Deno.Command("psql", {
    args: ["-h", "127.0.0.1", "-U", "postgres", "-d", "tipoff_test", "-F", ",", "-tAc",
      "SELECT (SELECT count(*) FROM public.games), (SELECT count(*) FROM public.sync_state), (SELECT count(*) FROM public.nba_sync_leases)"],
    env: { PGPASSWORD: "postgres" },
    stdout: "piped", stderr: "piped",
  });
  const output = await command.output();
  assert(output.success, "Disposable PostgreSQL snapshot failed: " + new TextDecoder().decode(output.stderr));
  return new TextDecoder().decode(output.stdout).trim();
}

async function startActualWorker(gatewayPort: number, jwt: string, syntheticFeeds = false) {
  // Restrict the worker to its own listener and the local database gateway.
  // Real NBA feed domains are deliberately NOT permitted: this exercises
  // provider-outage handling through the actual entrypoint and real leases.
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "--no-check",
      `--allow-net=0.0.0.0:8000,127.0.0.1:8000,127.0.0.1:${gatewayPort}`,
      "--allow-env=NBA_SYNC_WORKER_ENABLED,NBA_SYNC_CRON_SECRET,SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY",
      syntheticFeeds
        ? "supabase/functions/nba-sync-worker/entrypoint-synthetic-feeds.ci.ts"
        : "supabase/functions/nba-sync-worker/index.ts"],
    clearEnv: true,
    env: {
      HOME: Deno.env.get("HOME") ?? "/tmp",
      NBA_SYNC_WORKER_ENABLED: "true",
      NBA_SYNC_CRON_SECRET: cronSecret,
      SUPABASE_URL: `http://127.0.0.1:${gatewayPort}`,
      SUPABASE_SERVICE_ROLE_KEY: jwt,
    },
    stdout: "null", stderr: "piped",
  }).spawn();
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const response = await fetch(workerUrl, { signal: AbortSignal.timeout(300) });
      if (response.status === 405 &&
          (await response.json() as { error?: string }).error === "POST required") return child;
    } catch { /* Child may still be starting. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  try { child.kill("SIGTERM"); } catch { /* already exited */ }
  await child.status;
  throw new Error("Actual Edge worker failed to start: " +
    (await new Response(child.stderr).text()).slice(0, 2000));
}

async function stopWorker(child: Deno.ChildProcess) {
  try { child.kill("SIGTERM"); } catch { /* already exited */ }
  await child.status;
  await new Response(child.stderr).text();
}

function startGateway(
  jwt: string, calls: Array<{ path: string; status: number; result: unknown }>,
) {
  return Deno.serve({
    hostname: "127.0.0.1", port: 0, onListen: () => {},
  }, async request => {
    const target = new URL(request.url);
    if (!target.pathname.startsWith("/rest/v1/")) {
      return new Response("Unexpected gateway path", { status: 404 });
    }
    if (request.headers.get("apikey") !== jwt ||
        request.headers.get("authorization") !== "Bearer " + jwt) {
      return new Response("Unauthorized disposable gateway request", { status: 401 });
    }
    const path = target.pathname.slice("/rest/v1".length);
    const headers = new Headers({
      authorization: "Bearer " + jwt,
      "content-type": request.headers.get("content-type") ?? "application/json",
    });
    if (request.headers.has("prefer")) headers.set("prefer", request.headers.get("prefer")!);
    const upstream = await fetch("http://127.0.0.1:3000" + path + target.search, {
      method: request.method, headers,
      ...(request.method === "GET" ? {} : { body: await request.arrayBuffer() }),
      redirect: "error",
    });
    const body = await upstream.text();
    if (path.startsWith("/rpc/") || path === "/games") {
      let result: unknown;
      try { result = JSON.parse(body); } catch { result = body; }
      calls.push({ path, status: upstream.status, result });
    }
    return new Response(body, { status: upstream.status, headers: upstream.headers });
  });
}

Deno.test({
  name: "Actual NBA Edge entrypoint releases real PostgreSQL leases when NBA providers are unavailable",
  ignore: !enabled,
  async fn() {
    const before = await databaseSnapshot();
    assert(before.split(",")[2] === "0", "Disposable test started with active leases");
    const jwt = await localServiceJwt();
    const calls: Array<{ path: string; status: number; result: unknown }> = [];
    const gateway = startGateway(jwt, calls);
    let worker: Deno.ChildProcess | undefined;
    try {
      worker = await startActualWorker(gateway.addr.port, jwt);
      const response = await fetch(workerUrl, {
        method: "POST", headers: { authorization: "Bearer " + cronSecret },
        signal: AbortSignal.timeout(20000),
      });
      const result = await response.json() as {
        checked?: number; updated?: number; skipped?: number; failed?: number;
        errors?: string[];
      };
      assert(response.status === 503, "Provider outage must return HTTP 503");
      assert(response.headers.get("cache-control") === "no-store", "Worker response must not be cached");
      assert(result.checked === 0 && result.updated === 0 &&
        result.skipped === 0 && result.failed === 3, "Unexpected provider-outage result: " + JSON.stringify(result));
      assert(Array.isArray(result.errors) && result.errors.length > 0, "Provider outage was not reported");
      const claimed = calls.filter(c => c.path === "/rpc/try_claim_nba_sync");
      const released = calls.filter(c => c.path === "/rpc/release_nba_sync");
      assert(claimed.length === 3 && claimed.every(c => c.status === 200 && c.result === true),
        "Actual worker did not acquire three real leases");
      assert(released.length === 3 && released.every(c => c.status === 200 && c.result === true),
        "Actual worker did not release three real leases");
      assert(calls.every(c => c.path !== "/rpc/commit_nba_sync_day" && c.path !== "/games"),
        "Provider outage must not read history or commit scores");
    } finally {
      if (worker) await stopWorker(worker);
      await gateway.shutdown();
    }
    assert(await databaseSnapshot() === before,
      "Actual Edge worker changed disposable game/history/lease state during provider outage");
  },
});

async function disposableSql(sql: string) {
  // Only fixed statements against the CI-owned tipoff_test database.
  const command = new Deno.Command("psql", {
    args: ["-h", "127.0.0.1", "-U", "postgres", "-d", "tipoff_test", "-F", ",", "-tAc", sql],
    env: { PGPASSWORD: "postgres" }, stdout: "piped", stderr: "piped",
  });
  const output = await command.output();
  assert(output.success, "Disposable PostgreSQL SQL failed: " +
    new TextDecoder().decode(output.stderr));
  return new TextDecoder().decode(output.stdout).trim();
}

Deno.test({
  name: "Actual NBA Edge entrypoint commits a synthetic final through real PostgREST and preserves its game ID",
  ignore: !enabled,
  async fn() {
    // Earlier rollback-only SQL tests can leave their own fixture rows.
    // Require only that this game's identity and leases are unoccupied.
    const before = await databaseSnapshot();
    const counts = before.split(",").map(Number);
    assert(counts.length === 3 && counts[2] === 0, "Disposable test has active leases");
    assert(await disposableSql(
      "SELECT count(*) FROM public.games WHERE id='nba:0022600999'"
    ) === "0", "Synthetic official game ID is already occupied");
    const jwt = await localServiceJwt();
    const calls: Array<{ path: string; status: number; result: unknown }> = [];
    const gateway = startGateway(jwt, calls);
    let worker: Deno.ChildProcess | undefined;
    try {
      worker = await startActualWorker(gateway.addr.port, jwt, true);
      const response = await fetch(workerUrl, {
        method: "POST", headers: { authorization: "Bearer " + cronSecret },
        signal: AbortSignal.timeout(20000),
      });
      const result = await response.json();
      assert(response.status === 200, "Synthetic verified final must return HTTP 200: " +
        JSON.stringify(result));
      assert(response.headers.get("cache-control") === "no-store", "Successful result must not be cached");
      assert(JSON.stringify(result) === JSON.stringify({
        checked: 3, updated: 1, skipped: 0, failed: 0, errors: [],
      }), "Unexpected final-score result: " + JSON.stringify(result));
      const paths = calls.map(c => c.path);
      for (const [path, expected] of [
        ["/rpc/try_claim_nba_sync", 3], ["/games", 1],
        ["/rpc/commit_nba_sync_day", 3], ["/rpc/release_nba_sync", 3],
      ] as const) {
        assert(paths.filter(p => p === path).length === expected,
          "Unexpected authenticated PostgREST calls to " + path);
      }
      assert(calls.filter(c => c.path === "/rpc/commit_nba_sync_day")
        .every(c => c.status === 200), "Fenced commits failed");
      assert(await disposableSql(
        "SELECT id,state,away_score,home_score,source FROM public.games WHERE id='nba:0022600999'"
      ) === "nba:0022600999,final,109,107,nba",
        "Actual entrypoint did not store the official final and winning score");
      assert(await databaseSnapshot() ===
        [counts[0]! + 1, counts[1]! + 3, 0].join(","),
        "Expected one additional official game, three verified days and zero remaining leases");
    } finally {
      if (worker) await stopWorker(worker);
      await gateway.shutdown();
      // Clean only the synthetic fixture and its three Pacific days.
      // The job's PostgreSQL service is disposable and never production.
      await disposableSql("DELETE FROM public.games WHERE id='nba:0022600999'");
      await disposableSql("DELETE FROM public.sync_state WHERE day::date BETWEEN " +
        "(now() AT TIME ZONE 'America/Los_Angeles')::date - 1 AND " +
        "(now() AT TIME ZONE 'America/Los_Angeles')::date + 1");
    }
    assert(await databaseSnapshot() === before,
      "Synthetic final-score test did not restore the disposable database");
  },
});


Deno.test({
  name: "Actual NBA Edge entrypoint preserves a pre-existing scheduled game and its foreign-key reference",
  ignore: !enabled,
  async fn() {
    // This is a disposable CI database, not a production schema migration.
    // A linked row models a pick/wager that must continue pointing at the
    // SAME official game ID after the scheduled -> final transition.
    const before = await databaseSnapshot();
    const counts = before.split(",").map(Number);
    assert(counts.length === 3 && counts[2] === 0, "Disposable test has active leases");
    assert(await disposableSql(
      "SELECT count(*) FROM public.games WHERE id='nba:0022600999'"
    ) === "0", "Scheduled fixture ID is already occupied");
    const jwt = await localServiceJwt();
    const calls: Array<{ path: string; status: number; result: unknown }> = [];
    const gateway = startGateway(jwt, calls);
    let worker: Deno.ChildProcess | undefined;
    try {
      await disposableSql(
        "INSERT INTO public.games (id,start_utc,away_code,away_name,home_code,home_name,state,source) " +
        "VALUES ('nba:0022600999', " +
        "(((now() AT TIME ZONE 'America/Los_Angeles')::date)::text || 'T19:00:00Z')::timestamptz, " +
        "'LAL','Los Angeles Lakers','GS','Golden State Warriors','scheduled','nba_official_schedule')"
      );
      await disposableSql(
        "CREATE TABLE public.ci_nba_game_refs (" +
        "game_id text NOT NULL REFERENCES public.games(id), note text NOT NULL)"
      );
      await disposableSql(
        "INSERT INTO public.ci_nba_game_refs VALUES ('nba:0022600999','existing-pick-reference')"
      );
      worker = await startActualWorker(gateway.addr.port, jwt, true);
      const response = await fetch(workerUrl, {
        method: "POST", headers: { authorization: "Bearer " + cronSecret },
        signal: AbortSignal.timeout(20000),
      });
      const result = await response.json();
      assert(response.status === 200, "Scheduled-to-final worker failed: " + JSON.stringify(result));
      assert(JSON.stringify(result) === JSON.stringify({
        checked: 3, updated: 1, skipped: 0, failed: 0, errors: [],
      }), "Unexpected scheduled-to-final result: " + JSON.stringify(result));
      assert(calls.filter(c => c.path === "/games").length === 1,
        "Worker must read existing games before reconciling the final");
      assert(calls.filter(c => c.path === "/rpc/commit_nba_sync_day").length === 3 &&
        calls.filter(c => c.path === "/rpc/commit_nba_sync_day").every(c => c.status === 200),
        "Scheduled-to-final fenced commits failed");
      assert(await disposableSql(
        "SELECT id,state,away_score,home_score,source FROM public.games WHERE id='nba:0022600999'"
      ) === "nba:0022600999,final,109,107,nba",
        "Existing official game did not advance in place to the verified final");
      assert(await disposableSql(
        "SELECT game_id,note FROM public.ci_nba_game_refs"
      ) === "nba:0022600999,existing-pick-reference",
        "The existing linked game reference was detached or removed");
      assert(await databaseSnapshot() ===
        [counts[0]! + 1, counts[1]! + 3, 0].join(","),
        "Expected one existing game, three verified days and no active leases");

      // A scheduled refresh may run repeatedly while the app is unattended.
      // Replaying the same verified final must never duplicate the game,
      // detach a pick/wager reference, or accumulate sync rows or leases.
      const finalRow = await disposableSql(
        "SELECT id,state,away_score,home_score,source FROM public.games WHERE id='nba:0022600999'"
      );
      const linkedRow = await disposableSql(
        "SELECT game_id,note FROM public.ci_nba_game_refs"
      );
      const repeat = await fetch(workerUrl, {
        method: "POST", headers: { authorization: "Bearer " + cronSecret },
        signal: AbortSignal.timeout(20000),
      });
      const repeatResult = await repeat.json();
      assert(repeat.status === 200, "Repeated final-score refresh failed: " +
        JSON.stringify(repeatResult));
      assert(JSON.stringify(repeatResult) === JSON.stringify({
        checked: 3, updated: 1, skipped: 0, failed: 0, errors: [],
      }), "Repeated refresh returned unexpected counts: " + JSON.stringify(repeatResult));
      assert(await disposableSql(
        "SELECT id,state,away_score,home_score,source FROM public.games WHERE id='nba:0022600999'"
      ) === finalRow, "Repeated refresh changed the verified final");
      assert(await disposableSql(
        "SELECT game_id,note FROM public.ci_nba_game_refs"
      ) === linkedRow, "Repeated refresh changed the linked pick/wager reference");
      assert(await databaseSnapshot() ===
        [counts[0]! + 1, counts[1]! + 3, 0].join(","),
        "Repeated refresh duplicated game/sync rows or leaked leases");
      for (const [path, expected] of [
        ["/rpc/try_claim_nba_sync", 6], ["/games", 2],
        ["/rpc/commit_nba_sync_day", 6], ["/rpc/release_nba_sync", 6],
      ] as const) {
        assert(calls.filter(c => c.path === path).length === expected,
          "Unexpected repeated-refresh PostgREST calls to " + path);
      }
      assert(calls.filter(c => c.path === "/rpc/commit_nba_sync_day")
        .every(c => c.status === 200),
        "Repeated refresh must commit only with valid fenced leases");
    } finally {
      if (worker) await stopWorker(worker);
      await gateway.shutdown();
      // Clean only this disposable synthetic game, reference and three days.
      await disposableSql("DROP TABLE IF EXISTS public.ci_nba_game_refs");
      await disposableSql("DELETE FROM public.games WHERE id='nba:0022600999'");
      await disposableSql("DELETE FROM public.sync_state WHERE day::date BETWEEN " +
        "(now() AT TIME ZONE 'America/Los_Angeles')::date - 1 AND " +
        "(now() AT TIME ZONE 'America/Los_Angeles')::date + 1");
    }
    assert(await databaseSnapshot() === before,
      "Scheduled-to-final test did not restore the disposable database");
  },
});
