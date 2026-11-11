import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveTournamentPublicState,
  deriveCompletedFinalHonours,
  resolveTournamentHonours,
} from "../src/services/tournamentPublicState.js";

// The public header reads its status/range from the content endpoint. These
// tests pin the derivation: a knockout is not "completed" until its final is,
// and the range follows the last scheduled fixture even when the tournament row
// still carries the original one-day dates.

const STORED_END = new Date("2026-10-11T00:00:00.000Z");
const FINAL_START = new Date("2026-11-01T05:30:00.000Z");

const match = (stage, status, startAt = null, extra = {}) => ({
  stage,
  stageLabel: stage === "final" ? "Final" : stage.toUpperCase(),
  status,
  startAt,
  ...extra,
});

test("no fixtures keeps the stored status and end date", () => {
  const state = deriveTournamentPublicState(
    { type: "knockout", status: "upcoming", endDate: STORED_END },
    [],
  );
  assert.equal(state.status, "upcoming");
  assert.equal(state.endDate.toISOString(), STORED_END.toISOString());
});

test("completed quarter/semi-finals with a scheduled final read ongoing and extend to the final date", () => {
  const state = deriveTournamentPublicState(
    {
      type: "knockout",
      status: "upcoming",
      endDate: STORED_END,
      startDate: new Date("2026-10-01T00:00:00.000Z"),
    },
    [
      match("quarter_final", "completed", new Date("2026-10-11T04:00:00.000Z")),
      match("semi_final", "completed", new Date("2026-10-25T04:30:00.000Z")),
      match("final", "upcoming", FINAL_START),
    ],
  );
  assert.equal(state.status, "ongoing");
  assert.equal(state.endDate.toISOString(), FINAL_START.toISOString());
});

test("a past-dated final that is still upcoming keeps the knockout ongoing", () => {
  // The final has a date in the past, but nobody has entered a result. Deriving
  // from the calendar would call this "upcoming" (or completed); deriving from
  // the fixtures keeps it in progress until the final itself is completed.
  const pastFinal = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const state = deriveTournamentPublicState(
    { type: "knockout", status: "upcoming", endDate: STORED_END },
    [
      match("quarter_final", "completed", new Date("2026-10-11T04:00:00.000Z")),
      match("semi_final", "completed", new Date("2026-10-25T04:30:00.000Z")),
      match("final", "upcoming", pastFinal),
    ],
  );
  assert.equal(state.status, "ongoing");
  assert.equal(state.endDate.toISOString(), pastFinal.toISOString());
});

test("a completed final is the only thing that marks a knockout completed", () => {
  const semisOnly = deriveTournamentPublicState(
    { type: "knockout", status: "upcoming", endDate: STORED_END },
    [
      match("semi_final", "completed", new Date("2026-10-25T04:30:00.000Z")),
      match("semi_final", "completed", new Date("2026-10-25T05:00:00.000Z")),
    ],
  );
  assert.equal(semisOnly.status, "ongoing");

  const finalDone = deriveTournamentPublicState(
    { type: "knockout", status: "upcoming", endDate: STORED_END },
    [
      match("semi_final", "completed", new Date("2026-10-25T04:30:00.000Z")),
      match("final", "completed", FINAL_START),
    ],
  );
  assert.equal(finalDone.status, "completed");
});

test("a live match wins over every derived state", () => {
  const state = deriveTournamentPublicState(
    { type: "knockout", status: "upcoming", endDate: STORED_END },
    [
      match("semi_final", "completed", new Date("2026-10-25T04:30:00.000Z")),
      match("final", "live", FINAL_START),
    ],
  );
  assert.equal(state.status, "live");
});

test("a league is completed only when every match is finished", () => {
  const oneDone = deriveTournamentPublicState(
    { type: "league", status: "upcoming", endDate: STORED_END },
    [
      match("", "completed", new Date("2026-10-11T04:00:00.000Z")),
      match("", "upcoming", new Date("2026-10-12T04:00:00.000Z")),
    ],
  );
  assert.equal(oneDone.status, "ongoing");

  const allDone = deriveTournamentPublicState(
    { type: "league", status: "upcoming", endDate: STORED_END },
    [
      match("", "completed", new Date("2026-10-11T04:00:00.000Z")),
      match("", "abandoned", new Date("2026-10-12T04:00:00.000Z")),
    ],
  );
  assert.equal(allDone.status, "completed");
});

