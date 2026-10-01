import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Invitation from "../models/Invitation.js";
import TeamOrganization from "../models/TeamOrganization.js";
import { getMongoTarget } from "../utils/mongoTarget.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDir, "../../.env") });

async function main() {
  const url = process.env.MONGO_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!url) throw new Error("MONGO_URL / MONGODB_URI / MONGO_URI is required.");

  const { host, databaseName } = getMongoTarget(url);
  const hostname = host.replace(/^.*@/, "").split(":")[0].replace(/^\[|\]$/g, "");
  if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) {
    throw new Error("Refusing to inspect or modify a non-local MongoDB target.");
  }

  const apply = process.argv.includes("--apply");
  await mongoose.connect(url, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
  try {
    const organizations = await TeamOrganization.find({}, { _id: 1 }).lean();
    const existingIds = new Set(organizations.map((org) => String(org._id)));
    const invitations = await Invitation.find({}, { _id: 1, organization: 1, email: 1, status: 1 }).lean();
    const orphans = invitations.filter((invitation) => !existingIds.has(String(invitation.organization)));

    console.log(`Target: local MongoDB database ${databaseName || "(unnamed)"}`);
    console.log(`Orphan invitations found: ${orphans.length}`);
    if (!apply) {
      console.log("Dry run only. Re-run with --apply to delete these rows.");
      return;
    }

    let deleted = 0;
    for (const invitation of orphans) {
      const result = await Invitation.deleteOne({ _id: invitation._id, organization: invitation.organization });
      deleted += result.deletedCount || 0;
    }
    console.log(`Deleted orphan invitations: ${deleted}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
