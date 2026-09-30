import { Server } from "socket.io";
import log from "../utils/logger.js";
import { corsOrigin } from "../config/cors.js";

let io;

const matchRoom = (matchId) => `match-${matchId}`;
const shouldLogSocket = () => process.env.LOG_SOCKET === "true";

export const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: corsOrigin,
      methods: ["GET", "POST", "PUT", "DELETE"],
      credentials: true
    },
    transports: ["websocket", "polling"],
    pingTimeout: 120000,
    pingInterval: 30000,
    connectTimeout: 30000,
    maxHttpBufferSize: 1e6,
  });

  io.on("connection", (socket) => {
    const slog = log.child({ socketId: socket.id });
    const clientIp = socket.handshake.address;
    if (shouldLogSocket()) {
      slog.info({ ip: clientIp, transport: socket.conn.transport.name }, "socket connect");
    }

    socket.conn.on("upgrade", (transport) => {
      if (shouldLogSocket()) {
        slog.info({ transport: transport.name }, "socket upgrade");
      }
    });

    socket.on("joinRoom", (roomId) => {
      socket.join(roomId);
      if (shouldLogSocket()) {
        slog.info({ room: roomId }, "socket join room");
      }
    });

    socket.on("leaveRoom", (roomId) => {
      socket.leave(roomId);
    });

    const joinAllMatchRooms = (matchId) => {
      if (!matchId) return;
      // Canonical room: match-${matchId}
      socket.join(matchRoom(matchId));
      // Legacy aliases (kept for backward compat with existing clients)
      socket.join(String(matchId));
      socket.join(`imatch_${matchId}`);
      socket.join(`m_${matchId}`);
    };

    const leaveAllMatchRooms = (matchId) => {
      if (!matchId) return;
      socket.leave(matchRoom(matchId));
      socket.leave(String(matchId));
      socket.leave(`imatch_${matchId}`);
      socket.leave(`m_${matchId}`);
    };

    // ── Canonical join/leave (preferred) ───────────────────────
    socket.on("join-match", (matchId) => {
      joinAllMatchRooms(matchId);
      if (shouldLogSocket()) {
        slog.info({ matchId }, "socket join match");
      }
    });
    socket.on("leave-match", (matchId) => {
      leaveAllMatchRooms(matchId);
    });

    // ── Legacy aliases (migrate clients to "join-match") ───────
    const legacyJoinHandlers = ["JOIN_IMATCH", "JOIN_MATCH", "JOIN"];
    const legacyLeaveHandlers = ["LEAVE_IMATCH", "LEAVE_MATCH", "LEAVE"];
    legacyJoinHandlers.forEach((ev) => {
      socket.on(ev, ({ matchId, id } = {}) => joinAllMatchRooms(matchId || id));
    });
    legacyLeaveHandlers.forEach((ev) => {
      socket.on(ev, ({ matchId, id } = {}) => leaveAllMatchRooms(matchId || id));
    });

    socket.on("join-teams", () => { socket.join("teams"); });
    socket.on("join-players", () => { socket.join("players"); });
    socket.on("join-cricket-live", () => { socket.join("cricket-live"); });

    socket.on("match:updateList", () => {
      io.emit("match:updateList");
    });

    socket.on("disconnect", (reason) => {
      if (shouldLogSocket()) {
        slog.info({ reason }, "socket disconnect");
      }
    });
  });

  log.info("Socket.IO initialized successfully");
  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized! Call initSocket first.");
  }
  return io;
};

/**
 * Fire-and-forget broadcast to every connected client.
 *
 * `getIO()` throwing when Socket.IO has not started is right for code that truly
 * needs the server, and wrong for a notification: a background job, a migration,
 * a seeder, or a test has no emitter attached and must not fail the *write* that
 * happened to trigger the notification. The `getIO()?.emit(...)` pattern that
 * grew up around the emitters never actually guarded anything — the call itself
 * throws before `?.` can short-circuit — so it turned every uninitialised emit
 * into a 500. Use this instead.
 */
export const emitToAll = (event, payload) => {
  if (!io) return;
  io.emit(event, payload);
};

// ─── SCORING EVENTS ────────────────────────────────────────────────

export function emitBallRecorded(matchId, data) {
  if (!io) return;
  const payload = { matchId, ...data };
  io.to(matchRoom(matchId)).to(String(matchId)).emit("ball:recorded", payload);
  io.emit("match:ballUpdate", payload);
  io.emit("match:updated", { matchId });
  if (shouldLogSocket()) {
    log.info({ matchId, event: "ball:recorded", strikerId: data.strikerId, runs: data.runs }, "socket emit ball:recorded");
  }
}

