import { z } from "zod";

// One definition of the two blocks LocationSelect sends. Every strict write
// schema that receives them imports these same objects, so a form cannot be
// rejected for a key another form is allowed to send.

export const objectIdString = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, "Must be a valid id");

export const locationRefs = z
  .object({
    countryId: objectIdString.nullable().default(null),
    provinceId: objectIdString.nullable().default(null),
    districtId: objectIdString.nullable().default(null),
    cityId: objectIdString.nullable().default(null),
    townId: objectIdString.nullable().default(null),
  })
  .strict()
  .default({});

export const locationLabels = z
  .object({
    country: z.string().trim().max(120).default(""),
    province: z.string().trim().max(120).default(""),
    district: z.string().trim().max(120).default(""),
    city: z.string().trim().max(120).default(""),
    town: z.string().trim().max(120).default(""),
  })
  .strict()
  .default({});
