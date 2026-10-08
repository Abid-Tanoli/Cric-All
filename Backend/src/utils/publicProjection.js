// Round 5 — public-read projection for Player and Team.
//
// Why this module exists
// ---------------------
// Every public player/team read used to hand the caller whatever Mongoose
// happened to load. `Player.find()` with no `.select()` returned `birthInfo.date`
// (date of birth), the full `address`, `gallery[]`, `videos[]` and `createdBy`
// (the account that typed the profile in) to an unauthenticated caller, and two
// team endpoints embedded a dozen whole Player documents each. The privacy flags
// on the model were honoured in exactly one place (`getPlayer`), and even there
// the `contactInfo` branch deleted fields the schema never had.
//
// The rules this module enforces:
//
//   1. WHITELIST, never blacklist. A field that nobody thought about is absent
//      by construction, so adding a column to Player.js or Team.js cannot leak
//      it. `test/publicProjection.test.js` asserts the exact public key set, so
//      widening a whitelist is a deliberate, reviewable edit.
//   2. `createdBy`, the seed markers and `__v` never appear in a public body.
//      Who typed a profile in is not public information.
//   3. Privacy flags gate what the whitelist would otherwise include. A field
//      with no flag to permit it (`birthInfo`) is withheld outright; a field whose
//      flag is set to "hidden" (`gallery`, `videos`, `socialLinks`, `address`)
//      is blanked in place, so the public key set never varies from row to row.
//   4. Escalation is explicit and narrow: the profile's creator, a manager of
//      the organization that owns the player's team, and platform admins see the
//      full document. Everybody else sees the public projection.
//
// The sanitizers are pure and synchronous so they can be unit-tested without a
// database; the viewer capability lookup (which needs Membership) lives in
// `resolveViewerContext` and is done once per request.

import Membership from "../models/Membership.js";
import Player from "../models/Player.js";
import Team from "../models/Team.js";
import { PERMISSIONS, roleHasPermission, isOrgAdminRole } from "../permissions/orgPermissions.js";

// ---------------------------------------------------------------------------
// Public field sets
// ---------------------------------------------------------------------------

/**
 * Everything a non-privileged caller may see on a Player. Order is irrelevant
 * to behaviour but kept readable.
 *
 * Deliberately absent: `createdBy`, `isSeed`, `seedSource`, `seedVersion`
 * (internal provenance) and `birthInfo` (no privacy flag opts date of birth in,
 * so it is withheld outright rather than merely blanked).
 *
 * `gallery` and `videos` *are* on the whitelist because `privacy.gallery` and
 * `privacy.videos` are real flags on the model — they are emitted blanked when
 * hidden rather than dropped, which is what makes the key set stable.
 */
export const PLAYER_PUBLIC_FIELDS = Object.freeze([
  "_id",
  "name",
  "role",
  "playingRole",
  "battingStyle",
  "bowlingStyle",
  "campus",
  "category",
  "subCategory",
  "ageGroup",
  "organization",
  "imageUrl",
  "team",
  "age",
  "stats",
  "relations",
  "teamHistory",
  "gallery",
  "videos",
  "socialLinks",
  "privacy",
  "address",
  "createdAt",
  "updatedAt",
]);

/**
 * Minimal projection for a Player embedded inside a Team payload. Rosters are
 * rendered as name/role/logo buttons by the fixture editor and the team page;
 * a roster entry does not need career stats or a social link.
 */
export const PLAYER_ROSTER_FIELDS = Object.freeze([
  "_id",
  "name",
  "role",
  "playingRole",
  "imageUrl",
]);

/** Public Team fields. Excluded: `managedBy`, seed markers, `__v`. */
export const TEAM_PUBLIC_FIELDS = Object.freeze([
  "_id",
  "name",
  "shortName",
  "longName",
  "type",
  "category",
  "categoryRef",
  "subCategory",
  "description",
  "ageGroup",
  "organization",
  "organizationRef",
  "branchName",
  "address",
  "fullAddress",
  "area",
  "latitude",
  "longitude",
  "googleMapsUrl",
  "placeId",
  "phone",
  "email",
  "website",
  "establishedYear",
  "homeGround",
  "teamColorPrimary",
  "teamColorSecondary",
  "logo",
  "media",
  "videos",
  "socialLinks",
  "privacy",
  "tags",
  "players",
  "isCountry",
  "espnTeamId",
  "incubationGroup",
  "isActive",
  "profileComplete",
  "isPublic",
  "createdAt",
  "updatedAt",
]);

/** `.select()` strings, so the database never loads what we would strip anyway. */
export const PLAYER_PUBLIC_SELECT = PLAYER_PUBLIC_FIELDS.filter((f) => f !== "_id").join(" ");
export const PLAYER_ROSTER_SELECT = PLAYER_ROSTER_FIELDS.filter((f) => f !== "_id").join(" ");
export const TEAM_PUBLIC_SELECT = TEAM_PUBLIC_FIELDS.filter((f) => f !== "_id").join(" ");

