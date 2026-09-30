import { z } from 'zod';

// Phase 6: fixtures and competitions an organization runs itself.
//
// These schemas are strict for the same reason the player ones are: the
// organization dashboard is a self-service surface, and a body that carries
// keys the server does not understand is either a stale client or somebody
// probing for a field that happens to be writable.
//
// Two things are deliberately NOT in any of these schemas:
//
//   * `organizationRef` / `organization` — the tenant key comes from the
//     authorized `req.org`. A member must not be able to file a fixture under
//     somebody else's organization, so the key is not merely ignored, it is
//     rejected outright.
//   * anything score-related (`status: live|completed`, `result`, `innings`,
//     `manOfMatch`). Running a match is Phase 9 / platform-admin territory
//     (`score_match`). An organization may set a fixture up and take it away
//     again; it may not declare the outcome of one.

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id');

// Mirrors Match.matchType. The model derives totalOvers and the powerplay from
// this on save, so accepting an explicit `totalOvers` would let a client ask for
// a 20-over T20 that behaves like a 5-over one.
export const MATCH_TYPES = [
  '6 Overs',
  '8 Overs',
  'T10',
  'T20',
  'ODI',
  'Test',
  'Tape Ball',
  'Super Over',
];

// The only statuses self-service may set. A fixture can be scheduled or called
// off; it cannot be declared live or finished, because those states are written
// by the scoring engine.
export const ORG_SETTABLE_MATCH_STATUSES = ['upcoming', 'abandoned'];

export const EVENT_TYPES = [
  'single-match',
  'series',
  'tri-series',
  'tournament',
  'world-cup',
  'champions-trophy',
  'league',
];

export const EVENT_FORMATS = ['T20', 'ODI', 'Test', 'T10', '6 Overs', '8 Overs', 'Tape Ball'];

const addressSchema = z
  .object({
    town: z.string().trim().max(120).optional(),
    district: z.string().trim().max(120).optional(),
    city: z.string().trim().max(120).optional(),
    province: z.string().trim().max(120).optional(),
  })
  .strict();

export const createOrgMatchSchema = z
  .object({
    title: z.string().trim().max(200).optional(),
    venue: z.string().trim().max(200).optional(),
    matchType: z.enum(MATCH_TYPES).optional(),
    startAt: z.coerce.date().optional(),
    // Exactly two different teams. The controller additionally requires both to
    // belong to this organization, which a schema cannot know.
    teams: z
      .array(objectId)
      .length(2, 'A fixture needs exactly two teams')
      .refine((teams) => teams[0] !== teams[1], { message: 'A team cannot play itself' }),
    eventId: objectId.optional(),
    series: z.string().trim().max(200).optional(),
    seriesMatchNumber: z.number().int().min(1).max(500).optional(),
  })
  .strict();

export const updateOrgMatchSchema = z
  .object({
    title: z.string().trim().max(200).optional(),
    venue: z.string().trim().max(200).optional(),
    matchType: z.enum(MATCH_TYPES).optional(),
    startAt: z.coerce.date().optional(),
    status: z.enum(ORG_SETTABLE_MATCH_STATUSES).optional(),
    // Allowed only while the fixture is untouched; see assertTeamsCanChange().
    teams: z
      .array(objectId)
      .length(2, 'A fixture needs exactly two teams')
      .refine((teams) => teams[0] !== teams[1], { message: 'A team cannot play itself' })
      .optional(),
    series: z.string().trim().max(200).optional(),
    seriesMatchNumber: z.number().int().min(1).max(500).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });

const squadEntry = z
  .object({
    team: objectId,
    // 11 is a side; 20 is a tournament squad. Anything outside that is a typo
    // rather than an intention, and an XI of 3 produces a scorecard nobody can
    // read.
    players: z.array(objectId).min(1, 'A squad cannot be empty').max(20, 'A squad is at most 20 players'),
    captain: objectId.optional(),
    viceCaptain: objectId.optional(),
    wicketKeepers: z.array(objectId).max(4).optional(),
  })
  .strict()
  .refine((entry) => !entry.captain || entry.players.includes(entry.captain), {
    message: 'The captain must be in the squad',
    path: ['captain'],
  })
  .refine((entry) => !entry.viceCaptain || entry.players.includes(entry.viceCaptain), {
    message: 'The vice-captain must be in the squad',
    path: ['viceCaptain'],
  })
  .refine(
    (entry) => !(entry.wicketKeepers || []).some((id) => !entry.players.includes(id)),
    { message: 'Every wicket-keeper must be in the squad', path: ['wicketKeepers'] }
  );

/**
 * Squads for a fixture, one entry per team. The controller additionally
 * requires that both teams are the fixture's own teams and that every player is
 * on that team's roster — otherwise a self-service fixture could nominate a
 * player who has never played for either side.
 */
export const setOrgMatchSquadsSchema = z
  .object({
    squads: z.array(squadEntry).min(1).max(2),
  })
  .strict()
  .refine((body) => new Set(body.squads.map((s) => s.team)).size === body.squads.length, {
    message: 'Each team may appear only once',
    path: ['squads'],
  });

export const createOrgEventSchema = z
  .object({
    name: z.string().trim().min(1, 'An event needs a name').max(200),
    shortName: z.string().trim().max(60).optional(),
    description: z.string().trim().max(2000).optional(),
    eventType: z.enum(EVENT_TYPES),
    format: z.enum(EVENT_FORMATS).optional(),
    venue: z.string().trim().max(200).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    // Only meaningful for multi-team formats; a single-match event implies 2.
    totalTeams: z.number().int().min(2).max(64).optional(),
    address: addressSchema.optional(),
  })
  .strict()
  .refine((body) => !(body.startDate && body.endDate) || body.endDate >= body.startDate, {
    message: 'The end date cannot be before the start date',
    path: ['endDate'],
  })
  .refine((body) => body.eventType !== 'single-match' || !body.totalTeams, {
    message: 'A single-match event has exactly two teams; totalTeams does not apply',
    path: ['totalTeams'],
  });

export const updateOrgEventSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    shortName: z.string().trim().max(60).optional(),
    description: z.string().trim().max(2000).optional(),
    format: z.enum(EVENT_FORMATS).optional(),
    venue: z.string().trim().max(200).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().nullable().optional(),
    status: z.enum(['upcoming', 'completed']).optional(),
    address: addressSchema.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });

export default {
  createOrgMatchSchema,
  updateOrgMatchSchema,
  setOrgMatchSquadsSchema,
  createOrgEventSchema,
  updateOrgEventSchema,
  MATCH_TYPES,
  ORG_SETTABLE_MATCH_STATUSES,
  EVENT_TYPES,
  EVENT_FORMATS,
};
