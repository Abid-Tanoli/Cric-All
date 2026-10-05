/**
 * Hard local-only guard for the E2E suite.
 *
 * Round 2 rule: every write in this suite must land on the developer's own
 * machine. `Backend/.env` in this repo points at a *public Atlas cluster*, and
 * dotenv loads it on boot, so a harness that merely reads BASE_URL is one
 * mistyped variable away from writing production fixtures. This module refuses
 * to continue unless the resolved target is loopback, and prints the target it
 * is about to talk to so the run log records where the writes went.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export const API_BASE = (
  process.env.E2E_API_BASE || "http://127.0.0.1:5000/api"
).replace(/\/+$/, "");

export const EXPECTED_DB_NAME = "cric-all-e2e";

function parse(url) {
  return new URL(url);
}

/**
 * Throws unless the API base is loopback AND the database the server was booted
 * against is the disposable local one. Both halves matter: a loopback API in
 * front of an Atlas-backed server is still a production write.
 */
export function assertLocalTarget({ apiBase = API_BASE, dbName = process.env.E2E_DB_NAME || EXPECTED_DB_NAME } = {}) {
  let parsed;
  try {
    parsed = parse(apiBase);
  } catch {
    throw new Error(`E2E_API_BASE is not a valid URL: ${apiBase}`);
  }

  const host = parsed.hostname;
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `REFUSING TO RUN: API base ${apiBase} is not loopback. ` +
        `This suite may only write to the local environment.`,
    );
  }
  if (dbName !== EXPECTED_DB_NAME) {
    throw new Error(
      `REFUSING TO RUN: expected database ${EXPECTED_DB_NAME}, got ${dbName}. ` +
        `Point the server at the local throwaway database.`,
    );
  }

  const banner = [
    "",
    "=== E2E LOCAL TARGET GUARD =================================",
    `  API base : ${apiBase}`,
    `  API host : ${host} (loopback)`,
    `  DB name  : ${dbName}`,
    `  DB host  : proven by inspecting the server process's sockets (below)`,
    "  Writes   : this process only, this run only",
    "============================================================",
    "",
  ].join("\n");
  process.stdout.write(`${banner}\n`);

  return { apiBase, host, dbName };
}

/**
 * Proves loopback-ness from the server's side, at the socket layer.
 *
 * `/api/health` reports `dbConnected` but not the DB host, so a health check
 * cannot tell a local Mongo from the public Atlas cluster in `Backend/.env`.
 * Instead we find the process actually listening on the API port and inspect
 * every TCP connection it owns:
 *
 *   - it must hold at least one ESTABLISHED connection to port 27017, and
 *   - every remote peer of that process must be loopback.
 *
 * A server wired to Atlas necessarily holds a connection to a public address,
 * so this fails closed on the real risk rather than on a reported string.
 */
