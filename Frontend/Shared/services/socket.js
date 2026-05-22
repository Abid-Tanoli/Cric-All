import { io as clientIo } from "socket.io-client";

let socket = null;

const SERVER = import.meta.env?.VITE_SOCKET_URL || "http://localhost:5000";

export function initSocket() {
  if (socket?.connected) return socket;

  socket = clientIo(SERVER, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  socket.on("connect", () => {
    console.log("✅ Socket connected:", socket.id);
  });

  socket.on("connect_error", (err) => {
    console.warn("❌ Socket connection error:", err.message);
  });

  return socket;
}

export function getSocket() {
  return initSocket();
}

export function joinMatchRoom(matchId) {
  const s = initSocket();
  s?.emit("join-match", matchId);
}

export function leaveMatchRoom(matchId) {
  if (socket?.connected) {
    socket.emit("leave-match", matchId);
  }
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export default { initSocket, getSocket, joinMatchRoom, leaveMatchRoom, disconnectSocket };