import { readFileSync } from "node:fs";
import Location, { locationSlug, normalizeLocationName } from "../models/Location.js";

const DATA_URL = new URL("../data/locations/pakistan.json", import.meta.url);

export function loadLocationSeedData() {
  return JSON.parse(readFileSync(DATA_URL, "utf8"));
}

// Upsert keyed on (parent, nameKey), the same key the unique index enforces.
// Everything seeded is written with $setOnInsert so running the script again
// is a pure no-op for existing rows and never overwrites an admin edit or a
// merged/renamed node. Nothing is ever deleted.
async function upsertNode({ type, name, nameUr = "", slug, aliases = [], parent = null, source = "" }) {
  const nameKey = normalizeLocationName(name);
  const resolvedSlug = slug || locationSlug(name);
  const existing = await Location.findOne({ parent, nameKey }).select("_id").lean();
  if (existing) return { doc: existing, created: false };

  const doc = await Location.create({
    type,
    name,
    nameKey,
    nameUr,
    slug: resolvedSlug,
    parent,
    aliases,
    source,
    active: true,
    approved: true,
  });
  return { doc, created: true };
}

/**
 * Seeds the versioned location tree. Safe to run repeatedly: it only inserts
 * missing nodes and never deletes or overwrites existing ones.
 */
export async function seedLocations({ data = loadLocationSeedData(), onProgress } = {}) {
  const counts = { countries: 0, provinces: 0, districts: 0, cities: 0, towns: 0, skipped: 0 };

  const country = data.country;
  const countrySource = data.sources?.pakistan || country.source || "";
  const { doc: countryDoc, created: countryCreated } = await upsertNode({
    type: "country",
    name: country.name,
    nameUr: country.nameUr,
    slug: country.slug,
    aliases: country.aliases || [],
    source: countrySource,
  });
  if (countryCreated) counts.countries += 1;
  else counts.skipped += 1;

  for (const province of country.provinces || []) {
    const provinceSource = province.source || countrySource;
    const { doc: provinceDoc, created: provinceCreated } = await upsertNode({
      type: "province",
      name: province.name,
      nameUr: province.nameUr,
      aliases: province.aliases || [],
      parent: countryDoc._id,
      source: provinceSource,
    });
    if (provinceCreated) counts.provinces += 1;
    else counts.skipped += 1;

    for (const district of province.districts || []) {
      const districtSource = district.source || provinceSource;
      const { doc: districtDoc, created: districtCreated } = await upsertNode({
        type: "district",
        name: district.name,
        nameUr: district.nameUr,
        aliases: district.aliases || [],
        parent: provinceDoc._id,
        source: districtSource,
      });
      if (districtCreated) counts.districts += 1;
      else counts.skipped += 1;

      const cityNames = [district.hq, ...(district.cities || [])].filter(Boolean);
      const seen = new Set();
      let hqCityDoc = null;
      for (const cityName of cityNames) {
        const key = normalizeLocationName(cityName);
        if (seen.has(key)) continue;
        seen.add(key);
        const { doc: cityDoc, created } = await upsertNode({
          type: "city",
          name: String(cityName).trim(),
          parent: districtDoc._id,
          source: districtSource,
        });
        // The first city is the district headquarters; towns/areas hang off it
        // because the tree is country > province > district > city > town.
        if (!hqCityDoc) hqCityDoc = cityDoc;
        if (created) counts.cities += 1;
        else counts.skipped += 1;
      }

      for (const town of district.towns || []) {
        const townName = typeof town === "string" ? town : town.name;
        if (!townName) continue;
        const { created } = await upsertNode({
          type: "town",
          name: String(townName).trim(),
          aliases: typeof town === "string" ? [] : town.aliases || [],
          parent: hqCityDoc._id,
          source: districtSource,
        });
        if (created) counts.towns += 1;
        else counts.skipped += 1;
      }
    }
  }

  for (const countryName of data.otherCountries || []) {
    const { created } = await upsertNode({
      type: "country",
      name: countryName,
      source: "Country-only entry; no sub-levels seeded yet.",
    });
    if (created) counts.countries += 1;
    else counts.skipped += 1;
  }

  onProgress?.(counts);
  return {
    version: data.version,
    counts,
    totalSeeded: counts.countries + counts.provinces + counts.districts + counts.cities + counts.towns,
  };
}

export default seedLocations;
