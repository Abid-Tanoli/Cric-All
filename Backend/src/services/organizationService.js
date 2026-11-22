// Organization types — the single backend source of truth.
//
// The fixed enum replaces the free-form TeamCategory-driven `type`, but `type`
// stays readable/writable during the transition. Every backend write path
// resolves both fields through this module so an old client cannot leave an org
// without an orgType, and a new client cannot write stale type-specific data.

export const ORG_TYPES = Object.freeze([
  "local_club",
  "registered_club",
  "school",
  "college",
  "university",
  "company",
  "foundation",
  "other",
]);

export const ORG_TYPE_SET = new Set(ORG_TYPES);

/** Legacy slugs mapped by the migration. Exact normalized match only. */
export const LEGACY_TYPE_TO_ORG_TYPE = Object.freeze({
  club: "local_club",
  local_club: "local_club",
  registered_club: "registered_club",
  school: "school",
  college: "college",
  university: "university",
  industry: "company",
  business: "company",
  corporate: "company",
  company: "company",
  ngo: "foundation",
  foundation: "foundation",
  other: "other",
});

/** Value written to legacy `type` when a new client sets orgType. */
export const ORG_TYPE_TO_LEGACY_TYPE = Object.freeze({
  local_club: "club",
  registered_club: "club",
  school: "school",
  college: "college",
  university: "university",
  company: "business",
  foundation: "ngo",
  other: "other",
});

const CURRENT_YEAR = () => new Date().getFullYear();

const text = (max, { optional = true } = {}) => ({ kind: "text", max, optional });
const year = () => ({ kind: "year", min: 1800, max: CURRENT_YEAR() + 1, optional: true });
const choice = (values) => ({ kind: "choice", values, optional: true });

/**
 * Allowed `typeDetails` keys per type — exactly the design table in
 * docs/registration-redesign.md §2. Unknown keys are rejected, never stored.
 */
export const TYPE_DETAIL_FIELDS = Object.freeze({
  local_club: Object.freeze({}),
  registered_club: Object.freeze({
    registrationNumber: text(120),
    registrationAuthority: text(160),
    affiliation: text(160),
    foundedYear: year(),
  }),
  school: Object.freeze({
    institutionName: text(180),
    educationLevel: choice(["primary", "middle", "high"]),
    affiliationBoard: text(160),
  }),
  college: Object.freeze({
    institutionName: text(180),
    educationLevel: choice(["intermediate", "degree"]),
    affiliationUniversity: text(180),
  }),
  university: Object.freeze({
    institutionName: text(180),
    department: text(160),
    affiliationBody: text(160),
  }),
  company: Object.freeze({
    companyName: text(180),
    industrySector: text(160),
  }),
  foundation: Object.freeze({
    foundationName: text(180),
    registrationNumber: text(120),
    focusArea: text(240),
  }),
  other: Object.freeze({
    typeNote: text(500),
  }),
});

/** Only these typeDetails keys are safe for an unauthenticated projection. */
export const PUBLIC_TYPE_DETAIL_KEYS = Object.freeze([
  "institutionName",
  "companyName",
  "foundationName",
]);

export class OrgTypeValidationError extends Error {
  constructor(message, { code = "ORG_TYPE_DETAILS_INVALID", status = 422, field = "" } = {}) {
    super(message);
    this.name = "OrgTypeValidationError";
    this.code = code;
    this.status = status;
    this.field = field;
  }
}

