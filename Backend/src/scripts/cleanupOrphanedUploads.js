import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { getMongoTarget } from "../utils/mongoTarget.js";
import {
  uploadsDir,
  listUploadedFilenames,
  uploadFilenameFromUrl,
  isUploadedFilename,
} from "../utils/photoStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// Every stored image-bearing path across the models. Paths are resolved
// through nested arrays (media.url == team.media[].url, sponsors.logo, ...).
const REFERENCE_QUERIES = [
  ["players", "imageUrl"],
  ["players", "gallery.url"],
  ["players", "videos.url"],
  ["teams", "logo"],
  ["teams", "media.url"],
  ["events", "logo"],
  ["events", "images.url"],
  ["events", "sponsors.logo"],
  ["blogs", "imageUrl"],
  ["series", "logo"],
  ["tournaments", "logo"],
  ["tournaments", "sponsors.logo"],
  ["teamorganizations", "logoUrl"],
  ["incubationgroups", "logo"],
  ["incubationgroups", "images.url"],
];

function getByPath(doc, dottedPath) {
  const parts = dottedPath.split(".");
  const visit = (value, index) => {
    const key = parts[index];
    if (value == null) return [];
    if (Array.isArray(value)) {
      const out = [];
      for (const item of value) out.push(...visit(item, index));
      return out;
    }
    if (index === parts.length - 1) return [value];
    return visit(value[key], index + 1);
  };
  return visit(doc, 0).filter((value) => typeof value === "string" && value);
}

async function collectionExists(db, name) {
  const found = await db.listCollections({ name }, { nameOnly: true }).toArray();
  return found.length > 0;
}

async function collectReferencedFilenames(db) {
  const referenced = new Set();
  const stats = [];

  for (const [collectionName, fieldPath] of REFERENCE_QUERIES) {
    if (!(await collectionExists(db, collectionName))) continue;
    const docs = await db
      .collection(collectionName)
      .find({}, { projection: { [fieldPath.split(".")[0]]: 1 } })
      .toArray();

    let refs = 0;
    for (const doc of docs) {
      for (const value of getByPath(doc, fieldPath)) {
        const filename = uploadFilenameFromUrl(value);
        if (filename) {
          referenced.add(filename);
          refs++;
        }
      }
    }
    stats.push(`${collectionName}.${fieldPath}: ${refs}`);
  }

  return { referenced, stats };
}

async function main() {
  const url = process.env.MONGO_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!url) {
    throw new Error("MONGO_URL / MONGODB_URI / MONGO_URI is required.");
  }

  const target = getMongoTarget(url);
  await mongoose.connect(url, {
    serverSelectionTimeoutMS: 60000,
    connectTimeoutMS: 60000,
    socketTimeoutMS: 120000,
  });

  console.log(`Connected to MongoDB host: ${target.host || "unknown"} (db: ${target.databaseName || "?"})`);
  console.log(`Scanning uploads dir: ${uploadsDir}`);

  const { referenced, stats } = await collectReferencedFilenames(mongoose.connection.db);

  const files = await listUploadedFilenames();
  const orphaned = [];
  const skipped = [];
  for (const name of files) {
    if (referenced.has(name)) continue;
    if (isUploadedFilename(name)) orphaned.push(name);
    else skipped.push(name);
  }

  const apply = process.argv.includes("--apply");
  let deleted = 0;
  if (apply) {
    for (const name of orphaned) {
      const target = path.normalize(path.join(uploadsDir, name));
      if (!target.startsWith(uploadsDir + path.sep)) continue;
      try {
        await fs.promises.unlink(target);
        deleted++;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }

  console.log("\nReference counts (per field):");
  for (const line of stats) console.log(`  ${line}`);
  console.log(`\nFiles on disk: ${files.length}`);
  console.log(`Referenced (still in use): ${referenced.size}`);
  console.log(`Orphaned uploads: ${orphaned.length}`);
  console.log(`Non-upload files skipped: ${skipped.length}`);
  if (apply) {
    console.log(`Deleted: ${deleted}`);
  } else {
    console.log("Dry-run: no files deleted. Re-run with --apply to remove orphaned files.");
    if (orphaned.length) console.log(`Orphaned sample: ${orphaned.slice(0, 5).join(", ")}`);
  }
}

main()
  .catch((error) => {
    console.error("Cleanup failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });