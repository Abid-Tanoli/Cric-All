// Where a Player id can be stored, shared by the delete guard (B16) and the
// read-only merge audit (src/scripts/checkPlayerMergeIntegrity.js), so the two
// cannot drift apart.

import mongoose from "mongoose";
import Ball from "../models/Ball.js";
import Blog from "../models/Blog.js";
import CommunityPost from "../models/CommunityPost.js";
import Delivery from "../models/Delivery.js";
import Event from "../models/Event.js";
import Match from "../models/Match.js";
import Partnership from "../models/Partnership.js";
import Player from "../models/Player.js";
import Review from "../models/Review.js";
import Team from "../models/Team.js";
import TeamPlayerRanking from "../models/TeamPlayerRanking.js";
import Tournament from "../models/Tournament.js";

// Collections that belong to one match (each row carries a match id).
export const DIRECT_PLAYER_REFERENCES = [
  { model: Delivery, fields: ["batsmanId", "bowlerId", "nonStrikerId", "fielderId"] },
  { model: Ball, fields: ["batsman", "bowler", "fieldedBy"] },
  { model: Partnership, fields: ["batsman1Id", "batsman2Id"] },
  { model: Review, fields: ["playerReviewed"] },
];

export const GLOBAL_PLAYER_REFERENCES = [
  {
    model: Team,
    fields: ["players", "captain", "viceCaptain"],
  },
  {
    model: Event,
    fields: [
      "eventSquads.players",
      "eventSquads.captain",
      "eventSquads.viceCaptain",
      "eventSquads.wicketKeepers",
      "eventSquads.playerChanges.outPlayer",
      "eventSquads.playerChanges.inPlayer",
    ],
  },
  {
    model: Tournament,
    fields: [
      "tournamentSquads.players",
      "tournamentSquads.captain",
      "tournamentSquads.viceCaptain",
      "tournamentSquads.wicketKeepers",
      "tournamentSquads.playerChanges.outPlayer",
      "tournamentSquads.playerChanges.inPlayer",
      "awards.playerOfTournament",
      "awards.bestBatsman",
      "awards.bestBowler",
      "officialAwards.playerOfTournament",
      "officialAwards.topPlayers",
      "officialAwards.bestBatsman",
      "officialAwards.bestBowler",
      "officialAwards.bestFielder",
      "officialAwards.emergingPlayer",
      "officialAwards.customAwards.player",
    ],
  },
  {
    model: Player,
    fields: ["relations.player"],
  },
  {
    model: TeamPlayerRanking,
    fields: ["player"],
  },
  {
    model: Blog,
    fields: ["relatedId"],
    extraFilter: { relatedType: "Player" },
  },
  {
    model: CommunityPost,
    fields: ["subject.ref"],
    extraFilter: { "subject.type": "player" },
  },
];

/**
 * Every path in a schema that stores a Player id: plain refs, arrays of refs,
 * and refs inside subdocuments or arrays of subdocuments.
 */
export function playerRefPaths(schema, prefix = "") {
  const paths = new Set();
  schema.eachPath((name, type) => {
    const path = prefix ? `${prefix}.${name}` : name;
    const ref = type.options?.ref || type.embeddedSchemaType?.options?.ref || type.caster?.options?.ref;
    if (ref === "Player") paths.add(path);
    if (type.schema) for (const nested of playerRefPaths(type.schema, path)) paths.add(nested);
  });
  return [...paths];
}

let matchPaths = null;
/** The Match paths that hold a Player id (innings, XI, squads, awards, balls...). */
export function matchPlayerPaths() {
  matchPaths ||= playerRefPaths(Match.schema);
  return matchPaths;
}

// Team membership and other players' relations are tidied up by a delete; every
// other reference is cricket history or content about the player and blocks it.
const CLEANED_ON_DELETE = new Set([Team, Player]);

const LABELS = {
  matches: ["match", "matches"],
  deliveries: ["delivery", "deliveries"],
  balls: ["ball", "balls"],
  partnerships: ["partnership", "partnerships"],
  reviews: ["review", "reviews"],
  events: ["event squad", "event squads"],
  tournaments: ["tournament squad or award", "tournament squads or awards"],
  teamplayerrankings: ["ranking", "rankings"],
  blogs: ["blog post", "blog posts"],
  communityposts: ["community post", "community posts"],
};

/**
 * Counts the records that would be left pointing at a deleted player, by
 * collection name. An empty object means the player can be deleted safely.
 */
export async function findPlayerHistory(playerId) {
  const id = new mongoose.Types.ObjectId(String(playerId));
  const specs = [
    { model: Match, fields: matchPlayerPaths() },
    ...DIRECT_PLAYER_REFERENCES,
    ...GLOBAL_PLAYER_REFERENCES.filter((spec) => !CLEANED_ON_DELETE.has(spec.model)),
  ];
  const counts = {};
  for (const spec of specs) {
    const n = await spec.model.countDocuments({
      ...(spec.extraFilter || {}),
      $or: spec.fields.map((field) => ({ [field]: id })),
    });
    if (n) counts[spec.model.collection.collectionName] = n;
  }
  return counts;
}

/** "3 matches, 1 tournament squad or award" for a refusal message. */
export function describePlayerHistory(counts) {
  return Object.entries(counts)
    .map(([collection, n]) => {
      const [one, many] = LABELS[collection] || [collection, collection];
      return `${n} ${n === 1 ? one : many}`;
    })
    .join(", ");
}

/** Removes a deleted player from every squad list, team role and relation. */
export async function detachDeletedPlayers(playerIds) {
  const ids = playerIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  await Team.updateMany({ players: { $in: ids } }, { $pull: { players: { $in: ids } } });
  await Team.updateMany({ captain: { $in: ids } }, { $unset: { captain: "" } });
  await Team.updateMany({ viceCaptain: { $in: ids } }, { $unset: { viceCaptain: "" } });
  await Player.updateMany({ "relations.player": { $in: ids } }, { $pull: { relations: { player: { $in: ids } } } });
}