export function normalizeLegacyType(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

/** Returns `{ orgType, mapped }`. Unknown values map to `other`, never guessed. */
export function mapLegacyTypeToOrgType(value) {
  const normalized = normalizeLegacyType(value);
  if (!normalized) return { orgType: "other", mapped: false, raw: "" };
  const orgType = LEGACY_TYPE_TO_ORG_TYPE[normalized];
  return { orgType: orgType || "other", mapped: Boolean(orgType), raw: normalized };
}

export function effectiveOrgType(org) {
  if (org?.orgType && ORG_TYPE_SET.has(org.orgType)) return org.orgType;
  return mapLegacyTypeToOrgType(org?.type).orgType;
}

export function legacyTypeForOrgType(orgType) {
  return ORG_TYPE_TO_LEGACY_TYPE[orgType] || "other";
}

/**
 * Mongo clause that finds both new and legacy rows for a requested type.
 *
 * Accepts either an orgType or a legacy `type` slug (callers differ), covers all
 * legacy aliases of a type, and never maps an unknown value to "other" — an
 * unknown filter must return no rows, not every uncategorised organization.
 */
export function orgTypeQuery(value) {
  const raw = normalizeLegacyType(value);
  if (!raw) return null;

  const aliases = new Set();
  if (ORG_TYPE_SET.has(raw)) aliases.add(raw);
  for (const [legacy, mapped] of Object.entries(LEGACY_TYPE_TO_ORG_TYPE)) {
    if (mapped === raw) aliases.add(legacy);
    if (legacy === raw) aliases.add(mapped);
  }

  const orgTypes = [...aliases].filter((alias) => ORG_TYPE_SET.has(alias));
  const legacyTypes = [...aliases].filter((alias) => !ORG_TYPE_SET.has(alias));
  const clauses = [];
  if (orgTypes.length) clauses.push({ orgType: { $in: orgTypes } });
  if (legacyTypes.length) clauses.push({ orgType: { $exists: false }, type: { $in: legacyTypes } });
  if (!clauses.length) clauses.push({ type: raw });
  return { $or: clauses };
}

function sanitizeText(value, rule, field) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value !== "string") {
    throw new OrgTypeValidationError(`${field} must be text`, { field });
  }
  // Control characters and angle brackets have no place in a display name;
  // collapse whitespace so trimmed input cannot smuggle newlines into the UI.
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length > rule.max) {
    throw new OrgTypeValidationError(`${field} must be at most ${rule.max} characters`, { field });
  }
  return cleaned;
}

function sanitizeYear(value, rule, field) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    throw new OrgTypeValidationError(`${field} must be a whole year`, { field });
  }
  if (number < rule.min || number > rule.max()) {
    throw new OrgTypeValidationError(`${field} must be between ${rule.min} and ${rule.max()}`, { field });
  }
  return number;
}

/**
 * Validate and normalize one `typeDetails` object. Unknown keys are rejected so
 * a caller cannot put registration data into an unrelated type's subdocument.
 */
export function validateTypeDetails(orgType, rawDetails = {}) {
  if (!ORG_TYPE_SET.has(orgType)) {
    throw new OrgTypeValidationError("Unknown organization type", { code: "ORG_TYPE_UNKNOWN" });
  }
  if (rawDetails === undefined || rawDetails === null) return undefined;
  if (typeof rawDetails !== "object" || Array.isArray(rawDetails)) {
    throw new OrgTypeValidationError("typeDetails must be an object");
  }

  const allowed = TYPE_DETAIL_FIELDS[orgType];
  const unknown = Object.keys(rawDetails).filter((key) => !(key in allowed));
  if (unknown.length) {
    throw new OrgTypeValidationError(`typeDetails is not valid for ${orgType}: ${unknown.join(", ")}`, {
      field: unknown[0],
    });
  }

  const out = {};
  for (const [key, rule] of Object.entries(allowed)) {
    if (!(key in rawDetails)) continue;
    const value = rawDetails[key];
    if (rule.kind === "text") {
      out[key] = sanitizeText(value, rule, key);
    } else if (rule.kind === "year") {
      out[key] = sanitizeYear(value, rule, key);
    } else if (rule.kind === "choice") {
      const choiceValue = value === null || value === undefined || value === "" ? "" : String(value).trim();
      if (choiceValue && !rule.values.includes(choiceValue)) {
        throw new OrgTypeValidationError(`${key} must be one of ${rule.values.join(", ")}`, { field: key });
      }
      out[key] = choiceValue;
    }
  }
  return out;
}

