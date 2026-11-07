import mongoose from "mongoose";

// ---------------------------------------------------------------------------
// Official tournament awards
// ---------------------------------------------------------------------------
//
// These are the organiser's public picks (player of the tournament, best
// batsman, best bowler) plus an optional note. They are deliberately separate
// from the computed impact ranking: setting an official award never changes a
// player's points or the order of the Player of the Tournament table.
//
// Validation is pure so it can be unit-tested without a database. The caller
// supplies the tournament's teams, its squad player ids, and a player -> team
// map loaded from Player.team. A player is eligible when they are named in one
// of the tournament's squads OR their own Player.team is one of the tournament's
// teams. This is the same "actually part of this tournament" rule the admin UI
// enforces through its squad-limited pickers.

export const OFFICIAL_AWARD_KEYS = Object.freeze([
  "playerOfTournament",
  "bestBatsman",
  "bestBowler",
]);

export const OFFICIAL_AWARDS_NOTE_MAX = 500;

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

const cleanId = (value) => {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "object" ? value._id ?? value.id : value;
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
};

export const refId = (value) => cleanId(value) || null;

/**
 * Validate one official-awards payload.
 *
 * @param {object} input
 * @param {object} [input.body]             request body
 * @param {Array}  [input.teamIds]          tournament team ids (or populated teams)
 * @param {Array}  [input.squadPlayerIds]   player ids named in tournament squads
 * @param {Map|object} [input.playerTeamById] player id -> Player.team id
 * @returns {{ok:true,data:object}|{ok:false,errors:object}}
 */
export function validateOfficialAwards({
  body = {},
  teamIds = [],
  squadPlayerIds = [],
  playerTeamById = new Map(),
} = {}) {
  const errors = {};
  const teamSet = new Set((teamIds || []).map(cleanId).filter(Boolean));
  const squadSet = new Set((squadPlayerIds || []).map(cleanId).filter(Boolean));

  const teamOf = (playerId) => {
    if (!playerId) return "";
    if (playerTeamById instanceof Map) return cleanId(playerTeamById.get(playerId));
    return cleanId(playerTeamById?.[playerId]);
  };

  const parsePlayer = (key) => {
    if (!hasOwn(body, key)) return undefined;
    const id = cleanId(body[key]);
    if (!id) return null; // explicit clear
    if (!mongoose.isValidObjectId(id)) {
      errors[key] = "That is not a valid player id.";
      return undefined;
    }
    if (!teamSet.size) {
      errors[key] = "This tournament has no teams to award yet.";
      return undefined;
    }
    if (squadSet.has(id)) return id;
    const teamId = teamOf(id);
    if (teamId && teamSet.has(teamId)) return id;
    errors[key] = "The player must belong to one of this tournament's teams.";
    return undefined;
  };

  const data = {};
  for (const key of OFFICIAL_AWARD_KEYS) {
    const value = parsePlayer(key);
    if (value !== undefined) data[key] = value;
  }

  if (hasOwn(body, "note")) {
    const raw = body.note;
    if (raw === null || raw === undefined) {
      data.note = "";
    } else if (typeof raw !== "string") {
      errors.note = "The note must be text.";
    } else {
      const note = raw.trim();
      if (note.length > OFFICIAL_AWARDS_NOTE_MAX) {
        errors.note = `The note must be ${OFFICIAL_AWARDS_NOTE_MAX} characters or fewer.`;
      } else {
        data.note = note;
      }
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, data };
}

/**
 * Shape one populated award ref for the public payload. A bare id is passed
 * through as a playerId with an empty name; callers should populate before
 * calling this. `official` is evidence for the public "Official award" label.
 */
export function shapeOfficialAward(ref, { official = true } = {}) {
  if (!ref) return null;
  if (typeof ref !== "object") {
    return { playerId: String(ref), name: "", team: "", playingRole: "", official };
  }
  const teamRef = ref.team;
  const team =
    teamRef && typeof teamRef === "object"
      ? teamRef.name || teamRef.shortName || ""
      : "";
  const teamId =
    teamRef && typeof teamRef === "object" ? cleanId(teamRef._id ?? teamRef.id) || "" : cleanId(teamRef);
  const playerId = cleanId(ref._id ?? ref.id) || "";
  return {
    playerId,
    name: ref.name || "",
    team,
    teamId,
    playingRole: ref.playingRole || ref.role || "",
    official,
  };
}

/**
 * The public `officialAwards` block from a tournament document. Missing awards
 * are represented by `null` so the frontend can apply its fallback cleanly.
 */
export function publicOfficialAwards(tournament) {
  const source = tournament?.officialAwards || {};
  const shaped = {};
  for (const key of OFFICIAL_AWARD_KEYS) {
    shaped[key] = shapeOfficialAward(source[key]);
  }
  shaped.note = source.note || "";
  return shaped;
}

export default {
  OFFICIAL_AWARD_KEYS,
  OFFICIAL_AWARDS_NOTE_MAX,
  validateOfficialAwards,
  shapeOfficialAward,
  publicOfficialAwards,
};
