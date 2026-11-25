import mongoose from "mongoose";
import Team from "../models/Team.js";
import Player from "../models/Player.js";
import TeamRanking from "../models/TeamRanking.js";
import TeamOrganization from "../models/TeamOrganization.js";
import TeamCategory from "../models/TeamCategory.js";
import TeamPlayerRanking from "../models/TeamPlayerRanking.js";
import Match from "../models/Match.js";
import { getIO } from "../socket/socket.js";
import { deleteStoredFile, deleteStoredFiles } from "../utils/photoStore.js";
import { DEFAULT_TEAM_ROLE, TEAM_ROLES } from "./organizationService.js";
import { parseJerseyNumber } from "./playerService.js";
import { PLAYING_ROLES } from "../validators/playerValidators.js";
import {
  PLAYER_ROSTER_SELECT,
  TEAM_PUBLIC_SELECT,
  MATCH_CARD_SELECT,
  PUBLIC_MATCH_FILTER,
  publicTeamClause,
  reservedNamesMongoClause,
  hiddenTeamIds,
  isHiddenTeamDoc,
  canViewTeamPrivate,
} from "../utils/publicProjection.js";
import { getTeamPlayerRankings } from "./rankingService.js";

// Pure diff used to decide which team media uploads are no longer referenced
// after an update. Returns the subset of old URLs that are gone from `newMedia`.
export function computeRemovedMediaUrls(oldMediaUrls = [], newMedia) {
  if (!Array.isArray(newMedia)) return [];
  const newUrls = new Set(newMedia.map((entry) => entry && entry.url).filter(Boolean));
  return oldMediaUrls.filter((url) => url && !newUrls.has(url));
}

