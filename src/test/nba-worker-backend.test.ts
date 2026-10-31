// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createNbaWorkerBackend } from "../../supabase/functions/_shared/nba-worker-backend";

const endpoint = "https://example.invalid";
const key = "test-only-service-role-placeholder";
const validStoredGame = {
  id: "nba:0022600012", start_utc: "2026-11-18T03:00:00+00:00",
  away_code: "LAL", home_code: "GSW", away_score: 0, home_score: 101,
  state: "final", status_detail: "Final", source: "nba",
};
const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status, headers: {
      "content-type": "application/json",
      ...(Array.isArray(value) ? {
        "content-range": value.length ? `0-${value.length - 1}/${value.length}` : "*/0",
      } : {}),
    },
  });
const mockFetch = (handler: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch =>
  handler as unknown as typeof fetch;

describe("unattended NBA backend HTTP boundary (no network or database)", () => {
  it("uses bounded POST RPC requests with protected server credentials", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const backend = createNbaWorkerBackend(endpoint, key, mockFetch(async (url, init) => {
      calls.push({ url, init });
      return reply(true);
    }), 100);
    expect(await backend.rpc<boolean>("try_claim_nba_sync", { p_day: "2026-11-17" })).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(endpoint + "/rest/v1/rpc/try_claim_nba_sync");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe('{"p_day":"2026-11-17"}');
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.init?.headers).toMatchObject({
      apikey: key, Authorization: "Bearer " + key, "content-type": "application/json",
    });
  });

  it("uses the secret-key header form without adding an unnecessary bearer", async () => {
    const fetcher = mockFetch(async (_url, init) => {
      expect(init?.headers).toEqual({
        apikey: "sb_secret_test-only-placeholder", "content-type": "application/json",
      });
      return reply(0);
    });
    const backend = createNbaWorkerBackend(endpoint, "sb_secret_test-only-placeholder", fetcher);
    expect(await backend.rpc<number>("commit_nba_sync_day", { p_rows: [] })).toBe(0);
  });

  it("queries padded Pacific-day bounds and rejects malformed HTTP 200 game lists", async () => {
    const calls: string[] = [];
    const fetcher = mockFetch(async url => {
      calls.push(url);
      return reply({ error: "not a games array" });
    });
    const backend = createNbaWorkerBackend(endpoint, key, fetcher);
    await expect(backend.readExisting(["2026-11-17", "2026-11-18"]))
      .rejects.toThrow("malformed games");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("start_utc=gte.2026-11-15T00:00:00Z");
    expect(calls[0]).toContain("start_utc=lt.2026-11-20T00:00:00Z");
    expect(calls[0]).toContain("limit=3000");
  });

  it("rejects HTTP 206 partial game history even when its JSON array is valid", async () => {
    const backend = createNbaWorkerBackend(endpoint, key, mockFetch(async () =>
      reply([{ id: "nba:0022600012" }], 206)));
    await expect(backend.readExisting(["2026-11-17"]))
      .rejects.toThrow("incomplete games");
  });

  it("fails closed on an ambiguous full 3000-row history page", async () => {
    const backend = createNbaWorkerBackend(endpoint, key, mockFetch(async () =>
      reply(Array.from({ length: 3000 }, () => ({ id: "nba:0022600012" })))));
    await expect(backend.readExisting(["2026-11-17"]))
      .rejects.toThrow("incomplete games");
  });


  it("requests exact history counts and rejects a silent HTTP 200 PostgREST cap", async () => {
    let prefer: string | undefined;
    const backend = createNbaWorkerBackend(endpoint, key, mockFetch(async (_url, init) => {
      prefer = (init?.headers as Record<string, string>)?.["Prefer"];
      // The backend's configured max_rows can be 1000 even when limit=3000.
      return new Response(JSON.stringify(Array.from({ length: 1000 }, () => validStoredGame)), {
        status: 200, headers: { "content-range": "0-999/1250" },
      });
    }));
    await expect(backend.readExisting(["2026-11-17"]))
      .rejects.toThrow("incomplete games");
    expect(prefer).toBe("count=exact");
  });

  it("rejects an ambiguous HTTP 200 default-cap page without a reliable total", async () => {
    for (const contentRange of [null, "0-999/*"]) {
      const backend = createNbaWorkerBackend(endpoint, key, mockFetch(async () =>
        new Response(JSON.stringify(Array.from({ length: 1000 }, () => validStoredGame)), {
          status: 200,
          headers: contentRange ? { "content-range": contentRange } : {},
        })));
      await expect(backend.readExisting(["2026-11-17"]))
        .rejects.toThrow("incomplete games");
    }
  });

  it("validates Content-Range against the returned history array", async () => {
    for (const contentRange of ["0-1/3", "1-2/2", "0-2/2", "0-1/*", "not-a-range"]) {
      const backend = createNbaWorkerBackend(endpoint, key, mockFetch(async () =>
        new Response(JSON.stringify([validStoredGame, validStoredGame]), {
          status: 200, headers: { "content-range": contentRange },
        })));
      await expect(backend.readExisting(["2026-11-17"]))
        .rejects.toThrow("incomplete games");
    }
  });

  it("rejects missing exact counts on even small or empty HTTP 200 history", async () => {
    for (const rows of [[], [validStoredGame]]) {
      const backend = createNbaWorkerBackend(endpoint, key, mockFetch(async () =>
        new Response(JSON.stringify(rows), { status: 200 })));
      await expect(backend.readExisting(["2026-11-17"]))
        .rejects.toThrow("incomplete games");
    }
  });

  it("rejects impossible stored calendar days instead of silently rolling them into another month", async () => {
    // JavaScript Date.parse accepts 2026-02-30 as March 2. A malformed
    // stored tipoff must never be used to certify unattended score freshness.
    for (const timestamp of [
      "2026-02-30T03:00:00Z",
      "2026-02-29T03:00:00+00:00",
      "2026-11-31T03:00:00Z",
      "2026-00-18T03:00:00Z",
    ]) {
      const backend = createNbaWorkerBackend(endpoint, key, mockFetch(async () =>
        reply([{ ...validStoredGame, start_utc: timestamp }])));
      await expect(backend.readExisting(["2026-11-17"]))
        .rejects.toThrow("malformed games");
    }
    // Leap days and offset-aware timestamps from PostgreSQL remain valid.
    const validLeap = { ...validStoredGame, start_utc: "2028-02-29T03:00:00+00:00" };
    const backend = createNbaWorkerBackend(endpoint, key, mockFetch(async () => reply([validLeap])));
    expect(await backend.readExisting(["2028-02-29"])).toEqual([validLeap]);
  });

  it("accepts complete PostgREST history ranges including an empty result", async () => {
    const complete = createNbaWorkerBackend(endpoint, key, mockFetch(async () =>
      new Response(JSON.stringify([validStoredGame]), {
        status: 200, headers: { "content-range": "0-0/1" },
      })));
    expect(await complete.readExisting(["2026-11-17"])).toEqual([validStoredGame]);
    const empty = createNbaWorkerBackend(endpoint, key, mockFetch(async () =>
      new Response("[]", { status: 200, headers: { "content-range": "*/0" } })));
    expect(await empty.readExisting(["2026-11-17"])).toEqual([]);
  });

  it("rejects malformed rows inside an HTTP 200 history array before reconciliation", async () => {
    const invalidRows = [
      null, {}, { ...validStoredGame, id: null },
      { ...validStoredGame, start_utc: "not-a-timestamp" },
      { ...validStoredGame, away_code: null },
      { ...validStoredGame, home_code: "" },
      { ...validStoredGame, away_score: "101" },
      { ...validStoredGame, home_score: -1 },
      { ...validStoredGame, state: null },
      { ...validStoredGame, state: "unknown" },
      { ...validStoredGame, state: "" },
      { ...validStoredGame, away_score: null },
      { ...validStoredGame, home_score: null },
      { ...validStoredGame, home_score: 0 },
      { ...validStoredGame, status_detail: {} },
      { ...validStoredGame, source: 42 },
    ];
    for (const bad of invalidRows) {
      const backend = createNbaWorkerBackend(endpoint, key, mockFetch(async () =>
        reply([validStoredGame, bad])));
      await expect(backend.readExisting(["2026-11-17"]))
        .rejects.toThrow("malformed games");
    }
  });

  it("accepts complete history rows with nullable scores, source and status", async () => {
    const rows = [
      validStoredGame,
      { ...validStoredGame, id: "nba:0022600013", source: null,
        away_score: null, home_score: null, state: "scheduled", status_detail: null },
    ];
    const backend = createNbaWorkerBackend(endpoint, key, mockFetch(async () => reply(rows)));
    expect(await backend.readExisting(["2026-11-17"])).toEqual(rows);
  });

  it("keeps valid cross-sport final ties and unscored NBA postponements readable", async () => {
    const rows = [
      { ...validStoredGame, id: "nfl:tie-game", source: "espn",
        away_score: 17, home_score: 17, state: "final" },
      { ...validStoredGame, id: "nba:0022600014",
        away_score: null, home_score: null, state: "postponed" },
    ];
    const backend = createNbaWorkerBackend(endpoint, key, mockFetch(async () => reply(rows)));
    expect(await backend.readExisting(["2026-11-17"])).toEqual(rows);
  });

  it("returns a valid empty game list without inventing prior games", async () => {
    const backend = createNbaWorkerBackend(endpoint, key, mockFetch(async () => reply([])));
    expect(await backend.readExisting(["2026-11-17"])).toEqual([]);
  });

  it("rejects backend HTTP errors without leaking the credential", async () => {
    const backend = createNbaWorkerBackend(endpoint, key, mockFetch(async () => reply({}, 503)));
    await expect(backend.rpc("try_claim_nba_sync", {}))
      .rejects.toThrow("NBA sync RPC try_claim_nba_sync failed (HTTP 503)");
    await expect(backend.readExisting(["2026-11-17"]))
      .rejects.toThrow("NBA sync database read failed (HTTP 503)");
  });

  it("times out a stalled backend read rather than holding a lease indefinitely", async () => {
    const fetcher = mockFetch((_url, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return reject(new Error("Missing backend timeout"));
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const backend = createNbaWorkerBackend(endpoint, key, fetcher, 40);
    await expect(backend.readExisting(["2026-11-17"])).rejects.toThrow();
  });

  it("rejects invalid JSON on an otherwise successful backend response", async () => {
    const backend = createNbaWorkerBackend(endpoint, key, mockFetch(async () =>
      new Response("{broken", { status: 200 })));
    await expect(backend.rpc("commit_nba_sync_day", {})).rejects.toThrow();
    await expect(backend.readExisting(["2026-11-17"])).rejects.toThrow();
  });

  it("rejects malformed HTTP 200 lease replies rather than claiming ownership", async () => {
    for (const value of [null, {}, "true", 1]) {
      const backend = createNbaWorkerBackend(endpoint, key, mockFetch(async () => reply(value)));
      await expect(backend.rpc<boolean>("try_claim_nba_sync", { p_day: "2026-11-17" }))
        .rejects.toThrow("try_claim_nba_sync returned malformed result");
    }
    const backend = createNbaWorkerBackend(endpoint, key, mockFetch(async () => reply(false)));
    expect(await backend.rpc<boolean>("try_claim_nba_sync", {})).toBe(false);
  });

  it("rejects malformed HTTP 200 commit counts rather than reporting success", async () => {
    for (const value of [null, {}, "2", -1, 0.5, 41, Number.MAX_SAFE_INTEGER + 1]) {
      const backend = createNbaWorkerBackend(endpoint, key, mockFetch(async () => reply(value)));
      await expect(backend.rpc<number>("commit_nba_sync_day", { p_rows: [] }))
        .rejects.toThrow("commit_nba_sync_day returned malformed result");
    }
    const backend = createNbaWorkerBackend(endpoint, key, mockFetch(async () => reply(0)));
    expect(await backend.rpc<number>("commit_nba_sync_day", { p_rows: [] })).toBe(0);
  });

  it("rejects malformed lease release replies without exposing backend credentials", async () => {
    const backend = createNbaWorkerBackend(endpoint, key, mockFetch(async () => reply({ released: true })));
    await expect(backend.rpc<boolean>("release_nba_sync", {}))
      .rejects.toThrow("release_nba_sync returned malformed result");
  });

  it("rejects unapproved privileged RPC names before making any HTTP request", async () => {
    let calls = 0;
    const backend = createNbaWorkerBackend(endpoint, key, mockFetch(async () => {
      calls++;
      return reply(true);
    }));
    await expect(backend.rpc<boolean>("unexpected_admin_rpc", {}))
      .rejects.toThrow("Unexpected NBA sync RPC");
    expect(calls).toBe(0);
  });
});
