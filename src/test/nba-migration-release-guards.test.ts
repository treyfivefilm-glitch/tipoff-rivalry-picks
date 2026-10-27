// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// These are non-destructive release gates, NOT a substitute for staging SQL tests.
const migration = (name: string) =>
  readFileSync(new URL(`../../drizzle/migrations/${name}`, import.meta.url), "utf8");

describe("NBA unattended database migration release guards", () => {
  const lease = migration("0013_nba_sync_leases.sql");
  const fenced = migration("0014_fenced_nba_sync_commit.sql");

  it("restricts lease ownership RPCs and lease table to the server role", () => {
    expect(lease).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(lease).toMatch(/REVOKE ALL ON TABLE public\.nba_sync_leases FROM PUBLIC, anon, authenticated/i);
    for (const signature of [
      "try_claim_nba_sync\\(date, uuid, integer\\)",
      "release_nba_sync\\(date, uuid\\)",
    ]) {
      expect(lease).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature}\\s+FROM PUBLIC, anon, authenticated`, "i"));
      expect(lease).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature}\\s+TO service_role`, "i"));
    }
  });

  it("fences writes under a locked, unexpired lease and restricts the commit RPC", () => {
    expect(fenced).toMatch(/SELECT owner_token INTO v_lease_owner[\s\S]*?expires_at > clock_timestamp\(\)[\s\S]*?FOR UPDATE/i);
    expect(fenced).toMatch(/IF v_lease_owner IS NULL THEN[\s\S]*?RAISE EXCEPTION/i);
    expect(fenced).toMatch(/REVOKE ALL ON FUNCTION public\.commit_nba_sync_day\(date, uuid, jsonb\)\s+FROM PUBLIC, anon, authenticated/i);
    expect(fenced).toMatch(/GRANT EXECUTE ON FUNCTION public\.commit_nba_sync_day\(date, uuid, jsonb\)\s+TO service_role/i);
  });

  it("writes games and day freshness in the same database function", () => {
    expect(fenced).toMatch(/INSERT INTO public\.games/i);
    expect(fenced).toMatch(/INSERT INTO public\.sync_state/i);
    expect(fenced).toMatch(/current_game\.state = 'final' AND EXCLUDED\.state <> 'final'/i);
    expect(fenced).toMatch(/current_game\.state = 'live' AND EXCLUDED\.state = 'scheduled'/i);
  });
});
