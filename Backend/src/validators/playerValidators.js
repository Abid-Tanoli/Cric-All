import { z } from 'zod';

// Phase 5: player profiles.
//
// Two rules this file exists to enforce:
//
//  1. A profile is a *claim about a person*, so it is open to any verified
//     account — but it is still a write into a shared collection, so the schema
//     is strict (unknown keys are rejected, not silently dropped).
//  2. `stats` is never accepted. Career numbers are produced by the scoring
//     engine; letting a client write them would let anybody claim 10,000 runs.
//     The previous schema did not list `stats`, but it was not `.strict()`, so a
//     caller could still smuggle arbitrary keys past it.
//
// The enum lists mirror Player.js exactly. They are duplicated rather than
// imported because the model file exports a Mongoose model, and importing it
// into a validator would register the schema a second time under a second
// connection in the test harness.

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id');

export const PLAYING_ROLES = [
  'Batsman',
  'Bowler',
  'All-Rounder',
  'Batting-All-Rounder',
  'Bowling-All-Rounder',
  'Wicket-Keeper',
];

export const BATTING_STYLES = ['Right-handed', 'Left-handed'];

export const BOWLING_STYLES = [
  'Right-arm Fast',
  'Right-arm Fast-Medium',
  'Right-arm Medium',
  'Right-arm Medium-Pace',
  'Right-arm Off-break',
  'Right-arm Leg-break',
  'Right-arm Slow',
  'Left-arm Fast',
  'Left-arm Fast-Medium',
  'Left-arm Medium',
  'Left-arm Medium-Pace',
  'Left-arm Orthodox',
  'Left-arm Chinaman',
  'Left-arm Slow',
  'Not Applicable',
];

export const PLAYER_CATEGORIES = [
  'School',
  'College',
  'University',
  'Organization',
  'Business',
  'Industry',
  'Club',
  'International',
  'Other',
];

export const AGE_GROUPS = ['U-10', 'U-13', 'U-15', 'U-17', 'U-19', 'Open'];

const optionalUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => value === '' || /^https?:\/\//i.test(value) || value.startsWith('/'), {
    message: 'Must be an http(s) URL or a site-relative path',
  })
  .optional();

const addressSchema = z
  .object({
    town: z.string().trim().max(120).optional(),
    district: z.string().trim().max(120).optional(),
    city: z.string().trim().max(120).optional(),
    province: z.string().trim().max(120).optional(),
    country: z.string().trim().max(120).optional(),
  })
  .strict();

const socialLinksSchema = z
  .object({
    facebook: z.string().trim().max(300).optional(),
    instagram: z.string().trim().max(300).optional(),
    twitter: z.string().trim().max(300).optional(),
    youtube: z.string().trim().max(300).optional(),
    whatsapp: z.string().trim().max(300).optional(),
  })
  .strict();

const privacySchema = z
  .object({
    contactInfo: z.enum(['public', 'hidden']).optional(),
    socialLinks: z.enum(['public', 'hidden']).optional(),
    location: z.enum(['public', 'hidden']).optional(),
  })
  .strict();

const gallerySchema = z
  .array(
    z
      .object({
        url: z.string().trim().min(1).max(2048),
        caption: z.string().trim().max(300).optional(),
      })
      .strict()
  )
  .max(24)
  .optional();

const videosSchema = z
  .array(
    z
      .object({
        url: z.string().trim().min(1).max(2048),
        title: z.string().trim().max(300).optional(),
      })
      .strict()
  )
  .max(12)
  .optional();

const relationsSchema = z
  .array(
    z
      .object({
        player: objectId,
        relationType: z.string().trim().min(1).max(60),
      })
      .strict()
  )
  .max(20)
  .optional();

const teamHistorySchema = z
  .array(
    z
      .object({
        team: objectId,
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        isCurrent: z.boolean().optional(),
      })
      .strict()
  )
  .max(30)
  .optional();

/**
 * Fields a self-service creator may set. `team` is deliberately absent: putting
 * a player into a squad is a separate, permission-checked action
 * (POST /organizations/:id/teams/:teamId/players). Letting it ride along on
 * create would let any verified user drop a player into somebody else's team.
 */
export const SELF_SERVICE_PLAYER_FIELDS = [
  'name',
  'role',
  'playingRole',
  'battingStyle',
  'bowlingStyle',
  'campus',
  'category',
  'subCategory',
  'ageGroup',
  'organization',
  'address',
  'birthInfo',
  'age',
  'imageUrl',
  'relations',
  'teamHistory',
  'gallery',
  'videos',
  'socialLinks',
  'privacy',
];

