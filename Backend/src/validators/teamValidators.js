import { z } from "zod";
import { locationLabels, locationRefs } from "./locationSchemas.js";
import { BATTING_STYLES, BOWLING_STYLES, PLAYING_ROLES } from "./playerValidators.js";
import { isUploadedFilename } from "../utils/photoStore.js";
import { partialWithoutDefaults } from "./partialUpdate.js";

// Phase 4: teams created and maintained by an organization.
//
// `.strict()` for the same reason as the organization schemas: a caller who
// sends `organizationRef` gets a clear 400 instead of having the value silently
// overwritten by the guard middleware.
const objectIdString = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, "Must be a valid id");

const text = (max) => z.string().trim().max(max).default("");
const url = z
  .string()
  .trim()
  .max(600)
  .refine((v) => v === "" || /^https?:\/\//i.test(v), "Must start with http:// or https://")
  .default("");

export const TEAM_TYPES = ["team", "international_team", "league_team", "incubation_team", "local_team"];
export const TEAM_CATEGORIES = [
  "School",
  "College",
  "University",
  "Organization",
  "Business",
  "Industry",
  "Club",
  "Corporate",
  "Academy",
  "International",
  "Other",
];
export const AGE_GROUPS = ["U-10", "U-13", "U-15", "U-17", "U-19", "Open"];

const address = z
  .object({
    town: text(120),
    district: text(120),
    city: text(120),
    province: text(120),
    country: text(80),
  })
  .strict();

const privacy = z
  .object({
    contactInfo: z.enum(["public", "hidden"]).default("public"),
    socialLinks: z.enum(["public", "hidden"]).default("public"),
    location: z.enum(["public", "hidden"]).default("public"),
    // PR 7: gallery photos and videos. Defaults to "public", so a client that
    // never sends the key keeps the team's media on the public page.
    media: z.enum(["public", "hidden"]).default("public"),
  })
  .strict();

export const createOrgTeamSchema = z
  .object({
    name: z.string().trim().min(2, "Team name must be at least 2 characters").max(150),
    shortName: z.string().trim().max(20).default(""),
    type: z.enum(TEAM_TYPES).default("local_team"),
    teamRole: z.enum(["1st XI", "2nd XI", "U19", "U16", "women", "other"]).default("1st XI"),
    category: z.enum(TEAM_CATEGORIES).default("Other"),
    ageGroup: z.enum(AGE_GROUPS).default("Open"),
    description: text(2000),
    homeGround: text(200),
    establishedYear: z
      .number()
      .int()
      .min(1800)
      .max(new Date().getFullYear() + 1)
      .nullable()
      .default(null),
    logo: url,
    website: url,
    phone: text(40),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Please use a valid email format")
      .default(""),
    address: address.default({}),
    teamColorPrimary: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour such as #00a650")
      .default("#00a650"),
    teamColorSecondary: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour such as #003087")
      .default("#003087"),
    socialLinks: z
      .object({
        facebook: url,
        instagram: url,
        twitter: url,
        youtube: url,
        whatsapp: url,
      })
      .strict()
      .default({}),
    privacy: privacy.default({}),
    players: z.array(objectIdString).max(120).default([]),
    // Fix B: a new real team is public by default. An organization standing up a
    // test squad sends `isPublic: false` here; `PATCH /teams/:id/visibility`
    // (and the update schema, which derives from this one) keeps it reversible.
    isPublic: z.boolean().default(true),
  })
  .strict();

// Only the keys the caller sent: see partialUpdate.js for why `.partial()` alone
// is not enough with zod 4.
export const updateOrgTeamSchema = partialWithoutDefaults(createOrgTeamSchema.omit({ players: true }))
  .extend({ isActive: z.boolean().optional() })
  .strict();

export const orgTeamPlayersSchema = z
  .object({
    playerIds: z.array(objectIdString).min(1, "Pick at least one player").max(120),
  })
  .strict();

// The owner-side squad route also creates a player inline. Keeping this a
// separate schema lets DELETE keep requiring at least one existing player while
// POST accepts either existing ids, one new player, or both.
// Re-exported rather than re-typed: the owner-side squad form offers the same
// lists as the self-service player form, so both must validate against one
// source. A locally copied list here would silently drift and start accepting a
// bowling style the player form (and Player.js) does not.
export const TEAM_PLAYER_ROLES = PLAYING_ROLES;

export const TEAM_BATTING_STYLES = BATTING_STYLES;
export const TEAM_BOWLING_STYLES = BOWLING_STYLES;

// A photo may only point at a file this server wrote. Absolute URLs (even
// `https://evil.test/uploads/x.webp`) and traversal are refused here, not just
// in the browser, so a crafted POST cannot plant an off-site image URL.
const ownUploadUrl = z
  .string()
  .trim()
  .max(600)
  .regex(/^\/uploads\/[A-Za-z0-9._-]+$/, "Photo must be a local /uploads/ URL")
  .refine((value) => isUploadedFilename(value.slice("/uploads/".length)), "Photo must be a local /uploads/ URL");

const orgTeamNewPlayerSchema = z
  .object({
    name: z.string().trim().min(1, "Player name is required").max(150),
    imageUrl: ownUploadUrl.optional(),
    role: z.string().trim().max(120).optional(),
    playingRole: z.enum(PLAYING_ROLES).optional(),
    battingStyle: z.enum(BATTING_STYLES).optional(),
    bowlingStyle: z.enum(BOWLING_STYLES).optional(),
    jerseyNumber: z.coerce.number().int().min(0).max(999).optional(),
    phone: z.string().trim().max(40).optional(),
    locationRefs,
    locationLabels,
  })
  .strict();

export const orgTeamAddPlayersSchema = z
  .object({
    playerIds: z.array(objectIdString).max(120).default([]),
    newPlayer: orgTeamNewPlayerSchema.optional(),
    // "Add several": the bulk form sends names only; one request, one audit
    // entry, and every name is checked for duplicates before anything is saved.
    newPlayers: z.array(orgTeamNewPlayerSchema).max(60).default([]),
  })
  .strict()
  .refine(
    (value) => value.playerIds.length > 0 || Boolean(value.newPlayer) || value.newPlayers.length > 0,
    { message: "Pick at least one player or add a new one", path: ["playerIds"] }
  );

export const orgTeamPlayerRoleSchema = z
  .object({
    role: z.string().trim().min(1).max(60).optional(),
    jerseyNumber: z.number().int().min(0).max(999).nullable().optional(),
  })
  .strict();

export default {
  createOrgTeamSchema,
  updateOrgTeamSchema,
  orgTeamPlayersSchema,
  orgTeamAddPlayersSchema,
  orgTeamPlayerRoleSchema,
  TEAM_PLAYER_ROLES,
  TEAM_BATTING_STYLES,
  TEAM_BOWLING_STYLES,
};
