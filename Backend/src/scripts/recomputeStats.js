import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Match from "../models/Match.js";
import { getMongoTarget } from "../utils/mongoTarget.js";
import { runPostMatchPipeline } from "../services/postMatch.js";
import { refreshRankingPositions } from "../services/rankingService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// ---------------------------------------------------------------------------
// Rebuild the derived post-match tables from the source of truth.
//
//   npm run stats:recompute                      # dry run, every completed match
//   npm run stats:recompute -- --apply           # write
//   npm run stats:recompute -- --match=<id>      # one match
//   npm run stats:recompute -- --match=<id> --apply
//
// Dry run is the default: it computes the same career totals, compares them
// with the stored `Player.stats`, and writes nothing. It is the safe way to see
// what a scoring season left behind before touching production data.
//
// This is deliberately NOT run automatically by the app. It exists for a
// backfill after a deploy, and for re-deriving a match that was completed while
// the backend was mid-deploy.
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const usage =
  "Usage: node src/scripts/recomputeStats.js [--match=<id>] [--apply]";

const valueOf = (flag) => {
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};

const matchId = valueOf("--match");

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
  console.log(apply ? "MODE: APPLY (derived tables will be written)" : "MODE: DRY RUN (nothing will be written)");

  if (matchId) {
    const outcome = await runPostMatchPipeline(matchId, { reason: "stats:recompute", apply });
    console.log(`\nMatch ${outcome.matchId} (status: ${outcome.status ?? "not found"})`);
    console.log(`Teams: ${outcome.teams.length ? outcome.teams.join(", ") : "none"}`);
    console.log(`Tournament: ${outcome.tournament || "none"}`);

    if (outcome.players.length) {
      console.log("\nPlayer career figures:");
      for (const player of outcome.players) {
        const label = player.name || player.playerId;
        console.log(
          `  ${label}: ${player.changed.length ? player.changed.join(", ") : "already up to date"}`,
        );
      }
    }
    if (outcome.errors.length) {
      console.log("\nErrors:");
      for (const error of outcome.errors) console.log(`  ${error}`);
    }
    console.log(
      outcome.ok
        ? `\n${apply ? "Recomputed" : "Would recompute"} rankings for ${outcome.teams.length} team(s), ` +
            `${outcome.players.filter((player) => player.changed.length).length} player(s)` +
            `${outcome.tournament ? " and the tournament points table" : ""}.`
        : `\nFinished with ${outcome.errors.length} error(s).`,
    );
    if (!apply) console.log("Dry run: re-run with --apply to write these values.");
    process.exitCode = outcome.ok ? 0 : 1;
    return;
  }

  const matches = await Match.find({ status: "completed", manualDraft: { $ne: true } })
    .select("_id title")
    .sort({ startAt: 1, _id: 1 })
    .lean();

  console.log(`Completed matches: ${matches.length}`);

  let playersChanged = 0;
  let failed = 0;
  for (const match of matches) {
    // One board-wide rank pass at the end instead of one per match.
    const outcome = await runPostMatchPipeline(match._id, {
      reason: "stats:recompute",
      apply,
      refreshRanks: false,
    });
    const changed = outcome.players.filter((player) => player.changed.length);
    playersChanged += changed.length;
    if (!outcome.ok) failed += 1;
    console.log(
      `  ${outcome.ok ? "ok  " : "FAIL"} ${String(match._id)}  ${match.title || ""}` +
        `  (teams ${outcome.teams.length}, players changed ${changed.length})`,
    );
    for (const error of outcome.errors) console.log(`       ${error}`);
  }

  if (apply) {
    await refreshRankingPositions();
    console.log("\nRanking positions re-derived.");
  }

  console.log(
    `\n${apply ? "Updated" : "Would update"} ${playersChanged} player record(s) across ${matches.length} match(es).`,
  );
  if (failed) {
    console.log(`${failed} match(es) finished with errors.`);
    process.exitCode = 1;
  }
  if (!apply) console.log("Dry run: re-run with --apply to write these values.");
}

main()
  .catch((error) => {
    console.error("Stats recompute failed:", error.message);
    console.error(usage);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
