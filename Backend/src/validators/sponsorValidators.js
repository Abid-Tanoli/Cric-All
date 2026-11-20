import { z } from "zod";

// Sponsor input is public-facing data: a link becomes an <a href> on the user
// app and a logo becomes an <img src>, so both are validated here rather than
// trusted from the owner/admin form.

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** https:// anywhere, plus the usual https://wa.me/<number> short link. */
export function isSafeSponsorLink(value) {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value !== "string" || CONTROL_CHARS.test(value)) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return false;
    if (!parsed.hostname || !parsed.hostname.includes(".")) return false;
    // A wa.me link is only a chat deep link when its path is a phone number.
    if (parsed.hostname.toLowerCase() === "wa.me" && !/^\/\d{6,15}\/?$/.test(parsed.pathname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Local /uploads files, or an external http(s) image. Never javascript:/data:. */
export function isSafeLogoUrl(value) {
  if (typeof value !== "string" || !value || value.length > 600 || CONTROL_CHARS.test(value)) return false;
  if (value.startsWith("/uploads/")) {
    return /^\/uploads\/[A-Za-z0-9._-]+$/.test(value) && !value.includes("..");
  }
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return false;
    if (parsed.protocol === "https:") return true;
    // Local dev/test uploads are served over plain http by the same machine.
    if (parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

const objectId = z.string().trim().regex(/^[0-9a-fA-F]{24}$/, "Must be a valid id");
const name = z.string().trim().min(2, "Name must be at least 2 characters").max(100);
const linkUrl = z
  .string()
  .trim()
  .max(600)
  .refine(isSafeSponsorLink, "Link must be an https:// URL or an https://wa.me/ number");
const logoUrl = z
  .string()
  .trim()
  .max(600)
  .refine(isSafeLogoUrl, "Logo must be a safe /uploads or https:// image URL");
const tier = z.enum(["title", "supporting"]);
const order = z.number().int().min(0).max(999);
const active = z.boolean();
const scope = z.enum(["tournament", "platform"]);
const tournamentRef = objectId.nullable();

// Defaults live only on the create schema. An update must never silently
// reset fields the caller left out (e.g. deactivating a title sponsor must not
// turn it into a supporting sponsor).
const fields = { name, logoUrl, linkUrl, tier, order, active, scope, tournamentRef };

function checkScope(value, ctx) {
  if (value.scope === "tournament" && !value.tournamentRef) {
    ctx.addIssue({ code: "custom", path: ["tournamentRef"], message: "A tournament sponsor needs a tournament" });
  }
  if (value.scope === "platform" && value.tournamentRef) {
    ctx.addIssue({ code: "custom", path: ["tournamentRef"], message: "A platform-wide sponsor cannot target a tournament" });
  }
}

function checkPartialScope(value, ctx) {
  if (value.scope === "tournament" && value.tournamentRef === null) {
    ctx.addIssue({ code: "custom", path: ["tournamentRef"], message: "A tournament sponsor needs a tournament" });
  }
  if (value.scope === "platform" && value.tournamentRef) {
    ctx.addIssue({ code: "custom", path: ["tournamentRef"], message: "A platform-wide sponsor cannot target a tournament" });
  }
}

export const createSponsorSchema = z
  .object({
    ...fields,
    linkUrl: linkUrl.default(""),
    tier: tier.default("supporting"),
    order: order.default(0),
    active: active.default(true),
    scope: scope.default("tournament"),
    tournamentRef: tournamentRef.optional(),
  })
  .strict()
  .superRefine(checkScope);

export const updateSponsorSchema = z
  .object(fields)
  .partial()
  .strict()
  .superRefine(checkPartialScope);

export const reorderSponsorsSchema = z
  .object({
    ids: z.array(objectId).min(1).max(50),
  })
  .strict();

export default { createSponsorSchema, updateSponsorSchema, reorderSponsorsSchema, isSafeSponsorLink, isSafeLogoUrl };
