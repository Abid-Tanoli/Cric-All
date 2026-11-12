import { describe, it, expect } from "vitest";
import { getBowlerQuota, hasReachedBowlerQuota } from "../utils/bowlerQuota";

describe("Admin bowler quota display", () => {
  it("uses 4 overs for a 20-over T20 and 3 when the match overrides it", () => {
    expect(getBowlerQuota({ matchType: "T20", totalOvers: 20 })).toBe(4);
    expect(getBowlerQuota({ matchType: "T20", totalOvers: 20, maxBowlerOvers: 3 })).toBe(3);
  });

  it("falls back to ceil(overs / 5) when the format has no limit", () => {
    expect(getBowlerQuota({ matchType: "Tape Ball", totalOvers: 8 })).toBe(2);
  });

  it("marks a bowler who has bowled 24 balls as quota reached for 4 overs", () => {
    expect(hasReachedBowlerQuota({ balls: 23, overs: 3 }, 4)).toBe(false);
    expect(hasReachedBowlerQuota({ balls: 24, overs: 4 }, 4)).toBe(true);
    expect(hasReachedBowlerQuota({ overs: 4 }, 4)).toBe(true);
  });
});
