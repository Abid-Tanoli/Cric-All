import { io as clientIo } from "socket.io-client";

let socket = null;

export function initSocket() {
  if (socket) return socket;

  const SERVER = import.meta.env.VITE_SOCKET_URL || (import.meta.env.DEV ? "http://localhost:5000" : window.location.origin);

  socket = clientIo(SERVER, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  socket.on("connect", () => {
    console.log("Socket connected:", socket.id);
  });

  socket.on("connect_error", (err) => {
    console.warn("Socket connect_error:", err.message);
  });

  return socket;
}

export function getSocket() {
  return initSocket();
}

export function joinMatchRoom(matchId) {
  const s = initSocket();
  s.emit("join-match", matchId);
}

export function leaveMatchRoom(matchId) {
  if (!socket) return;
  socket.emit("leave-match", matchId);
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export default {
  initSocket,
  joinMatchRoom,
  leaveMatchRoom,
  disconnectSocket,
};
