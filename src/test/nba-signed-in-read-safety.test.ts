// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assertCompleteNbaGamePage } from "../../supabase/functions/_shared/nba-game-page";

const page = (status: number, range?: string) => ({
  status,
  headers: new Headers(range === undefined ? {} : { "content-range": range }),
});
const games = [{ id: "nba:0022600001" }, { id: "nba:0022600002" }];

describe("signed-in NBA PostgREST game history completeness", () => {
  it("accepts exact complete game pages and verified empty reads", () => {
    expect(() => assertCompleteNbaGamePage(page(200, "0-1/2"), games)).not.toThrow();
    expect(() => assertCompleteNbaGamePage(page(200, "*/0"), [])).not.toThrow();
  });

  it("rejects truncated HTTP 206 pages even when the total looks exact", () => {
    expect(() => assertCompleteNbaGamePage(page(206, "0-1/2"), games))
      .toThrow("incomplete");
  });

  it("rejects HTTP 200 pages when the reported total exceeds returned rows", () => {
    expect(() => assertCompleteNbaGamePage(page(200, "0-1/5"), games))
      .toThrow("incomplete");
  });

  it("rejects missing, unknown and inconsistent range metadata", () => {
    for (const range of [undefined, "0-1/*", "1-2/2", "0-0/2", "0-2/2", "bytes 0-1/2"]) {
      expect(() => assertCompleteNbaGamePage(page(200, range), games))
        .toThrow("incomplete");
    }
    expect(() => assertCompleteNbaGamePage(page(200), [])).toThrow("incomplete");
    expect(() => assertCompleteNbaGamePage(page(200, "*/0"), games)).toThrow("incomplete");
  });

  it("rejects a full configured page and malformed response data", () => {
    expect(() => assertCompleteNbaGamePage(page(200, "0-1/2"), games, 2))
      .toThrow("incomplete");
    expect(() => assertCompleteNbaGamePage(page(200, "0-0/1"), { id: "nba:0022600001" }))
      .toThrow("incomplete");
  });
});
