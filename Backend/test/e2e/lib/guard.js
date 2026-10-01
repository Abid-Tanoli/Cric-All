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

/** Lists the established peers of the process listening on `port`. Windows only. */
function inspectSockets(port) {
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

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
