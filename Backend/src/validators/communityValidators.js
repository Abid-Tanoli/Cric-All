import { z } from "zod";

// Community content is plain text end to end: stored as text, rendered as
// text. A tag is therefore never legitimate input — `.refine` rejects it at
// the edge instead of relying on an output escape that a later rendering path
// might forget to apply.
const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/;
export const containsHtml = (value) => HTML_TAG_RE.test(String(value ?? ""));

const objectIdString = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, "Must be a valid id");

// `.max` also rejects non-strings (objects carrying `$ne`/`$regex` arrive as
// type errors, not as query operators), which is what makes this schema the
// NoSQL guard for every text field it covers.
const text = (max, label) =>
  z
    .string()
    .max(max, `${label} must be at most ${max} characters`)
    .refine((value) => !HTML_TAG_RE.test(value), `${label} must not contain HTML tags`);

const mediaItem = z
  .object({
    url: z.string().trim().max(600, "Image URL is too long"),
    alt: text(200, "Alt text").optional(),
  })
  .strict();

const KINDS = ["photo", "video", "article", "story"];
const SUBJECT_TYPES = ["team", "player", "user"];

const postFields = {
  kind: z.enum(KINDS),
  subject: z
    .object({
      type: z.enum(SUBJECT_TYPES),
      ref: objectIdString,
    })
    .strict(),
  title: text(120, "Title").optional(),
  body: text(10000, "Body").optional(),
  // Hard ceiling of 6 here; the *effective* limit is settings.maxImagesPerPost,
  // checked in the controller so an admin can lower it without a deploy.
  media: z.array(mediaItem).max(6, "At most 6 images per post").optional(),
  videoUrl: z.string().trim().max(500, "Video URL is too long").optional(),
};

// `.strict()` keeps `authorUser`, `status` and the counters out of the request
// entirely: the server decides who authored a post, what status it starts in
// and what its counters say.
export const createPostSchema = z.object(postFields).strict();

export const updatePostSchema = z
  .object({
    kind: z.enum(KINDS).optional(),
    title: text(120, "Title").optional(),
    body: text(10000, "Body").optional(),
    media: z.array(mediaItem).max(6, "At most 6 images per post").optional(),
    videoUrl: z.string().trim().max(500, "Video URL is too long").optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");

export const createCommentSchema = z
  .object({
    body: text(1000, "Comment")
      .min(1, "Comment cannot be empty")
      .max(1000, "Comment must be at most 1000 characters"),
  })
  .strict();

export const REPORT_REASONS = [
  "spam",
  "abuse",
  "harassment",
  "hate",
  "nudity",
  "violence",
  "false",
  "copyright",
  "other",
];

export const createReportSchema = z
  .object({
    reason: z.enum(REPORT_REASONS),
    note: text(500, "Note").optional(),
  })
  .strict();

export const adminSettingsPatchSchema = z
  .object({
    communityEnabled: z.boolean().optional(),
    postMode: z.enum(["auto", "approval"]).optional(),
    maxPostsPerUserPerDay: z.number().int().min(1).max(1000).optional(),
    maxImagesPerPost: z.number().int().min(1).max(6).optional(),
    bannedPosters: z.array(objectIdString).max(1000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");

export default {
  containsHtml,
  createPostSchema,
  updatePostSchema,
  createCommentSchema,
  createReportSchema,
  adminSettingsPatchSchema,
  REPORT_REASONS,
};