export function emitScoreUpdate(matchId, data) {
  if (!io) return;
  const payload = { matchId, ...data };
  io.to(matchRoom(matchId)).to(String(matchId)).emit("score:update", payload);
  io.emit("match:scoreUpdate", payload);
  io.emit("match:updated", { matchId });
}

export function emitStrikeChanged(matchId, data) {
  if (!io) return;
  io.to(matchRoom(matchId)).to(String(matchId)).emit("strike:changed", { matchId, ...data });
  if (shouldLogSocket()) {
    log.info({ matchId, event: "strike:changed", strikerId: data.strikerId, nonStrikerId: data.nonStrikerId }, "socket emit strike:changed");
  }
}

export function emitOverCompleted(matchId, data) {
  if (!io) return;
  io.to(matchRoom(matchId)).to(String(matchId)).emit("over:completed", { matchId, ...data });
  if (shouldLogSocket()) {
    log.info({ matchId, event: "over:completed", overNumber: data.overNumber }, "socket emit over:completed");
  }
}

export function emitInningsEnd(matchId, data) {
  if (!io) return;
  io.to(matchRoom(matchId)).to(String(matchId)).emit("innings:end", { matchId, ...data });
}

export function emitMatchEnd(matchId, data) {
  if (!io) return;
  io.to(matchRoom(matchId)).to(String(matchId)).emit("match:end", { matchId, ...data });
  io.emit("match:updateList");
  io.emit("match:updated", { matchId });
}

export function emitWicketAlert(matchId, data) {
  if (!io) return;
  io.to(matchRoom(matchId)).emit("WICKET_ALERT", data);
}

export function emitMilestoneAlert(matchId, data) {
  if (!io) return;
  io.to(matchRoom(matchId)).emit("MILESTONE_ALERT", data);
}

// ─── LEGACY EVENTS (keep for backward compat, remove after migration) ────

export const emitMatchUpdate = (matchId, data) => {
  if (io) io.to(matchRoom(matchId)).emit("match:update", data);
};

export const emitBallUpdate = (matchId, data) => {
  if (io) io.to(matchRoom(matchId)).emit("BALL_UPDATE", data);
};

export const emitBallWithCommentary = (matchId, data) => {
  if (io) io.to(matchRoom(matchId)).emit("match:ballWithCommentary", data);
};

export const emitAICommentary = (matchId, data) => {
  if (io) io.to(matchRoom(matchId)).emit("match:aiCommentary", data);
};

export const emitMatchStatusChange = (matchId, data) => {
  if (io) io.to(matchRoom(matchId)).emit("MATCH_STATUS_CHANGE", data);
};

export const emitInningsComplete = (matchId, data) => {
  if (io) io.to(matchRoom(matchId)).emit("INNINGS_COMPLETE", data);
};

export const emitMatchResult = (matchId, data) => {
  if (io) io.to(matchRoom(matchId)).emit("MATCH_RESULT", data);
};

export const emitFieldClick = (matchId, data) => {
  if (io) io.to(matchRoom(matchId)).emit("match:fieldClick", data);
};

export const emitDRSUpdate = (matchId, data) => {
  if (io) io.to(matchRoom(matchId)).emit("DRS_UPDATE", data);
};

export const emitReviewDecision = (matchId, data) => {
  if (io) io.to(matchRoom(matchId)).emit("REVIEW_DECISION", data);
};

export const emitUmpireSignal = (matchId, signal) => {
  if (io) io.to(matchRoom(matchId)).emit("UMPIRE_SIGNAL", { signal, timestamp: new Date() });
};

export const emitTeamUpdate = (team) => {
  if (io) { io.to("teams").emit("team:updated", team); }
};

export const emitTeamCreated = (team) => {
  if (io) { io.to("teams").emit("team:created", team); }
};

export const emitTeamDeleted = (teamId) => {
  if (io) { io.to("teams").emit("team:deleted", { id: teamId }); }
};

export const emitPlayerUpdate = (player) => {
  if (io) { io.to("players").emit("player:updated", player); }
};

export const emitCricketLiveUpdate = (data) => {
  if (io) { io.to("cricket-live").emit("cricket:liveUpdate", data); }
};
