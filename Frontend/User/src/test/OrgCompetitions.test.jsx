import { describe, it, expect } from "vitest";
import {
  buildSeriesPayload,
  buildTournamentPayload,
  competitionErrorMessage,
  groupFixtures,
  minTeamsForType,
  uniqueIds,
  validateSeriesForm,
  validateTournamentForm,
} from "../lib/orgCompetitions";

// ---------------------------------------------------------------------------
// The org competition forms and the management screen share these helpers, so
// pinning the server's rules down here keeps the create, edit and tests honest.
// ---------------------------------------------------------------------------

const teams = ["team-a", "team-b", "team-c", "team-d"];

const validTournament = {
  name: "Summer League",
  type: "league",
  format: "T20",
  startDate: "2026-06-01",
  endDate: "2026-06-30",
  teams: teams.slice(0, 3),
  twelfthManEnabled: true,
};

describe("orgCompetitions validation", () => {
  it("accepts a complete league tournament", () => {
    expect(validateTournamentForm(validTournament)).toMatchObject({ ok: true, message: "" });
  });

  it("requires a name and both dates", () => {
    const result = validateTournamentForm({ ...validTournament, name: " ", startDate: "", endDate: "" });
    expect(result.ok).toBe(false);
    expect(result.errors.name).toMatch(/name is required/i);
    expect(result.errors.startDate).toMatch(/start date is required/i);
    expect(result.errors.endDate).toMatch(/end date is required/i);
  });

  it("rejects an end date before the start date", () => {
    const result = validateTournamentForm({ ...validTournament, endDate: "2026-05-01" });
    expect(result.ok).toBe(false);
    expect(result.errors.endDate).toMatch(/cannot be before/i);
  });

  it("enforces the server's minimum team count per type", () => {
    expect(minTeamsForType("league")).toBe(3);
    expect(minTeamsForType("knockout")).toBe(2);
    expect(minTeamsForType("group-stage")).toBe(4);
    expect(minTeamsForType("mixed")).toBe(4);

    const league = validateTournamentForm({ ...validTournament, teams: teams.slice(0, 2) });
    expect(league.errors.teams).toMatch(/league needs at least 3 teams/i);

    const knockout = validateTournamentForm({
      ...validTournament,
      type: "knockout",
      teams: teams.slice(0, 2),
    });
    expect(knockout.ok).toBe(true);
  });

  it("validates series names and date ordering", () => {
    expect(validateSeriesForm({ name: "Ashes", startDate: "2026-01-01", endDate: "2026-02-01" })).toMatchObject({
      ok: true,
    });
    expect(validateSeriesForm({ name: "" }).errors.name).toMatch(/name is required/i);
    expect(
      validateSeriesForm({ name: "Ashes", startDate: "2026-02-01", endDate: "2026-01-01" }).errors.endDate
    ).toMatch(/cannot be before/i);
  });
});

describe("orgCompetitions payloads", () => {
  it("builds the tournament body the server reads", () => {
    const payload = buildTournamentPayload({
      ...validTournament,
      name: "  Summer League  ",
      shortName: "",
      teams: ["team-a", "team-a", "team-b", "team-c"],
    });

    expect(payload.name).toBe("Summer League");
    expect(payload.shortName).toBe("SUMMER LEA");
    expect(payload.type).toBe("league");
    expect(payload.format).toBe("T20");
    expect(payload.venue).toBe("");
    expect(payload.teams).toEqual(["team-a", "team-b", "team-c"]);
    expect(payload.rules).toEqual({ twelfthManEnabled: true });
    expect(payload.startDate).toBe("2026-06-01T00:00:00.000Z");
    expect(payload.endDate).toBe("2026-06-30T00:00:00.000Z");
  });

  it("keeps an explicit short name and defaults the format", () => {
    const payload = buildTournamentPayload({ ...validTournament, shortName: "SL26", format: "" });
    expect(payload.shortName).toBe("SL26");
    expect(payload.format).toBe("T20");
  });

  it("builds the series body and normalises optional fields", () => {
    const payload = buildSeriesPayload({
      name: "  Ashes  ",
      matchType: "",
      status: "",
      startDate: "",
      endDate: "",
      venue: "  Lord's ",
      description: "  Three Tests ",
      teams: ["team-a", "team-a", "team-b"],
    });

    expect(payload).toMatchObject({
      name: "Ashes",
      shortName: "",
      matchType: "T20",
      status: "upcoming",
      startDate: undefined,
      endDate: undefined,
      venue: "Lord's",
      description: "Three Tests",
    });
    expect(payload.teams).toEqual(["team-a", "team-b"]);
  });

  it("deduplicates ids that arrive as populated documents", () => {
    expect(uniqueIds([{ _id: "a" }, "a", { _id: "b" }, null])).toEqual(["a", "b"]);
  });
});

describe("orgCompetitions errors and fixtures", () => {
  it("turns permission and tenant answers into readable sentences", () => {
    expect(competitionErrorMessage({ response: { status: 403 } })).toMatch(/do not have permission/i);
    expect(competitionErrorMessage({ response: { status: 404 } })).toMatch(/not found in this organization/i);
    expect(competitionErrorMessage({ message: "Server said no" }, "Fallback")).toBe("Server said no");
    expect(competitionErrorMessage({}, "Fallback")).toBe("Fallback");
  });

  it("groups fixtures by group then round and keeps insertion order inside each group", () => {
    const grouped = groupFixtures([
      { _id: "m3", group: "B", round: 1 },
      { _id: "m1", group: "A", round: 2 },
      { _id: "m2", group: "A", round: 1 },
      { _id: "m4" },
    ]);

    expect(grouped.map((entry) => [entry.group, entry.round, entry.matches.map((m) => m._id)])).toEqual([
      ["", 1, ["m4"]],
      ["A", 1, ["m2"]],
      ["A", 2, ["m1"]],
      ["B", 1, ["m3"]],
    ]);
  });
});
