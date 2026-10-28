// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static safety checks run in CI even when the disposable staging DB is absent.
// These do NOT replace the rollback-only SQL integration tests.
const migration = readFileSync(
  new URL("../../drizzle/migrations/0014_fenced_nba_sync_commit.sql", import.meta.url),
  "utf8",
);

describe("unapplied fenced NBA commit migration safety contract", () => {
  it("uses valid PostgreSQL dollar-quoted bodies for both functions", () => {
    // A lone $ is not a valid PostgreSQL dollar-quote delimiter.
    // This caught a syntax error that static security-contract tests missed.
    expect(migration).not.toMatch(/\bAS \$\r?\n/);
    expect(migration).not.toMatch(/\r?\n\$;\r?\n/);
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.nba_canonical_team_code\([\s\S]*?AS \$\$[\s\S]*?\$\$;/,
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.commit_nba_sync_day\([\s\S]*?AS \$\$[\s\S]*?\$\$;/,
    );
  });

  it("guards conflicting game IDs while holding the upsert row lock", () => {
    const upsert = migration.split("ON CONFLICT (id) DO UPDATE SET")[1]
      ?.split("INSERT INTO public.sync_state")[0];
    expect(upsert).toBeDefined();
    expect(upsert).toContain("WHERE current_game.source = 'nba'");
    expect(upsert).toContain("public.nba_canonical_team_code(current_game.away_code)");
    expect(upsert).toContain("public.nba_canonical_team_code(EXCLUDED.away_code)");
    expect(upsert).toContain("public.nba_canonical_team_code(current_game.home_code)");
    expect(upsert).toContain("public.nba_canonical_team_code(EXCLUDED.home_code)");
  });

  it("rejects canonical same-team aliases before any fenced write", () => {
    // The database must reject malformed RPC callers even if Edge validation
    // was bypassed. GS and GSW identify the same team despite distinct text.
    expect(migration).toContain(
      "public.nba_canonical_team_code(g.away_code) = public.nba_canonical_team_code(g.home_code)",
    );
    expect(migration).not.toContain("OR g.away_code = g.home_code");
  });

  it("raises on a collision before updating day freshness", () => {
    const guard = migration.indexOf("RAISE EXCEPTION 'NBA game ID matchup collision'");
    const freshness = migration.indexOf("INSERT INTO public.sync_state");
    expect(guard).toBeGreaterThan(0);
    expect(freshness).toBeGreaterThan(guard);
    expect(migration).toContain("persisted.source IS DISTINCT FROM 'nba'");
  });

  it("keeps historical NBA team aliases consistent and helper private", () => {
    for (const [short, canonical] of [
      ["NY", "NYK"], ["SA", "SAS"], ["GS", "GSW"],
      ["NO", "NOP"], ["UTAH", "UTA"], ["WSH", "WAS"],
    ]) {
      expect(migration).toContain(`WHEN '${short}' THEN '${canonical}'`);
    }
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.nba_canonical_team_code(text)",
    );
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.nba_canonical_team_code(text)");
  });
});
