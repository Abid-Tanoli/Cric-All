import { z } from "zod";
import { ORG_ROLES } from "../permissions/orgPermissions.js";

// Organization, membership and invitation request validation.
//
// Typed fields are the NoSQL-injection guard: `{"name": {"$ne": ""}}` is a 400
// instead of a query operator. These schemas are `.strict()`, so an unexpected
// key is rejected outright rather than silently dropped — a caller that meant
// to set `owner` gets told, instead of having it quietly ignored.
const objectIdString = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, "Must be a valid id");

const orgName = z.string().trim().min(2, "Name must be at least 2 characters").max(150);

const shortName = z.string().trim().max(20).default("");

const optionalText = z.string().trim().max(2000).default("");

const url = z
  .string()
  .trim()
  .max(600)
  .refine((v) => v === "" || /^https?:\/\//i.test(v), "Must start with http:// or https://")
  .default("");

const socialLinks = z
  .record(
    z.string().trim().regex(/^[a-z0-9_-]{1,30}$/i, "Social platform key is invalid").max(30),
    url
  )
  .refine(
    (map) => Object.keys(map).length <= 15,
    "Too many social links"
  )
  .default({});

export const createOrganizationSchema = z
  .object({
    name: orgName,
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(2)
      .max(60)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug may only contain lowercase letters, numbers and hyphens")
      .optional(),
    shortName,
    logoUrl: url,
    coverUrl: url,
    description: optionalText,
    website: url,
    // Drawn from the TeamCategory configuration collection; checked against
    // it in the controller because the validator stays pure.
    type: z.string().trim().toLowerCase().max(40).default("other"),
    foundedYear: z
      .number()
      .int()
      .min(1800)
      .max(new Date().getFullYear() + 1)
      .nullable()
      .default(null),
    location: z
      .object({
        city: z.string().trim().max(120).default(""),
        area: z.string().trim().max(120).default(""),
        address: z.string().trim().max(400).default(""),
        country: z.string().trim().max(80).default(""),
      })
      .strict()
      .default({}),
    contact: z
      .object({
        phone: z.string().trim().max(40).default(""),
        email: z
          .string()
          .trim()
          .toLowerCase()
          .max(254)
          .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Please use a valid email format")
          .default(""),
      })
      .strict()
      .default({}),
    socialLinks,
    privacy: z
      .object({
        contactInfo: z.enum(["public", "hidden"]).default("public"),
        socialLinks: z.enum(["public", "hidden"]).default("public"),
        location: z.enum(["public", "hidden"]).default("public"),
      })
      .strict()
      .default({}),
    category: objectIdString.optional(),
    parent: objectIdString.nullable().optional(),
    // Supervisory — ignored on the self-service path (see the controller).
    isActive: z.boolean().optional(),
    verificationStatus: z.enum(["unverified", "pending", "verified", "rejected"]).optional(),
  })
  .strict();

export const updateOrganizationSchema = createOrganizationSchema.partial();

const emailAddress = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Please use a valid email format");

const rolesArray = z
  .array(z.enum(ORG_ROLES))
  .min(1, "Pick at least one role")
  .max(6, "Too many roles");

// Direct add: an existing, email-verified account joins immediately. This is
// the convenience path; the invitation flow is the default in the UI.
export const addMemberSchema = z
  .object({
    email: emailAddress,
    roles: rolesArray.default(["player"]),
  })
  .strict();

export const updateMemberSchema = z
  .object({
    roles: rolesArray,
  })
  .strict();

export const createInvitationSchema = z
  .object({
    email: emailAddress,
    roles: rolesArray.default(["player"]),
    message: z.string().trim().max(500).default(""),
  })
  .strict();

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  role: z.enum(ORG_ROLES).optional(),
  search: z.string().trim().max(120).default(""),
  status: z
    .enum(["pending", "accepted", "rejected", "expired", "revoked"])
    .optional(),
});

export const acceptInvitationSchema = z
  .object({
    token: z.string().trim().min(16).max(128),
  })
  .strict();

export const invitationIdSchema = z
  .object({
    id: objectIdString,
  })
  .strict();

export default {
  createOrganizationSchema,
  updateOrganizationSchema,
  addMemberSchema,
  updateMemberSchema,
  createInvitationSchema,
  listQuerySchema,
  acceptInvitationSchema,
  invitationIdSchema,
};
