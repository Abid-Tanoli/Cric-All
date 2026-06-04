import { Server } from "socket.io";

let io;

const matchRoom = (matchId) => `match-${matchId}`;

export const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: true, // Allow all origins during development
      methods: ["GET", "POST", "PUT", "DELETE"],
      credentials: true
    },
    transports: ["websocket", "polling"],
    pingTimeout: 60000,
    pingInterval: 25000
  });

  io.on("connection", (socket) => {
    console.log("⚡ Client connected:", socket.id);

    socket.on("joinRoom", (roomId) => {
      socket.join(roomId);
      console.log(`👥 Socket ${socket.id} joined room: ${roomId}`);
    });

    socket.on("leaveRoom", (roomId) => {
      socket.leave(roomId);
      console.log(`👋 Socket ${socket.id} left room: ${roomId}`);
    });

    socket.on("join-match", (matchId) => {
      socket.join(matchRoom(matchId));
      socket.join(matchId);
      console.log(`🏏 Socket ${socket.id} joined match: ${matchId}`);
    });

    socket.on("leave-match", (matchId) => {
      socket.leave(matchRoom(matchId));
      socket.leave(matchId);
      console.log(`🏏 Socket ${socket.id} left match: ${matchId}`);
    });

    socket.on("join-teams", () => {
      socket.join("teams");
      console.log(`👥 Socket ${socket.id} joined teams room`);
    });

    socket.on("join-players", () => {
      socket.join("players");
      console.log(`👤 Socket ${socket.id} joined players room`);
    });

    socket.on("join-cricket-live", () => {
      socket.join("cricket-live");
      console.log(`🏏 Socket ${socket.id} joined cricket-live room`);
    });

    socket.on("JOIN_IMATCH", ({ matchId, id } = {}) => {
      const roomId = matchId || id;
      if (!roomId) return;
      socket.join(`imatch_${roomId}`);
      socket.join(`m_${roomId}`);
      console.log(`🌍 Socket ${socket.id} joined international match: ${roomId}`);
    });

    socket.on("LEAVE_IMATCH", ({ matchId, id } = {}) => {
      const roomId = matchId || id;
      if (!roomId) return;
      socket.leave(`imatch_${roomId}`);
      socket.leave(`m_${roomId}`);
      console.log(`🌍 Socket ${socket.id} left international match: ${roomId}`);
    });

    socket.on("JOIN_MATCH", ({ matchId, id } = {}) => {
      const roomId = matchId || id;
      if (!roomId) return;
      socket.join(`imatch_${roomId}`);
      socket.join(`m_${roomId}`);
      console.log(`International socket ${socket.id} joined match: ${roomId}`);
    });

    socket.on("LEAVE_MATCH", ({ matchId, id } = {}) => {
      const roomId = matchId || id;
      if (!roomId) return;
      socket.leave(`imatch_${roomId}`);
      socket.leave(`m_${roomId}`);
      console.log(`International socket ${socket.id} left match: ${roomId}`);
    });

    socket.on("JOIN", ({ matchId, id } = {}) => {
      const roomId = matchId || id;
      if (!roomId) return;
      socket.join(`imatch_${roomId}`);
      socket.join(`m_${roomId}`);
    });

    socket.on("LEAVE", ({ matchId, id } = {}) => {
      const roomId = matchId || id;
      if (!roomId) return;
      socket.leave(`imatch_${roomId}`);
      socket.leave(`m_${roomId}`);
    });

    socket.on("match:updateList", () => {
      io.emit("match:updateList");
    });

    socket.on("disconnect", () => {
      console.log("❌ Client disconnected:", socket.id);
    });
  });

  console.log("✅ Socket.IO initialized successfully");
  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized! Call initSocket first.");
  }
  return io;
};

export const emitTeamUpdate = (team) => {
  if (io) {
    io.to("teams").emit("team:updated", team);
    io.emit("team:updated", team);
  }
};

export const emitTeamCreated = (team) => {
  if (io) {
    io.to("teams").emit("team:created", team);
    io.emit("team:created", team);
  }
};

export const emitTeamDeleted = (teamId) => {
  if (io) {
    io.to("teams").emit("team:deleted", { id: teamId });
    io.emit("team:deleted", { id: teamId });
  }
};

export const emitPlayerUpdate = (player) => {
  if (io) {
    io.to("players").emit("player:updated", player);
    io.emit("player:updated", player);
  }
};

export const emitMatchUpdate = (matchId, data) => {
  if (io) {
    io.to(matchRoom(matchId)).emit("match:update", data);
    io.emit("match:update", data);
  }
};

export const emitCricketLiveUpdate = (data) => {
  if (io) {
    io.to("cricket-live").emit("cricket:liveUpdate", data);
    io.emit("cricket:liveUpdate", data);
  }
};

export const emitFieldClick = (matchId, data) => {
  if (io) {
    io.to(matchRoom(matchId)).emit("match:fieldClick", data);
    io.emit("match:fieldClick", data);
  }
};

export const emitAICommentary = (matchId, data) => {
  if (io) {
    io.to(matchRoom(matchId)).emit("match:aiCommentary", data);
    io.emit("match:aiCommentary", data);
  }
};

export const emitBallWithCommentary = (matchId, data) => {
  if (io) {
    io.to(matchRoom(matchId)).emit("match:ballWithCommentary", data);
    io.emit("match:ballWithCommentary", data);
  }
};

export const emitBallUpdate = (matchId, data) => {
  if (io) {
    io.to(matchRoom(matchId)).emit("BALL_UPDATE", data);
  }
};

export const emitMatchStatusChange = (matchId, data) => {
  if (io) {
    io.to(matchRoom(matchId)).emit("MATCH_STATUS_CHANGE", data);
  }
};

export const emitWicketAlert = (matchId, data) => {
  if (io) {
    io.to(matchRoom(matchId)).emit("WICKET_ALERT", data);
  }
};

export const emitMilestoneAlert = (matchId, data) => {
  if (io) {
    io.to(matchRoom(matchId)).emit("MILESTONE_ALERT", data);
  }
};

export const emitInningsComplete = (matchId, data) => {
  if (io) {
    io.to(matchRoom(matchId)).emit("INNINGS_COMPLETE", data);
  }
};

export const emitMatchResult = (matchId, data) => {
  if (io) {
    io.to(matchRoom(matchId)).emit("MATCH_RESULT", data);
    io.emit("MATCH_RESULT", data);
  }
};

export const emitDRSUpdate = (matchId, data) => {
  if (io) {
    io.to(matchRoom(matchId)).emit("DRS_UPDATE", data);
  }
};

export const emitReviewDecision = (matchId, data) => {
  if (io) {
    io.to(matchRoom(matchId)).emit("REVIEW_DECISION", data);
  }
};

export const emitUmpireSignal = (matchId, signal) => {
  if (io) {
    io.to(matchRoom(matchId)).emit("UMPIRE_SIGNAL", { signal, timestamp: new Date() });
  }
};
