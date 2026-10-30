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
    expect(upsert).toContain("WHERE current_game.source IN ('nba', 'nba_official_schedule')");
    expect(upsert).toContain("persisted.source IS DISTINCT FROM 'nba_official_schedule'");
    expect(upsert).toContain("public.nba_canonical_team_code(current_game.away_code)");
    expect(upsert).toContain("public.nba_canonical_team_code(EXCLUDED.away_code)");
    expect(upsert).toContain("public.nba_canonical_team_code(current_game.home_code)");
    expect(upsert).toContain("public.nba_canonical_team_code(EXCLUDED.home_code)");
  });

  it("refuses to move an existing game ID across Pacific days while certifying freshness", () => {
    // A lease for one day cannot authorize rewriting an existing game from
    // another day. This static guard supplements staging SQL execution.
    const upsert = migration.split("ON CONFLICT (id) DO UPDATE SET")[1]
      ?.split("INSERT INTO public.sync_state")[0];
    expect(upsert).toContain(
      "(current_game.start_utc AT TIME ZONE 'America/Los_Angeles')::date = p_day",
    );
    expect(upsert).toContain(
      "(persisted.start_utc AT TIME ZONE 'America/Los_Angeles')::date IS DISTINCT FROM p_day",
    );
    expect(migration).toContain("NBA game ID matchup or day collision");
  });

  it("fences stale live/final score regressions before certifying freshness", () => {
    // The initial worker read can be stale relative to a concurrent score
    // writer. Both the locked upsert and post-write collision check must
    // prevent a score rewind from marking the day fresh.
    const upsert = migration.split("ON CONFLICT (id) DO UPDATE SET")[1]
      ?.split("INSERT INTO public.sync_state")[0];
    expect(upsert).toContain("EXCLUDED.away_score < current_game.away_score");
    expect(upsert).toContain("EXCLUDED.home_score < current_game.home_score");
    expect(upsert).toContain("incoming.away_score < persisted.away_score");
    expect(upsert).toContain("incoming.home_score < persisted.home_score");
    expect(upsert).toContain("incoming.away_score IS NULL");
    expect(upsert).toContain("incoming.home_score IS NULL");
  });

  it("rejects canonical same-team aliases before any fenced write", () => {
    // The database must reject malformed RPC callers even if Edge validation
    // was bypassed. GS and GSW identify the same team despite distinct text.
    expect(migration).toContain(
      "public.nba_canonical_team_code(g.away_code) = public.nba_canonical_team_code(g.home_code)",
    );
    expect(migration).not.toContain("OR g.away_code = g.home_code");
  });

  it("requires all 30 real NBA teams for both sides at the database boundary", () => {
    // Static CI guard: SQL execution is still separately required in staging.
    const expected = [
      "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW",
      "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK",
      "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS",
    ];
    for (const side of ["away", "home"]) {
      const guard = migration.match(new RegExp(
        `public\\.nba_canonical_team_code\\(g\\.${side}_code\\) NOT IN \\(([\\s\\S]*?)\\)`,
      ));
      expect(guard, `${side} team-code SQL guard`).not.toBeNull();
      const actual = [...(guard?.[1] ?? "").matchAll(/'([A-Z]{2,3})'/g)].map(match => match[1]);
      expect(actual).toEqual(expected);
    }
  });

  it("raises on a collision before updating day freshness", () => {
    const guard = migration.indexOf("RAISE EXCEPTION 'NBA game ID matchup or day collision'");
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
