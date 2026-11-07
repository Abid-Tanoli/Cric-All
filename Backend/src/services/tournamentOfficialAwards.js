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

/** The organiser podium has at most three places: 1st, 2nd and 3rd. */
export const PODIUM_SIZE = 3;

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
  // The compatibility alias and the ordered podium are validated together
  // below; best batsman/bowler are independent single-player awards.
  for (const key of ["bestBatsman", "bestBowler"]) {
    const value = parsePlayer(key);
    if (value !== undefined) data[key] = value;
  }

  const hasTopPlayers = hasOwn(body, "topPlayers");
  const hasAlias = hasOwn(body, "playerOfTournament");
  let topPlayers;
  let alias;

  if (hasAlias) alias = parsePlayer("playerOfTournament");

  if (hasTopPlayers) {
    const raw = body.topPlayers;
    if (!Array.isArray(raw)) {
      errors.topPlayers = `Top players must be a list of up to ${PODIUM_SIZE} players.`;
    } else {
      // Drop blank trailing places so ["a", "", ""] means a one-player podium,
      // but keep interior blanks so a skipped place can be rejected.
      const values = raw.map((value) => cleanId(value));
      while (values.length && !values[values.length - 1]) values.pop();

      if (values.length > PODIUM_SIZE) {
        errors.topPlayers = `The podium can have at most ${PODIUM_SIZE} players.`;
      } else if (values.some((id) => !id)) {
        errors.topPlayers =
          "The podium cannot skip a place. Fill 1st before 2nd, and 2nd before 3rd.";
      } else {
        const ids = [];
        for (let index = 0; index < values.length; index += 1) {
          const id = values[index];
          if (!mongoose.isValidObjectId(id)) {
            errors.topPlayers = `Place ${index + 1} is not a valid player id.`;
            break;
          }
          if (!teamSet.size) {
            errors.topPlayers = "This tournament has no teams to award yet.";
            break;
          }
          if (!squadSet.has(id)) {
            const teamId = teamOf(id);
            if (!teamId || !teamSet.has(teamId)) {
              errors.topPlayers = "The player must belong to one of this tournament's teams.";
              break;
            }
          }
          if (ids.includes(id)) {
            errors.topPlayers = "Each podium place must be a different player.";
            break;
          }
          ids.push(id);
        }
        if (!errors.topPlayers) topPlayers = ids;
      }
    }
  }

  if (hasTopPlayers) {
    if (!errors.topPlayers) {
      const first = topPlayers[0] || null;
      // When both are supplied they must agree; the podium is the source of
      // truth and the alias is always rewritten from its first place.
      if (hasAlias && !errors.playerOfTournament && alias !== first) {
        errors.playerOfTournament =
          "The Player of the Tournament must be the same as the 1st-place pick.";
      }
      if (!errors.playerOfTournament) {
        data.topPlayers = topPlayers;
        data.playerOfTournament = first;
      }
    }
  } else if (hasAlias && !errors.playerOfTournament) {
    // A legacy/single-pick save is a one-place podium (or a clear).
    data.topPlayers = alias ? [alias] : [];
    data.playerOfTournament = alias || null;
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
    return { playerId: String(ref), name: "", team: "", playingRole: "", imageUrl: "", official };
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
    imageUrl: ref.imageUrl || "",
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

  const sourceTop = Array.isArray(source.topPlayers) ? source.topPlayers : [];
  shaped.topPlayers = sourceTop
    .map((ref) => shapeOfficialAward(ref))
    .filter(Boolean)
    .map((player, index) => ({ ...player, position: index + 1 }));

  // Legacy documents (and saves that only sent the alias) carry no topPlayers
  // array. Mirror the alias as a one-player podium so the public page has a
  // single shape to render.
  if (!shaped.topPlayers.length && shaped.playerOfTournament) {
    shaped.topPlayers = [{ ...shaped.playerOfTournament, position: 1 }];
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
