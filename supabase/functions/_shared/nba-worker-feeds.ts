// Isolated, testable NBA feed boundary for the disabled unattended worker.
// Fetches are independent: one provider outage must not discard valid data
// from the other, but degraded runs must remain visible to monitoring.
import { isValidNbaScoreboard } from "./nba-feed-validation.ts";
import { verifiedUnattendedNbaSchedule } from "./nba-unattended.ts";

const BASE = "https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA";
const SCHEDULE = BASE + "/staticData/scheduleLeagueV2.json";
const LIVE = BASE + "/liveData/scoreboard/todaysScoreboard_00.json";

async function fetchJson(url: string, request: typeof fetch, timeoutMs: number): Promise<unknown> {
  const response = await request(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "application/json" },
  });
  // HTTP 206 can contain valid JSON while omitting games. A partial feed
  // must not certify an otherwise empty day or settle an incomplete final.
  if (response.status !== 200) throw new Error("NBA feed unavailable");
  return await response.json();
}

export async function loadUnattendedNbaFeeds(
  request: typeof fetch = fetch,
  timeoutMs = 11000,
): Promise<{ schedule: unknown | null; live: unknown | null; errors: string[] }> {
  const [scheduleResult, liveResult] = await Promise.allSettled([
    fetchJson(SCHEDULE, request, timeoutMs),
    fetchJson(LIVE, request, timeoutMs),
  ]);
  const schedule = scheduleResult.status === "fulfilled" &&
    verifiedUnattendedNbaSchedule(scheduleResult.value) ? scheduleResult.value : null;
  const live = liveResult.status === "fulfilled" &&
    isValidNbaScoreboard(liveResult.value) ? liveResult.value : null;
  const errors: string[] = [];
  if (!schedule) errors.push("Season schedule unavailable");
  if (!live) errors.push("Live scoreboard unavailable");
  return { schedule, live, errors };
}
