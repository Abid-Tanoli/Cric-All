import { z } from "zod";

// zod 4 applies `.default()` even inside `.partial()`: a key the caller did not
// send still comes out of `parse()` with its create-time default. For an update
// route that is data loss, because the controller then writes those defaults
// over the stored document (an owner renaming a team used to blank its logo,
// colours and privacy and make a hidden team public).
//
// `partialWithoutDefaults(schema)` is `schema.partial()` with every top-level
// default removed, so an update body contains only what was sent. It keeps the
// schema's own settings (`.strict()` stays strict) and returns a ZodObject, so
// callers can still `.extend()`, `.strict()` and `.refine()` it. Defaults inside
// a nested object are left alone: a nested block such as `privacy` is sent and
// stored as a whole, so filling its missing keys is the intended behaviour.

function withoutDefault(field) {
  if (field instanceof z.ZodDefault) return withoutDefault(field.removeDefault());
  if (field instanceof z.ZodOptional) {
    const inner = field.unwrap();
    if (inner instanceof z.ZodDefault) return withoutDefault(inner.removeDefault());
  }
  return field;
}

export function partialWithoutDefaults(schema) {
  const overrides = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    overrides[key] = withoutDefault(field).optional();
  }
  return schema.partial().extend(overrides);
}

export default partialWithoutDefaults;
