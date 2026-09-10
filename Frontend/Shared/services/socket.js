import { io } from "socket.io-client";
import { SOCKET_URL } from "../config/env.js";

const instances = {};
const CONFIG = {
  admin: {
    key: "__CRIC_ALL_ADMIN_SOCKET__",
    autoConnect: true,
  },
  user: {
    key: "__CRIC_ALL_USER_SOCKET__",
    autoConnect: false,
  },
};

function getInstance(namespace) {
  if (!namespace) return null;
  const cfg = CONFIG[namespace];
  if (!cfg) throw new Error(`Unknown socket namespace: ${namespace}`);

  if (instances[namespace]) return instances[namespace];

  const global = globalThis[cfg.key];
  if (global) {
    instances[namespace] = global;
    return global;
  }

  return null;
}

function setInstance(namespace, socket) {
  const cfg = CONFIG[namespace];
  if (!cfg) return;
  instances[namespace] = socket;
  globalThis[cfg.key] = socket;
}

export function getSocket(namespace = "admin") {
  const inst = getInstance(namespace);
  return inst || initSocket(namespace);
}

export function initSocket(namespace = "admin") {
  const cfg = CONFIG[namespace];
  if (!cfg) throw new Error(`Unknown socket namespace: ${namespace}`);

  const existing = getInstance(namespace);
  if (existing?.connected) return existing;

  if (existing) {
    if (!existing.active) existing.connect();
    return existing;
  }

  const socket = io(SOCKET_URL, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    reconnectionAttempts: Infinity,
    timeout: 30000,
    autoConnect: cfg.autoConnect,
    withCredentials: true,
  });
  setInstance(namespace, socket);

  socket.on("connect", () => {
    console.log(`[SOCKET:${namespace}] connect    id=${socket.id}`);
  });
  socket.on("disconnect", (reason) => {
    console.log(`[SOCKET:${namespace}] disconnect id=${socket?.id} reason=${reason}`);
  });
  socket.on("connect_error", (error) => {
    if (!socket?.connected) {
      const transport = socket.io?.engine?.transport?.name || "unknown";
      console.warn(`[SOCKET:${namespace}] error      ${error.message} transport=${transport}`);
    }
  });
  socket.on("reconnect", (attemptNumber) => {
    console.log(`[SOCKET:${namespace}] reconnect  id=${socket.id} after ${attemptNumber} attempts`);
  });
  socket.io.on("reconnect_attempt", (attempt) => {
    console.log(`[SOCKET:${namespace}] reconnect_attempt #${attempt}`);
  });

  return socket;
}

export function joinMatchRoom(matchId, namespace = "user") {
  const s = initSocket(namespace);
  if (matchId) s.emit("join-match", matchId);
}

export function leaveMatchRoom(matchId, namespace = "user") {
  const s = getInstance(namespace);
  if (s) s.emit("leave-match", matchId);
}

export function disconnectSocket(namespace = "admin") {
  const s = getInstance(namespace);
  if (s) {
    console.log(`[SOCKET:${namespace}] manual disconnect`);
    s.disconnect();
    setInstance(namespace, null);
  }
}

export function isSocketConnected(namespace = "admin") {
  const s = getInstance(namespace);
  return !!(s && s.connected);
}

export function emitSocket(event, data, namespace = "admin") {
  const s = getInstance(namespace);
  if (s && s.connected) {
    s.emit(event, data);
    return true;
  }
  console.warn(`[SOCKET:${namespace}] cannot emit ${event} — not connected`);
  return false;
}

// Keep socket instances stable across hot reloads; components clean up their own listeners.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {});
}
