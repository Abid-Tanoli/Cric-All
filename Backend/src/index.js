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
import { hasCricApiKey, hasExternalCricketProvider } from "./services/cricketDataService.js";

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
  console.log(`${req.method} ${req.originalUrl}`);
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
app.use("/api/intl", internationalRoutes);

// New team categorization routes
app.use("/api/team-categories", teamCategoryRoutes);
app.use("/api/organizations", organizationRoutes);
app.use("/api/rankings-v2", rankingRoutes);

// Optional external sync routes.
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

const PORT = process.env.PORT || 5000;
const shouldListen = process.env.VERCEL !== "1";
const externalSyncEnabled = process.env.ENABLE_EXTERNAL_SYNC === "true" || process.env.ENABLE_ESPN_SYNC === "true";

// Seed default team categories on startup
import TeamCategory from "./models/TeamCategory.js";
(async () => {
  try {
    await TeamCategory.seedDefaults();
    console.log("Default team categories seeded");
  } catch (e) {
    // ignore if already seeded
  }
})();

if (shouldListen) {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Socket.IO ready for connections`);
    console.log(`CORS enabled for configured origins`);

    // Start cricket polling if API key is configured (OPTIONAL)
    if (hasCricApiKey()) {
      cricketPolling.start();
      console.log(`External cricket API polling started`);
    }

    // Start international live score poller
    if (hasExternalCricketProvider()) {
      startInternationalPoller(io);
      console.log(`International live score poller started`);
    } else {
      console.log('International live score poller disabled (add RAPIDAPI_KEY or CRICKET_API_KEY to enable)');
    }

    // Start external sync scheduler only when explicitly enabled.
    // It is optional and requires outbound internet/DNS access.
    if (externalSyncEnabled) {
      startSyncScheduler();
      console.log(`External sync scheduler started`);
    } else {
      console.log(`External sync scheduler disabled (set ENABLE_EXTERNAL_SYNC=true to enable)`);
    }

    // No warning - external API is completely optional
  });
}

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
