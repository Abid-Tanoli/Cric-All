import express from "express";
import http from "http";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import connectDB from "./utils/db.js";
import { initSocket } from "./socket/socket.js";

import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import playerRoutes from "./routes/playerRoutes.js";
import matchRoutes from "./routes/matchRoutes.js";
import teamRoutes from "./routes/teamRoutes.js";
import liveMatchRoutes from "./routes/liveMatchRoutes.js";
import errorHandler from "./middleware/errorHandler.js";
import tournamentRoutes from "./routes/tournamentRoutes.js";
import eventRoutes from "./routes/eventRoutes.js";
import bulkImportRoutes from "./routes/bulkImportRoutes.js";
import rankingsRoutes from "./routes/rankingsRoutes.js";
import blogRoutes from "./routes/blogRoutes.js";
import cricketApiRoutes from "./routes/cricketApiRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import seriesRoutes from "./routes/seriesRoutes.js";
import cricketPolling from "./services/cricketPolling.js";
import internationalRoutes from "./routes/international.js";
import { startPoller as startInternationalPoller } from "./services/internationalPoller.js";

// New team categorization routes
import teamCategoryRoutes from "./routes/teamCategoryRoutes.js";
import organizationRoutes from "./routes/organizationRoutes.js";
import rankingRoutes from "./routes/rankingRoutes.js";
import syncRoutes from "./routes/syncRoutes.js";
import { startSyncScheduler } from "./services/syncScheduler.js";

dotenv.config();

const app = express();

connectDB();

const corsOptions = {
  origin: true, // Allow all origins during development
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

const server = http.createServer(app);

const io = initSocket(server);

app.use((req, res, next) => {
  req.io = io;
  next();
});

app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/players", playerRoutes);
app.use("/api/matches", matchRoutes);
app.use("/api/teams", teamRoutes);
app.use("/api/livematch", liveMatchRoutes);
app.use("/api/tournaments", tournamentRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/bulk-import", bulkImportRoutes);
app.use("/api/rankings", rankingsRoutes);
app.use("/api/blogs", blogRoutes);
app.use("/api/cricket", cricketApiRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/series", seriesRoutes);
app.use("/api/international", internationalRoutes);

// New team categorization routes
app.use("/api/team-categories", teamCategoryRoutes);
app.use("/api/organizations", organizationRoutes);
app.use("/api/rankings-v2", rankingRoutes);

// ESPNcricinfo sync routes (free, no API key needed)
app.use("/api/sync", syncRoutes);

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Server is running",
    timestamp: new Date().toISOString()
  });
});

app.get("/", (req, res) => {
  res.json({
    message: "BQ-Play API Server",
    version: "1.0.0",
    endpoints: {
      auth: "/api/auth",
      admin: "/api/admin",
      players: "/api/players",
      matches: "/api/matches",
      teams: "/api/teams",
      livematch: "/api/livematch"
    }
  });
});

app.use(errorHandler);

app.use((req, res) => {
  res.status(404).json({
    message: "Route not found",
    path: req.path
  });
});

const PORT = process.env.PORT || 8000;

// Seed default team categories on startup
import TeamCategory from "./models/TeamCategory.js";
(async () => {
  try {
    await TeamCategory.seedDefaults();
    console.log("📁 Default team categories seeded");
  } catch (e) {
    // ignore if already seeded
  }
})();

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Socket.IO ready for connections`);
  console.log(`🌐 CORS enabled for all origins (development mode)`);

  // Start cricket polling if API key is configured (OPTIONAL)
  if (process.env.CRICKET_API_KEY && process.env.CRICKET_API_KEY !== 'your_api_key_here' && process.env.CRICKET_API_KEY.trim() !== '') {
    cricketPolling.start();
    console.log(`🏏 External Cricket API polling started (OPTIONAL FEATURE)`);
  }

  // Start international live score poller
  if (process.env.CRICKET_API_KEY && process.env.CRICKET_API_KEY !== 'your_api_key_here' && process.env.CRICKET_API_KEY.trim() !== '') {
    startInternationalPoller(io);
    console.log(`🌍 International live score poller started`);
  }

  // Start ESPNcricinfo sync scheduler (free, no API key needed)
  startSyncScheduler();
  console.log(`🔄 ESPNcricinfo sync scheduler started`);

  // No warning - external API is completely optional
});

server.on("error", (error) => {
  console.error("Server error:", error);
  process.exit(1);
});

process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

export default app;