/** The team fields a public player payload needs. */
export const PLAYER_TEAM_SELECT_PUBLIC = "name shortName logo";
/** Adds the owning organization so an org manager can be recognised per row. */
export const PLAYER_TEAM_SELECT_PRIVATE = "name shortName logo organizationRef";

/**
 * `.select()` for a Player query, widened only for an identified caller.
 *
 * An anonymous caller never loads `createdBy`/`birthInfo`/`gallery`/`videos` at
 * all — they cannot leak what never left the database. An identified caller
 * loads them so `sanitizePlayerPublic` can decide per row whether this viewer is
 * the creator or an org manager, rather than the whole list being downgraded
 * because the endpoint happens to serve mixed authors.
 */
export function playerSelectFor(viewer) {
  return viewer?.userId ? `${PLAYER_PUBLIC_SELECT} createdBy birthInfo` : PLAYER_PUBLIC_SELECT;
}

export function playerTeamSelectFor(viewer) {
  return viewer?.userId ? PLAYER_TEAM_SELECT_PRIVATE : PLAYER_TEAM_SELECT_PUBLIC;
}

/** Owning organization of a player, read off its populated team. */
export function playerOrgIdOf(player) {
  const plain = toPlain(player);
  const team = plain?.team;
  if (!team || typeof team !== "object") return null;
  return idOf(team.organizationRef);
}

/** Team fields gated by `privacy.location`. */
const TEAM_LOCATION_FIELDS = Object.freeze([
  "address",
  "fullAddress",
  "area",
  "latitude",
  "longitude",
  "googleMapsUrl",
  "placeId",
]);

/** Team fields gated by `privacy.contactInfo`. */
const TEAM_CONTACT_FIELDS = Object.freeze(["phone", "email", "website"]);

// ---------------------------------------------------------------------------
// Viewer context
// ---------------------------------------------------------------------------

const ANONYMOUS = Object.freeze({
  userId: null,
  isPlatformAdmin: false,
  managedOrgIds: new Set(),
});

/**
 * Works out what the caller is allowed to see beyond the public projection.
 *
 * Call this once per request and pass the result to the sanitizers. It reads
 * Membership, so it is the only async part of this module.
 *
 * `managedOrgIds` holds the organizations in which the caller holds
 * `manage_teams` (owners and org admins qualify, by definition of the
 * permission). Platform admins manage everything, signalled by isPlatformAdmin.
 */
export async function resolveViewerContext(req) {
  if (!req?.user?._id) return ANONYMOUS;

  const ctx = {
    userId: String(req.user._id),
    isPlatformAdmin:
      req.principalType === "admin" ||
      req.user.role === "admin" ||
      req.user.role === "superadmin",
    managedOrgIds: new Set(),
  };
  if (ctx.isPlatformAdmin) return ctx;

  const memberships = await Membership.find({
    user: req.user._id,
    status: "active",
  })
    .select("organization roles")
    .lean();

  for (const membership of memberships) {
    const roles = membership.roles || [];
    const manages =
      roles.includes("owner") ||
      isOrgAdminRole(roles) ||
      roleHasPermission(roles, PERMISSIONS.MANAGE_TEAMS);
    if (manages && membership.organization) {
      ctx.managedOrgIds.add(String(membership.organization));
    }
  }
  return ctx;
}

export const anonymousViewer = () => ANONYMOUS;

/** True when `viewer` may see the full player document. */
export function canViewPlayerPrivate(viewer, player, playerOrgId) {
  if (!viewer?.userId) return false;
  if (viewer.isPlatformAdmin) return true;
  const plain = toPlain(player);
  if (plain?.createdBy && String(plain.createdBy) === viewer.userId) return true;
  if (playerOrgId && viewer.managedOrgIds.has(String(playerOrgId))) return true;
  return false;
}

