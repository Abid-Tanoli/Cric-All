import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { inspectLinuxProcNet, parseProcNetTable, peersForProcSockets } from "./lib/guard.js";

const HEADER =
  "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode";

function row({ local, remote, state, inode }) {
  return `   0: ${local} ${remote} ${state} 00000000:00000000 00:00000000 00000000 1000 0 ${inode}`;
}

test("parses IPv4 endpoints and keeps process socket inodes", () => {
  const [socket] = parseProcNetTable(
    `${HEADER}\n${row({
      local: "0100007F:1388",
      remote: "0201A8C0:CBB2",
      state: "01",
      inode: "12345",
    })}`,
    "tcp",
  );

  assert.deepEqual(socket, {
    localAddress: "127.0.0.1",
    localPort: 5000,
    remoteAddress: "192.168.1.2",
    remotePort: 52146,
    state: "01",
    inode: "12345",
  });
});

test("parses IPv6 loopback and IPv4-mapped endpoints", () => {
  const sockets = parseProcNetTable(
    [
      HEADER,
      row({
        local: "00000000000000000000000001000000:1388",
        remote: "00000000000000000000000001000000:1389",
        state: "0A",
        inode: "20",
      }),
      row({
        local: "0000000000000000FFFF00000100007F:1388",
        remote: "0000000000000000FFFF00000200007F:1389",
        state: "01",
        inode: "21",
      }),
    ].join("\n"),
    "tcp6",
  );

  assert.equal(sockets[0].localAddress, "::1");
  assert.equal(sockets[0].remoteAddress, "::1");
  assert.equal(sockets[1].localAddress, "::ffff:127.0.0.1");
  assert.equal(sockets[1].remoteAddress, "::ffff:127.0.0.2");
});

test("returns every established process peer and excludes unrelated sockets", () => {
  const tables = [
    ...parseProcNetTable(
      [
        HEADER,
        row({ local: "00000000:1388", remote: "00000000:0000", state: "0A", inode: "100" }),
        row({ local: "0100007F:1388", remote: "0100007F:9C40", state: "01", inode: "101" }),
        row({ local: "0100007F:1388", remote: "0201A8C0:CBB2", state: "01", inode: "102" }),
        row({ local: "0100007F:1388", remote: "0100007F:9C41", state: "01", inode: "999" }),
      ].join("\n"),
      "tcp",
    ),
  ];

  assert.deepEqual(peersForProcSockets(5000, tables, ["100", "101", "102"]), [
    { remoteAddress: "127.0.0.1", remotePort: 40000 },
    { remoteAddress: "192.168.1.2", remotePort: 52146 },
  ]);
});

test("returns an empty peer list only when the listener is owned and idle", () => {
  const tables = parseProcNetTable(
    `${HEADER}\n${row({ local: "00000000:1388", remote: "00000000:0000", state: "0A", inode: "100" })}`,
    "tcp",
  );

  assert.deepEqual(peersForProcSockets(5000, tables, ["100"]), []);
  assert.equal(peersForProcSockets(5000, tables, []), null);
});

test("rejects malformed proc rows instead of silently omitting peers", () => {
  assert.throws(() => parseProcNetTable(`${HEADER}\n  malformed row`, "tcp"), /Malformed/);
});

test(
  "Linux /proc inspection finds the listener and returns its established peers",
  { skip: process.platform !== "linux" },
  async () => {
    const server = net.createServer((socket) => socket.pause());
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const port = server.address().port;
    const client = net.connect(port, "127.0.0.1");
    await new Promise((resolve, reject) => {
      client.once("connect", resolve);
      client.once("error", reject);
    });

    try {
      const result = inspectLinuxProcNet(port);
      assert.ok(result, "the listening socket must be identifiable from /proc");
      assert.equal(result.pid, String(process.pid));
      assert.ok(
        result.peers.some(
          (peer) => peer.remoteAddress === "127.0.0.1" && peer.remotePort !== port,
        ),
        "the established loopback client peer must be preserved",
      );
    } finally {
      client.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
