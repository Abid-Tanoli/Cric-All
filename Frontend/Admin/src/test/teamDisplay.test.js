import { describe, it, expect } from "vitest";
import { teamInitials, teamShortName, formatMatchTime } from "../utils/teamDisplay";

describe("admin team display helpers", () => {
  it("prefers the stored short name", () => {
    expect(teamShortName({ name: "Young Star", shortName: "YS" })).toBe("YS");
  });

  it("falls back to the initials of every word", () => {
    expect(teamInitials("Young Star")).toBe("YS");
    expect(teamShortName({ name: "Young Star" })).toBe("YS");
    expect(teamShortName({ name: "  Sky   Sports  " })).toBe("SS");
    expect(teamShortName({ name: "" })).toBe("T");
  });

  it("formats match times in Pakistan time with a PKT label", () => {
    expect(formatMatchTime("2026-11-01T05:30:00.000Z")).toBe("10:30 AM PKT");
  });
});