/** True when `viewer` may see the full team document. */
export function canViewTeamPrivate(viewer, team) {
  if (!viewer?.userId) return false;
  if (viewer.isPlatformAdmin) return true;
  const plain = toPlain(team);
  const orgId = plain?.organizationRef?._id || plain?.organizationRef;
  if (orgId && viewer.managedOrgIds.has(String(orgId))) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toPlain(doc) {
  if (!doc) return null;
  if (typeof doc.toObject === "function") return doc.toObject();
  return doc;
}

function idOf(value) {
  if (!value) return null;
  if (typeof value === "object") return value._id ? String(value._id) : null;
  return String(value);
}

/**
 * Maps populated entries through `fn`; leaves bare ObjectIds alone. A roster can
 * legitimately arrive either way — `teamPayload` receives it populated in some
 * paths and as ids in others — and an id is not sensitive, so passing it
 * through is correct rather than a hole.
 */
function mapPopulated(list, fn) {
  if (!Array.isArray(list)) return list;
  return list
    .map((entry) => (entry && typeof entry === "object" ? fn(entry) : entry))
    .filter((entry) => entry !== undefined);
}

/**
 * Copies `fields` off `source`, always emitting every one of them.
 *
 * An absent field becomes a type-correct empty value rather than a missing key.
 * Two reasons. The frontend reads `player.address.city` and `player.stats.runs`
 * unconditionally, so an optional-but-absent field turning the key off would turn
 * a stable response shape into one that depends on how complete the record is;
 * and a closed key set is only testable if the set does not vary per row. The
 * default is read off the Mongoose schema rather than guessed, so `players` gets
 * `[]` and `age` gets `""` instead of the other way round.
 */
function pick(source, fields, schema) {
  const out = {};
  for (const field of fields) {
    out[field] = source[field] !== undefined ? source[field] : emptyLike(schema, field);
  }
  return out;
}

function emptyLike(schema, field) {
  switch (schema?.pathType(field)) {
    case "Array":
      return [];
    case "Object":
      return {};
    default:
      return "";
  }
}

/**
 * Projection for a Player embedded in a Team payload: exactly the roster fields,
 * always present. Roster rows are rendered as a name/role/photo button in the
 * fixture editor and on the team page, so this is deliberately narrower than
 * `PLAYER_PUBLIC_FIELDS` — a roster is a list of people, not a set of profiles.
 */
export function sanitizeRosterPlayer(doc) {
  if (doc === null || doc === undefined) return doc;
  // A roster entry that arrived as a bare ObjectId has nothing to disclose; the
  // id itself is not sensitive, so it is kept as the row's `_id`.
  if (typeof doc !== "object") return { _id: String(doc), ...emptyRoster() };
  return pick(toPlain(doc), PLAYER_ROSTER_FIELDS, Player.schema);
}

function emptyRoster() {
  return { name: "", role: "", playingRole: "", imageUrl: "" };
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

/**
 * Public projection of one player.
 *
 * @param {object} doc            Player document, lean object or populated doc.
 * @param {object} [opts]
 * @param {object} [opts.viewer]  from `resolveViewerContext`.
 * @param {boolean} [opts.canViewPrivate]  force the full document through.
 * @param {string}  [opts.playerOrgId]     owning organization, for org managers.
 */
export function sanitizePlayerPublic(doc, opts = {}) {
  const plain = toPlain(doc);
  if (!plain) return plain;

  const { viewer = null, playerOrgId = null } = opts;
  const canViewPrivate =
    opts.canViewPrivate === true || canViewPlayerPrivate(viewer, plain, playerOrgId);

  if (canViewPrivate) {
    // Full document minus internal provenance. `createdBy` is kept here on
    // purpose: this is the creator's own view of their profile.
    const full = { ...plain };
    delete full.__v;
    return full;
  }

  const privacy = plain.privacy || {};
  const out = pick(plain, PLAYER_PUBLIC_FIELDS, Player.schema);

  // `birthInfo` is not on the whitelist, so date of birth is already absent by
  // construction. It was also being deleted here, which was a no-op: a field the
  // whitelist never emitted cannot be removed from the output. Removing it from
  // the whitelist is the guarantee; a delete cannot add one.

  // Gallery and videos are gated by their own privacy flags (both default to
  // "public" on the model). Hidden blanks the array in place rather than dropping
  // the key, for the same reason `address` and `socialLinks` are blanked: the
  // public key set stays stable, so a consumer can read `player.gallery` without
  // first checking whether the record happened to have one.
  //
  // These used to `delete out.gallery`, which could never fire — neither field was
  // on the whitelist, so the flags were inert and a player who had chosen
  // "public" still saw no media of their own.
  if (privacy.gallery === "hidden") {
    out.gallery = [];
  }
  if (privacy.videos === "hidden") {
    out.videos = [];
  }

  // `privacy.contactInfo` has nothing to gate on a Player: the model declares no
  // phone, email or website field, so there is no contact data to blank. The flag
  // is kept on the schema because it is part of the shared privacy vocabulary and
  // `Team` (which does have contact fields, gated above) uses the same names. If a
  // contact field is ever added to Player, it belongs on the whitelist *and*
  // behind this branch — the empty `if` that used to sit here was a placeholder
  // that silently did nothing.

  // `location` gates the address. For public (non-private) view, expose only city and country
  // as per requirement. Blank the values rather than dropping the key so the frontend's reads stay type-safe.
  if (privacy.location === "hidden") {
    out.address = {
      town: "",
      district: "",
      city: "",
      province: "",
      country: "",
    };
  } else {
    const addr = out.address || {};
    out.address = {
      town: "",
      district: "",
      city: addr.city || "",
      province: "",
      country: addr.country || "",
    };
  }

  // `socialLinks` blanks in place for the same reason.
  if (privacy.socialLinks === "hidden") {
    out.socialLinks = Object.fromEntries(
      Object.keys(out.socialLinks || {}).map((key) => [key, ""]),
    );
  }

  delete out.createdBy;
  delete out.__v;
  return out;
}

export function sanitizePlayersPublic(docs, opts = {}) {
  if (!Array.isArray(docs)) return docs;
  return docs.map((doc) =>
    sanitizePlayerPublic(doc, { ...opts, playerOrgId: opts.playerOrgId ?? playerOrgIdOf(doc) }),
  );
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

/**
 * Public projection of one team. A populated `players` array is projected with
 * the roster rules rather than passed through, which is what closed the
 * `GET /teams/:id` and `GET /organizations/:id/teams` leaks.
 */
export function sanitizeTeamPublic(doc, opts = {}) {
  const plain = toPlain(doc);
  if (!plain) return plain;

  const { viewer = null, playerOrgId = null } = opts;
  const canViewPrivate = opts.canViewPrivate === true || canViewTeamPrivate(viewer, plain);

  if (canViewPrivate) {
    const full = { ...plain };
    delete full.__v;
    if (Array.isArray(full.players)) {
      full.players = mapPopulated(full.players, (player) => sanitizePlayerPublic(player, opts));
    }
    return full;
  }

  const privacy = plain.privacy || {};
  const out = pick(plain, TEAM_PUBLIC_FIELDS, Team.schema);

  if (privacy.location === "hidden") {
    for (const field of TEAM_LOCATION_FIELDS) {
      if (field in out) out[field] = field === "address" ? { town: "", district: "", city: "", province: "", country: "" } : "";
    }
  }

  if (privacy.contactInfo === "hidden") {
    for (const field of TEAM_CONTACT_FIELDS) {
      if (field in out) out[field] = "";
    }
  }

  if (privacy.socialLinks === "hidden") {
    out.socialLinks = Object.fromEntries(
      Object.keys(out.socialLinks || {}).map((key) => [key, ""]),
    );
  }

  // A public roster is a roster projection, not a set of player profiles: the
  // team page and the fixture squad editor only render name/role/photo, and the
  // narrower shape means a team's player list cannot become a second player
  // directory. Bare ObjectIds stay ids (see `mapPopulated`).
  if (Array.isArray(out.players)) {
    out.players = out.players.map((entry) => sanitizeRosterPlayer(entry));
  }

  delete out.managedBy;
  delete out.isInternal;
  delete out.__v;
  return out;
}

export function sanitizeTeamsPublic(docs, opts = {}) {
  if (!Array.isArray(docs)) return docs;
  return docs.map((doc) => sanitizeTeamPublic(doc, opts));
}

/**
 * Convenience wrapper for a team payload that also carries populated players:
 * resolves the player's owning organization from the team so that a manager of
 * that organization sees their own roster in full.
 */
export function sanitizeTeamWithRoster(doc, opts = {}) {
  const plain = toPlain(doc);
  const orgId = idOf(plain?.organizationRef);
  return sanitizeTeamPublic(doc, { ...opts, playerOrgId: orgId });
}


// Test name reservation (defense in depth).
//
// Fix B: test and fixture data must never surface in public reads, while real
// organizations stay public by default. This is the single shared predicate
// every public read path applies so the reserved prefixes cannot drift apart
// between endpoints.
const TEST_NAME_PREFIXES = [
  "OPENCODE_TEST_",
  "OPENCODE-TEST_",
  "E2E_",
  "TEST_",
  "CRICALL_TEST_",
];

export function isReservedTestName(value) {
  if (!value) return false;
  const s = String(value).trim();
  for (const p of TEST_NAME_PREFIXES) {
    if (s.startsWith(p)) return true;
  }
  return false;
}

export default {
  isReservedTestName,
  PLAYER_PUBLIC_FIELDS,
  PLAYER_ROSTER_FIELDS,
  TEAM_PUBLIC_FIELDS,
  PLAYER_PUBLIC_SELECT,
  PLAYER_ROSTER_SELECT,
  TEAM_PUBLIC_SELECT,
  PLAYER_TEAM_SELECT_PUBLIC,
  PLAYER_TEAM_SELECT_PRIVATE,
  playerSelectFor,
  playerTeamSelectFor,
  playerOrgIdOf,
  resolveViewerContext,
  anonymousViewer,
  canViewPlayerPrivate,
  canViewTeamPrivate,
  sanitizePlayerPublic,
  sanitizePlayersPublic,
  sanitizeTeamPublic,
  sanitizeTeamsPublic,
  sanitizeTeamWithRoster,
};
