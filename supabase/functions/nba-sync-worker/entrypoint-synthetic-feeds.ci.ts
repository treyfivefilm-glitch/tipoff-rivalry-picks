// Disposable CI-only fixture. The production Edge entrypoint is imported unchanged.
// Synthetic official NBA feeds are supplied in-process; all other requests retain
// native fetch and are restricted to loopback by the child Deno permissions.
const nativeFetch = globalThis.fetch.bind(globalThis);
const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
}).formatToParts(new Date());
const part = (name: string) => parts.find(item => item.type === name)?.value;
const day = [part("year"), part("month"), part("day")].join("-");
if (!/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(day)) {
  throw new Error("Cannot determine fixture Pacific day");
}
const scheduled = {
  gameId: "0022600999", gameDateTimeUTC: day + "T19:00:00Z",
  gameStatus: 1, gameStatusText: "Scheduled",
  awayTeam: { teamTricode: "LAL", teamCity: "Los Angeles", teamName: "Lakers", score: null },
  homeTeam: { teamTricode: "GSW", teamCity: "Golden State", teamName: "Warriors", score: null },
};
const final = {
  ...scheduled, gameStatus: 3, gameStatusText: "Final",
  awayTeam: { ...scheduled.awayTeam, score: 109 },
  homeTeam: { ...scheduled.homeTeam, score: 107 },
};
const response = (payload: unknown) => Promise.resolve(new Response(JSON.stringify(payload), {
  status: 200, headers: { "content-type": "application/json" },
}));
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.endsWith("/staticData/scheduleLeagueV2.json")) {
    return response({ leagueSchedule: { gameDates: [{ gameDate: day, games: [scheduled] }] } });
  }
  if (url.endsWith("/liveData/scoreboard/todaysScoreboard_00.json")) {
    return response({ scoreboard: { gameDate: day, games: [final] } });
  }
  return nativeFetch(input, init);
}) as typeof fetch;
await import("./index.ts");
