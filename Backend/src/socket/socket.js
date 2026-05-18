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
