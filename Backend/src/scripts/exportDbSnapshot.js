import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { getMongoTarget } from "../utils/mongoTarget.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const COLLECTIONS = [
  "teams",
  "players",
  "matches",
  "users",
  "admins",
  "innings",
  "balls",
  "commentary",
  "commentaries",
];

const SENSITIVE_KEY_PATTERN = /(password|hash|token|secret|salt|otp|reset|verification)/i;

function parseDatabaseName() {
  const dbArg = process.argv.find((arg) => arg.startsWith("--db="));
  const databaseName = dbArg?.split("=", 2)[1]?.trim();

  if (!databaseName) {
    throw new Error("Missing database argument. Use --db=cric-all or --db=test.");
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(databaseName)) {
    throw new Error("Unsafe database name. Use only letters, numbers, hyphen, or underscore.");
  }

  return databaseName;
}

function sanitizeDocument(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDocument(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value.toHexString === "function") {
    return value.toHexString();
  }

  const sanitized = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    sanitized[key] = sanitizeDocument(nestedValue);
  }
  return sanitized;
}

async function connectToMongo() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGO_URI;
  if (!mongoUrl) {
    throw new Error("MONGO_URL or MONGO_URI is required.");
  }

  const target = getMongoTarget(mongoUrl);

  await mongoose.connect(mongoUrl, {
    serverSelectionTimeoutMS: 60000,
    connectTimeoutMS: 60000,
    socketTimeoutMS: 120000,
    heartbeatFrequencyMS: 15000,
    maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 20),
    minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE || 1),
  });

  console.log(`Connected to MongoDB host: ${target.host || "unknown"}`);
}

async function exportDatabaseSnapshot(databaseName) {
  const db = mongoose.connection.client.db(databaseName);
  const existingCollections = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((collection) => collection.name));
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.resolve(__dirname, "../../backups", databaseName, timestamp);
  const counts = {};

  await fs.mkdir(backupDir, { recursive: true });

  for (const collectionName of COLLECTIONS) {
    if (!existingCollections.has(collectionName)) {
      counts[collectionName] = 0;
      continue;
    }

    const docs = await db.collection(collectionName).find({}).toArray();
    const sanitizedDocs = docs.map((doc) => sanitizeDocument(doc));
    const filePath = path.join(backupDir, `${collectionName}.json`);
    await fs.writeFile(filePath, `${JSON.stringify(sanitizedDocs, null, 2)}\n`, "utf8");
    counts[collectionName] = sanitizedDocs.length;
  }

  await fs.writeFile(
    path.join(backupDir, "_snapshot.json"),
    `${JSON.stringify({ databaseName, exportedAt: new Date().toISOString(), counts }, null, 2)}\n`,
    "utf8",
  );

  console.log(`Exported database: ${databaseName}`);
  console.log(`Backup directory: ${backupDir}`);
  for (const collectionName of COLLECTIONS) {
    console.log(`${collectionName}: ${counts[collectionName] || 0}`);
  }
}

const databaseName = parseDatabaseName();

connectToMongo()
  .then(() => exportDatabaseSnapshot(databaseName))
  .catch((error) => {
    console.error("Export failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
