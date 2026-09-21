import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import connectDB, { getDbState, isDbConnected } from "./utils/db.js";
import { initSocket } from "./socket/socket.js";
import { corsOrigin } from "./config/cors.js";

import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import playerRoutes from "./routes/playerRoutes.js";
import matchRoutes from "./routes/matchRoutes.js";
import teamRoutes from "./routes/teamRoutes.js";
import liveMatchRoutes from "./routes/liveMatchRoutes.js";
import errorHandler from "./middleware/errorHandler.js";
import log from "./utils/logger.js";
import { initSentry, sentryMiddleware, captureException } from "./utils/sentry.js";
import tournamentRoutes from "./routes/tournamentRoutes.js";
import eventRoutes from "./routes/eventRoutes.js";
import bulkImportRoutes from "./routes/bulkImportRoutes.js";
import rankingsRoutes from "./routes/rankingsRoutes.js";
import blogRoutes from "./routes/blogRoutes.js";
import cricketApiRoutes from "./routes/cricketApiRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import seriesRoutes from "./routes/seriesRoutes.js";
import internationalRoutes from "./routes/international.js";

// New team categorization routes
import teamCategoryRoutes from "./routes/teamCategoryRoutes.js";
import organizationRoutes from "./routes/organizationRoutes.js";
import rankingRoutes from "./routes/rankingRoutes.js";
import syncRoutes from "./routes/syncRoutes.js";
import settingsRoutes from "./routes/settingsRoutes.js";
import { startExternalSyncManager } from "./controllers/settingsController.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import { uploadsDir, ensureUploadsDir } from "./utils/photoStore.js";

initSentry();

const app = express();

const dbReadyPromise = connectDB();

const corsOptions = {
  origin: corsOrigin,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

app.use(helmet());

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// Local image uploads (Task 6). Ensure the dir exists once at boot; when cloud
// storage env vars (CLOUDINARY_URL / S3_BUCKET) are configured the endpoints
// still respond, redirecting the uploader to configure the adapter instead.
ensureUploadsDir();
app.use("/uploads", express.static(uploadsDir));

const server = http.createServer(app);

const io = initSocket(server);

app.use((req, res, next) => {
  req.io = io;
  next();
});

app.use((req, res, next) => {
  if (process.env.LOG_REQUESTS === "true") {
    log.info({ method: req.method, url: req.originalUrl }, `${req.method} ${req.originalUrl}`);
  }
  next();
});

const databaseBackedPrefixes = [
  "/api/auth",
  "/api/admin",
  "/api/players",
  "/api/matches",
  "/api/teams",
  "/api/livematch",
  "/api/tournaments",
  "/api/events",
  "/api/bulk-import",
  "/api/rankings",
  "/api/blogs",
  "/api/categories",
  "/api/series",
  "/api/team-categories",
  "/api/organizations",
  "/api/rankings-v2",
  "/api/sync",
  "/api/settings",
  "/api/shots",
  "/api/fielding-positions"
];

const emptyCollectionResponses = {
  "/api/blogs": [],
  "/api/categories": [],
  "/api/events": [],
  "/api/matches": [],
  "/api/series": [],
  "/api/team-categories": [],
  "/api/teams": [],
  "/api/tournaments": [],
  "/api/shots": { shots: [], grouped: { attacking: [], defensive: [], glancing: [] } },
  "/api/fielding-positions": []
};

app.use((req, res, next) => {
  if (isDbConnected()) return next();

  const isDatabaseBacked = databaseBackedPrefixes.some((prefix) => (
    req.path === prefix || req.path.startsWith(`${prefix}/`)
  ));

  if (!isDatabaseBacked) return next();

  if (req.method === "GET" && Object.hasOwn(emptyCollectionResponses, req.path)) {
    res.set("X-BQ-DB-State", getDbState());
    return res.status(200).json(emptyCollectionResponses[req.path]);
  }

  if (req.method === "GET" && req.path === "/api/players") {
    res.set("X-BQ-DB-State", getDbState());
    return res.status(200).json({
      players: [],
      totalPlayers: 0,
      totalPages: 0,
      currentPage: Number(req.query.page || 1)
    });
  }

  if (req.method === "GET" && req.path.startsWith("/api/players/rankings")) {
    res.set("X-BQ-DB-State", getDbState());
    return res.status(200).json([]);
  }

  if (req.method === "GET" && (req.path === "/api/rankings" || req.path.startsWith("/api/rankings-v2"))) {
    res.set("X-BQ-DB-State", getDbState());
    return res.status(200).json([]);
  }

  return res.status(503).json({
    message: "Database is not connected yet.",
    dbState: getDbState()
  });
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
app.use("/api/upload", uploadRoutes);
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

// Runtime toggles for external API sync / free Cricbuzz provider.
app.use("/api/settings", settingsRoutes);

// Cricket shots & fielding positions routes
import shotRoutes from "./routes/shotRoutes.js";
import fieldingPositionRoutes from "./routes/fieldingPositionRoutes.js";
import commentaryRoutes from "./routes/commentaryRoutes.js";
app.use("/api/shots", shotRoutes);
app.use("/api/fielding-positions", fieldingPositionRoutes);
app.use("/api/commentary", commentaryRoutes);

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "ok",
    dbState: getDbState(),
    dbConnected: isDbConnected(),
    message: "CricAll API is running",
    timestamp: new Date().toISOString()
  });
});

app.get("/", (req, res) => {
  res.json({
    message: "CricAll API Server",
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

app.use(sentryMiddleware);
app.use(errorHandler);

app.use((req, res) => {
  res.status(404).json({
    message: "Route not found",
    path: req.path
  });
});

const PORT = process.env.PORT || 5000;
const shouldListen = process.env.VERCEL !== "1";

// Seed default team categories on startup
import TeamCategory from "./models/TeamCategory.js";
(async () => {
  try {
    const connection = await dbReadyPromise;
    if (!connection) return;
    await TeamCategory.seedDefaults();
    console.log("Default team categories seeded");
  } catch (e) {
    // ignore if already seeded
  }
})();

// Seed master data (cricket shots & fielding positions) on startup
import { seedCricketShots } from "./seed/cricketShots.js";
import { seedFieldingPositions } from "./seed/fieldingPositions.js";
(async () => {
  try {
    await seedCricketShots();
    await seedFieldingPositions();
  } catch (e) {
    // ignore if already seeded
  }
})();

if (shouldListen) {
  server.listen(PORT, () => {
    log.info({ port: PORT }, `CricAll API running on port ${PORT}`);
    log.info('Socket.IO ready for connections');
    log.info('CORS enabled for configured origins');

    // External live providers are optional and can consume quota, so they only
    // run when explicitly enabled. The runtime sync manager re-reads the
    // SystemSettings document on a short interval (and right after any PUT to
    // /api/settings/external-api), so sync can be toggled on/off without a restart.
    //
    // The first evaluateExternalSync() reads SystemSettings (via
    // systemsettings.findOne()), so it must wait for the Mongo connection. The
    // HTTP server itself stays un-blocked — only the sync manager's first run
    // waits on the dbReadyPromise to avoid the startup MongooseError.
    (async () => {
      const connection = await dbReadyPromise;
      if (!connection) return;
      startExternalSyncManager(io);
      log.info('External sync manager started (see GET /api/settings/external-api)');
    })().catch((err) => {
      log.error(err, 'Failed to start external sync manager');
    });
  });
}

server.on("error", (error) => {
  log.error(error, "Server error");
  process.exit(1);
});

server.on('upgrade', (req, socket, head) => {
  const url = req.url || '';
  // Allow Vite HMR WebSocket to pass through when proxied
  if (url.includes('/@vite') || url.includes('/@react-refresh') || url.includes('__vite_ping')) {
    socket.destroy();
    return;
  }
  // Socket.IO will handle its own upgrades
});

process.on("SIGTERM", () => {
  log.info("SIGTERM signal received: closing HTTP server");
  server.close(() => {
    log.info("HTTP server closed");
    process.exit(0);
  });
});

process.on("unhandledRejection", (reason) => {
  log.error({ reason }, "Unhandled Rejection");
  captureException(reason instanceof Error ? reason : new Error(String(reason)));
});

process.on("uncaughtException", (error) => {
  log.error(error, "Uncaught Exception");
  captureException(error);
  process.exit(1);
});

export default app;
