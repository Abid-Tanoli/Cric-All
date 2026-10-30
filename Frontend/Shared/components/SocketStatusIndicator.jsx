import { useState, useEffect } from "react";

const SOCKET_STATUS = {
  connected: { bg: "bg-emerald-500", text: "Connected", show: false },
  connecting: { bg: "bg-amber-500", text: "Reconnecting...", show: true },
  disconnected: { bg: "bg-red-500", text: "Disconnected", show: true },
};

export default function SocketStatusIndicator({ getSocket }) {
  const [status, setStatus] = useState("connected");

  useEffect(() => {
    const socket = getSocket?.();
    if (!socket) return;

    // The `user` socket is created lazily with autoConnect:false (see
    // Shared/services/socket.js), so on pages that never open a live
    // connection `socket.connected` is simply false forever. Treating that as
    // "connecting" left an amber "Reconnecting..." bar pinned on top of the
    // login, rankings, teams, players and community pages. Only a socket that
    // actually reached `connect` once may report a connection problem.
    if (!socket.connected) return undefined;
    setStatus("connected");

    const onConnect = () => setStatus("connected");
    // Reconnection is enabled (reconnection:true), so a dropped connection is
    // a reconnect attempt, not a dead socket — keep the wording honest.
    const onDisconnect = () => setStatus(socket.active ? "connecting" : "disconnected");
    const onConnectError = () => setStatus("connecting");
    const onReconnectAttempt = () => setStatus("connecting");
    const onReconnect = () => setStatus("connected");

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.io?.on("reconnect_attempt", onReconnectAttempt);
    socket.on("reconnect", onReconnect);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.io?.off("reconnect_attempt", onReconnectAttempt);
      socket.off("reconnect", onReconnect);
    };
  }, [getSocket]);

  const s = SOCKET_STATUS[status] || SOCKET_STATUS.disconnected;
  if (!s.show) return null;

  return (
    <div className={`fixed top-0 left-0 right-0 z-[9999] ${s.bg} text-white text-center text-[11px] font-bold py-2 px-4 shadow-lg animate-slideDown`}>
      <div className="flex items-center justify-center gap-2">
        <span className={`w-2 h-2 rounded-full ${status === "connecting" ? "bg-white animate-pulse" : "bg-white/80"}`} />
        {s.text}
      </div>
    </div>
  );
}
