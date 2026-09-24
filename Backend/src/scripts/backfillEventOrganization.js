import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { getMongoTarget } from "../utils/mongoTarget.js";
import Event from "../models/Event.js";
import TeamOrganization from "../models/TeamOrganization.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Legacy events stored `organization` as a flat free-text string. Newer events
// (and the current schema + createEvent/updateEvent) store an ObjectId ref to
// TeamOrganization. Migrate the stragglers by matching an existing org by name
// or creating one.
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

  const apply = process.argv.includes("--apply");
  const events = await Event.find({ organization: { $exists: true, $ne: null } }).lean();

  let alreadyRef = 0;
  let legacy = 0;
  let migratedToExisting = 0;
  let createdNew = 0;
  let skipped = 0;

  const skippedDetails = [];

  for (const event of events) {
    const value = event.organization;

    // ObjectId ref (already migrated) or a value that looks like a ref.
    if (value instanceof mongoose.Types.ObjectId || (typeof value === "string" && OBJECT_ID_HEX.test(value))) {
      alreadyRef++;
      continue;
    }

    legacy++;
    const orgName = typeof value === "string" ? value.trim() : "";

    if (!orgName) {
      skipped++;
      skippedDetails.push(`#${event._id} "${event.name}" — empty organization, will be set to null`);
      continue;
    }

    let org = await TeamOrganization.findOne({
      name: { $regex: `^${escapeRegex(orgName)}$`, $options: "i" },
    });

    if (!org) {
      if (!apply) {
        skipped++;
        skippedDetails.push(`#${event._id} "${event.name}" → would create new org "${orgName}"`);
        continue;
      }
      org = await TeamOrganization.create({ name: orgName, isActive: true });
      createdNew++;
    } else {
      migratedToExisting++;
    }

    if (apply) {
      event.organization = org._id;
      // eslint-disable-next-line no-await-in-loop
      await Event.updateOne({ _id: event._id }, { $set: { organization: org._id } });
    }
  }

  console.log(`Mongo host: ${target.host || "unknown"} (db: ${target.databaseName || "?"})`);
  console.log(`Events with a non-null organization field: ${events.length}`);
  console.log(`  Already a valid ref: ${alreadyRef}`);
  console.log(`  Legacy plain-string values: ${legacy}`);
  if (apply) {
    console.log(`  Matched existing TeamOrganization: ${migratedToExisting}`);
    console.log(`  Created new TeamOrganization: ${createdNew}`);
    console.log(`  Set to null (empty value): ${skipped}`);
  } else {
    console.log("Dry-run: nothing written. Re-run with --apply to persist.");
    console.log(`  Would match existing org: ${migratedToExisting}`);
    console.log(`  Would create new org: ${createdNew}`);
    console.log(`  Would set null (empty): ${skipped}`);
  }
  if (skippedDetails.length) {
    console.log("\nDetail:");
    for (const line of skippedDetails.slice(0, 50)) console.log(`  ${line}`);
    if (skippedDetails.length > 50) console.log(`  ... and ${skippedDetails.length - 50} more`);
  }
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });