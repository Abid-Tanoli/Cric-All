import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { getMongoTarget } from "../utils/mongoTarget.js";
import User from "../models/User.js";
import TeamOrganization from "../models/TeamOrganization.js";
import Membership from "../models/Membership.js";
import { recordAudit, SYSTEM_ACTOR } from "../utils/audit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// ---------------------------------------------------------------------------
// Phase 2 helper: assign/transfer the owner of an organization.
//
// Organizations created by the Admin app before Phase 2 have no owner, so
// nobody can self-manage them. This script links one to a User account:
//
//   node src/scripts/setOrgOwner.js --list-unowned
//   node src/scripts/setOrgOwner.js --org=<orgId> --email=<user@email>          # dry-run
//   node src/scripts/setOrgOwner.js --org=<orgId> --email=<user@email> --apply  # write
//
// --apply sets `owner` (the owner is an implicit admin and needs no member
// entry). The previous owner (if any) is replaced — the script prints the old
// value first. Nothing is ever deleted.
// ---------------------------------------------------------------------------

function argValue(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function main() {
  const url = process.env.MONGO_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!url) throw new Error("MONGO_URL / MONGODB_URI / MONGO_URI is required.");

  const apply = process.argv.includes("--apply");
  const orgId = argValue("org");
  const email = argValue("email");
  const listUnowned = process.argv.includes("--list-unowned");

  const target = getMongoTarget(url);
  await mongoose.connect(url, {
    serverSelectionTimeoutMS: 60000,
    connectTimeoutMS: 60000,
    socketTimeoutMS: 120000,
  });

  console.log(`Mongo host: ${target.host || "unknown"} (db: ${target.databaseName || "?"})`);
  console.log(`Mode: ${apply ? "APPLY" : "dry-run"}`);
  console.log("");

  if (listUnowned) {
    const unowned = await TeamOrganization.find({ $or: [{ owner: null }, { owner: { $exists: false } }] })
      .select("name category isActive createdAt")
      .sort({ name: 1 })
      .lean();
    console.log(`Organizations without an owner: ${unowned.length}`);
    for (const org of unowned) {
      console.log(`  - ${org._id}  ${org.name}`);
    }
    console.log("\nAssign one with: --org=<orgId> --email=<user email> [--apply]");
    return;
  }

  if (!orgId || !email) {
    throw new Error("Usage: --org=<orgId> --email=<user email> [--apply]  or  --list-unowned");
  }
  if (!mongoose.Types.ObjectId.isValid(orgId)) {
    throw new Error("--org must be a valid ObjectId.");
  }

  const org = await TeamOrganization.findById(orgId);
  if (!org) throw new Error(`Organization ${orgId} not found.`);

  const user = await User.findOne({ email: String(email).trim().toLowerCase() });
  if (!user) throw new Error(`No User account with email ${email}.`);

  const currentOwner = org.owner ? String(org.owner) : "(none)";
  const alreadyOwner = org.owner && org.owner.equals(user._id);

  console.log(`Organization: ${org._id}  "${org.name}"`);
  console.log(`Current owner: ${currentOwner}`);
  console.log(`New owner:     ${user._id}  ${user.email} (${user.name})`);
  console.log(`  already owner: ${alreadyOwner ? "yes — no change needed" : "no"}`);

  if (alreadyOwner) {
    console.log("\nNothing to do.");
    return;
  }

  if (!apply) {
    console.log("\nDry-run: nothing written. Re-run with --apply to persist.");
    return;
  }

  await TeamOrganization.updateOne({ _id: org._id }, { $set: { owner: user._id } });
  // The permission layer reads Membership, not the pointer, so the owner row
  // has to exist for this person to actually be able to manage the org.
  await Membership.updateOne(
    { organization: org._id, user: user._id },
    {
      $set: {
        roles: ["owner"],
        status: "active",
        source: "admin",
        removedAt: null,
        joinedAt: new Date(),
      },
    },
    { upsert: true }
  );
  await recordAudit({
    action: "org.owner_assigned_by_script",
    organization: org._id,
    targetType: "user",
    targetId: user._id,
    targetLabel: user.email,
    actor: SYSTEM_ACTOR,
    metadata: { previousOwner: currentOwner },
  });

  console.log("\nOwner updated (org.owner + owner Membership).");
}

main()
  .catch((error) => {
    console.error("setOrgOwner failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
