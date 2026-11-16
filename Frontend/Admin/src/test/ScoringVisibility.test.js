import { describe, expect, it } from "vitest";
import { describeBall, getScoringVisibility } from "../utils/scoringVisibility";

describe("getScoringVisibility", () => {
  it("hides analysis controls when AI commentary is off", () => {
    expect(getScoringVisibility(false)).toEqual({
      aiEnabled: false,
      showPitchMap: false,
      showGround: false,
      showShotTypePicker: false,
      showBallMovement: false,
      showNormalBallFielder: false,
      showAdvancedAnalysis: false,
      showBasicCommentary: true,
    });
  });

  it("shows analysis controls and hides basic fallback when AI commentary is on", () => {
    const visibility = getScoringVisibility(true);

    expect(visibility.aiEnabled).toBe(true);
    expect(visibility.showPitchMap).toBe(true);
    expect(visibility.showGround).toBe(true);
    expect(visibility.showShotTypePicker).toBe(true);
    expect(visibility.showBallMovement).toBe(true);
    expect(visibility.showNormalBallFielder).toBe(true);
    expect(visibility.showAdvancedAnalysis).toBe(true);
    expect(visibility.showBasicCommentary).toBe(false);
  });
});

describe("describeBall", () => {
  it("falls back to plain result commentary", () => {
    expect(describeBall({ runs: 1 })).toBe("1 run");
    expect(describeBall({ runs: 4 })).toBe("FOUR");
    expect(describeBall({ runs: 6 })).toBe("SIX");
    expect(describeBall({ isWide: true })).toBe("Wide");
    expect(describeBall({ isWicket: true, wicketType: "bowled" })).toBe(
      "OUT, bowled"
    );
  });
});
