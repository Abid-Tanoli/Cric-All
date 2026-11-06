import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Match from "../models/Match.js";
import { formatOvers, normalizeOvers } from "../utils/overs.js";
import { assertMongoDatabaseName } from "../utils/mongoTarget.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(SCRIPT_DIR, "../../.env"), quiet: true });

export function collectOversFields(match) {
  const fields = [];
  const add = (path, value) => fields.push({ path, value });

  (match?.innings || []).forEach((innings, inningsIndex) => {
    if (Object.hasOwn(innings || {}, "overs")) add(`innings[${inningsIndex}].overs`, innings.overs);
    for (const field of ["bowling", "fallOfWickets", "partnerships"]) {
      (innings?.[field] || []).forEach((row, rowIndex) => {
        if (Object.hasOwn(row || {}, "overs")) {
          add(`innings[${inningsIndex}].${field}[${rowIndex}].overs`, row.overs);
        }
      });
    }
  });
  return fields;
}

export function scanOversFormat(matches) {
  return matches.flatMap((match) => collectOversFields(match).map(({ path: jsonPath, value }) => {
    const normalized = normalizeOvers(value);
    return {
      matchId: String(match._id),
      stageLabel: match.stageLabel || match.stage || match.round || "—",
      path: jsonPath,
      stored: value,
      suggestion: normalized.valid ? formatOvers(undefined, normalized.balls) : "UNRESOLVED",
    };
  }));
}

async function main() {
  const args = process.argv.slice(2);
  let tournamentId = "";
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--tournament" || !args[index + 1]) {
      throw new Error("Usage: node src/scripts/scanOversFormat.js [--tournament <id>]");
    }
    tournamentId = args[++index];
  }
  if (tournamentId && !mongoose.Types.ObjectId.isValid(tournamentId)) {
    throw new Error("--tournament must be a valid tournament id.");
  }

  const url = process.env.MONGO_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!url) throw new Error("MONGO_URL / MONGODB_URI / MONGO_URI is required.");
  assertMongoDatabaseName(url);
  await mongoose.connect(url, { serverSelectionTimeoutMS: 10000 });

  try {
    const query = tournamentId ? { tournament: new mongoose.Types.ObjectId(tournamentId) } : {};
    const matches = await Match.collection.find(query, {
      projection: { stage: 1, stageLabel: 1, round: 1, innings: 1 },
    }).toArray();
    console.log("Read-only overs format scan.");
    console.log("MATCH ID\tSTAGE\tJSON PATH\tSTORED VALUE\tNORMALIZED SUGGESTION");
    for (const row of scanOversFormat(matches)) {
      console.log(`${row.matchId}\t${row.stageLabel}\t${row.path}\t${JSON.stringify(row.stored)}\t${row.suggestion}`);
    }
    console.log(`\nMatches scanned: ${matches.length}`);
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error("scanOversFormat failed:", error.message);
    process.exitCode = 1;
  });
}
