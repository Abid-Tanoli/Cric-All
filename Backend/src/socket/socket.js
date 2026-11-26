import { Server } from "socket.io";
import log from "../utils/logger.js";
import { corsOrigin } from "../config/cors.js";

let io;

const matchRoom = (matchId) => `match-${matchId}`;
const shouldLogSocket = () => process.env.LOG_SOCKET === "true";

// Live feeds are anonymous and read-only, so joins are never refused for want of
// a login - but one socket may only hold so many client-chosen rooms. A match
// takes four rooms (see matchRooms), so this is 20 matches at once.
export const MAX_ROOMS_PER_SOCKET = 80;
const MAX_ROOM_ID_LENGTH = 128;

/**
 * Room ids come straight from an anonymous client. Anything but a short
 * string/number is ignored: an array would join every entry in one call (and so
 * step around the limit), and an object is never a room we emit to.
 */
const toRoomId = (value) => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const id = String(value);
  return id && id.length <= MAX_ROOM_ID_LENGTH ? id : null;
};

const matchRooms = (matchId) => [
  // Canonical room: match-${matchId}
  matchRoom(matchId),
  // Legacy aliases (kept for backward compat with existing clients)
  String(matchId),
  `imatch_${matchId}`,
  `m_${matchId}`,
];

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

    // Client-chosen rooms this socket holds, oldest first.
    const heldRooms = new Set();

    // Past the limit the oldest room is dropped rather than the new join refused.
    // Some live components join a match and never leave it, so a visitor who
    // opens many matches in one session would otherwise stop getting updates on
    // the page in front of them.
    const joinRooms = (rooms) => {
      for (const room of rooms) {
        heldRooms.delete(room); // a re-join counts as recent again
        heldRooms.add(room);
        socket.join(room);
      }
      for (const room of heldRooms) {
        if (heldRooms.size <= MAX_ROOMS_PER_SOCKET) break;
        heldRooms.delete(room);
        socket.leave(room);
      }
    };

    const leaveRooms = (rooms) => {
      for (const room of rooms) {
        heldRooms.delete(room);
        socket.leave(room);
      }
    };

    socket.on("joinRoom", (value) => {
      const roomId = toRoomId(value);
      if (!roomId) return;
      joinRooms([roomId]);
      if (shouldLogSocket()) {
        slog.info({ room: roomId }, "socket join room");
      }
    });

    socket.on("leaveRoom", (value) => {
      const roomId = toRoomId(value);
      if (roomId) leaveRooms([roomId]);
    });

    const joinAllMatchRooms = (value) => {
      const matchId = toRoomId(value);
      if (matchId) joinRooms(matchRooms(matchId));
    };

    const leaveAllMatchRooms = (value) => {
      const matchId = toRoomId(value);
      if (matchId) leaveRooms(matchRooms(matchId));
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
    // `payload?.` and not a destructured parameter: a client can send null, which
    // a default does not cover, and a throw here takes the whole process down.
    legacyJoinHandlers.forEach((ev) => {
      socket.on(ev, (payload) => joinAllMatchRooms(payload?.matchId || payload?.id));
    });
    legacyLeaveHandlers.forEach((ev) => {
      socket.on(ev, (payload) => leaveAllMatchRooms(payload?.matchId || payload?.id));
    });

    socket.on("join-teams", () => { socket.join("teams"); });
    socket.on("join-players", () => { socket.join("players"); });
    socket.on("join-cricket-live", () => { socket.join("cricket-live"); });

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
