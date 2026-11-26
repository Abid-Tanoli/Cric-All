import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// No database here: the socket layer is driven over a real loopback WebSocket,
// as an anonymous client, exactly the way a public live page connects.
import {
  initSocket,
  emitToAll,
  emitMatchEnd,
  emitBallRecorded,
  emitWicketAlert,
  MAX_ROOMS_PER_SOCKET,
} from "../src/socket/socket.js";
import { connectSocket } from "./e2e/lib/socket.js";

let server;
let io;
let apiBase;
let clients = [];

before(async () => {
  server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  io = initSocket(server);
  apiBase = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await io.close();
});

afterEach(() => {
  for (const { client } of clients) client.close();
  clients = [];
});

async function waitFor(condition, label) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for: ${label}`);
}

async function connect() {
  const client = await connectSocket(apiBase);
  const connectPacket = client.received.find((raw) => raw.startsWith("40"));
  const { sid } = JSON.parse(connectPacket.slice(2));
  await waitFor(() => io.sockets.sockets.has(sid), "server-side socket");
  const serverSocket = io.sockets.sockets.get(sid);

  const handle = {
    client,
    serverSocket,
    rooms: serverSocket.rooms,
    send: (...packet) => client.ws.send(`42${JSON.stringify(packet)}`),
    events: () =>
      client.received
        .filter((raw) => raw.startsWith("42"))
        .map((raw) => JSON.parse(raw.slice(2))),
    names: () => handle.events().map(([event]) => event),
  };
  clients.push(handle);
  return handle;
}

// Packets on one connection are handled in order, so once a later packet's effect
// is visible every earlier one has been handled too. The feed rooms are used as
// the marker because they do not count towards the room limit.
async function flush(handle, feed = "teams") {
  handle.send(`join-${feed}`);
  await waitFor(() => handle.serverSocket.rooms.has(feed), `join-${feed} handled`);
}

// The same idea for the other direction: emits reach a client in order.
let marker = 0;
async function settle(...handles) {
  const event = `test:marker:${(marker += 1)}`;
  io.emit(event);
  for (const handle of handles) {
    await waitFor(() => handle.names().includes(event), `${event} delivered`);
  }
}

test("a client cannot make the server broadcast match:updateList", async () => {
  const sender = await connect();
  const bystander = await connect();

  sender.send("match:updateList");
  sender.send("match:updateList", { matchId: "m1" });
  await flush(sender);
  await settle(sender, bystander);

  assert.ok(!bystander.names().includes("match:updateList"), "bystander got a client-triggered broadcast");
  assert.ok(!sender.names().includes("match:updateList"), "sender got its own broadcast back");
});

test("the server still broadcasts match:updateList to everyone", async () => {
  const one = await connect();
  const two = await connect();

  emitToAll("match:updateList");
  await settle(one, two);
  assert.equal(one.names().filter((event) => event === "match:updateList").length, 1);
  assert.equal(two.names().filter((event) => event === "match:updateList").length, 1);

  emitMatchEnd("m1", { result: "done" });
  await settle(one, two);
  assert.equal(one.names().filter((event) => event === "match:updateList").length, 2);
  assert.equal(two.names().filter((event) => event === "match:updateList").length, 2);
});

test("an anonymous client can join a match and gets its live events only", async () => {
  const viewer = await connect();
  const elsewhere = await connect();
  viewer.send("join-match", "match-a");
  elsewhere.send("join-match", "match-b");
  await flush(viewer);
  await flush(elsewhere);

  emitBallRecorded("match-a", { runs: 4 });
  emitWicketAlert("match-a", { matchId: "match-a" });
  await settle(viewer, elsewhere);

  assert.ok(viewer.names().includes("ball:recorded"));
  assert.ok(viewer.names().includes("WICKET_ALERT"));
  assert.ok(!elsewhere.names().includes("ball:recorded"));
  assert.ok(!elsewhere.names().includes("WICKET_ALERT"));
});

test("every join event still works, and leaving stops the feed", async () => {
  const joins = [
    ["join-match", "m1", "match-m1"],
    ["joinRoom", "match-m2", "match-m2"],
    ["JOIN_IMATCH", { matchId: "m3" }, "imatch_m3"],
    ["JOIN_MATCH", { id: "m4" }, "match-m4"],
    ["JOIN", { matchId: "m5" }, "m_m5"],
    ["join-match", 12345, "match-12345"],
  ];
  const leaves = [
    ["leave-match", "m1"],
    ["leaveRoom", "match-m2"],
    ["LEAVE_IMATCH", { matchId: "m3" }],
    ["LEAVE_MATCH", { id: "m4" }],
    ["LEAVE", { matchId: "m5" }],
    ["leave-match", 12345],
  ];

  const viewer = await connect();
  for (const [event, payload] of joins) viewer.send(event, payload);
  for (const feed of ["teams", "players", "cricket-live"]) await flush(viewer, feed);
  for (const [event, , room] of joins) assert.ok(viewer.rooms.has(room), `${event} joined ${room}`);

  for (const [event, payload] of leaves) viewer.send(event, payload);
  viewer.send("joinRoom", "after-leaving");
  await waitFor(() => viewer.rooms.has("after-leaving"), "leaves handled");
  assert.deepEqual(
    [...viewer.rooms].sort(),
    [viewer.serverSocket.id, "after-leaving", "cricket-live", "players", "teams"].sort(),
  );
});

test("one socket cannot hold more than the room limit", async () => {
  const flooder = await connect();
  for (let i = 0; i < MAX_ROOMS_PER_SOCKET * 3; i += 1) flooder.send("joinRoom", `flood-${i}`);
  await flush(flooder);

  // + its own id room and the uncounted feed room `flush` joins
  assert.equal(flooder.rooms.size, MAX_ROOMS_PER_SOCKET + 2);
  assert.ok(!flooder.rooms.has("flood-0"), "the oldest room was dropped");
  assert.ok(flooder.rooms.has(`flood-${MAX_ROOMS_PER_SOCKET * 3 - 1}`), "the newest room is held");
});

test("the room limit is per socket", async () => {
  const flooder = await connect();
  const viewer = await connect();
  viewer.send("join-match", "quiet");
  await flush(viewer);
  for (let i = 0; i < MAX_ROOMS_PER_SOCKET * 2; i += 1) flooder.send("joinRoom", `noise-${i}`);
  await flush(flooder);

  assert.ok(viewer.rooms.has("match-quiet"));
});

test("a visitor who opens many matches without leaving keeps the live feed of the latest one", async () => {
  const visitor = await connect();
  const opened = MAX_ROOMS_PER_SOCKET; // four rooms each, so far past the limit
  for (let i = 0; i < opened; i += 1) visitor.send("join-match", `seen-${i}`);
  await flush(visitor);
  assert.ok(visitor.rooms.size <= MAX_ROOMS_PER_SOCKET + 2);

  emitWicketAlert(`seen-${opened - 1}`, { matchId: `seen-${opened - 1}` });
  emitWicketAlert("seen-0", { matchId: "seen-0" });
  await settle(visitor);
  const alerts = visitor.events().filter(([event]) => event === "WICKET_ALERT");
  assert.deepEqual(alerts.map(([, data]) => data.matchId), [`seen-${opened - 1}`]);
});

test("re-joining a match keeps it ahead of older rooms", async () => {
  const viewer = await connect();
  viewer.send("join-match", "kept");
  const matchesThatFit = MAX_ROOMS_PER_SOCKET / 4;
  for (let i = 0; i < matchesThatFit - 1; i += 1) viewer.send("join-match", `other-${i}`);
  viewer.send("join-match", "kept");
  viewer.send("join-match", "one-too-many");
  await flush(viewer);

  assert.ok(viewer.rooms.has("match-kept"), "the re-joined match survived");
  assert.ok(viewer.rooms.has("match-one-too-many"));
  assert.ok(!viewer.rooms.has("match-other-0"), "the oldest untouched match was dropped");
});

test("leaving rooms frees the limit", async () => {
  const viewer = await connect();
  for (let i = 0; i < MAX_ROOMS_PER_SOCKET; i += 1) viewer.send("joinRoom", `r-${i}`);
  viewer.send("leaveRoom", `r-${MAX_ROOMS_PER_SOCKET - 1}`);
  viewer.send("joinRoom", "freed");
  await flush(viewer);

  assert.ok(viewer.rooms.has("r-0"), "nothing had to be dropped");
  assert.ok(viewer.rooms.has("freed"));
});

test("a list, an object or an oversized id is not a room", async () => {
  const viewer = await connect();
  viewer.send("joinRoom", Array.from({ length: 500 }, (_, i) => `bulk-${i}`));
  viewer.send("joinRoom", { room: "x" });
  viewer.send("joinRoom", "x".repeat(5000));
  viewer.send("joinRoom", "");
  viewer.send("join-match", ["a", "b"]);
  viewer.send("join-match", { matchId: "x", runs: 6 });
  viewer.send("JOIN", { matchId: ["a", "b"] });
  await flush(viewer);

  assert.deepEqual([...viewer.rooms].sort(), [viewer.serverSocket.id, "teams"].sort());
});

test("malformed payloads do not bring the server down", async () => {
  // The handlers are called directly: a throw inside one is an uncaughtException,
  // on which index.js exits, but node:test swallows it when it comes off the wire.
  const attacker = await connect();
  const events = [
    "joinRoom", "leaveRoom", "join-match", "leave-match",
    "JOIN_IMATCH", "JOIN_MATCH", "JOIN", "LEAVE_IMATCH", "LEAVE_MATCH", "LEAVE",
    "join-teams", "join-players", "join-cricket-live", "match:updateList",
  ];
  for (const event of events) {
    for (const payload of [undefined, null, 0, true, "", [], {}, [null], { matchId: null }, { id: {} }]) {
      for (const handler of attacker.serverSocket.listeners(event)) {
        assert.doesNotThrow(() => handler(payload), `${event} with ${JSON.stringify(payload)}`);
      }
      attacker.send(event, payload);
    }
  }
  await flush(attacker);

  const viewer = await connect();
  viewer.send("join-match", "still-up");
  await flush(viewer);
  assert.ok(viewer.rooms.has("match-still-up"));
});