// Round 5 — cross-tenant exposure of organization-owned teams.
//
// `GET /api/teams` is unauthenticated and used to accept `organizationRef` only
// as an optional filter, so with no query parameters it returned every team in
// the platform: organization-owned tenants' rosters, branches and locations
// included, to anyone. Two ways to ask for those teams, both explicit:
//
//   * `?scope=organization`         — organization-owned teams are in scope.
//   * `?organizationRef=<id>`      — one organization's teams, named outright.
//
// The default is the platform/public catalogue: published teams only — which
// covers org-less teams (a team with no `organizationRef` is a platform team)
// and organization-owned teams the owner has not hidden. An organization that
// wants its own listing, hidden teams included, uses the org-scoped manage
// route (`GET /api/organizations/:id/teams/manage`).
export async function listTeams(filters = {}) {
  const query = {};
  const limit = Math.min(Math.max(Number(filters.limit) || 120, 1), 500);
  const page = Math.max(Number(filters.page) || 1, 1);
  const scope = String(filters.scope || "").toLowerCase();
  const wantsAll = scope === "all";
  const wantsOrgOwned = wantsAll || scope === "organization" || Boolean(filters.organizationRef);

  // Clauses that must hold *together* go in `$and`, never in `query.$or`.
  //
  // Round 5: the tenancy filter and the free-text filter are both `$or` shaped,
  // and they used to share the single `query.$or` key — so passing `?search=`
  // overwrote the tenancy filter and returned every organization's teams to an
  // anonymous caller, `isPublic` notwithstanding. Two `$or` clauses that both have
  // to apply is exactly what `$and` is for.
  const andClauses = [];

  // "all organization-owned teams" across tenants is a supervisory read; it is
  // reachable only with the explicit scope and is sanitized like any other.
  if (wantsOrgOwned && !filters.organizationRef && !wantsAll && scope === "organization") {
    andClauses.push({ organizationRef: { $exists: true, $ne: null } });
  }

  // Fix B: published and non-fixture, for every read that is not an entitled
  // one. `publicOnly` is set by the controller for anyone who is not a platform
  // admin; the default catalogue (no org scope) applies the same rule on its own
  // so an org-less private team cannot sit in the public team browser either.
  // The org manage path (`GET /organizations/:id/teams/manage`) passes neither
  // flag, which is what keeps it able to list a team the owner has hidden.
  if (filters.publicOnly || !wantsOrgOwned) {
    andClauses.push(publicTeamClause());
  } else if (filters.excludeReservedTestNames) {
    andClauses.push(reservedNamesMongoClause("name"));
  }

  if (filters.category) query.category = filters.category;
  if (filters.categoryRef) query.categoryRef = filters.categoryRef;
  if (filters.organizationRef) query.organizationRef = filters.organizationRef;
  if (Array.isArray(filters.orgTypeIds)) andClauses.push({ organizationRef: { $in: filters.orgTypeIds } });
  if (filters.type) query.type = filters.type;
  if (filters.city) query["address.city"] = { $regex: filters.city, $options: "i" };
  if (filters.search) {
    // Terminal A: four search keys — team name, club name, team ID, club ID.
    // The text keys are escaped so a caller cannot inject a regex; the id keys
    // are only added when the term is a valid ObjectId, so a typo degrades to a
    // text miss instead of a CastError 400.
    const raw = String(filters.search).trim();
    const term = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const orClauses = [
      { name: { $regex: term, $options: "i" } },
      { shortName: { $regex: term, $options: "i" } },
      { branchName: { $regex: term, $options: "i" } },
      { organization: { $regex: term, $options: "i" } },
      { "address.city": { $regex: term, $options: "i" } },
    ];
    if (mongoose.Types.ObjectId.isValid(raw)) {
      const oid = new mongoose.Types.ObjectId(raw);
      orClauses.push({ _id: oid }, { organizationRef: oid });
    }
    andClauses.push({ $or: orClauses });
  }
  if (filters.isActive !== undefined) query.isActive = filters.isActive;
  if (filters.isPublic !== undefined) query.isPublic = filters.isPublic === 'true' || filters.isPublic === true;
  if (Array.isArray(filters.locationClauses) && filters.locationClauses.length) {
    andClauses.push(...filters.locationClauses);
  }

  if (andClauses.length > 0) query.$and = andClauses;

  const teamsQuery = Team.find(query)
    // `city` was in this projection but is not a Team field — city lives in
    // `address.city`, which is projected as part of `address`. Selecting a
    // nonexistent path was harmless but misleading.
    .select("name shortName logo type teamRole category categoryRef organization organizationRef branchName address area players captain viceCaptain teamColorPrimary teamColorSecondary isActive profileComplete isPublic description establishedYear homeGround ageGroup locationRefs locationLabels locationIds")
    .populate("categoryRef", "name slug icon")
    .populate("organizationRef", "name slug type orgType verificationStatus")
    .sort({ name: 1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .maxTimeMS(5000)
    .lean();

  if (filters.includePlayers === "true" || filters.includePlayers === true) {
    teamsQuery.populate("players", PLAYER_ROSTER_SELECT);
  }

  return teamsQuery;
}

// ---------------------------------------------------------------------------
// PR 7 — public team overview blocks
// ---------------------------------------------------------------------------
//
// The team page used to show ten completed matches and nothing else: a visitor
// could not see the next fixture, a match in progress, or who the side's best
// players are, even though the backend already loaded the rankings.

/** Statuses that mean "not started yet". `scheduled` is not in Match's enum
 * today, but fixtures written by importers carry it, so it is accepted here. */
export const UPCOMING_MATCH_STATUSES = Object.freeze(["upcoming", "scheduled"]);

/** Statuses that mean "on the field right now". A completed toss, an innings
 * break and a super over are all still a live fixture to a visitor. */
export const LIVE_MATCH_STATUSES = Object.freeze([
  "live",
  "toss_done",
  "innings-break",
  "innings_break",
  "super_over",
]);

export const UPCOMING_MATCH_LIMIT = 5;
export const RECENT_MATCH_LIMIT = 10;
export const BEST_PLAYERS_LIMIT = 5;

/** A strike-rate leader needs this many matches — or every match the team has
 * played, when the team has played fewer (see `buildTopPerformers`). */
export const BEST_STRIKE_RATE_MIN_MATCHES = 3;

/** The compact player row the team page renders in a performer card. Derived
 * from the ranking row, never a whole Player document. */
function performerSummary(row) {
  const player = row?.player || {};
  return {
    _id: player._id || null,
    name: player.name || "",
    imageUrl: player.imageUrl || "",
    playingRole: player.playingRole || player.role || "",
    jerseyNumber: player.jerseyNumber ?? null,
    matches: row.teamMatches || 0,
    runs: row.teamRuns || 0,
    wickets: row.teamWickets || 0,
    strikeRate: row.teamBattingSr || 0,
    average: row.teamBattingAvg || 0,
    rating: row.teamPlayerRating || 0,
  };
}

/** Highest `value` among the rows, ignoring rows that do not clear `positive`. */
function bestRowBy(rows, value, { requirePositive = true } = {}) {
  return rows.reduce((best, row) => {
    if (requirePositive && !(value(row) > 0)) return best;
    if (!best || value(row) > value(best)) return row;
    return best;
  }, null);
}

/**
 * Pure: turns the team's ranking rows into the top-performers block.
 *
 * The rows are the same ones `/players/team/:teamId` serves (see
 * `rankingService.getTeamPlayerRankings`, which reads `Player.stats` — the source
 * the leaderboards use). A team with no completed match has no rows behind it,
 * and that is a normal state: the block comes back with nulls and an empty list
 * rather than throwing or inventing a leader.
 *
 * The strike-rate leader is the only place a minimum-matches rule is needed —
 * one big innings should not outrank a season. The threshold is three matches,
 * or every match the team has played if it has played fewer, so a new side with
 * two matches still gets a leader among the players who played both.
 */
export function buildTopPerformers(rankings = []) {
  const rows = (Array.isArray(rankings) ? rankings : []).filter(
    (row) => row && row.player && row.player._id,
  );
  if (rows.length === 0) {
    return {
      topRunScorer: null,
      topWicketTaker: null,
      bestStrikeRate: null,
      bestStrikeRateMinMatches: BEST_STRIKE_RATE_MIN_MATCHES,
      bestPlayers: [],
    };
  }

  const mostMatches = rows.reduce((max, row) => Math.max(max, row.teamMatches || 0), 0);
  const minMatches = Math.min(BEST_STRIKE_RATE_MIN_MATCHES, mostMatches);
  const strikeRateCandidates =
    minMatches > 0
      ? rows.filter(
          (row) => (row.teamMatches || 0) >= minMatches && (row.teamRuns || 0) > 0,
        )
      : [];

  // Best players keep the leaderboard's own ordering idea (runs, plus 25 per
  // wicket) because that rating is what the rankings screens sort by. A row with
  // no match behind it is not a ranking: a squad that has never played returns no
  // best players rather than five zeros.
  const ranked = rows
    .filter((row) => (row.teamMatches || 0) > 0)
    .sort(
    (a, b) =>
      (b.teamPlayerRating || 0) - (a.teamPlayerRating || 0) ||
      (b.teamRuns || 0) - (a.teamRuns || 0) ||
      (b.teamWickets || 0) - (a.teamWickets || 0) ||
      String(a.player.name || "").localeCompare(String(b.player.name || "")),
    );

  const runLeader = bestRowBy(rows, (row) => row.teamRuns || 0);
  const wicketLeader = bestRowBy(rows, (row) => row.teamWickets || 0);
  const strikeRateLeader = bestRowBy(strikeRateCandidates, (row) => row.teamBattingSr || 0);

  return {
    topRunScorer: runLeader ? performerSummary(runLeader) : null,
    topWicketTaker: wicketLeader ? performerSummary(wicketLeader) : null,
    bestStrikeRate: strikeRateLeader ? performerSummary(strikeRateLeader) : null,
    bestStrikeRateMinMatches: minMatches,
    bestPlayers: ranked.slice(0, BEST_PLAYERS_LIMIT).map(performerSummary),
  };
}

/**
 * Every match read on the team page goes through this scope: this team's
 * fixtures, never a draft scorecard, and — for a caller who may not see the team
 * in full — never a fixture against a team the owner has hidden. The same
 * `hiddenTeamIds` set every public listing uses, so the rule cannot drift.
 */
async function publicMatchScope(teamId, viewer, team) {
  const clauses = [{ teams: teamId }];
  if (!canViewTeamPrivate(viewer, team)) {
    const hidden = await hiddenTeamIds();
    if (hidden.length) clauses.push({ teams: { $nin: hidden } });
  }
  return clauses;
}

// Round 5: `.populate("players")` with no argument loaded whole Player
// documents — date of birth, address, gallery, videos and the creating account —
// into `GET /api/teams/:id`, which is unauthenticated. The roster is now a
// named projection and the team body is projected too. `viewer` is supplied by
// the controller so a manager of the owning organization still sees their team
// in full.
export async function getTeamProfile(teamId, viewer = null) {
  const team = await Team.findById(teamId)
    .select(viewer?.userId ? `${TEAM_PUBLIC_SELECT} managedBy` : TEAM_PUBLIC_SELECT)
    .populate("players", PLAYER_ROSTER_SELECT)
    .populate("categoryRef", "name slug icon")
    .populate("organizationRef", "name slug type orgType verificationStatus");
  if (!team) return null;

  // Fix B: a team the owner has hidden, or a fixture, is not addressable by id
  // for anyone who could not have found it through a listing anyway. Members and
  // platform admins still get it — which is also why `GET /teams/:id` now runs
  // `optionalProtect`, so an authenticated caller is not mistaken for a guest.
  if (isHiddenTeamDoc(team) && !canViewTeamPrivate(viewer, team)) return null;

  const ranking = await TeamRanking.findOne({ team: teamId });

  const matchScope = await publicMatchScope(teamId, viewer, team);
  const findMatchCards = (extraQuery, sort, limit) =>
    Match.find({ ...PUBLIC_MATCH_FILTER, ...extraQuery, $and: matchScope })
      .select(MATCH_CARD_SELECT)
      .populate("teams", "name shortName logo")
      .sort(sort)
      .limit(limit);

  const upcomingStatus = { status: { $in: UPCOMING_MATCH_STATUSES } };
  // Dated fixtures first, undated ones only fill the slots the dated ones leave.
  // Two queries rather than one sort: MongoDB orders a missing date before a
  // real one, which would push actual dates out of a five-row window.
  const [recentMatches, datedUpcoming, undatedUpcoming, liveMatches] = await Promise.all([
    findMatchCards({ status: "completed" }, { startAt: -1 }, RECENT_MATCH_LIMIT),
    findMatchCards({ ...upcomingStatus, startAt: { $ne: null } }, { startAt: 1 }, UPCOMING_MATCH_LIMIT),
    findMatchCards({ ...upcomingStatus, startAt: null }, { startAt: 1 }, UPCOMING_MATCH_LIMIT),
    findMatchCards(
      { status: { $in: LIVE_MATCH_STATUSES } },
      { startAt: 1 },
      UPCOMING_MATCH_LIMIT,
    ),
  ]);
  const upcomingMatches = [...datedUpcoming, ...undatedUpcoming].slice(0, UPCOMING_MATCH_LIMIT);

  let branches = [];
  if (team.organizationRef) {
    const branchQuery = {
      organizationRef: team.organizationRef,
      _id: { $ne: teamId },
      isActive: true,
    };
    // Sibling branches follow the same rule as the organization's public team
    // list: a guest browsing one published branch does not learn the names of
    // the branches the owner hid.
    if (!canViewTeamPrivate(viewer, team)) Object.assign(branchQuery, publicTeamClause());
    branches = await Team.find(branchQuery)
      // Round 5: `city` was in this projection but is not a Team field - city lives
    // in `address.city`, which `address` already brings along.
    .select("name branchName address logo shortName")
      .populate("organizationRef", "name");
  }

  const playerRankings = await TeamPlayerRanking.find({ team: teamId })
    .populate("player", "name imageUrl role playingRole battingPosition");

  // PR 7: the top-performers block is derived from the ranking source the
  // leaderboards read, not from the stored TeamPlayerRanking rows above — those
  // are only written by the post-match pipeline, so an older team can have none
  // and the block would be silently blank. Player.stats is kept up to date after
  // every match, so it is the trustworthy source.
  const rankingRows = await getTeamPlayerRankings(teamId, viewer);
  const topPerformers = buildTopPerformers(rankingRows || []);

  return {
    team,
    ranking: ranking || null,
    recentMatches,
    upcomingMatches,
    liveMatches,
    topPerformers,
    branches,
    playerRankings,
  };
}

// Round 5 — team name uniqueness is per organization, not global.
//
// Previously `name` carried a bare `unique: true` on the schema and both service
// checks matched on `{ name }` alone, so two unrelated organizations could not
// both own a "Rising Stars". The rule now is:
//
//   * a team that belongs to an organization is unique by (organization, name);
//   * an org-less (platform) team keeps global uniqueness, because there is no
//     organization to scope it to.
//
// Case is ignored on both sides so "Strikers" and "strikers" still collide —
// matching the collation on the compound index in Team.js.
function teamNameQuery(name, organizationRef, excludeId = null) {
  const escaped = String(name).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const filter = { name: { $regex: `^${escaped}$`, $options: "i" } };
  if (organizationRef) filter.organizationRef = organizationRef;
  else filter.organizationRef = { $in: [null, undefined] };
  if (excludeId) filter._id = { $ne: excludeId };
  return filter;
}

export async function assertTeamNameAvailable(name, organizationRef, excludeId = null) {
  if (!name) return;
  const existing = await Team.findOne(teamNameQuery(name, organizationRef, excludeId))
    .select("_id name organizationRef")
    .lean();
  if (existing) {
    // Terminal A: name the record that already exists so the owner can see what
    // collided, not just that something did.
    const scope = organizationRef ? "this club" : "the platform";
    const error = new Error(`A team named "${existing.name}" already exists in ${scope}.`);
    error.code = "TEAM_NAME_TAKEN";
    error.existing = { _id: existing._id, name: existing.name };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Organization ownership changes (Round 5)
// ---------------------------------------------------------------------------

export const ORG_CHANGE_FIELD = "allowOrganizationChange";

/**
 * Re-attaching a team to a different organization, or detaching it into an
 * org-less platform team, is a supervisory act: it moves the roster, the
 * fixture history and every org permission that reaches those players.
 *
 * `orgTeamsController` has always refused it for members (it deliberately omits
 * `organizationRef` from the editable body). The platform-admin route
 * `PUT /api/teams/:id` had no such rule, so any admin could silently re-parent a
 * tenant's team or orphan it. Now the change has to be asked for by name.
 *
 * @returns {null|{code:string,message:string,from:string|null,to:string|null}}
 *          null when the request is not an ownership change.
 */
export function checkOrganizationChangeRequest(team, data) {
  if (data.organizationRef === undefined) return null;

  const from = team?.organizationRef ? String(team.organizationRef) : null;
  const raw = data.organizationRef;
  const to = raw === null || raw === "" || raw === undefined ? null : String(raw);
  if (from === to) return null;

  if (data[ORG_CHANGE_FIELD] !== true) {
    return {
      code: "TEAM_ORG_CHANGE_REQUIRES_FLAG",
      message:
        "Changing a team's organization is a supervisory action. Resend with " +
        `"${ORG_CHANGE_FIELD}": true to confirm; the change is written to the audit log.`,
      from,
      to,
    };
  }
  return null;
}

/** Strip the supervisory flag so it is never written to the document. */
export function stripOrganizationChangeFlag(data) {
  const { [ORG_CHANGE_FIELD]: _ignored, ...rest } = data || {};
  void _ignored;
  return rest;
}

export function validateTeamRole(value) {
  if (value === undefined || value === null || value === "") return;
  if (!TEAM_ROLES.includes(value)) {
    const error = new Error(`Team role must be one of ${TEAM_ROLES.join(", ")}`);
    error.code = "TEAM_ROLE_INVALID";
    throw error;
  }
}

/**
 * Create the organization's first side through the exact same `createTeam`
 * service a manual "Add another team" uses. The name match is an idempotency
 * guard backed by Team's existing unique `(organizationRef, name)` index: a
 * concurrent double submit loses the insert race, and is then read back rather
 * than producing a second team.
 */
export async function ensureDefaultTeam(org, creatorId = null) {
  const name = String(org?.name || "").trim();
  if (!org?._id || !name) throw new Error("Organization is missing a name");
  validateTeamRole(DEFAULT_TEAM_ROLE);

  const existing = await Team.findOne({ organizationRef: org._id, name, teamRole: DEFAULT_TEAM_ROLE })
    .select("_id")
    .lean();
  if (existing) {
    return { team: await Team.findById(existing._id), created: false };
  }

  const labels = org.locationLabels || {};
  const legacy = org.location || {};
  const address = {
    town: labels.town || "",
    district: labels.district || "",
    city: legacy.city || labels.city || "",
    province: labels.province || "",
    country: legacy.country || labels.country || "Pakistan",
  };

  try {
    const team = await createTeam({
      name,
      organization: name,
      organizationRef: org._id,
      teamRole: DEFAULT_TEAM_ROLE,
      address,
      area: legacy.area || "",
      ...(org.locationRefs ? { locationRefs: org.locationRefs } : {}),
      ...(org.locationLabels ? { locationLabels: org.locationLabels } : {}),
      ...(creatorId ? { createdBy: creatorId } : {}),
    });
    return { team, created: true };
  } catch (error) {
    // The unique index is the real guard; the pre-check above only saves work.
    if (error.code === 11000 || error.code === "TEAM_NAME_TAKEN" || /already exists/i.test(error.message || "")) {
      const raced = await Team.findOne({ organizationRef: org._id, name }).select("_id").lean();
      if (raced) return { team: await Team.findById(raced._id), created: false };
    }
    throw error;
  }
}

export async function createTeam(data) {
  validateTeamRole(data.teamRole);
  // Round 5: the duplicate check runs before the insert and is org-scoped, so a
  // collision inside one organization is a 409 while the same name in a
  // different organization is allowed.
  await assertTeamNameAvailable(data.name, data.organizationRef);

  // Round 5: `city` used to be assigned to a top-level `team.city`, which Team.js
  // does not declare, so Mongoose's strict mode dropped it and a create-time city
  // was silently lost - the same latent bug the location endpoint had. City lives
  // in `address.city`. An explicit `address` object wins; the flat `city` is only
  // used to fill a gap it leaves, so the two cannot clobber each other.
  const address = {
    town: "",
    district: "",
    city: "",
    province: "",
    country: "Pakistan",
    ...(data.address || {}),
  };
  if (!address.city && data.city !== undefined) address.city = data.city || "";

  const team = new Team({
    name: data.name,
    shortName: data.shortName || data.name.substring(0, 3).toUpperCase(),
    type: data.type || "local_team",
    category: data.category || "Other",
    categoryRef: data.categoryRef || null,
    subCategory: data.subCategory || "",
    description: data.description || "",
    ageGroup: data.ageGroup || "Open",
    organization: data.organization || "",
    organizationRef: data.organizationRef || null,
    ...(data.teamRole !== undefined ? { teamRole: data.teamRole } : {}),
    branchName: data.branchName || "",
    ownername: data.ownername || "",
    logo: data.logo || "",
    fullAddress: data.fullAddress || "",
    address,
    // Location-tree selection from the Admin / org-owner form. The model's
    // plugin resolves the labels and ancestor chain; legacy `address` is kept.
    ...(data.locationRefs ? { locationRefs: data.locationRefs } : {}),
    ...(data.locationLabels ? { locationLabels: data.locationLabels } : {}),
    area: data.area || "",
    latitude: data.latitude,
    longitude: data.longitude,
    googleMapsUrl: data.googleMapsUrl || "",
    placeId: data.placeId || "",
    phone: data.phone || "",
    email: data.email || "",
    website: data.website || "",
    establishedYear: data.establishedYear,
    homeGround: data.homeGround || "",
    teamColorPrimary: data.teamColorPrimary || "#00a650",
    teamColorSecondary: data.teamColorSecondary || "#003087",
    isInternal: data.isInternal || false,
    tags: data.tags || [],
    media: data.media || [],
    videos: data.videos || [],
    socialLinks: data.socialLinks || {},
    privacy: data.privacy || {},
    players: data.players || [],
    captain: data.captain || null,
    viceCaptain: data.viceCaptain || null,
    // A new real team is public by default (Team.js default). An org that is
    // standing up a test squad asks for `isPublic: false` explicitly — the
    // field used to be accepted by `updateTeam` and silently dropped on create.
    ...(data.isPublic !== undefined ? { isPublic: Boolean(data.isPublic) } : {}),
  });

  await team.save();

  if (team.players && team.players.length > 0) {
    await Player.updateMany(
      { _id: { $in: team.players } },
      { $set: { team: team._id } }
    );
  }

  await team.populate("players");
  await team.populate("categoryRef");
  await team.populate("organizationRef");

  try { getIO()?.emit("team:created", team); } catch (e) {}

  return team;
}

export async function updateTeam(teamId, data) {
  validateTeamRole(data.teamRole);
  // Round 5: the uniqueness probe follows the team's *resulting* organization,
  // so a rename is checked against the organization the team will end up in.
  // `updateTeam` refuses to move a team between organizations (see
  // assertNoOrgMove) unless a supervisory caller asks for it explicitly, in
  // which case the check uses the requested target.
  const existingTeam = await Team.findById(teamId).select("organizationRef").lean();
  const targetOrg =
    data.organizationRef !== undefined ? data.organizationRef || null : existingTeam?.organizationRef || null;
  await assertTeamNameAvailable(data.name, targetOrg, teamId);

  const team = await Team.findById(teamId);
  if (!team) throw new Error("Team not found");

  const oldLogo = team.logo;
  const oldMediaUrls = (team.media || []).map((entry) => entry.url);

  const updateFields = [
    "name", "shortName", "type", "teamRole", "category", "categoryRef", "subCategory", "description", "ageGroup",
    "organization", "organizationRef", "branchName", "ownername", "logo",
    "fullAddress", "address", "area", "latitude", "longitude",
    "googleMapsUrl", "placeId", "phone", "email", "website",
    "establishedYear", "homeGround", "teamColorPrimary", "teamColorSecondary",
    "isActive", "profileComplete", "isInternal", "tags", "media",
    "videos", "socialLinks", "privacy", "isPublic",
    "captain", "viceCaptain", "locationRefs", "locationLabels",
  ];

  const objectIdFields = ["categoryRef", "organizationRef", "incubationGroup", "captain", "viceCaptain"];
  for (const field of objectIdFields) {
    if (data[field] === "") data[field] = null;
  }

  for (const field of updateFields) {
    if (data[field] !== undefined) {
      team[field] = data[field];
    }
  }

  if (data.players !== undefined) {
    await Player.updateMany(
      { team: team._id },
      { $unset: { team: 1 } }
    );
    if (data.players.length > 0) {
      await Player.updateMany(
        { _id: { $in: data.players } },
        { $set: { team: team._id } }
      );
    }
    team.players = data.players;
  }

  await team.save();
  await team.populate("players");
  await team.populate("categoryRef");
  await team.populate("organizationRef");

  // Clean up replaced/removed uploads after the save succeeds.
  if (data.logo !== undefined && oldLogo && oldLogo !== data.logo) {
    await deleteStoredFile(oldLogo).catch(() => {});
  }
  if (Array.isArray(data.media)) {
    const removedUrls = computeRemovedMediaUrls(oldMediaUrls, data.media);
    if (removedUrls.length) {
      await deleteStoredFiles(removedUrls).catch(() => {});
    }
  }

  try { getIO()?.emit("team:updated", team); } catch (e) {}

  return team;
}

export async function deleteTeam(teamId) {
  const team = await Team.findById(teamId);
  if (!team) throw new Error("Team not found");

  const mediaUrls = (team.media || []).map((entry) => entry.url).filter(Boolean);

  await Player.updateMany({ team: teamId }, { $unset: { team: 1 } });
  await TeamRanking.deleteOne({ team: teamId });
  await TeamPlayerRanking.deleteMany({ team: teamId });
  await Team.findByIdAndDelete(teamId);

  // Remove the team's own uploads from disk after the record is gone.
  if (team.logo) mediaUrls.push(team.logo);
  if (mediaUrls.length) {
    await deleteStoredFiles(mediaUrls).catch(() => {});
  }

  try { getIO()?.emit("team:deleted", { id: teamId }); } catch (e) {}

  return { id: teamId };
}

export async function assignPlayerToTeam(teamId, playerId, role = "player", jerseyNumber) {
  const team = await Team.findById(teamId);
  if (!team) throw new Error("Team not found");

  const player = await Player.findById(playerId);
  if (!player) throw new Error("Player not found");

  // Validated before anything is pulled from the player's old team, so a bad
  // value cannot leave a half-moved player behind.
  const jersey = parseJerseyNumber(jerseyNumber);

  const oldTeamId = player.team?.toString();

  if (oldTeamId && oldTeamId !== teamId) {
    await Team.findByIdAndUpdate(oldTeamId, { $pull: { players: playerId } });
    if (!player.teamHistory) player.teamHistory = [];
    player.teamHistory.push({
      team: oldTeamId,
      from: new Date(),
      to: new Date(),
      isCurrent: false,
    });
  }

  player.team = teamId;
  player.role = role || player.role;
  if (jersey !== undefined) player.jerseyNumber = jersey;
  await player.save();

  await Team.findByIdAndUpdate(teamId, { $addToSet: { players: playerId } });

  try { getIO()?.emit("team:updated", team); } catch (e) {}

  return player;
}

export async function removePlayerFromTeam(teamId, playerId) {
  const team = await Team.findById(teamId);
  if (!team) throw new Error("Team not found");

  team.players = team.players.filter((p) => p.toString() !== playerId);
  await team.save();

  const player = await Player.findById(playerId);
  if (player) {
    if (!player.teamHistory) player.teamHistory = [];
    player.teamHistory.push({
      team: teamId,
      from: new Date(),
      to: new Date(),
      isCurrent: false,
    });
    player.team = null;
    await player.save();
  }

  try { getIO()?.emit("team:updated", team); } catch (e) {}

  return team;
}

export async function updatePlayerRole(teamId, playerId, data) {
  const player = await Player.findById(playerId);
  // `teamId` arrives as an ObjectId from the controller, so comparing it to the
  // stringified `player.team` directly made every call look like a stranger and
  // returned 404 for a player who really was in the squad.
  if (!player || String(player.team || "") !== String(teamId)) {
    throw new Error("Player not in this team");
  }

  // The public team page prints `playingRole || role`, so a role change that is
  // also a valid classification must update both or the page keeps showing the
  // old one. A free-text role has no enum equivalent and leaves `playingRole`
  // alone (`""` is not a legal value for that field, and guessing a
  // classification would be worse than keeping the last explicit one).
  if (data.role) {
    player.role = data.role;
    if (PLAYING_ROLES.includes(data.role)) player.playingRole = data.role;
  }
  if (data.jerseyNumber !== undefined) {
    player.jerseyNumber = data.jerseyNumber === null ? null : parseJerseyNumber(data.jerseyNumber);
  }
  await player.save();

  return player;
}

export async function getOrganizationTree(viewer = null) {
  // The Admin app's Teams page reads this tree to *manage* teams, so a platform
  // admin sees fixtures and hidden branches; everybody else gets the public
  // shape of the same tree.
  const canSeePrivate = Boolean(viewer?.isPlatformAdmin);

  const orgQuery = { isActive: true };
  if (!canSeePrivate) Object.assign(orgQuery, reservedNamesMongoClause("name"));

  const organizations = await TeamOrganization.find(orgQuery)
    .populate("category", "name slug icon")
    .sort({ name: 1 });

  const result = [];

  for (const org of organizations) {
    const branchQuery = { organizationRef: org._id, isActive: true };
    if (!canSeePrivate) Object.assign(branchQuery, publicTeamClause());

    const branches = await Team.find(branchQuery)
      .populate("players", PLAYER_ROSTER_SELECT)
      .populate("categoryRef", "name slug icon");

    const branchCount = branches.length;
    const totalPlayers = branches.reduce((sum, b) => sum + (b.players?.length || 0), 0);

    result.push({
      organization: org,
      branches,
      branchCount,
      totalPlayers,
    });
  }

  return result;
}
