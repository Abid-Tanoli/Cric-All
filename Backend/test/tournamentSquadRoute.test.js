import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import mongoose from "mongoose";
import { startTestDb, stopTestDb } from "./helpers/testDb.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import Tournament from "../src/models/Tournament.js";

// GET /tournaments/:id/squad used to 404 on every tournament page: the route
// declared `/:id/squad` while the controller read `req.params.tournamentId`, so
// the lookup ran with `undefined` and the Teams tab always showed "Squads not
// announced yet". These tests pin the public route shape.

let mongod;
let server;
let baseUrl;

before(async () => {
  mongod = await startTestDb();
  const { default: tournamentRoutes } = await import("../src/routes/tournamentRoutes.js");
  const app = express();
  app.use(express.json());
  app.use("/tournaments", tournamentRoutes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([Team.deleteMany({}), Player.deleteMany({}), Tournament.deleteMany({})]);
});

const call = (path) =>
  new Promise((resolve) => {
    const url = new URL(path, `${baseUrl}/`);
    http
      .get({ hostname: url.hostname, port: url.port, path: url.pathname }, (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }));
      })
      .on("error", (error) => resolve({ status: 0, body: { message: error.message } }));
  });

const makeTournament = async () => {
  const team = await Team.create({ name: `Squad Team ${new mongoose.Types.ObjectId()}`, shortName: "SQT" });
  const players = await Player.create([
    { name: "Squad Opener", team: team._id, role: "Batsman" },
    { name: "Squad Bowler", team: team._id, role: "Bowler" },
  ]);
  const tournament = await Tournament.create({
    name: `Squad Cup ${new mongoose.Types.ObjectId()}`,
    startDate: new Date("2026-10-01T00:00:00Z"),
    endDate: new Date("2026-10-31T00:00:00Z"),
    tournamentSquads: [{ team: team._id, players: players.map((player) => player._id) }],
  });
  return { tournament, team, players };
};

test("GET /tournaments/:id/squad returns the tournament's squads", async () => {
  const { tournament, team, players } = await makeTournament();
  const res = await call(`/tournaments/${tournament._id}/squad`);
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].team._id, String(team._id));
  assert.deepEqual(res.body[0].players.map((player) => player.name).sort(), players.map((player) => player.name).sort());
});

test("GET /tournaments/:id/squad/:teamId returns one squad", async () => {
  const { tournament, team } = await makeTournament();
  const res = await call(`/tournaments/${tournament._id}/squad/${team._id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.team._id, String(team._id));
});

test("an unknown tournament id still 404s", async () => {
  const res = await call(`/tournaments/${new mongoose.Types.ObjectId()}/squad`);
  assert.equal(res.status, 404);
  assert.equal(res.body.message, "Tournament not found");
});

test("a malformed tournament id is rejected before the controller", async () => {
  const res = await call("/tournaments/not-an-id/squad");
  assert.equal(res.status, 400);
});
