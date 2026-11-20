import mongoose from "mongoose";

// ---------------------------------------------------------------------------
// Official tournament awards
// ---------------------------------------------------------------------------
//
// These are the organiser's public picks (player of the tournament, best
// batter, best bowler, best fielder/keeper, emerging player and any custom
// honours) plus citations. They are deliberately separate from the computed
// impact ranking: setting an official award never changes a player's points or
// the order of the Player of the Tournament table.
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
  "bestFielder",
  "emergingPlayer",
]);

/** The organiser podium has at most three places: 1st, 2nd and 3rd. */
export const PODIUM_SIZE = 3;

export const OFFICIAL_AWARDS_NOTE_MAX = 500;
export const OFFICIAL_AWARD_CITATION_MAX = 200;
export const CUSTOM_AWARD_TITLE_MAX = 60;
export const CUSTOM_AWARD_CITATION_MAX = 200;
export const MAX_CUSTOM_AWARDS = 10;

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

const cleanId = (value) => {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "object" ? value._id ?? value.id : value;
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
};

export const refId = (value) => cleanId(value) || null;

export const isCompletedTournament = (tournament) =>
  String(tournament?.status || "").toLowerCase() === "completed";

/** Public rule: completed tournament AND an organiser explicitly published. */
export const isOfficialAwardsPublic = (tournament) =>
  isCompletedTournament(tournament) && tournament?.officialAwards?.published === true;

const emptyCitations = () =>
  Object.fromEntries(OFFICIAL_AWARD_KEYS.map((key) => [key, ""]));

/** Empty public shape used when the publish gate is closed. */
export function emptyOfficialAwards() {
  return {
    playerOfTournament: null,
    topPlayers: [],
    bestBatsman: null,
    bestBatter: null,
    bestBowler: null,
    bestFielder: null,
    emergingPlayer: null,
    citations: emptyCitations(),
    customAwards: [],
    note: "",
    published: false,
  };
}

/**
 * Validate one official-awards payload.
 *
 * @param {object} input
 * @param {object} [input.body]             request body
 * @param {Array}  [input.teamIds]          tournament team ids (or populated teams)
 * @param {Array}  [input.squadPlayerIds]   player ids named in tournament squads
 * @param {Map|object} [input.playerTeamById] player id -> Player.team id
 * @param {object} [input.tournament]       tournament document (for publish rules)
 * @returns {{ok:true,data:object}|{ok:false,errors:object}}
 */
