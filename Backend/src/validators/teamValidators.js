import { z } from "zod";

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
  })
  .strict();

export const createOrgTeamSchema = z
  .object({
    name: z.string().trim().min(2, "Team name must be at least 2 characters").max(150),
    shortName: z.string().trim().max(20).default(""),
    type: z.enum(TEAM_TYPES).default("local_team"),
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

export const updateOrgTeamSchema = createOrgTeamSchema
  .omit({ players: true })
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict();

export const orgTeamPlayersSchema = z
  .object({
    playerIds: z.array(objectIdString).min(1, "Pick at least one player").max(120),
  })
  .strict();

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
  orgTeamPlayerRoleSchema,
};
