import { describe, it, expect } from "vitest";
import {
  normalizeStatus,
  matchBucket,
  groupMatches,
  teamNamesOf,
  matchLabel,
  filterMatches,
  distinctGroups,
  distinctTeams,
} from "../pages/tournament/matchUtils";

// ---------------------------------------------------------------------------
// The Fixtures tab's grouping/filtering is all pure logic; pin it down here so
// the tab itself can stay a thin render layer.
// ---------------------------------------------------------------------------

const alpha = { _id: "team-a", name: "Alpha CC", shortName: "ALP" };
const beta = { _id: "team-b", name: "Beta CC", shortName: "BET" };
const gamma = { _id: "team-c", name: "Gamma CC", shortName: "GAM" };

const matches = [
  { _id: "m1", status: "live", teams: [alpha, beta], venue: "Oval", group: "Group A", matchNumber: 1 },
  { _id: "m2", status: "innings-break", teams: [beta, gamma], venue: "Lord's", group: "Group B", matchNumber: 2 },
  { _id: "m3", status: "completed", teams: [alpha, gamma], venue: "Oval", group: "Group A", matchNumber: 3, result: { description: "Alpha won" } },
  { _id: "m4", status: "abandoned", teams: [alpha, beta], venue: "Edgbaston", matchNumber: 4 },
  { _id: "m5", status: "scheduled", teams: [beta, gamma], venue: "Headingley", matchNumber: 5 },
  { _id: "m6", teams: [gamma, alpha], title: "Final" },
];

describe("tournament matchUtils", () => {
  it("normalises the legacy innings-break spelling", () => {
    expect(normalizeStatus("innings-break")).toBe("innings_break");
    expect(normalizeStatus("live")).toBe("live");
    expect(normalizeStatus(undefined)).toBeUndefined();
  });

  it("buckets every status into live / completed / upcoming", () => {
    expect(matchBucket("live")).toBe("live");
    expect(matchBucket("innings-break")).toBe("live");
    expect(matchBucket("toss_done")).toBe("live");
    expect(matchBucket("completed")).toBe("completed");
    expect(matchBucket("abandoned")).toBe("completed");
    expect(matchBucket("scheduled")).toBe("upcoming");
    expect(matchBucket(undefined)).toBe("upcoming");
  });

  it("groups matches and preserves the input order inside each bucket", () => {
    const grouped = groupMatches(matches);
    expect(grouped.live.map((m) => m._id)).toEqual(["m1", "m2"]);
    expect(grouped.completed.map((m) => m._id)).toEqual(["m3", "m4"]);
    expect(grouped.upcoming.map((m) => m._id)).toEqual(["m5", "m6"]);
  });

  it("renders readable team names and a vs label", () => {
    expect(teamNamesOf(matches[0])).toEqual(["ALP", "BET"]);
    expect(matchLabel(matches[0])).toBe("ALP vs BET");
    // Prefers shortName, then falls back through title / first name / generic.
    expect(matchLabel({ teams: [gamma] })).toBe("GAM");
    expect(matchLabel({ title: "Final" })).toBe("Final");
    expect(matchLabel({})).toBe("Match");
  });

  it("filters by text, team, status and group", () => {
    expect(filterMatches(matches, { q: "headingley" }).map((m) => m._id)).toEqual(["m5"]);
    expect(filterMatches(matches, { q: "match 3" }).map((m) => m._id)).toEqual(["m3"]);
    expect(filterMatches(matches, { teamId: "team-a" }).map((m) => m._id)).toEqual(["m1", "m3", "m4", "m6"]);
    expect(filterMatches(matches, { status: "live" }).map((m) => m._id)).toEqual(["m1", "m2"]);
    expect(filterMatches(matches, { status: "completed" }).map((m) => m._id)).toEqual(["m3", "m4"]);
    expect(filterMatches(matches, { group: "Group A" }).map((m) => m._id)).toEqual(["m1", "m3"]);
    // No filters is a straight copy.
    expect(filterMatches(matches)).toHaveLength(matches.length);
  });

  it("lists distinct groups and teams in a stable, sorted order", () => {
    expect(distinctGroups(matches)).toEqual(["Group A", "Group B"]);
    expect(distinctTeams(matches).map((t) => t._id)).toEqual(["team-a", "team-b", "team-c"]);
    // A non-populated team reference never crashes the dropdown builder.
    expect(distinctTeams([{ teams: ["raw-id", null, alpha] }]).map((t) => t._id)).toEqual(["team-a"]);
  });
});