/** Public projection of typeDetails: only the display name is disclosed. */
export function publicTypeDetails(orgType, details) {
  const allowed = new Set(PUBLIC_TYPE_DETAIL_KEYS);
  const source = details && typeof details === "object" ? details : {};
  const out = {};
  for (const key of PUBLIC_TYPE_DETAIL_KEYS) {
    if (allowed.has(key) && source[key]) out[key] = source[key];
  }
  return out;
}

/**
 * Resolve orgType + legacy type for a new organization.
 * A legacy client sending only `type` still gets a correct orgType; a new
 * client sending only `orgType` still gets a valid legacy `type`.
 */
export function resolveCreateFields({ orgType, type, typeDetails }) {
  const fromLegacy = mapLegacyTypeToOrgType(type);
  const resolvedOrgType = orgType || (type ? fromLegacy.orgType : "other");
  if (!ORG_TYPE_SET.has(resolvedOrgType)) {
    throw new OrgTypeValidationError("Unknown organization type", { code: "ORG_TYPE_UNKNOWN" });
  }
  return {
    orgType: resolvedOrgType,
    // Preserve an explicit legacy value; otherwise write the mapped slug.
    type: normalizeLegacyType(type) || legacyTypeForOrgType(resolvedOrgType),
    typeDetails: validateTypeDetails(resolvedOrgType, typeDetails),
  };
}

/**
 * Resolve an update. When orgType changes and the caller did not send fresh
 * details, the old type's details are dropped rather than left stale.
 */
export function resolveUpdateFields({ orgType, type, typeDetails }, existing = {}) {
  const currentOrgType = effectiveOrgType(existing);
  const nextOrgType = orgType || (type ? mapLegacyTypeToOrgType(type).orgType : currentOrgType);
  if (!ORG_TYPE_SET.has(nextOrgType)) {
    throw new OrgTypeValidationError("Unknown organization type", { code: "ORG_TYPE_UNKNOWN" });
  }
  const typeChanged = nextOrgType !== currentOrgType;
  const detailsChanged = typeDetails !== undefined;

  let details;
  if (detailsChanged) {
    details = validateTypeDetails(nextOrgType, typeDetails);
  } else if (typeChanged) {
    details = undefined; // cleared by the caller with $unset
  }

  return {
    orgType: nextOrgType,
    // Keep an existing legacy value on detail-only edits; only rewrite `type`
    // when the caller chose a new type explicitly.
    type: normalizeLegacyType(type) || (typeChanged ? legacyTypeForOrgType(nextOrgType) : normalizeLegacyType(existing?.type) || legacyTypeForOrgType(nextOrgType)),
    typeDetails: details,
    typeChanged,
    detailsChanged,
    registrationNumberChanged:
      detailsChanged &&
      String(existing?.typeDetails?.registrationNumber || "") !== String(details?.registrationNumber || ""),
  };
}

export function canRequestVerification(org) {
  return (
    effectiveOrgType(org) === "registered_club" &&
    Boolean(String(org?.typeDetails?.registrationNumber || "").trim())
  );
}

export function isSensitiveVerificationChange({ typeChanged, registrationNumberChanged } = {}) {
  return Boolean(typeChanged || registrationNumberChanged);
}

export default {
  ORG_TYPES,
  ORG_TYPE_SET,
  LEGACY_TYPE_TO_ORG_TYPE,
  ORG_TYPE_TO_LEGACY_TYPE,
  TYPE_DETAIL_FIELDS,
  PUBLIC_TYPE_DETAIL_KEYS,
  OrgTypeValidationError,
  normalizeLegacyType,
  mapLegacyTypeToOrgType,
  effectiveOrgType,
  legacyTypeForOrgType,
  orgTypeQuery,
  validateTypeDetails,
  publicTypeDetails,
  resolveCreateFields,
  resolveUpdateFields,
  canRequestVerification,
  isSensitiveVerificationChange,
};