export async function assertServerIsLocal(apiBase = API_BASE) {
  const res = await fetch(new URL("health", `${apiBase}/`).toString(), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Backend /health returned ${res.status}. Is the local server running?`);
  }
  const body = await res.json().catch(() => ({}));
  if (body.dbConnected === false || body.dbState === "disconnected") {
    throw new Error(`REFUSING TO RUN: server reports the database is not connected (${JSON.stringify(body)}).`);
  }

  // Reported string, when the deployment happens to expose one.
  const reported = String(body.dbHost || body.mongoHost || body.host || "");
  if (reported && !LOOPBACK_HOSTS.has(reported)) {
    throw new Error(`REFUSING TO RUN: the running server reports DB host ${reported}, which is not loopback.`);
  }

  const port = Number(new URL(apiBase).port || (apiBase.startsWith("https") ? 443 : 80));
  const sockets = inspectSockets(port);

  if (!sockets) {
    throw new Error(
      `REFUSING TO RUN: could not inspect the sockets of the process listening on port ${port}. ` +
        `The database's locality cannot be proven, so no writes will be attempted.`,
    );
  }

  const remote = sockets.peers.filter((p) => p.remotePort !== port);
  const foreign = remote.filter((p) => !isLoopback(p.remoteAddress));
  if (foreign.length) {
    throw new Error(
      `REFUSING TO RUN: the server on port ${port} (PID ${sockets.pid}) holds connections to ` +
        `${foreign.map((f) => `${f.remoteAddress}:${f.remotePort}`).join(", ")}, which are not loopback. ` +
        `That looks like a remote cluster, so no writes will be attempted.`,
    );
  }

  const mongo = remote.filter((p) => p.remotePort === 27017);
  if (!mongo.length) {
    throw new Error(
      `REFUSING TO RUN: the server on port ${port} (PID ${sockets.pid}) has no connection to a ` +
        `local MongoDB on 127.0.0.1:27017. Its peers are ` +
        `${[...new Set(remote.map((p) => `${p.remoteAddress}:${p.remotePort}`))].join(", ") || "(none)"}. ` +
        `Locality cannot be proven, so no writes will be attempted.`,
    );
  }

  process.stdout.write(
    `  Verified  : server PID ${sockets.pid} on port ${port}; ` +
      `${mongo.length} established connection(s) to 127.0.0.1:27017; ` +
      `no non-loopback peers\n`,
  );
  return body;
}

function isLoopback(address) {
  if (LOOPBACK_HOSTS.has(address)) return true;
  // IPv6 loopback and IPv4-mapped forms.
  if (/^::1$/.test(address)) return true;
  if (/^::ffff:127\./i.test(address)) return true;
  return false;
}

