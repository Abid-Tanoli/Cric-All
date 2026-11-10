// Tests for src/scripts/syncTournamentChampion.js. The script runs against a
// throwaway mongodb-memory-server database: dry-run writes nothing, --apply
// fills only unset fields, and a second --apply is a no-op.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startTestDb, stopTestDb } from "./helpers/testDb.js";
import Team from "../src/models/Team.js";
import Match from "../src/models/Match.js";
import Tournament from "../src/models/Tournament.js";
import AuditLog from "../src/models/AuditLog.js";
import {
  parseOptions,
  runSyncTournamentChampion,
} from "../src/scripts/syncTournamentChampion.js";

let mongod;
let seq = 0;
const noLog = () => {};

before(async () => {
  mongod = await startTestDb();
});

after(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([
    Team.deleteMany({}),
    Match.deleteMany({}),
    Tournament.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
});

async function seed({
  storedWinner = "",
  storedRunnerUp = "",
  finalStatus = "completed",
  resultType = "normal",
} = {}) {
  seq += 1;
  const teamA = await Team.create({ name: `Champion Sync A ${seq}` });
  const teamB = await Team.create({ name: `Champion Sync B ${seq}` });
  const tournament = await Tournament.create({
    name: `Champion Sync Cup ${seq}`,
    type: "knockout",
    startDate: new Date("2026-10-01T00:00:00.000Z"),
    endDate: new Date("2026-10-31T00:00:00.000Z"),
    teams: [teamA._id, teamB._id],
    winner: storedWinner === "A" ? teamA._id : null,
    runnerUp: storedRunnerUp === "B" ? teamB._id : null,
  });

  const decided = resultType === "normal";
  await Match.create({
    title: `${teamA.name} vs ${teamB.name}`,
    tournament: tournament._id,
    teams: [teamA._id, teamB._id],
    stage: "final",
    stageLabel: "Final",
    status: finalStatus,
    startAt: new Date("2026-10-31T09:00:00.000Z"),
    result: {
      resultType,
      winner: decided ? teamA._id : null,
      ...(resultType === "tie" ? { isTie: true } : {}),
    },
    innings: [],
  });

  return { teamA, teamB, tournament };
}

test("parseOptions is a dry run by default and accepts --tournament", () => {
  assert.deepEqual(parseOptions([]), { apply: false, tournamentId: "" });
  const tournamentId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  assert.deepEqual(parseOptions(["--apply", "--tournament", tournamentId]), {
    apply: true,
    tournamentId,
  });
  assert.throws(() => parseOptions(["--tournament", "not-an-id"]), /valid tournament id/);
});

test("dry-run reports the missing honours but writes nothing", async () => {
  const { tournament } = await seed();
  const report = await runSyncTournamentChampion({ log: noLog });

  assert.equal(report.wouldChange, 1);
  assert.equal(report.rows[0].outcome, "WOULD_UPDATE");
  assert.equal(await AuditLog.countDocuments({ action: "tournament.champion_synced" }), 0);

  const stored = await Tournament.findById(tournament._id).lean();
  assert.equal(stored.winner, null);
  assert.equal(stored.runnerUp, null);
});

test("--apply writes winner/runnerUp, audits once, and is idempotent", async () => {
  const { tournament, teamA, teamB } = await seed();

  const first = await runSyncTournamentChampion({ apply: true, log: noLog });
  assert.equal(first.changed, 1);

  let stored = await Tournament.findById(tournament._id).lean();
  assert.equal(String(stored.winner), String(teamA._id));
  assert.equal(String(stored.runnerUp), String(teamB._id));
  assert.equal(await AuditLog.countDocuments({ action: "tournament.champion_synced" }), 1);

  const second = await runSyncTournamentChampion({ apply: true, log: noLog });
  assert.equal(second.changed, 0);
  assert.equal(second.counts.SKIP_STORED, 1);

  stored = await Tournament.findById(tournament._id).lean();
  assert.equal(String(stored.winner), String(teamA._id));
  assert.equal(String(stored.runnerUp), String(teamB._id));
  assert.equal(await AuditLog.countDocuments({ action: "tournament.champion_synced" }), 1);
});

test("--tournament scopes the run and an existing champion is never overwritten", async () => {
  const first = await seed({ storedWinner: "A" });
  const second = await seed();

  const report = await runSyncTournamentChampion({
    apply: true,
    tournamentId: String(first.tournament._id),
    log: noLog,
  });

  assert.equal(report.rows.length, 1);
  const firstStored = await Tournament.findById(first.tournament._id).lean();
  assert.equal(String(firstStored.winner), String(first.teamA._id));
  assert.equal(String(firstStored.runnerUp), String(first.teamB._id));

  const secondStored = await Tournament.findById(second.tournament._id).lean();
  assert.equal(secondStored.winner, null);
});

test("no completed final and a tie are both skipped", async () => {
  await seed({ finalStatus: "upcoming" });
  await seed({ resultType: "tie" });

  const report = await runSyncTournamentChampion({ apply: true, log: noLog });

  assert.equal(report.changed, 0);
  assert.equal(report.counts.SKIP_NO_FINAL, 2);
  assert.equal(await AuditLog.countDocuments({ action: "tournament.champion_synced" }), 0);
});