export function validateOfficialAwards({
  body = {},
  teamIds = [],
  squadPlayerIds = [],
  playerTeamById = new Map(),
  tournament = null,
} = {}) {
  const errors = {};
  const teamSet = new Set((teamIds || []).map(cleanId).filter(Boolean));
  const squadSet = new Set((squadPlayerIds || []).map(cleanId).filter(Boolean));
  // Accept `bestBatter` as a friendly alias for the existing `bestBatsman`
  // field so the API matches the "Best Batter" label used by the UI.
  const payload = { ...(body || {}) };
  if (hasOwn(payload, "bestBatter")) {
    if (
      hasOwn(payload, "bestBatsman") &&
      cleanId(payload.bestBatter) !== cleanId(payload.bestBatsman)
    ) {
      errors.bestBatter = "Use either bestBatsman or bestBatter, not both.";
    } else if (!hasOwn(payload, "bestBatsman")) {
      payload.bestBatsman = payload.bestBatter;
    }
  }

  const teamOf = (playerId) => {
    if (!playerId) return "";
    if (playerTeamById instanceof Map) return cleanId(playerTeamById.get(playerId));
    return cleanId(playerTeamById?.[playerId]);
  };

  const belongs = (id) => squadSet.has(id) || Boolean(teamOf(id) && teamSet.has(teamOf(id)));

  const parsePlayer = (key) => {
    if (!hasOwn(payload, key)) return undefined;
    const id = cleanId(payload[key]);
    if (!id) return null; // explicit clear
    if (!mongoose.isValidObjectId(id)) {
      errors[key] = "That is not a valid player id.";
      return undefined;
    }
    if (!teamSet.size) {
      errors[key] = "This tournament has no teams to award yet.";
      return undefined;
    }
    if (belongs(id)) return id;
    errors[key] = "The player must belong to one of this tournament's teams.";
    return undefined;
  };

  const parseCitation = (value, key, max) => {
    if (value === null || value === undefined) return "";
    if (typeof value !== "string") {
      errors[key] = "The citation must be text.";
      return undefined;
    }
    const text = value.trim();
    if (text.length > max) {
      errors[key] = `The citation must be ${max} characters or fewer.`;
      return undefined;
    }
    return text;
  };

  const data = {};
  // The compatibility alias and the ordered podium are validated together
  // below; the single-player honours are independent of one another.
  for (const key of ["bestBatsman", "bestBowler", "bestFielder", "emergingPlayer"]) {
    const value = parsePlayer(key);
    if (value !== undefined) data[key] = value;
  }

  const hasTopPlayers = hasOwn(payload, "topPlayers");
  const hasAlias = hasOwn(payload, "playerOfTournament");
  let topPlayers;
  let alias;

  if (hasAlias) alias = parsePlayer("playerOfTournament");

  if (hasTopPlayers) {
    const raw = payload.topPlayers;
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
          if (!belongs(id)) {
            errors.topPlayers = "The player must belong to one of this tournament's teams.";
            break;
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

  // Per-award citations. Both a `citations` object and flat `<key>Citation`
  // fields are accepted; the object wins when a key appears in both.
  const citations = {};
  if (hasOwn(payload, "citations")) {
    const raw = payload.citations;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      errors.citations = "Citations must be an object.";
    } else {
      const citationSource = { ...raw };
      if (hasOwn(citationSource, "bestBatter") && !hasOwn(citationSource, "bestBatsman")) {
        citationSource.bestBatsman = citationSource.bestBatter;
      }
      for (const key of OFFICIAL_AWARD_KEYS) {
        if (!hasOwn(citationSource, key)) continue;
        const value = parseCitation(citationSource[key], `citations.${key}`, OFFICIAL_AWARD_CITATION_MAX);
        if (value !== undefined) citations[key] = value;
      }
    }
  }
  for (const key of OFFICIAL_AWARD_KEYS) {
    const flatKey = `${key}Citation`;
    if (hasOwn(payload, flatKey)) {
      const value = parseCitation(payload[flatKey], flatKey, OFFICIAL_AWARD_CITATION_MAX);
      if (value !== undefined) citations[flatKey] = value;
    }
  }
  if (Object.keys(citations).length) {
    for (const [key, value] of Object.entries(citations)) {
      citations[key.replace(/Citation$/, "")] = value;
      if (key.endsWith("Citation")) delete citations[key];
    }
    data.citations = citations;
  }

  // Custom honours: title + player, with an optional short citation.
  if (hasOwn(payload, "customAwards")) {
    const raw = payload.customAwards;
    if (!Array.isArray(raw)) {
      errors.customAwards = "Custom awards must be a list.";
    } else if (raw.length > MAX_CUSTOM_AWARDS) {
      errors.customAwards = `There can be at most ${MAX_CUSTOM_AWARDS} custom awards.`;
    } else {
      const parsed = [];
      const titles = new Set();
      raw.forEach((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          errors.customAwards = `Custom award ${index + 1} must be an object.`;
          return;
        }
        const title = String(item.title ?? "").trim();
        if (!title) {
          errors.customAwards = `Custom award ${index + 1} needs a title.`;
        } else if (title.length > CUSTOM_AWARD_TITLE_MAX) {
          errors.customAwards = `Custom award titles must be ${CUSTOM_AWARD_TITLE_MAX} characters or fewer.`;
        } else if (titles.has(title.toLowerCase())) {
          errors.customAwards = "Custom award titles must be different.";
        } else {
          titles.add(title.toLowerCase());
        }

        const playerId = cleanId(item.playerId ?? item.player);
        if (!playerId) {
          errors.customAwards = `Custom award ${index + 1} needs a player.`;
        } else if (!mongoose.isValidObjectId(playerId)) {
          errors.customAwards = `Custom award ${index + 1} has an invalid player id.`;
        } else if (!teamSet.size) {
          errors.customAwards = "This tournament has no teams to award yet.";
        } else if (!belongs(playerId)) {
          errors.customAwards = "Each custom award player must belong to this tournament.";
        }

        const citation = parseCitation(
          item.citation,
          `customAwards.${index + 1}.citation`,
          CUSTOM_AWARD_CITATION_MAX,
        );
        if (!errors.customAwards && title && playerId && citation !== undefined) {
          parsed.push({ title, player: playerId, citation });
        }
      });
      if (!errors.customAwards) data.customAwards = parsed;
    }
  }

  if (hasOwn(payload, "note")) {
    const raw = payload.note;
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

  if (hasOwn(payload, "published")) {
    const value = payload.published;
    if (typeof value !== "boolean") {
      errors.published = "Publish must be either true or false.";
    } else if (value && !isCompletedTournament(tournament)) {
      errors.published = "Awards can only be published after the tournament is completed.";
    } else {
      data.published = value;
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
export function shapeOfficialAward(ref, { official = true, citation = "" } = {}) {
  if (!ref) return null;
  if (typeof ref !== "object") {
    return {
      playerId: String(ref),
      name: "",
      team: "",
      playingRole: "",
      imageUrl: "",
      citation,
      official,
    };
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
    citation,
    official,
  };
}

/**
 * The public `officialAwards` block from a tournament document. Missing awards
 * are represented by `null` so the frontend can apply its fallback cleanly.
 */
export function publicOfficialAwards(tournament) {
  const source = tournament?.officialAwards || {};
  const citations = { ...emptyCitations(), ...(source.citations || {}) };
  const shaped = {};
  for (const key of OFFICIAL_AWARD_KEYS) {
    shaped[key] = shapeOfficialAward(source[key], { citation: citations[key] || "" });
  }
  // Keep the "Best Batter" alias in the public payload; it is the same award.
  shaped.bestBatter = shaped.bestBatsman;

  const sourceTop = Array.isArray(source.topPlayers) ? source.topPlayers : [];
  shaped.topPlayers = sourceTop
    .map((ref, index) =>
      shapeOfficialAward(ref, { citation: index === 0 ? citations.playerOfTournament || "" : "" }),
    )
    .filter(Boolean)
    .map((player, index) => ({ ...player, position: index + 1 }));

  // Legacy documents (and saves that only sent the alias) carry no topPlayers
  // array. Mirror the alias as a one-player podium so the public page has a
  // single shape to render.
  if (!shaped.topPlayers.length && shaped.playerOfTournament) {
    shaped.topPlayers = [{ ...shaped.playerOfTournament, position: 1 }];
  }

  shaped.citations = citations;
  const sourceCustom = Array.isArray(source.customAwards) ? source.customAwards : [];
  shaped.customAwards = sourceCustom
    .map((award) => ({
      title: String(award?.title || "").trim(),
      ...(shapeOfficialAward(award?.player, { citation: award?.citation || "" }) || {}),
    }))
    .filter((award) => award.title && award.playerId);
  shaped.note = source.note || "";
  shaped.published = source.published === true;
  return shaped;
}

export default {
  OFFICIAL_AWARD_KEYS,
  OFFICIAL_AWARDS_NOTE_MAX,
  OFFICIAL_AWARD_CITATION_MAX,
  CUSTOM_AWARD_TITLE_MAX,
  CUSTOM_AWARD_CITATION_MAX,
  MAX_CUSTOM_AWARDS,
  isCompletedTournament,
  isOfficialAwardsPublic,
  emptyOfficialAwards,
  validateOfficialAwards,
  shapeOfficialAward,
  publicOfficialAwards,
};
