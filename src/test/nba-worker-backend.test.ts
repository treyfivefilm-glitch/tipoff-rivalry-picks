// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createNbaWorkerBackend } from "../../supabase/functions/_shared/nba-worker-backend";

const endpoint = "https://example.invalid";
const key = "test-only-service-role-placeholder";
const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
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
});
