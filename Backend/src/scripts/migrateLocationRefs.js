import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../utils/db.js";
import Location, { normalizeLocationName } from "../models/Location.js";
import Team from "../models/Team.js";
import TeamOrganization from "../models/TeamOrganization.js";
import Player from "../models/Player.js";
import Tournament from "../models/Tournament.js";
import Match from "../models/Match.js";
import { resolveLocationSelection } from "../utils/locationTree.js";

// Maps existing free-text place names to curated Location nodes.
//
//   npm run locations:migrate          # dry run, prints a report, writes nothing
//   npm run locations:migrate:apply    # writes the resolved references
//
// Matching is exact (name or alias, case/whitespace-insensitive). It never
// guesses: a name that matches several unrelated nodes is reported ambiguous
// and left alone, and so is a name with no match. Existing free-text fields are
// never modified or removed.

const SOURCES = [
  {
    label: "Team",
    model: Team,
    read: (doc) => ({ district: doc?.address?.district, city: doc?.address?.city }),
  },
  {
    label: "TeamOrganization",
    model: TeamOrganization,
    read: (doc) => ({ district: doc?.location?.district, city: doc?.location?.city }),
  },
  {
    label: "Player",
    model: Player,
    read: (doc) => ({ district: doc?.address?.district, city: doc?.address?.city }),
  },
  {
    label: "Tournament",
    model: Tournament,
    read: (doc) => ({ district: doc?.content?.district, city: doc?.content?.city }),
  },
  {
    label: "Match",
    model: Match,
    read: (doc) => ({ district: doc?.address?.district, city: doc?.address?.city }),
  },
];

const isFilled = (value) => typeof value === "string" && value.trim() !== "";
const hasRefs = (doc) =>
  Boolean(doc?.locationRefs && Object.values(doc.locationRefs).some((value) => Boolean(value)));

function buildIndex(locations) {
  const index = new Map();
  for (const node of locations) {
    const keys = new Set([normalizeLocationName(node.name)]);
    for (const alias of node.aliases || []) keys.add(normalizeLocationName(alias));
    for (const key of keys) {
      if (!key) continue;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(node);
    }
  }
  return index;
}

/**
 * Picks the single best node for a free-text value. Several matches are fine
 * when they sit on one branch (e.g. the city and the district both called
 * Lahore) — the deepest one wins. Unrelated matches are ambiguous.
 */
function pickMatch(matches = []) {
  if (matches.length === 0) return { status: "unmatched" };
  if (matches.length === 1) return { status: "mapped", node: matches[0] };

  const onOneBranch = matches.every((node) =>
    matches.every((other) => {
      if (String(node._id) === String(other._id)) return true;
      const nodeAncestors = (node.ancestors || []).map(String);
      const otherAncestors = (other.ancestors || []).map(String);
      return nodeAncestors.includes(String(other._id)) || otherAncestors.includes(String(node._id));
    })
  );
  if (!onOneBranch) return { status: "ambiguous", candidates: matches };

  const deepest = [...matches].sort((a, b) => (b.ancestors?.length || 0) - (a.ancestors?.length || 0))[0];
  return { status: "mapped", node: deepest };
}

async function run() {
  const apply = process.argv.includes("--apply");
  const connection = await connectDB();
  if (!connection) {
    console.error("Cannot migrate locations: MongoDB is not reachable. Set MONGO_URL / MONGODB_URI.");
    process.exit(1);
  }

  const locations = await Location.find({ active: true, approved: true, mergedInto: null })
    .select("_id type name aliases ancestors")
    .lean();
  const index = buildIndex(locations);

  const report = { apply, scanned: 0, alreadyMigrated: 0, mapped: 0, ambiguous: 0, unmatched: 0, written: 0, byModel: {} };
  const details = [];

  for (const source of SOURCES) {
    const stats = { scanned: 0, alreadyMigrated: 0, mapped: 0, ambiguous: 0, unmatched: 0, written: 0 };
    const docs = await source.model.find({}).select("_id name address location content locationRefs").lean();

    for (const doc of docs) {
      stats.scanned += 1;
      if (hasRefs(doc)) {
        stats.alreadyMigrated += 1;
        continue;
      }
      const text = source.read(doc);
      const value = isFilled(text.city) ? text.city : isFilled(text.district) ? text.district : "";
      const key = normalizeLocationName(value);
      if (!key) {
        stats.unmatched += 1;
        details.push({ model: source.label, id: String(doc._id), value: "", status: "unmatched" });
        continue;
      }

      const result = pickMatch(index.get(key));
      if (result.status === "mapped") {
        stats.mapped += 1;
        if (apply) {
          const resolved = await resolveLocationSelection({
            [`${result.node.type}Id`]: result.node._id,
          });
          await source.model.updateOne(
            { _id: doc._id },
            {
              $set: {
                locationRefs: resolved.locationRefs,
                locationLabels: resolved.locationLabels,
                locationIds: resolved.locationIds,
              },
            }
          );
          stats.written += 1;
        }
      } else if (result.status === "ambiguous") {
        stats.ambiguous += 1;
        details.push({
          model: source.label,
          id: String(doc._id),
          value,
          status: "ambiguous",
          candidates: result.candidates.map((node) => `${node.type}:${node.name}`),
        });
      } else {
        stats.unmatched += 1;
        details.push({ model: source.label, id: String(doc._id), value, status: "unmatched" });
      }
    }

    report.byModel[source.label] = stats;
    for (const field of ["scanned", "alreadyMigrated", "mapped", "ambiguous", "unmatched", "written"]) {
      report[field] += stats[field];
    }
  }

  console.log(`Location migration ${apply ? "(APPLY)" : "(DRY RUN — pass --apply to write)"}`);
  console.log(`Scanned ${report.scanned} records; ${report.alreadyMigrated} already had references.`);
  console.log(`  mapped=${report.mapped} ambiguous=${report.ambiguous} unmatched=${report.unmatched} written=${report.written}`);
  for (const [label, stats] of Object.entries(report.byModel)) {
    console.log(`  ${label}: mapped=${stats.mapped} ambiguous=${stats.ambiguous} unmatched=${stats.unmatched} written=${stats.written}`);
  }
  if (details.length) console.log("\nNeeds attention (not written):", JSON.stringify(details.slice(0, 50), null, 2));

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("Location migration failed:", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