test("draft fixtures are ignored for both status and the end date", () => {
  const state = deriveTournamentPublicState(
    { type: "knockout", status: "upcoming", endDate: STORED_END },
    [
      match("semi_final", "completed", new Date("2026-10-25T04:30:00.000Z")),
      match("final", "upcoming", FINAL_START, { manualDraft: true }),
    ],
  );
  assert.equal(state.status, "ongoing");
  // The draft final on 1 Nov is ignored, so the completed semi on 25 Oct is the
  // latest real fixture (which is still later than the stored 11 Oct date).
  assert.equal(state.endDate.toISOString(), "2026-10-25T04:30:00.000Z");
});

test("an already-later stored end date is not shortened by an earlier fixture", () => {
  const laterStored = new Date("2026-12-31T00:00:00.000Z");
  const state = deriveTournamentPublicState(
    { type: "knockout", status: "upcoming", endDate: laterStored },
    [match("final", "upcoming", FINAL_START)],
  );
  assert.equal(state.endDate.toISOString(), laterStored.toISOString());
});

// --- effective champion / runner-up ---------------------------------------

const CHAMPION = "aaaaaaaaaaaaaaaaaaaaaaaa";
const RUNNER_UP = "bbbbbbbbbbbbbbbbbbbbbbbb";

const finalMatch = (extra = {}) => ({
  _id: "cccccccccccccccccccccccc",
  stage: "final",
  stageLabel: "Final",
  status: "completed",
  teams: [
    { _id: CHAMPION, name: "Sky Sports" },
    { _id: RUNNER_UP, name: "Young Star" },
  ],
  result: { resultType: "normal", winner: { _id: CHAMPION, name: "Sky Sports" } },
  ...extra,
});

test("a completed final gives the effective champion and runner-up when both are unset", () => {
  const tournament = { type: "knockout", winner: null, runnerUp: null, teams: finalMatch().teams };
  const honours = resolveTournamentHonours(tournament, [finalMatch()]);

  assert.equal(String(honours.winner?._id), CHAMPION);
  assert.equal(honours.winner.name, "Sky Sports");
  assert.equal(String(honours.runnerUp?._id), RUNNER_UP);
  assert.equal(honours.runnerUp.name, "Young Star");
});

test("stored honours take precedence over the final result", () => {
  const storedWinner = { _id: "dddddddddddddddddddddddd", name: "Stored Winner" };
  const storedRunnerUp = { _id: "eeeeeeeeeeeeeeeeeeeeeeee", name: "Stored Runner-up" };
  const honours = resolveTournamentHonours(
    { winner: storedWinner, runnerUp: storedRunnerUp, teams: [] },
    [finalMatch()],
  );

  assert.equal(honours.winner, storedWinner);
  assert.equal(honours.runnerUp, storedRunnerUp);
});

test("no completed final, a pending final and a tie are not guessed", () => {
  assert.equal(deriveCompletedFinalHonours([]), null);
  assert.equal(deriveCompletedFinalHonours([finalMatch({ status: "upcoming" })]), null);
  assert.equal(
    deriveCompletedFinalHonours([
      finalMatch({ result: { resultType: "tie", winner: null, isTie: true } }),
    ]),
    null,
  );
  assert.equal(
    deriveCompletedFinalHonours([
      finalMatch({ result: { resultType: "no result", winner: null } }),
    ]),
    null,
  );

  const honours = resolveTournamentHonours({ winner: null, runnerUp: null }, []);
  assert.equal(honours.winner, null);
  assert.equal(honours.runnerUp, null);
});

test("a draft final never supplies the public champion", () => {
  assert.equal(deriveCompletedFinalHonours([finalMatch({ manualDraft: true })]), null);
});