export const createPlayerSchema = z
  .object({
    name: z.string().trim().min(1, 'Player name is required').max(150),
    role: z.string().trim().max(120).optional(),
    playingRole: z.enum(PLAYING_ROLES).optional(),
    battingStyle: z.enum(BATTING_STYLES).optional(),
    bowlingStyle: z.enum(BOWLING_STYLES).optional(),
    campus: z.string().trim().max(150).optional(),
    category: z.enum(PLAYER_CATEGORIES).optional(),
    subCategory: z.string().trim().max(120).optional(),
    ageGroup: z.enum(AGE_GROUPS).optional(),
    organization: z.string().trim().max(200).optional(),
    address: addressSchema.optional(),
    birthInfo: z
      .object({
        date: z.coerce.date().optional(),
        place: z.string().trim().max(150).optional(),
      })
      .strict()
      .optional(),
    age: z.number().int().min(5).max(120).optional(),
    imageUrl: optionalUrl,
    relations: relationsSchema,
    teamHistory: teamHistorySchema,
    gallery: gallerySchema,
    videos: videosSchema,
    socialLinks: socialLinksSchema.optional(),
    privacy: privacySchema.optional(),
  })
  .strict();

// The career-stats shape. It lives here so the shape is validated even on the
// self-service route — the field is *accepted by the shape and then removed by
// the authorization layer* for anyone who is not a platform admin. Rejecting it
// with a 400 instead would leak the fact that the field exists and force the
// client to special-case the response.
const statsSchema = z
  .object({
    runs: z.number().min(0).optional(),
    wickets: z.number().min(0).optional(),
    strikeRate: z.number().min(0).optional(),
    economy: z.number().min(0).optional(),
    matches: z.number().int().min(0).optional(),
    innings: z.number().int().min(0).optional(),
    notOuts: z.number().int().min(0).optional(),
    highScore: z.number().min(0).optional(),
    average: z.number().min(0).optional(),
    fifties: z.number().int().min(0).optional(),
    hundreds: z.number().int().min(0).optional(),
    bowlingAverage: z.number().min(0).optional(),
    bestBowling: z.string().trim().max(20).optional(),
    fourWickets: z.number().int().min(0).optional(),
    fiveWickets: z.number().int().min(0).optional(),
    dotBalls: z.number().int().min(0).optional(),
    catches: z.number().int().min(0).optional(),
    stumpings: z.number().int().min(0).optional(),
    runOuts: z.number().int().min(0).optional(),
  })
  .strict();

// `age` and `birthInfo.date` are derivable from each other; letting a client set
// both inconsistently produced profiles that disagreed with themselves.
const ageOrBirthInfo = (body) => !(body.age != null && body.birthInfo?.date);

export const updatePlayerSchema = createPlayerSchema
  .partial()
  .extend({
    // Accepted by the shape, then stripped by applyPlayerFieldPolicy unless the
    // caller is entitled to it. See middleware/playerAccess.js.
    team: objectId.optional(),
    stats: statsSchema.optional(),
  })
  .refine(ageOrBirthInfo, {
    message: 'Send either age or birthInfo.date, not both',
  });

// The Admin forms submit `team: ""` for a free agent ("Agent (No Team)"). The
// controller strips empty ids before they reach Mongoose — otherwise "" throws a
// CastError and the whole save 500s — so the schema has to let "" through rather
// than 400 on a choice the form itself offers.
const optionalTeamId = z.union([objectId, z.literal('')]);

const seedProvenance = {
  isSeed: z.boolean().optional(),
  seedSource: z.string().trim().max(200).optional(),
  seedVersion: z.string().trim().max(50).optional(),
};

// Terminal A (oct11-A): fields the Admin data-entry path may set. Kept off the
// self-service schema so a public creator cannot add contact/jersey data to a
// claim about somebody else. `jerseyNumber` is coerced because HTML number
// inputs submit strings.
const adminEntryFields = {
  phone: z.string().trim().max(32).optional(),
  jerseyNumber: z.coerce.number().int().min(0).max(999).optional(),
  isPartTimeBowler: z.boolean().optional(),
};

/** Admin-only: the seed/import path, which may set career stats and provenance. */
export const adminPlayerSchema = createPlayerSchema
  .extend({
    stats: statsSchema.optional(),
    team: optionalTeamId.optional(),
    ...seedProvenance,
    ...adminEntryFields,
  })
  .strict();

/**
 * The update half of the same privilege. `PUT /players/:id` is one route for
 * three kinds of caller, so the route picks the schema from the principal and
 * applyPlayerFieldPolicy decides what actually lands in the document.
 */
export const adminUpdatePlayerSchema = createPlayerSchema
  .partial()
  .extend({
    stats: statsSchema.optional(),
    team: optionalTeamId.optional(),
    ...seedProvenance,
    ...adminEntryFields,
  })
  .refine(ageOrBirthInfo, {
    message: 'Send either age or birthInfo.date, not both',
  });

export default {
  createPlayerSchema,
  updatePlayerSchema,
  adminPlayerSchema,
  adminUpdatePlayerSchema,
  SELF_SERVICE_PLAYER_FIELDS,
  PLAYING_ROLES,
  BATTING_STYLES,
  BOWLING_STYLES,
  PLAYER_CATEGORIES,
  AGE_GROUPS,
};
