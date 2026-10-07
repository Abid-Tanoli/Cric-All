import { z } from "zod";
import { isValidPhone, normalizePhone } from "../utils/phone.js";

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

// Phone as typed by a human; validity is judged after normalization, so
// "0300 1234567", "+92-300-1234567" and "00923001234567" are all acceptable.
const phone = z
  .string()
  .trim()
  .min(7)
  .max(30)
  .refine((v) => isValidPhone(v), "Please use a valid phone number");

// Login accepts an email address or a phone number in any of three keys, so
// older clients that still post `{email}` keep working.
const identifier = z.string().trim().min(3).max(254);

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

export const registerSchema = z
  .object({
    name,
    // `""` means "I did not fill this in" from every existing client (the old
    // register form always posted an empty phone), so it is treated as absent
    // instead of failing min-length validation.
    email: z.preprocess((v) => (v === "" || v === null ? undefined : v), email.optional()),
    phone: z.preprocess((v) => (v === "" || v === null ? undefined : v), phone.optional()),
    password,
    accountType,
    organizationCategory,
    organizationName: shortText,
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
  })
  .superRefine((data, ctx) => {
    // Phone is a full alternative to email: signup needs at least one of the
    // two, never neither.
    if (!data.email && !data.phone) {
      ctx.addIssue({
        code: "custom",
        message: "Enter an email address or a phone number",
        path: ["email"],
      });
    }
  });

export const loginSchema = z
  .object({
    identifier: identifier.optional(),
    email: identifier.optional(),
    phone: identifier.optional(),
    password: z.string().min(1, "Password is required").max(200),
  })
  .superRefine((data, ctx) => {
    if (!data.identifier && !data.email && !data.phone) {
      ctx.addIssue({
        code: "custom",
        message: "Email or phone number is required",
        path: ["identifier"],
      });
    }
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

export const verifyPhoneSchema = z.object({
  phone: z.string().trim().min(7).max(30),
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "The verification code is 6 digits"),
});

export const resendPhoneOtpSchema = z.object({
  phone: z.string().trim().min(7).max(30),
});

export default {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  googleAuthSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  verifyPhoneSchema,
  resendPhoneOtpSchema,
};
