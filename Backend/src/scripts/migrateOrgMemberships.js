import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { getMongoTarget } from "../utils/mongoTarget.js";
import User from "../models/User.js";
import TeamOrganization from "../models/TeamOrganization.js";
import Membership from "../models/Membership.js";
import Invitation from "../models/Invitation.js";
import { generateOrgSlug } from "../services/membershipService.js";
import { recordAudit, SYSTEM_ACTOR } from "../utils/audit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// ---------------------------------------------------------------------------
// Phase 2 migration: backfill the Membership collection from the legacy
// TeamOrganization.owner / TeamOrganization.members[] fields, and give every
// organization a public slug.
//
//   node src/scripts/migrateOrgMemberships.js            # dry-run (default)
//   node src/scripts/migrateOrgMemberships.js --apply    # write
//
// Dry-run is the default and prints exactly what --apply would change. Nothing
// is ever deleted: rows are created or updated and the legacy fields are left
// in place (Membership is the source of truth from here on; the legacy array
// only keeps older reads rendering).
//
// Rollback: --rollback --apply deletes only the Membership rows whose
// `source` is "migration". Generated slugs are left alone — they are public
// handles, not permissions.
// ---------------------------------------------------------------------------

const LEGACY_ROLE_MAP = {
  admin: ["admin"],
  member: ["player"],
};

async function main() {
  const url = process.env.MONGO_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!url) throw new Error("MONGO_URL / MONGODB_URI / MONGO_URI is required.");

  const apply = process.argv.includes("--apply");
  const rollback = process.argv.includes("--rollback");
  const target = getMongoTarget(url);

  await mongoose.connect(url, {
    serverSelectionTimeoutMS: 60000,
    connectTimeoutMS: 60000,
    socketTimeoutMS: 120000,
  });

  console.log(`Mongo host: ${target.host || "unknown"} (db: ${target.databaseName || "?"})`);
  console.log(`Mode: ${apply ? (rollback ? "APPLY (rollback)" : "APPLY") : "dry-run"}`);
  console.log("");

  if (rollback) {
    const preview = await Membership.countDocuments({ source: "migration" });
    const withSlug = await TeamOrganization.countDocuments({ slug: { $exists: true, $ne: null } });
    console.log(`Membership rows with source="migration" to delete: ${preview}`);
    console.log(`Organizations currently carrying a slug (left in place): ${withSlug}`);
    if (!apply) {
      console.log("\nDry-run: nothing written. Re-run with --apply to perform the rollback.");
      return;
    }
    const result = await Membership.deleteMany({ source: "migration" });
    await recordAudit({
      action: "migration.org_memberships_rolled_back",
      actor: SYSTEM_ACTOR,
      metadata: { deletedMemberships: result.deletedCount },
    });
    console.log(`\nRollback applied: ${result.deletedCount} membership row(s) removed.`);
    return;
  }

  const orgs = await TeamOrganization.find({}).lean();
  console.log(`Organizations to inspect: ${orgs.length}\n`);

  let ownerRows = 0;
  let memberRows = 0;
  let orphanOwners = 0;
  let missingSlug = 0;
  let changedOrgs = 0;

  for (const org of orgs) {
    const wanted = [];

    if (org.owner) {
      const ownerUser = await User.findById(org.owner).select("_id").lean();
      if (ownerUser) {
        wanted.push({ user: ownerUser._id, roles: ["owner"] });
      } else {
        orphanOwners += 1;
        console.log(`  ! ${org.name}: owner ${org.owner} is not in User — assign a new one with setOrgOwner.js`);
      }
    }

    for (const entry of org.members || []) {
      if (!entry?.user) continue;
      if (org.owner && String(org.owner) === String(entry.user)) continue;
      const exists = await User.findById(entry.user).select("_id").lean();
      if (!exists) {
        console.log(`  ! ${org.name}: legacy member ${entry.user} is not in User — skipped`);
        continue;
      }
      wanted.push({ user: exists._id, roles: LEGACY_ROLE_MAP[entry.role] || ["player"] });
    }

    const existing = await Membership.find({ organization: org._id }).select("user roles").lean();
    const byUser = new Map(existing.map((m) => [String(m.user), m]));

    const changes = wanted
      .filter((entry) => {
        const current = byUser.get(String(entry.user));
        return !current || (current.roles || []).join(",") !== entry.roles.join(",");
      })
      .map((entry) => ({ ...entry, isUpdate: Boolean(byUser.get(String(entry.user))) }));

    const needsSlug = !org.slug;
    if (needsSlug) missingSlug += 1;

    const owners = changes.filter((c) => c.roles.includes("owner")).length;
    ownerRows += owners;
    memberRows += changes.length - owners;

    if (changes.length > 0 || needsSlug) {
      changedOrgs += 1;
      console.log(
        `  ${org.name} (${org._id})\n` +
          `      owner rows: ${owners}   other rows: ${changes.length - owners}` +
          `${needsSlug ? "   slug: MISSING" : ""}`,
      );
    }

    if (!apply) continue;

    if (needsSlug) {
      await TeamOrganization.updateOne(
        { _id: org._id },
        { $set: { slug: await generateOrgSlug(org.name, org._id) } }
      );
    }

    for (const change of changes) {
      await Membership.updateOne(
        { organization: org._id, user: change.user },
        {
          $set: {
            roles: change.roles,
            status: "active",
            source: "migration",
            joinedAt: org.createdAt || new Date(),
          },
        },
        { upsert: true }
      );
    }

    if (changes.length > 0) {
      await recordAudit({
        action: "migration.org_memberships_backfilled",
        organization: org._id,
        targetType: "organization",
        targetId: org._id,
        targetLabel: org.name,
        actor: SYSTEM_ACTOR,
        metadata: { owners, members: changes.length - owners },
      });
    }
  }

  const totalMemberships = await Membership.countDocuments();
  const pendingInvitations = await Invitation.countDocuments({ status: "pending" });

  console.log("");
  console.log("Summary");
  console.log(`  organizations needing changes   : ${changedOrgs}`);
  console.log(`  owner Membership rows to write  : ${ownerRows}`);
  console.log(`  member Membership rows to write : ${memberRows}`);
  console.log(`  organizations missing a slug     : ${missingSlug}`);
  console.log(`  owners pointing at a missing user: ${orphanOwners}`);
  console.log(`  Membership rows already present  : ${totalMemberships}`);
  console.log(`  pending invitations (untouched)   : ${pendingInvitations}`);

  if (!apply) {
    console.log("\nDry-run: nothing written. Re-run with --apply to persist.");
  } else {
    console.log("\nMigration applied. Run `npm run org:audit` to verify every organization kept at least one owner.");
  }
}

main()
  .catch((error) => {
    console.error("migrateOrgMemberships failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
