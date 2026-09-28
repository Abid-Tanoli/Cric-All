import { z } from "zod";

// Auth request validation.
//
// Beyond user-facing errors, these schemas are the NoSQL-injection guard for
// the auth surface: every field is typed, so `{"email": {"$ne": ""}}` is a
// 400 instead of a query operator, and unknown keys are stripped before the
// body reaches a Mongo filter.

const email = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Please use a valid email format");

const password = z.string().min(8, "Password must be at least 8 characters").max(200);

const name = z.string().trim().min(1, "Name is required").max(120);

const accountType = z.enum(["player", "handler", "organization_admin", "viewer"]).default("viewer");

const organizationCategory = z
  .enum([
    "School", "College", "University", "Organization", "Business",
    "Industry", "Club", "Academy", "League", "Other", "",
  ])
  .default("");

const shortText = z.string().trim().max(300).default("");

export const registerSchema = z.object({
  name,
  email,
  password,
  accountType,
  organizationCategory,
  organizationName: shortText,
  phone: shortText,
  joinIntent: shortText,
  // Player registration carries an optional profile blob; it is typed loosely
  // on purpose (the Player model validates it) but still stripped of
  // unexpected keys at the top level.
  playerProfile: z
    .object({
      playingRole: z.string().max(60).optional(),
      battingStyle: z.string().max(60).optional(),
      bowlingStyle: z.string().max(60).optional(),
      category: z.string().max(60).optional(),
      subCategory: z.string().max(60).optional(),
      ageGroup: z.string().max(30).optional(),
      organizationName: z.string().max(200).optional(),
      location: z
        .object({
          town: z.string().max(120).optional(),
          district: z.string().max(120).optional(),
          city: z.string().max(120).optional(),
          province: z.string().max(120).optional(),
        })
        .optional(),
    })
    .loose()
    .optional(),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Password is required").max(200),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({ password });

export const googleAuthSchema = z.object({
  credential: z.string().min(10, "Google credential is required").max(4096),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(16).max(128),
});

export const resendVerificationSchema = z.object({
  email,
});

export default {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  googleAuthSchema,
  verifyEmailSchema,
  resendVerificationSchema,
};
