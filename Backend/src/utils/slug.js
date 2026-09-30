/** URL-safe slug: lowercase, ASCII-ish, hyphen separated, trimmed to length. */
export function slugify(value, maxLength = 60) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

/**
 * Find a free slug by appending -2, -3, … `isTaken` is awaited per candidate.
 */
export async function uniqueSlug(base, isTaken, maxLength = 60) {
  const root = slugify(base, maxLength) || "organization";
  if (!(await isTaken(root))) return root;
  for (let n = 2; n < 500; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${root.slice(0, Math.max(1, maxLength - suffix.length))}${suffix}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  return `${root}-${Date.now()}`;
}

export default { slugify, uniqueSlug };
