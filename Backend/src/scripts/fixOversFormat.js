import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Match from "../models/Match.js";
import AuditLog from "../models/AuditLog.js";
import { normalizeOvers } from "../utils/overs.js";
import { assertMongoDatabaseName, getMongoTarget } from "../utils/mongoTarget.js";
import { isTestTarget } from "./createSemiFinals.js";
import { collectOversFields } from "./scanOversFormat.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(SCRIPT_DIR, "../../.env"), quiet: true });

const parseOversPath = (value) => {
  const match = /^innings\[(\d+)\]\.(overs|bowling\[(\d+)\]\.overs|fallOfWickets\[(\d+)\]\.overs|partnerships\[(\d+)\]\.overs)$/.exec(value);
  if (!match) return null;
  if (match[2] === "overs") return ["innings", match[1], "overs"];
  if (match[2].startsWith("bowling")) return ["innings", match[1], "bowling", match[3], "overs"];
  if (match[2].startsWith("fallOfWickets")) return ["innings", match[1], "fallOfWickets", match[4], "overs"];
  return ["innings", match[1], "partnerships", match[5], "overs"];
};

export async function readSetFile(filePath) {
  const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--set JSON must be an object mapping JSON paths to overs values.");
  }
  const entries = new Map();
  for (const [jsonPath, value] of Object.entries(parsed)) {
    if (!parseOversPath(jsonPath)) throw new Error(`Unsupported overs JSON path: ${jsonPath}`);
    const normalized = normalizeOvers(value);
    if (!normalized.valid || value === "" || value == null) {
      throw new Error(`Invalid --set value for ${jsonPath}: ${normalized.reason || "overs value is required"}`);
    }
    entries.set(jsonPath, normalized.value);
  }
  return entries;
}

export function planOversRepair(match, setValues = new Map()) {
  const fields = new Map(collectOversFields(match).map((field) => [field.path, field]));

  const changes = [];
  for (const [jsonPath, value] of setValues) {
    const field = fields.get(jsonPath);
    if (!field) throw new Error(`--set path does not exist in match ${match._id}: ${jsonPath}`);
    if (normalizeOvers(field.value).valid) {
      throw new Error(`--set path is not unresolved in match ${match._id}: ${jsonPath}`);
    }
    changes.push({ path: jsonPath, from: field.value, to: value, reason: "explicit" });
  }

  const explicitPaths = new Set(setValues.keys());
  for (const field of fields.values()) {
    if (explicitPaths.has(field.path)) continue;
    const normalized = normalizeOvers(field.value);
    if (!normalized.valid) continue;
    const numeric = typeof field.value === "number" ? field.value : Number(field.value);
    if (!Number.isFinite(numeric) || numeric === normalized.value) continue;
    changes.push({
      path: field.path,
      from: field.value,
      to: normalized.value,
      reason: "float-noise",
    });
  }
  return {
    changes,
    unresolved: [...fields.values()]
      .filter(({ path: jsonPath, value }) => !normalizeOvers(value).valid && !explicitPaths.has(jsonPath))
      .map(({ path: jsonPath, value }) => ({ path: jsonPath, value })),
  };
}

export async function runOversRepair({
  matches,
  apply = false,
  setValues = new Map(),
  writeMatch = async () => {},
  writeAudit = async () => {},
}) {
  const rows = [];
  for (const match of matches) {
    const plan = planOversRepair(match, setValues);
    if (apply && plan.changes.length) {
      const updates = Object.fromEntries(plan.changes.map((change) => [
        change.path.replace(/\[(\d+)\]/g, ".$1"),
        change.to,
      ]));
      await writeMatch(match, updates);
      await writeAudit({ match, changes: plan.changes });
    }
    rows.push({ match, ...plan, outcome: !plan.changes.length ? "SKIP" : apply ? "FIXED" : "WOULD FIX" });
  }
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  let matchId = "";
  let setFile = "";
  let apply = false;
  let forceTest = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") apply = true;
    else if (arg === "--force-test") forceTest = true;
    else if (arg === "--match" && args[index + 1]) matchId = args[++index];
    else if (arg === "--set" && args[index + 1]) setFile = args[++index];
    else throw new Error("Usage: node src/scripts/fixOversFormat.js [--apply] [--match <id>] [--set <file.json>] [--force-test]");
  }
  if (matchId && !mongoose.Types.ObjectId.isValid(matchId)) throw new Error("--match must be a valid match id.");
  if (setFile && !matchId) throw new Error("--set requires --match so explicit values cannot affect multiple matches.");
  const setValues = setFile ? await readSetFile(path.resolve(process.cwd(), setFile)) : new Map();

  const url = process.env.MONGO_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!url) throw new Error("MONGO_URL / MONGODB_URI / MONGO_URI is required.");
  assertMongoDatabaseName(url);
  const target = getMongoTarget(url);
  if (!target.databaseName) throw new Error("Mongo URL must include an explicit database name before applying overs repairs.");
  if (isTestTarget(target.databaseName) && !forceTest) {
    throw new Error("Refusing to repair a test/e2e database without --force-test.");
  }
  await mongoose.connect(url, { serverSelectionTimeoutMS: 10000 });

  try {
    const query = matchId ? { _id: new mongoose.Types.ObjectId(matchId) } : {};
    const matches = await Match.collection.find(query, {
      projection: { stage: 1, stageLabel: 1, round: 1, title: 1, innings: 1 },
    }).toArray();
    const rows = await runOversRepair({
      matches,
      apply,
      setValues,
      writeMatch: async (match, updates) => {
        const result = await Match.collection.updateOne({ _id: match._id }, { $set: updates });
        if (result.matchedCount !== 1) throw new Error(`Match ${match._id} disappeared during repair.`);
      },
      writeAudit: async ({ match, changes }) => {
        await AuditLog.create({
          actorType: "system",
          actorLabel: "fix-overs-format-script",
          action: "match.overs_format_repaired",
          targetType: "match",
          targetId: String(match._id),
          targetLabel: String(match.title || match.stageLabel || match.stage || match._id),
          metadata: {
            changes: changes.map(({ path: jsonPath, from, to, reason }) => ({ path: jsonPath, from, to, reason })),
          },
        });
      },
    });

    console.log(`Mongo host: ${target.host || "unknown"} (db: ${target.databaseName || "?"})`);
    console.log(apply ? "fixOversFormat — APPLY" : "fixOversFormat — DRY RUN (nothing will be written)");
    for (const row of rows) {
      const stage = row.match.stageLabel || row.match.stage || row.match.round || "—";
      console.log(`${row.outcome}\t${row.match._id}\t${stage}`);
      for (const change of row.changes) {
        console.log(`  ${change.path}: ${JSON.stringify(change.from)} -> ${change.to} (${change.reason})`);
      }
      for (const item of row.unresolved) {
        console.log(`  UNRESOLVED ${item.path}: ${JSON.stringify(item.value)} (skipped)`);
      }
    }
    console.log(`\nMatches scanned: ${matches.length}`);
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error("fixOversFormat failed:", error.message);
    process.exitCode = 1;
  });
}
