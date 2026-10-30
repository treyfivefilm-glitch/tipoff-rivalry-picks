// Exercises the actual deployed entrypoint, not only its imported handler.
// A child Deno process receives synthetic configuration and NO backend keys.
// It never reaches NBA feeds, PostgREST, Supabase or a production service.
const secret = "disposable-entrypoint-test-secret-at-least-32-characters";
const url = "http://127.0.0.1:8000/";

async function startEntrypoint(enabled: boolean) {
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "run", "--no-check",
      "--allow-net=0.0.0.0:8000,127.0.0.1:8000",
      "--allow-env=NBA_SYNC_WORKER_ENABLED,NBA_SYNC_CRON_SECRET,SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY",
      "supabase/functions/nba-sync-worker/index.ts",
    ],
    clearEnv: true,
    env: {
      HOME: Deno.env.get("HOME") ?? "/tmp",
      NBA_SYNC_WORKER_ENABLED: enabled ? "true" : "false",
      NBA_SYNC_CRON_SECRET: secret,
    },
    stdout: "null",
    stderr: "piped",
  }).spawn();
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(300) });
      if (response.status === 405 &&
          (await response.json() as { error?: string }).error === "POST required") {
        ready = true;
        break;
      }
    } catch {
      // The entrypoint may still be loading its dependencies.
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) {
    try { child.kill("SIGTERM"); } catch { /* process already exited */ }
    await child.status;
    const stderr = await new Response(child.stderr).text();
    throw new Error("Actual NBA worker entrypoint failed to start: " + stderr.slice(0, 2000));
  }
  return child;
}

async function stopEntrypoint(child: Deno.ChildProcess) {
  try { child.kill("SIGTERM"); } catch { /* process already exited */ }
  await child.status;
  await new Response(child.stderr).text();
}

Deno.test("Actual NBA Edge entrypoint is disabled by default and fails closed before backend access", async () => {
  const disabled = await startEntrypoint(false);
  try {
    const response = await fetch(url, {
      method: "POST", headers: { authorization: "Bearer " + secret },
    });
    if (response.status !== 503 ||
        (await response.json() as { error?: string }).error !== "Worker disabled") {
      throw new Error("Disabled entrypoint accepted a refresh request");
    }
    if (response.headers.get("cache-control") !== "no-store") {
      throw new Error("Disabled response must not be cached");
    }
  } finally {
    await stopEntrypoint(disabled);
  }

  const enabled = await startEntrypoint(true);
  try {
    const unauthorized = await fetch(url, {
      method: "POST", headers: { authorization: "Bearer incorrect" },
    });
    if (unauthorized.status !== 401 ||
        (await unauthorized.json() as { error?: string }).error !== "Unauthorized") {
      throw new Error("Entrypoint failed to reject unauthorized request");
    }
    const authorized = await fetch(url, {
      method: "POST", headers: { authorization: "Bearer " + secret },
    });
    const result = await authorized.json() as { error?: string };
    if (authorized.status !== 503 || result.error !== "Backend configuration missing") {
      throw new Error("Unexpected authorized-without-backend response: " +
        authorized.status + " " + JSON.stringify(result));
    }
  } finally {
    await stopEntrypoint(enabled);
  }
});