/** Lists established peers of the process listening on `port`. */
function inspectSockets(port) {
  if (process.platform === "linux") return inspectLinuxProcNet(port);
  if (process.platform !== "win32") return null;
  try {
    const ps = `\$l = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
      `if (-not \$l) { exit 3 }; ` +
      `\$p = \$l.OwningProcess; ` +
      `\$c = Get-NetTCPConnection -OwningProcess \$p -State Established -ErrorAction SilentlyContinue | ` +
      `ForEach-Object { '{0}|{1}' -f \$_.RemoteAddress, \$_.RemotePort }; ` +
      `Write-Output ('PID=' + \$p); \$c`;
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
      encoding: "utf8",
      timeout: 30_000,
    });
    const lines = out.split(/\r?\n/).filter(Boolean);
    const pidLine = lines.find((l) => l.startsWith("PID="));
    if (!pidLine) return null;
    const pid = pidLine.slice(4).trim();
    const peers = lines
      .filter((l) => l.includes("|"))
      .map((l) => {
        const [remoteAddress, remotePort] = l.split("|");
        return { remoteAddress: remoteAddress.trim(), remotePort: Number(remotePort) };
      });
    return { pid, peers };
  } catch {
    return null;
  }
}

/**
 * Parses a Linux /proc/net/tcp or tcp6 table. Socket inodes are used to match
 * table rows to the file descriptors held by the API process.
 */
export function parseProcNetTable(contents, family) {
  if (family !== "tcp" && family !== "tcp6") {
    throw new Error(`Unsupported proc net family: ${family}`);
  }
  const addressLength = family === "tcp" ? 8 : 32;
  const sockets = [];

  for (const line of contents.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const fields = line.trim().split(/\s+/);
    if (fields.length < 10) throw new Error(`Malformed /proc/net/${family} row`);
    const local = parseProcEndpoint(fields[1], addressLength, family);
    const remote = parseProcEndpoint(fields[2], addressLength, family);
    if (!/^[0-9A-Fa-f]{2}$/.test(fields[3]) || !/^\d+$/.test(fields[9])) {
      throw new Error(`Malformed /proc/net/${family} row`);
    }
    sockets.push({
      localAddress: local.address,
      localPort: local.port,
      remoteAddress: remote.address,
      remotePort: remote.port,
      state: fields[3].toUpperCase(),
      inode: fields[9],
    });
  }
  return sockets;
}

function parseProcEndpoint(value, addressLength, family) {
  const match = new RegExp(`^([0-9A-Fa-f]{${addressLength}}):([0-9A-Fa-f]{4})$`).exec(value);
  if (!match) throw new Error("Malformed /proc/net endpoint");
  const addressBytes = match[1].match(/../g).map((byte) => Number.parseInt(byte, 16));
  if (family === "tcp") addressBytes.reverse();
  else {
    for (let offset = 0; offset < addressBytes.length; offset += 4) {
      addressBytes.splice(offset, 4, ...addressBytes.slice(offset, offset + 4).reverse());
    }
  }
  return {
    address: family === "tcp" ? addressBytes.join(".") : formatProcIPv6(addressBytes),
    port: Number.parseInt(match[2], 16),
  };
}

function formatProcIPv6(bytes) {
  const groups = [];
  for (let i = 0; i < bytes.length; i += 2) {
    groups.push((bytes[i] * 256 + bytes[i + 1]).toString(16));
  }
  if (groups.slice(0, 5).every((group) => group === "0") && groups[5] === "ffff") {
    return `::ffff:${bytes.slice(12).join(".")}`;
  }

  let bestStart = -1;
  let bestLength = 1;
  for (let start = 0; start < groups.length;) {
    if (groups[start] !== "0") {
      start += 1;
      continue;
    }
    let end = start + 1;
    while (end < groups.length && groups[end] === "0") end += 1;
    if (end - start > bestLength) {
      bestStart = start;
      bestLength = end - start;
    }
    start = end;
  }
  if (bestStart === -1) return groups.join(":");
  const left = groups.slice(0, bestStart).join(":");
  const right = groups.slice(bestStart + bestLength).join(":");
  if (!left && !right) return "::";
  if (!left) return `::${right}`;
  if (!right) return `${left}::`;
  return `${left}::${right}`;
}

/**
 * Returns established peers belonging to the process that owns the listener.
 * A missing listener-owner match is uncertainty; an owned listener with no
 * established connections is a known-empty peer list.
 */
export function peersForProcSockets(port, tables, processSocketInodes) {
  const ownedInodes = new Set(processSocketInodes);
  const ownsListener = tables.some(
    (socket) => socket.localPort === port && socket.state === "0A" && ownedInodes.has(socket.inode),
  );
  if (!ownsListener) return null;
  return tables
    .filter((socket) => socket.state === "01" && ownedInodes.has(socket.inode))
    .map(({ remoteAddress, remotePort }) => ({ remoteAddress, remotePort }));
}

export function inspectLinuxProcNet(port, procRoot = "/proc") {
  try {
    const tables = [
      ...parseProcNetTable(readFileSync(join(procRoot, "net", "tcp"), "utf8"), "tcp"),
      ...readProcNetIPv6(procRoot),
    ];
    const listenerInodes = new Set(
      tables.filter((socket) => socket.localPort === port && socket.state === "0A").map((socket) => socket.inode),
    );
    if (!listenerInodes.size) return null;

    for (const entry of readdirSync(procRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      let socketInodes;
      try {
        socketInodes = readProcessSocketInodes(join(procRoot, entry.name, "fd"));
      } catch {
        // Processes can exit or be inaccessible while /proc is being inspected.
        continue;
      }
      if (![...listenerInodes].some((inode) => socketInodes.has(inode))) continue;

      const peers = peersForProcSockets(port, tables, socketInodes);
      if (!peers) return null;
      return { pid: entry.name, peers };
    }
    return null;
  } catch {
    return null;
  }
}

function readProcNetIPv6(procRoot) {
  try {
    return parseProcNetTable(readFileSync(join(procRoot, "net", "tcp6"), "utf8"), "tcp6");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function readProcessSocketInodes(fdPath) {
  const inodes = new Set();
  for (const descriptor of readdirSync(fdPath)) {
    let target;
    try {
      target = readlinkSync(join(fdPath, descriptor));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const match = /^socket:\[(\d+)\]$/.exec(target);
    if (match) inodes.add(match[1]);
  }
  return inodes;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
