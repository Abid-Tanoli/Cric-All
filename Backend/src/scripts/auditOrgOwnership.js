import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { getMongoTarget } from "../utils/mongoTarget.js";
import TeamOrganization from "../models/TeamOrganization.js";
import Membership from "../models/Membership.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// ---------------------------------------------------------------------------
// Read-only integrity report for the Phase 2 organization model. Never writes.
//
//   npm run org:audit
//
// Checks the invariants that must hold after migrateOrgMemberships:
//   1. every organization has at least one active Membership with role "owner"
//   2. every Membership points at an organization and a user that still exist
//   3. no organization is missing a slug
//   4. the deprecated org.members[] array agrees with the Membership rows
// ---------------------------------------------------------------------------

async function main() {
  const url = process.env.MONGO_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!url) throw new Error("MONGO_URL / MONGODB_URI / MONGO_URI is required.");

  const target = getMongoTarget(url);
  await mongoose.connect(url, { serverSelectionTimeoutMS: 60000, socketTimeoutMS: 120000 });

  console.log(`Mongo host: ${target.host || "unknown"} (db: ${target.databaseName || "?"})`);
  console.log("Read-only audit — nothing is written.\n");

  const orgs = await TeamOrganization.find({}).lean();
  const noOwner = [];
  const noSlug = [];
  const legacyMismatch = [];

  for (const org of orgs) {
    const ownerCount = await Membership.countDocuments({
      organization: org._id,
      status: "active",
      roles: "owner",
    });
    if (ownerCount === 0) noOwner.push({ id: org._id, name: org.name, pointer: org.owner || null });
    if (!org.slug) noSlug.push({ id: org._id, name: org.name });

    const active = await Membership.find({ organization: org._id, status: "active" })
      .select("user roles")
      .lean();
    const expected = active
      .filter((m) => !(m.roles || []).includes("owner"))
      .map((m) => String(m.user))
      .sort();
    const legacy = (org.members || []).map((m) => String(m.user)).sort();
    if (expected.join(",") !== legacy.join(",")) {
      legacyMismatch.push({ id: org._id, name: org.name, membership: expected.length, legacy: legacy.length });
    }
  }

  const orphanMemberships = await Membership.aggregate([
    {
      $lookup: {
        from: "teamorganizations",
        localField: "organization",
        foreignField: "_id",
        as: "org",
      },
    },
    { $match: { org: { $size: 0 } } },
    { $count: "total" },
  ]);

  const memberships = await Membership.countDocuments();
  const activeMemberships = await Membership.countDocuments({ status: "active" });

  console.log(`Organizations                     : ${orgs.length}`);
  console.log(`Membership rows (all)             : ${memberships}`);
  console.log(`Membership rows (active)          : ${activeMemberships}`);
  console.log(`Membership rows pointing nowhere  : ${orphanMemberships[0]?.total || 0}`);
  console.log("");

  const section = (title, rows) => {
    console.log(`${title}: ${rows.length}`);
    for (const row of rows) {
      console.log(`  - ${row.name} (${row.id})${row.pointer ? ` legacy owner pointer: ${row.pointer}` : ""}`);
    }
    console.log("");
  };

  section("Organizations with NO active owner membership (must be fixed)", noOwner);
  section("Organizations missing a slug (fix with migrateOrgMemberships)", noSlug);
  section("Organizations where legacy members[] disagrees with Membership", legacyMismatch);

  if (noOwner.length > 0) {
    console.log("Fix with: node src/scripts/setOrgOwner.js --org=<orgId> --email=<user email> --apply");
  }
}

main()
  .catch((error) => {
    console.error("auditOrgOwnership failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
