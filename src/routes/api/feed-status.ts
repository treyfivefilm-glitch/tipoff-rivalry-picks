import { createFileRoute } from "@tanstack/react-router";

// Read-only operational health check for the official public NBA scoreboard.
// No credentials, user data, or private records are exposed.
export const Route = createFileRoute("/api/feed-status")({
  server: {
    handlers: {
      GET: async () => {
        const headers = { "content-type": "application/json", "cache-control": "public, s-maxage=30, max-age=0" };
        try {
          const source = await fetch(
            "https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA/liveData/scoreboard/todaysScoreboard_00.json",
            { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10000) },
          );
          if (!source.ok) throw new Error(`Upstream HTTP ${source.status}`);
          const raw: unknown = await source.json();
          const data = raw as { meta?: { time?: string }; scoreboard?: {
            gameDate?: string; games?: Array<{ gameStatus?: number; gameId?: string }>
          } };
          const games = data.scoreboard?.games;
          if (!data.scoreboard?.gameDate || !Array.isArray(games)) {
            throw new Error("NBA provider returned incomplete scoreboard data");
          }
          return new Response(JSON.stringify({
            ok: true,
            provider: "NBA official live data",
            date: data.scoreboard.gameDate,
            games: games.length,
            live: games.filter(g => g.gameStatus === 2).length,
            final: games.filter(g => g.gameStatus === 3).length,
            sourceTimestamp: data.meta?.time ?? null,
          }), { status: 200, headers });
        } catch (error) {
          return new Response(JSON.stringify({
            ok: false,
            provider: "NBA official live data",
            error: error instanceof Error ? error.message : "Provider unavailable",
          }), { status: 503, headers: { ...headers, "cache-control": "no-store" } });
        }
      },
    },
  },
});
